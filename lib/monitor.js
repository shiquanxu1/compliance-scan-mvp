/**
 * ComplianceScan — 每日监控定时任务核心
 *
 * runMonitor()：读取所有 active 监控项 → 校验订阅 → 重扫 → 对比变化 → 违规邮件告警 → 回写。
 * 被 POST /api/cron/monitor（CRON_SECRET 保护）与 scripts/monitor.js 共用。
 *
 * 依赖环境变量：SUPABASE_URL / SUPABASE_SERVICE_KEY（读取/写入 monitors、subscriptions）
 *               RESEND_API_KEY / FROM_EMAIL（告警邮件，缺省则仅日志）
 */

const { scanSite } = require('./scanner');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'ComplianceScan <onboarding@resend.dev>';

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE,
    Authorization: `Bearer ${SUPABASE_SERVICE}`,
    'Content-Type': 'application/json',
  };
}

async function sbSelect(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: supabaseHeaders(),
  });
  if (!res.ok) throw new Error(`Supabase 查询失败 ${table}: ${res.status}`);
  return res.json();
}

async function sbUpdate(table, match, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${match}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase 更新失败 ${table}: ${res.status}`);
}

// 判断订阅是否有效（Creem webhook 写入的 event_type 形如 subscription.active / subscription.canceled）
function isSubscriptionActive(sub) {
  if (!sub || !sub.status) return false;
  const s = String(sub.status).toLowerCase();
  if (/cancel|expire|delet|unpaid|past_due/.test(s)) return false;
  return /active|paid/.test(s);
}

async function checkSubscription(email) {
  if (!SUPABASE_SERVICE) return true; // 未配置 service key 时放行（本地/演示）
  try {
    const rows = await sbSelect(
      `subscriptions?email=eq.${encodeURIComponent(email)}&select=status`
    );
    if (!rows.length) return false;
    return isSubscriptionActive(rows[0]);
  } catch (e) {
    console.error('[monitor] 订阅校验异常:', e.message);
    return false;
  }
}

async function sendAlert(email, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[monitor] (无 RESEND_API_KEY，跳过真实邮件) 收件人=${email} 主题=${subject}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html }),
    });
    if (!res.ok) {
      console.error('[monitor] Resend 发送失败:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[monitor] Resend 异常:', e.message);
    return false;
  }
}

function diffChecks(prevChecks, newChecks) {
  const prevMap = new Map((prevChecks || []).map((c) => [c.key, c.pass]));
  const newFailing = newChecks.filter((c) => !c.pass);
  const newlyFailing = newFailing.filter((c) => prevMap.get(c.key) === true);
  const recovered = (prevChecks || []).filter((c) => !c.pass && newChecks.find((x) => x.key === c.key)?.pass);
  return { newlyFailing, recovered, newFailingCount: newFailing.length };
}

function alertHtml(monitor, scan, diff) {
  const rows = scan.checks
    .map(
      (c) =>
        `<tr><td>${c.label}</td><td>${c.pass ? '✅ 通过' : '❌ 未通过'}</td><td>${
          c.detail
        }</td></tr>`
    )
    .join('');
  const newList = diff.newlyFailing.length
    ? diff.newlyFailing.map((c) => `<li><b>${c.label}</b>：${c.detail}</li>`).join('')
    : '<li>无新增违规项。</li>';
  return `
  <h2>合规评分下降：${monitor.url}</h2>
  <p>你的站点合规评分从 <b>${monitor.last_score ?? '—'}</b> 变为 <b>${scan.score}</b>。</p>
  <h3>新增违规项</h3><ul>${newList}</ul>
  <h3>完整检查结果</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
    <tr><th>检查项</th><th>状态</th><th>说明</th></tr>${rows}
  </table>
  <p style="color:#888;font-size:12px">由 ComplianceScan 自动监控于 ${new Date().toISOString()} 发出。</p>`;
}

async function runMonitor() {
  if (!SUPABASE_SERVICE) {
    return { scanned: 0, alerts: 0, skipped: 0, note: '未配置 SUPABASE_SERVICE_KEY，跳过监控。' };
  }
  const monitors = await sbSelect('monitors?active=eq.true&select=*');
  let scanned = 0;
  let alerts = 0;
  let skipped = 0;

  for (const m of monitors) {
    const active = await checkSubscription(m.email);
    if (!active) {
      // 订阅失效：关闭监控，避免继续扫描
      await sbUpdate(`monitors?id=eq.${m.id}`, {}, { active: false }).catch(() => {});
      skipped++;
      console.log(`[monitor] 订阅失效，关闭监控: ${m.url} (${m.email})`);
      continue;
    }

    let scan;
    try {
      scan = await scanSite(m.url);
    } catch (e) {
      console.error(`[monitor] 扫描失败 ${m.url}:`, e.message);
      continue;
    }

    const diff = diffChecks(m.last_checks, scan.checks);
    const scoreDropped = m.last_score != null && scan.score < m.last_score;
    const shouldAlert =
      scan.fetchError == null && (scoreDropped || diff.newlyFailing.length > 0);

    if (shouldAlert) {
      const subject = `[ComplianceScan] 合规告警：${m.url} 评分 ${m.last_score ?? '—'} → ${scan.score}`;
      await sendAlert(m.email, subject, alertHtml(m, scan, diff));
      alerts++;
      console.log(`[monitor] 已发送告警: ${m.url} (${m.email})`);
    }

    await sbUpdate(
      `monitors?id=eq.${m.id}`,
      {},
      {
        last_score: scan.fetchError ? m.last_score : scan.score,
        last_checks: scan.checks,
        last_scan_at: new Date().toISOString(),
      }
    ).catch((e) => console.error('[monitor] 回写失败:', e.message));

    scanned++;
  }

  return { scanned, alerts, skipped };
}

module.exports = { runMonitor, isSubscriptionActive, diffChecks };
