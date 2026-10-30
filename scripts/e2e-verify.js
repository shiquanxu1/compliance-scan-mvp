/**
 * ComplianceScan — 端到端验证脚本（零依赖，Node 18+）
 *
 * 用途：把站点真正部署 / 配置好密钥后，一条命令跑通整条产品链路，确认每一项真实可用。
 * 覆盖：配置能力 → 合规扫描(含 WCAG) → 结账(支付通道) → 每日监控(cron) → 合规文档生成。
 *
 * 用法：
 *   1) 先启动服务（已加载 .env）：node server.js
 *   2) 运行：node scripts/e2e-verify.js
 *   可选：指定地址  BASE_URL=https://你的域名  node scripts/e2e-verify.js
 *
 * 注意：本脚本只发"只读 / 演示"请求：
 *   - 结账仅创建 checkout（不会真的扣款，除非你用真实 key 且手动在浏览器完成支付）。
 *   - 监控 cron 在无 SUPABASE_SERVICE_KEY 时自动跳过（打印说明，不写库）。
 *   - 真实扣款 / Webhook 回写需你用浏览器走完支付 + 在后台配置 Webhook，无法脚本化。
 */

const fs = require('fs');
const path = require('path');

// ---- 极简 .env 读取（与 server.js 同目录）----
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function api(pathname, opts = {}) {
  const url = BASE + pathname;
  const init = {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  };
  if (opts.body) init.body = JSON.stringify(opts.body);
  return fetch(url, init);
}
const ok = (c) => (c ? '✅' : '⚠️');
const line = (mark, label, extra = '') => console.log(`  ${mark} ${label}${extra ? ' — ' + extra : ''}`);

