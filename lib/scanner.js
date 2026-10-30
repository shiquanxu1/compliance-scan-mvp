/**
 * ComplianceScan — 扫描引擎（可复用于 HTTP 服务与定时脚本）
 *
 * 导出：scanSite(rawUrl) → { url, engine, score, checks, foundTrackers, recommendations, ... }
 * 采集方式：Playwright 真浏览器（USE_PLAYWRIGHT=true 且已安装）或正则（零依赖降级）。
 */

const { URL } = require('url');

const USE_PLAYWRIGHT = process.env.USE_PLAYWRIGHT === 'true';
let playwright = null;
try {
  playwright = require('playwright');
} catch (_) {
  /* 未安装 Playwright 时自动降级为正则模式 */
}
const PLAYWRIGHT_OK = USE_PLAYWRIGHT && !!playwright;

// ============================================================
// 规则
// ============================================================
const TRACKER_PATTERNS = [
  { name: 'Google Analytics', re: /(google-analytics\.com|googletagmanager\.com|gtm\.js)/i },
  { name: 'Meta Pixel', re: /(connect\.facebook\.net|facebook\.com\/tr|fbq)/i },
  { name: 'Hotjar', re: /hotjar\.com/i },
  { name: 'Microsoft Clarity', re: /clarity\.ms/i },
  { name: 'Segment', re: /(segment\.com|segment\.io)/i },
];
function matchTrackers(text, set) {
  for (const t of TRACKER_PATTERNS) if (t.re.test(text)) set.add(t.name);
}

const PRIVACY_HINTS = [
  /privacy[\s-]?policy/i, /privacypolicy/i, /datenschutz/i, /privacy notice/i, /legal notice/i,
];
const COOKIE_CONSENT = [
  /cookie[\s-]?consent/i, /one[\s-]?trust/i, /cookiebot/i, /\bgdpr\b/i,
  /(accept|reject) (all )?cookies/i, /we use cookies/i, /consent management/i,
];
const CONSENT_TEXT =
  /(accept|reject|allow|agree|拒绝|接受|同意).{0,20}(cookie|consent|cookie)/i;

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ---- 数据采集：正则模式（零依赖）----
async function regexCollect(rawUrl) {
  const target = normalizeUrl(rawUrl);
  let html = '';
  let httpsOk = false;
  let fetchError = null;
  const trackers = new Set();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ComplianceScanBot/1.0)' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    httpsOk = res.url.startsWith('https://') || target.startsWith('https://');
    const buf = await res.text();
    html = buf.length > 3_000_000 ? buf.slice(0, 3_000_000) : buf;
    matchTrackers(html, trackers);
    const srcRe = /(?:src|href)=["']([^"']+)["']/gi;
    let m;
    while ((m = srcRe.exec(html))) matchTrackers(m[1], trackers);
  } catch (e) {
    fetchError = e.name === 'AbortError' ? '请求超时（8 秒）' : e.message || '无法访问目标站点';
  }
  const consentDetected = COOKIE_CONSENT.some((re) => re.test(html));
  return { html, trackers: [...trackers], consentDetected, cookiesSet: false, httpsOk, fetchError };
}

// ---- 数据采集：Playwright 无头浏览器（真渲染级）----
async function playwrightCollect(rawUrl) {
  const target = normalizeUrl(rawUrl);
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const trackers = new Set();
  page.on('request', (req) => matchTrackers(req.url(), trackers));
  let html = '';
  let httpsOk = false;
  let consentDetected = false;
  let cookiesSet = false;
  let fetchError = null;
  try {
    const resp = await page.goto(target, { waitUntil: 'networkidle', timeout: 15000 });
    httpsOk = (resp && resp.url().startsWith('https://')) || target.startsWith('https://');
    html = await page.content();
    consentDetected = CONSENT_TEXT.test(html) || COOKIE_CONSENT.some((re) => re.test(html));
    cookiesSet = await page.evaluate(
      () => document.cookie.length > 0 || Object.keys(localStorage).length > 0
    );
  } catch (e) {
    fetchError = e.message || '浏览器渲染失败';
  } finally {
    await browser.close().catch(() => {});
  }
  return { html, trackers: [...trackers], consentDetected, cookiesSet, httpsOk, fetchError };
}

