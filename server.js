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
 *   POST /api/generate-doc   合规文档一键生成（隐私政策 / Cookie 声明 / DPA）
 *   POST /api/cron/monitor   每日监控定时任务（CRON_SECRET 保护）
 *
 * 说明：服务端抓取不受浏览器 CORS 限制，可抓取第三方站点做合规体检。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { scanSite, PLAYWRIGHT_OK } = require('./lib/scanner');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============================================================
// 能力开关
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON);

const CREEM_TEST = process.env.CREEM_TEST_MODE === 'true';
const CREEM_BASE = CREEM_TEST ? 'https://test-api.creem.io' : 'https://api.creem.io';
const CREEM_CONFIGURED = !!(process.env.CREEM_API_KEY && process.env.CREEM_PRODUCT_ID);

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'ComplianceScan <onboarding@resend.dev>';
const CRON_SECRET = process.env.CRON_SECRET || '';

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
// 合规文档生成
// ============================================================
async function handleGenerateDoc(req, res) {
  let body = '';
  req.on('data', (c) => { if (body.length < 3_000_000) body += c; });
  req.on('end', async () => {
    try {
      const { url, companyName, email, country, docType, scanResult } = JSON.parse(body || '{}');
      if (!docType) throw new Error('缺少 docType（privacy | cookie | dpa）');

      // 没有传入扫描结果则实时扫描一次
      let scan = scanResult;
      if (!scan && url) scan = await scanSite(url);

      const { generateDoc } = require('./lib/docs');
      const doc = generateDoc({
        docType,
        url: scan?.url || url || '',
        companyName: companyName || 'Your Company Ltd.',
        email: email || 'privacy@yourcompany.com',
        country: country || 'United Kingdom',
        scan,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ docType, markdown: doc, generatedAt: new Date().toISOString() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ============================================================
// 每日监控定时任务（CRON_SECRET 保护）
// ============================================================
async function handleCronMonitor(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!CRON_SECRET || token !== CRON_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未授权：需要 CRON_SECRET' }));
    return;
  }
  try {
    const { runMonitor } = require('./lib/monitor');
    const summary = await runMonitor();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...summary }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
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
        docGenEnabled: true,
        monitorEnabled: !!SUPABASE_SERVICE,
      })
    );
    return;
  }

  // 免费合规扫描
  if (req.method === 'POST' && req.url === '/api/scan') {
    let body = '';
    req.on('data', (c) => { if (body.length < 3_000_000) body += c; });
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
    req.on('data', (c) => { if (body.length < 100_000) body += c; });
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
    req.on('data', (c) => { if (raw.length < 1_000_000) raw += c; });
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

  // 合规文档生成
  if (req.method === 'POST' && req.url === '/api/generate-doc') {
    handleGenerateDoc(req, res);
    return;
  }

  // 每日监控定时任务
  if (req.method === 'POST' && req.url === '/api/cron/monitor') {
    handleCronMonitor(req, res);
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
      `Creem: ${CREEM_CONFIGURED ? (CREEM_TEST ? 'Test 模式' : '生产') : 'Demo 模式'} | ` +
      `文档生成: 开启 | 监控: ${SUPABASE_SERVICE ? '可用' : '未配置 service key'}`
  );
});
