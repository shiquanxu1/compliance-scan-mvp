/**
 * ComplianceScan — 扫描引擎（可复用于 HTTP 服务与定时脚本）
 *
 * 导出：scanSite(rawUrl) → { url, engine, score, checks, foundTrackers, recommendations, wcag, ... }
 * 采集方式：Playwright 真浏览器（USE_PLAYWRIGHT=true 且已安装）或正则（零依赖降级）。
 *
 * 合规维度：
 *   1) GDPR/ePrivacy 基础合规（HTTPS / 隐私政策 / Cookie 同意 / 追踪 / 法律实体）
 *   2) WCAG 2.1 无障碍（lang / title / 图片 alt / 表单标签 / 链接文本 / 标题结构）
 *      —— 对应欧盟 Web Accessibility Directive 与 EN 301 549。
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

// ---- 正则模式采集（含 WCAG 粗粒度启发式）----
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

  // ---- WCAG 启发式（正则）----
  const hasLang = /<html[^>]*\slang=/i.test(html);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const hasTitle = !!(titleMatch && titleMatch[1].trim().length > 0);
  const totalImgs = (html.match(/<img\b/gi) || []).length;
  const imgsWithAlt = (html.match(/<img\b[^>]*\balt=/gi) || []).length;
  const imgsNoAlt = Math.max(0, totalImgs - imgsWithAlt);
  // 可见文本型输入（text/email/search/url/tel/number/password 等）缺少 aria-label / id
  const visibleInputs = html.match(
    /<input\b[^>]*\btype=(?:"(text|email|search|url|tel|number|password|date)"|'(text|email|search|url|tel|number|password|date)')/gi
  ) || [];
  const inputsNoLabel = visibleInputs.filter(
    (s) => !/\baria-label=/i.test(s) && !/\bid=/i.test(s)
  ).length;
  const headings = (html.match(/<h[1-6]\b/gi) || []).length;

  return {
    html,
    trackers: [...trackers],
    consentDetected,
    cookiesSet: false,
    httpsOk,
    fetchError,
    wcag: { hasLang, hasTitle, totalImgs, imgsNoAlt, inputsNoLabel, headings },
  };
}

// ---- Playwright 无头浏览器（真渲染级采集）----
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
  let wcag = { hasLang: false, hasTitle: false, totalImgs: 0, imgsNoAlt: 0, inputsNoLabel: 0, headings: 0 };
  try {
    const resp = await page.goto(target, { waitUntil: 'networkidle', timeout: 15000 });
    httpsOk = (resp && resp.url().startsWith('https://')) || target.startsWith('https://');
    html = await page.content();
    consentDetected = CONSENT_TEXT.test(html) || COOKIE_CONSENT.some((re) => re.test(html));
    cookiesSet = await page.evaluate(
      () => document.cookie.length > 0 || Object.keys(localStorage).length > 0
    );
    // 更准确的 WCAG 评估（基于 DOM）
    wcag = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      const imgsNoAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
      const inputs = [...document.querySelectorAll('input,select,textarea')].filter((el) => {
        const t = (el.type || '').toLowerCase();
        if (el.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(t)) return false;
        const labelled =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          (el.id && document.querySelector(`label[for="${el.id}"]`));
        return !labelled;
      });
      const links = [...document.querySelectorAll('a')];
      const emptyLinks = links.filter(
        (a) => !(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img')
      ).length;
      const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
      const buttons = [...document.querySelectorAll('button')];
      const emptyButtons = buttons.filter(
        (b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label')
      ).length;
      return {
        hasLang: document.documentElement.hasAttribute('lang'),
        hasTitle: !!(document.title && document.title.trim().length > 0),
        totalImgs: imgs.length,
        imgsNoAlt,
        inputsNoLabel: inputs.length,
        emptyLinks,
        emptyButtons,
        headings,
      };
    });
  } catch (e) {
    fetchError = e.message || '浏览器渲染失败';
  } finally {
    await browser.close().catch(() => {});
  }
  return { html, trackers: [...trackers], consentDetected, cookiesSet, httpsOk, fetchError, wcag };
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

// ============================================================
// GDPR / ePrivacy 评估
// ============================================================
function evaluateGdpr(data) {
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

// ============================================================
// WCAG 2.1 无障碍评估（对应欧盟 Web Accessibility Directive / EN 301 549）
// ============================================================
function evaluateWcag(w) {
  const checks = [];
  const issues = [];

  checks.push({
    key: 'lang',
    label: '<html lang> 语言声明',
    pass: w.hasLang,
    weight: 15,
    detail: w.hasLang
      ? '页面声明了语言，屏幕阅读器可正确发音。'
      : '缺少 <html lang> 属性。WCAG 3.1.1 要求为每个页面指定语言。',
  });
  if (!w.hasLang) issues.push('为 <html> 添加 lang 属性，如 <html lang="en">');

  checks.push({
    key: 'title',
    label: '页面标题 <title>',
    pass: w.hasTitle,
    weight: 10,
    detail: w.hasTitle
      ? '页面有描述性标题，帮助用户定位。'
      : '缺少 <title> 或为空。WCAG 2.4.2 要求每个页面有标题。',
  });
  if (!w.hasTitle) issues.push('为页面添加唯一且描述性的 <title>');

  const imgOk = w.totalImgs > 0 ? w.imgsNoAlt === 0 : true;
  checks.push({
    key: 'img-alt',
    label: '图片替代文本 (alt)',
    pass: imgOk,
    weight: 25,
    detail:
      w.totalImgs === 0
        ? '未检测到图片，跳过（装饰性图片应使用空 alt=""）。'
        : `共 ${w.totalImgs} 张图片，其中 ${w.imgsNoAlt} 张缺少 alt 属性。${
            w.imgsNoAlt ? 'WCAG 1.1.1 要求所有有意义图片提供替代文本。' : '所有图片均含 alt，符合 WCAG 1.1.1。'
          }`,
  });
  if (w.imgsNoAlt > 0) issues.push(`为 ${w.imgsNoAlt} 张图片补充 alt 属性（装饰图用 alt=""）`);

  checks.push({
    key: 'form-label',
    label: '表单控件标签',
    pass: w.inputsNoLabel === 0,
    weight: 20,
    detail:
      w.inputsNoLabel > 0
        ? `${w.inputsNoLabel} 个输入控件缺少 <label> 或 aria-label。WCAG 1.3.1/3.3.2 要求每个控件有可访问名称。`
        : '所有可见表单控件均有关联标签，符合 WCAG。',
  });
  if (w.inputsNoLabel > 0) issues.push(`为 ${w.inputsNoLabel} 个输入控件补充 label 或 aria-label`);

  const linkOk = w.emptyLinks === 0 && w.emptyButtons === 0;
  checks.push({
    key: 'link-text',
    label: '链接 / 按钮可识别文本',
    pass: linkOk,
    weight: 15,
    detail:
      linkOk
        ? '链接与按钮均含可识别文本或 aria-label。'
        : `检测到 ${w.emptyLinks} 个空链接、${w.emptyButtons} 个空按钮。WCAG 2.4.4/4.1.2 要求控件有可理解名称。`,
  });
  if (!linkOk) issues.push('为空的链接 / 按钮补充可见文本或 aria-label');

  checks.push({
    key: 'heading',
    label: '标题结构',
    pass: w.headings > 0,
    weight: 15,
    detail:
      w.headings > 0
        ? `检测到 ${w.headings} 个标题，页面结构清晰。`
        : '页面未使用任何标题标签 (h1–h6)。WCAG 1.3.1 建议用标题建立内容结构。',
  });
  if (w.headings === 0) issues.push('使用 h1–h6 标题建立页面内容层级');

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const passedWeight = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const score = Math.round((passedWeight / totalWeight) * 100);
  const recommendations = checks.filter((c) => !c.pass).map((c) => c.detail);
  return { score, checks, issues, recommendations };
}

async function scanSite(rawUrl) {
  const data = await collect(rawUrl);
  const gdpr = evaluateGdpr(data);
  const wcag = evaluateWcag(data.wcag || {});
  return {
    url: normalizeUrl(rawUrl),
    engine: PLAYWRIGHT_OK ? 'playwright' : 'regex',
    ...gdpr,
    wcag,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  scanSite,
  normalizeUrl,
  PLAYWRIGHT_OK,
  TRACKER_PATTERNS,
  evaluateWcag,
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
