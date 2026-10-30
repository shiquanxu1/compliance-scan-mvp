#!/usr/bin/env node
/**
 * 测试 Creem 结账链路（无需启动整个应用）
 *
 * 用法：
 *   1. 在 .env 填好 CREEM_API_KEY / CREEM_PRODUCT_ID
 *   2. 测试环境（不扣真钱）：CREEM_TEST_MODE=true
 *   3. node scripts/test-creem.js
 *
 * 脚本会直接调用 Creem 创建一笔结账，返回 checkout_url，
 * 浏览器打开该链接即可用测试卡完成支付，验证整条链路。
 */

const fs = require('fs');
const path = require('path');

// 极简 .env 加载（与 server.js 兼容：只补不设）
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const apiKey = process.env.CREEM_API_KEY;
const productId = process.env.CREEM_PRODUCT_ID;
const testMode = process.env.CREEM_TEST_MODE === 'true';
const base = testMode ? 'https://test-api.creem.io' : 'https://api.creem.io';

(async () => {
  console.log('Creem 环境 :', testMode ? 'TEST（沙箱，不扣费）' : 'PRODUCTION（真实扣费！）');
  if (!apiKey || !productId) {
    console.error('✗ 缺少 CREEM_API_KEY 或 CREEM_PRODUCT_ID。请先在 .env 配置（参考 .env.example）。');
    process.exit(1);
  }

  const email = process.env.TEST_EMAIL || 'test-' + Date.now() + '@example.com';
  console.log('请求结账   : product =', productId, '| customer =', email);

  try {
    const res = await fetch(`${base}/v1/checkout`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        customer: { email },
        metadata: { plan: 'monitor-monthly', test: 'true' },
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      console.error('✗ Creem 返回错误:', res.status, JSON.stringify(d));
      process.exit(1);
    }
    console.log('✓ 结账创建成功');
    console.log('  checkout_url :', d.checkout_url);
    console.log('  checkout_id  :', d.id || d.checkout || '(见返回体)');
    console.log('\n下一步：');
    console.log('  1) 浏览器打开上面的 checkout_url，用 Creem 测试卡完成支付（测试卡号见 Creem 后台 Test mode）。');
    console.log('  2) 配置 CREEM_WEBHOOK_SECRET，并把公网回调指向 /api/webhook/creem 接收订阅状态。');
    console.log('  3) 启动应用：CREEM_TEST_MODE=true node server.js（前端结账即真实跳转 Creem）。');
  } catch (e) {
    console.error('✗ 请求失败:', e.message);
    process.exit(1);
  }
})();