async function collect(rawUrl) {
  if (PLAYWRIGHT_OK) {
    try {
      return await playwrightCollect(rawUrl);
    } catch (_) {
      return regexCollect(rawUrl); // 浏览器失败回退正则
    }
  }
  return regexCollect(rawUrl);
}

// ---- 统一评估（与采集方式无关）----
function evaluate(data) {
  const { html, trackers, consentDetected, httpsOk, fetchError } = data;
  const checks = [];

  checks.push({
    key: 'https',
    label: 'HTTPS 加密传输',
    pass: httpsOk,
    weight: 15,
    detail: httpsOk
      ? '站点通过 HTTPS 提供服务，满足传输安全基线。'
      : '未检测到 HTTPS。GDPR 要求个人数据在传输中加密。',
  });

  let hasPrivacy = false;
  if (html) {
    const links = html.match(/href=["']([^"']+)["']/gi) || [];
    hasPrivacy = links.some((l) => PRIVACY_HINTS.some((re) => re.test(l)));
  }
  checks.push({
    key: 'privacy',
    label: '隐私政策页面',
    pass: hasPrivacy,
    weight: 25,
    detail: hasPrivacy
      ? '检测到隐私政策链接，满足 GDPR 透明性要求。'
      : '未找到隐私政策链接。GDPR 第 13/14 条要求明确告知用户数据处理方式。',
  });

  checks.push({
    key: 'consent',
    label: 'Cookie 同意机制',
    pass: consentDetected,
    weight: 30,
    detail: consentDetected
      ? '检测到 Cookie / 同意机制（含渲染后检测）。'
      : '未发现 Cookie 同意横幅。ePrivacy / GDPR 要求在设置非必要 Cookie 前取得用户同意。',
  });

  const trackerRisk = trackers.length > 0 && !consentDetected;
  checks.push({
    key: 'trackers',
    label: '追踪脚本合规',
    pass: !trackerRisk,
    weight: 20,
    detail: trackers.length
      ? `检测到 ${trackers.join('、')}。${trackerRisk ? '但缺少 Cookie 同意机制，存在违规收集风险。' : '已配合同意机制，风险可控。'}`
      : '未检测到常见追踪脚本（含动态加载）。',
  });

  let hasContact = false;
  if (html) {
    hasContact =
      /(imprint|impressum|contact|@|tel:|email)/i.test(html) &&
      /(company|ltd|limited|inc|gmbh|s\.r\.l|registered)/i.test(html);
  }
  checks.push({
    key: 'entity',
    label: '法律实体信息',
    pass: hasContact,
    weight: 10,
    detail: hasContact
      ? '检测到法律实体 / 联系信息。'
      : '未明确展示运营主体与联系方式，建议补充 Imprint 页（欧盟强制）。',
  });

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const passedWeight = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const score = fetchError ? 0 : Math.round((passedWeight / totalWeight) * 100);
  const recommendations = checks.filter((c) => !c.pass).map((c) => c.detail);
  return { score, fetchError, checks, foundTrackers: trackers, recommendations };
}

async function scanSite(rawUrl) {
  const data = await collect(rawUrl);
  const ev = evaluate(data);
  return {
    url: normalizeUrl(rawUrl),
    engine: PLAYWRIGHT_OK ? 'playwright' : 'regex',
    ...ev,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  scanSite,
  normalizeUrl,
  PLAYWRIGHT_OK,
  TRACKER_PATTERNS,
  // 供文档生成复用
  describeTrackers(trackers) {
    const map = {
      'Google Analytics': '网站流量统计分析（Google LLC）',
      'Meta Pixel': '广告效果与转化追踪（Meta Platforms）',
      Hotjar: '用户行为热图与录屏（Hotjar Ltd）',
      'Microsoft Clarity': '用户行为分析（Microsoft）',
      Segment: '用户数据收集与路由（Twilio Segment）',
    };
    return (trackers || []).map((t) => ({ name: t, purpose: map[t] || '第三方追踪/分析工具' }));
  },
};