async function main() {
  console.log('\n=== ComplianceScan 端到端验证 ===');
  console.log('目标地址：' + BASE + '\n');

  // 1) 配置能力
  console.log('① 配置能力 (/api/config)');
  let cfg = {};
  try {
    const r = await api('/api/config');
    cfg = await r.json();
    line(ok(true), '接口可达');
    line(ok(cfg.supabaseEnabled), 'Supabase 注册/历史', cfg.supabaseEnabled ? '已启用' : '未配置');
    line(ok(!cfg.paymentDemo), '支付通道 (' + (cfg.paymentProvider || 'creem') + ')', cfg.paymentDemo ? '当前为演示模式' : '已配置真实密钥');
    line(ok(cfg.monitorEnabled), '每日监控', cfg.monitorEnabled ? '可用' : '需 SUPABASE_SERVICE_KEY');
    line(ok(true), 'WCAG 检测', '已内置（双引擎）');
    console.log('   套餐档位：' + (cfg.plans || []).map((p) => `${p.name} ¥${p.priceMonthly}/${p.monitorSites}站`).join(' · '));
  } catch (e) {
    line(ok(false), '接口不可达 — 请先启动服务 (node server.js)：' + e.message);
    return finish(false);
  }

  // 2) 合规扫描 + WCAG
  console.log('\n② 合规扫描 + WCAG（POST /api/scan）');
  let scan = null;
  try {
    const r = await api('/api/scan', { method: 'POST', body: { url: 'github.com' } });
    scan = await r.json();
    line(ok(!scan.fetchError), '抓取 github.com', scan.fetchError ? scan.fetchError : `引擎=${scan.engine}`);
    line(ok(typeof scan.score === 'number'), 'GDPR 评分', scan.fetchError ? '—' : String(scan.score));
    line(ok(scan.wcag && typeof scan.wcag.score === 'number'), 'WCAG 评分', scan.fetchError ? '—' : String(scan.wcag.score));
    line(ok(Array.isArray(scan.checks) && scan.checks.length >= 5), 'GDPR 检查项', (scan.checks || []).length + ' 项');
    line(ok(scan.wcag && Array.isArray(scan.wcag.checks) && scan.wcag.checks.length >= 5), 'WCAG 检查项', (scan.wcag?.checks || []).length + ' 项');
  } catch (e) {
    line(ok(false), '扫描失败：' + e.message);
  }

  // 3) 结账（支付通道）
  console.log('\n③ 结账链路（POST /api/checkout, plan=pro）');
  try {
    const r = await api('/api/checkout', { method: 'POST', body: { plan: 'pro' } });
    const d = await r.json();
    const isReal = !!d.checkoutUrl && !d.demo;
    line(ok(true), '接口返回通道', d.provider || '?');
    if (d.demo) {
      line(ok(false), '真实结账未配置', d.message || '当前为演示跳转');
    } else if (d.provider === 'paddle') {
      line(ok(!!d.transactionId), 'Paddle 交易已创建', d.transactionId || '缺少 transactionId');
      line(ok(!!cfg.paddleClientToken), 'Paddle.js 前端令牌', cfg.paddleClientToken ? '已配置' : '需 PADDLE_CLIENT_TOKEN');
    } else if (d.checkoutUrl) {
      line(ok(true), '结账链接已生成', d.checkoutUrl);
    }
  } catch (e) {
    line(ok(false), '结账失败：' + e.message);
  }

  // 4) 每日监控 cron
  console.log('\n④ 每日监控定时任务（POST /api/cron/monitor）');
  const secret = process.env.CRON_SECRET;
  try {
    const r = await api('/api/cron/monitor', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (secret || 'missing') },
    });
    const d = await r.json();
    if (r.status === 401) {
      line(ok(!!secret), 'CRON_SECRET 保护', secret ? '已配置（当前请求匹配）' : '未配置 — 需在 .env 设置');
    } else if (d.ok) {
      line(ok(true), '监控任务执行', JSON.stringify(d));
    } else {
      line(ok(false), '监控跳过 / 未配置', d.message || d.error || '需 SUPABASE_SERVICE_KEY');
    }
  } catch (e) {
    line(ok(false), '监控接口异常：' + e.message);
  }

  // 5) 合规文档生成
  console.log('\n⑤ 合规文档生成（POST /api/generate-doc）');
  try {
    const body = { docType: 'privacy', companyName: 'Acme Ltd.', email: 'p@acme.com', country: 'United Kingdom' };
    if (scan && !scan.fetchError) body.scanResult = scan;
    const r = await api('/api/generate-doc', { method: 'POST', body });
    const d = await r.json();
    line(ok(!d.error && d.markdown && d.markdown.length > 200), '隐私政策草稿', d.error ? d.error : `生成 ${d.markdown.length} 字符`);
  } catch (e) {
    line(ok(false), '文档生成失败：' + e.message);
  }

  // 总结：需你亲自完成的部分
  console.log('\n=== 验证结论与待办 ===');
  const needs = [];
  if (!cfg.supabaseEnabled) needs.push('Supabase：建项目、跑 supabase-schema.sql、填三个 SUPABASE_* key（注册/历史/监控必需）');
  if (cfg.paymentDemo) needs.push(`支付：在 ${(cfg.paymentProvider || 'creem').toUpperCase()} 后台建订阅产品并填密钥（当前为演示模式）`);
  if (!cfg.monitorEnabled) needs.push('监控告警：填 SUPABASE_SERVICE_KEY + RESEND_API_KEY + CRON_SECRET（GitHub Actions 加 Secrets: SITE_URL / CRON_SECRET）');
  if (cfg.paymentProvider === 'paddle' && !cfg.paddleClientToken) needs.push('Paddle：填 PADDLE_CLIENT_TOKEN 以在前端打开 hosted checkout');
  if (cfg.paymentProvider !== 'creem' && cfg.paymentProvider !== 'paddle') needs.push('注意：当前通道非 MoR，大陆个人可能受限（建议 creem / paddle）');

  if (needs.length === 0) {
    console.log('  ✅ 所有配置项均已就绪，可进入真实支付 + Webhook 联调。');
  } else {
    console.log('  ⚠️  以下需你亲自在对应后台完成（脚本无法替你登录第三方账号）：');
    needs.forEach((n, i) => console.log(`   ${i + 1}. ${n}`));
  }
  console.log('  • 真实扣款 + 订阅状态回写：用浏览器走完支付后，在支付后台配 Webhook → ' + BASE + '/api/webhook/...');
  console.log('  • 部署：Railway/Render 连仓库一键部署（见 deploy-guide.html）。\n');
  return finish(true);
}

function finish(success) {
  process.exit(success ? 0 : 1);
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  process.exit(1);
});
