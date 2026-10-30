/**
 * ComplianceScan MVP — EU/UK 网站合规检测微型 SaaS
 * 后端：Node 原生 http（零硬依赖；Playwright 动态加载，未安装则降级正则）
 *
 * 路由：
 *   GET  /               静态站点
 *   GET  /api/config     返回前端能力开关 + Supabase 配置
 *   POST /api/scan       真实合规扫描（正则 / Playwright 可切换）
 *   POST /api/checkout   Creem 结账（支持 test mode + 真实调用）
 *   POST /api/webhook/creem  Creem Webhook 验签 + 订阅状态更新（Supabase）
 *
 * 说明：服务端抓取不受浏览器 CORS 限制，可抓取第三方站点做合规体检。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============================================================
// 能力开关
// ============================================================
const USE_PLAYWRIGHT = process.env.USE_PLAYWRIGHT === 'true';
let playwright = null;
try {
  playwright = require('playwright');
} catch (_) {
  /* 未安装 Playwright 时自动降级为正则模式 */
}
const PLAYWRIGHT_OK = USE_PLAYWRIGHT && !!playwright;

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON);

const CREEM_TEST = process.env.CREEM_TEST_MODE === 'true';
const CREEM_BASE = CREEM_TEST ? 'https://test-api.creem.io' : 'https://api.creem.io';
const CREEM_CONFIGURED = !!(process.env.CREEM_API_KEY && process.env.CREEM_PRODUCT_ID);

// ============================================================
// 扫描规则
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

// ============================================================
// Creem 结账 + Webhook
// ============================================================
async function createCheckout(email) {
  const apiKey = process.env.CREEM_API_KEY;
  const productId = process.env.CREEM_PRODUCT_ID;
  if (!apiKey || !productId) {
    return {
      demo: true,
      checkoutUrl: 'https://www.creem.io',
      message: '未配置 Creem API Key，当前为演示跳转。在 .env 填入真实密钥后即为真实结账。',
    };
  }
  const res = await fetch(`${CREEM_BASE}/v1/checkout`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      customer: email ? { email } : undefined,
      metadata: { plan: 'monitor-monthly' },
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.message || 'Creem 结账创建失败');
  return { demo: false, testMode: CREEM_TEST, checkoutUrl: d.checkout_url };
}

function verifyCreemWebhook(rawBody, signature) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch (_) {
    return false;
  }
}

// 通过 Supabase REST（service key）写入订阅状态
async function upsertSubscription(email, status, plan) {
  if (!SUPABASE_SERVICE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ email, status, plan, updated_at: new Date().toISOString() }),
    });
  } catch (_) {
    /* 忽略写入失败，仅记录 */
  }
}

// ============================================================
// 静态托管
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

// ============================================================
// 路由
// ============================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 能力开关 + Supabase 配置（anon key 可公开）
  if (req.method === 'GET' && req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        supabaseEnabled: SUPABASE_ENABLED,
        supabaseUrl: SUPABASE_URL,
        supabaseAnon: SUPABASE_ANON,
        playwrightEnabled: PLAYWRIGHT_OK,
        creemDemo: !CREEM_CONFIGURED,
        creemTest: CREEM_TEST,
      })
    );
    return;
  }

  // 免费合规扫描
  if (req.method === 'POST' && req.url === '/api/scan') {
    let body = '';
    req.on('data', (c) => {
      if (body.length < 3_000_000) body += c;
    });
    req.on('end', async () => {
      try {
        const { url } = JSON.parse(body || '{}');
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '缺少 url 参数' }));
          return;
        }
        const result = await scanSite(url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 结账接入
  if (req.method === 'POST' && req.url === '/api/checkout') {
    let body = '';
    req.on('data', (c) => {
      if (body.length < 100_000) body += c;
    });
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body || '{}');
        const result = await createCheckout(email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Creem Webhook（先收集原始 body 用于验签）
  if (req.method === 'POST' && req.url === '/api/webhook/creem') {
    let raw = '';
    req.on('data', (c) => {
      if (raw.length < 1_000_000) raw += c;
    });
    req.on('end', async () => {
      const signature = req.headers['creem-signature'] || req.headers['x-creem-signature'] || '';
      if (!verifyCreemWebhook(raw, signature)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '签名校验失败' }));
        return;
      }
      try {
        const evt = JSON.parse(raw);
        const email = evt?.object?.customer?.email || evt?.customer?.email;
        const status = evt?.event_type || 'unknown';
        if (email) {
          const plan = 'monitor-monthly';
          await upsertSubscription(email, status, plan);
        }
        console.log('[webhook] Creem 事件:', evt?.event_type, email || '');
      } catch (e) {
        console.error('[webhook] 解析失败', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`ComplianceScan MVP 运行中 → http://localhost:${PORT}`);
  console.log(
    `  扫描引擎: ${PLAYWRIGHT_OK ? 'Playwright(真浏览器)' : '正则(降级)'} | ` +
      `Supabase: ${SUPABASE_ENABLED ? '已启用' : '未配置'} | ` +
      `Creem: ${CREEM_CONFIGURED ? (CREEM_TEST ? 'Test 模式' : '生产') : 'Demo 模式'}`
  );
});
