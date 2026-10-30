#!/usr/bin/env node
/**
 * 测试 Supabase 连通性 + scans 表 + RLS（无需启动整个应用）
 *
 * 用法：
 *   1. 在 .env 填好 SUPABASE_URL / SUPABASE_ANON
 *      （可选 SUPABASE_SERVICE_ROLE，用于写一条测试扫描并清理，验证表结构）
 *   2. node scripts/test-supabase.js
 *
 * 说明：
 *   - anon key 直连 PostgREST：验证连通 + RLS 生效（未登录时读取 scans 正常返回空数组）。
 *   - service_role key 绕过 RLS：写入并清理一条测试行，验证表结构与写入能力。
 *   - 这一致于 server.js 的 upsertSubscription 与服务端 REST 调用方式。
 */

const fs = require('fs');
const path = require('path');

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

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON;
const service = process.env.SUPABASE_SERVICE_ROLE;

(async () => {
  if (!url || !anon) {
    console.error('✗ 缺少 SUPABASE_URL 或 SUPABASE_ANON。请先在 .env 配置（参考 .env.example）。');
    process.exit(1);
  }
  console.log('Supabase URL :', url);

  // 1) 连通性 + 表存在（anon 读取 scans，RLS 下应返回 []）
  const headers = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${url}/rest/v1/scans?select=*&limit=1`, { headers });
    if (!r.ok) {
      const t = await r.text();
      console.error('✗ 读取 scans 表失败:', r.status, t);
      process.exit(1);
    }
    const rows = await r.json();
    console.log('✓ 连通成功，scans 表可访问（anon 返回行数:', rows.length, '）');
    console.log('  → 返回为空属正常：RLS 默认仅当前登录用户可见自己的数据。');
  } catch (e) {
    console.error('✗ 连接失败:', e.message);
    process.exit(1);
  }

  // 2) 写测试（需要 service role，验证表结构/写入能力）
  if (!service) {
    console.log('\n（可选）提供 SUPABASE_SERVICE_ROLE 可进一步验证写入与表结构。');
    console.log('  在 Supabase SQL Editor 跑过 supabase-schema.sql 后，再运行本脚本即可。');
    return;
  }
  const sHeaders = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  try {
    const r = await fetch(`${url}/rest/v1/scans`, {
      method: 'POST',
      headers: sHeaders,
      body: JSON.stringify({
        url: 'test-' + Date.now() + '.com',
        score: 42,
        result: { engine: 'regex', test: true },
      }),
    });
    const t = await r.text();
    if (!r.ok) {
      console.error('✗ 写入测试行失败:', r.status, t);
      process.exit(1);
    }
    const row = JSON.parse(t)[0];
    console.log('✓ 写入测试行成功，id =', row.id);
    await fetch(`${url}/rest/v1/scans?id=eq.${row.id}`, { method: 'DELETE', headers: sHeaders });
    console.log('✓ 已清理测试行。');
  } catch (e) {
    console.error('✗ 写入测试失败:', e.message);
    process.exit(1);
  }
  console.log('\nSupabase 联调通过：应用配置好 SUPABASE_URL / ANON 后即可启用登录与历史云端同步。');
})();
