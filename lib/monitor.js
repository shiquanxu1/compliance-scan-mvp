/**
 * ComplianceScan — 每日监控定时任务核心
 *
 * runMonitor()：读取所有 active 监控项 → 校验订阅 → 重扫 → 对比变化 → 违规邮件告警 → 回写。
 * 被 POST /api/cron/monitor（CRON_SECRET 保护）与 scripts/monitor.js 共用。
 *
 * 依赖环境变量：SUPABASE_URL / SUPABASE_SERVICE_KEY（读取/写入 monitors、subscriptions）
 *               RESEND_API_KEY / FROM_EMAIL / SITE_URL（告警邮件，缺省则仅日志）
 */

const { scanSite } = require('./scanner');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'ComplianceScan <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || '';

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

// 生成趋势迷你图（邮件内嵌 SVG，无需外部图片）
function buildTrendSvg(history) {
  if (!history || history.length < 2) return '';
  const w = 520, h = 120, pad = 18;
  const scores = history.map((p) => p.score);
  const min = Math.min(...scores, 0), max = Math.max(...scores, 100);
  const range = max - min || 1;
  const points = history
    .map((p, i) => {
      const x = pad + (i * (w - 2 * pad)) / (history.length - 1);
      const y = h - pad - ((p.score - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = history[history.length - 1];
  const lastX = pad + ((history.length - 1) * (w - 2 * pad)) / (history.length - 1);
  const lastY = h - pad - ((last.score - min) / range) * (h - 2 * pad);
  return `
  <p style="margin:14px 0 6px;font-size:13px;color:#6b7280">近期评分趋势</p>
  <svg width="100%" viewBox="0 0 ${w} ${h}" style="background:#f8fafc;border-radius:10px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e5e7eb"/>
    <line x1="${pad}" y1="${pad}" x2="${w - pad}" y2="${pad}" stroke="#e5e7eb" stroke-dasharray="3 3"/>
    <polyline points="${points}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="#8b5cf6"/>
  </svg>`;
}

function alertHtml(monitor, scan, diff, history) {
  const rows = scan.checks
    .map(
      (c) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">${c.label}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;white-space:nowrap">
          ${
            c.pass
              ? '<span style="color:#16a34a;font-weight:600">✅ 通过</span>'
              : '<span style="color:#dc2626;font-weight:600">❌ 未通过</span>'
          }
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#52525b">${
          (c.detail || '').slice(0, 160)
        }</td>
      </tr>`
    )
    .join('');

  const newList = diff.newlyFailing.length
    ? diff.newlyFailing.map((c) => `<li style="margin:4px 0">${c.label}：${c.detail}</li>`).join('')
    : '<li style="margin:4px 0">无新增违规项。</li>';

  const recoveredList = diff.recovered.length
    ? diff.recovered.map((c) => `<li style="margin:4px 0">${c.label} 已恢复合规 ✓</li>`).join('')
    : '';

  const trend = buildTrendSvg(history);
  const detailUrl = SITE_URL
    ? `<a href="${SITE_URL}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:600;font-size:14px">查看完整报告</a>`
    : '';

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
    <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:22px 26px;border-radius:14px 14px 0 0">
      <div style="font-size:18px;font-weight:700;color:#fff">⚠️ 合规评分下降</div>
      <div style="color:#ede9fe;font-size:13px;margin-top:4px">${monitor.url}</div>
    </div>
    <div style="background:#fff;padding:24px 26px;border:1px solid #eee;border-top:0;border-radius:0 0 14px 14px">
      <p style="margin:0 0 14px;font-size:15px">你的站点合规评分从
        <b style="color:${monitor.last_score != null && monitor.last_score >= 80 ? '#16a34a' : '#dc2626'}">${
    monitor.last_score ?? '—'
  }</b>
        变为 <b style="color:${scan.score >= 80 ? '#16a34a' : '#dc2626'}">${scan.score}</b>。</p>

      <div style="background:#faf5ff;border-left:4px solid #8b5cf6;padding:12px 16px;border-radius:8px;margin:0 0 18px">
        <div style="font-size:12px;font-weight:700;color:#7c3aed;letter-spacing:.5px;text-transform:uppercase">新增违规项</div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#374151">${newList}</ul>
      </div>

      ${
        recoveredList
          ? `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:8px;margin:0 0 18px">
        <div style="font-size:12px;font-weight:700;color:#15803d;letter-spacing:.5px;text-transform:uppercase">已恢复项</div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#374151">${recoveredList}</ul>
      </div>`
          : ''
      }

      ${trend}

      <h3 style="font-size:14px;margin:20px 0 8px">完整检查结果</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden">
        <tr style="background:#f8fafc">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280">检查项</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280">状态</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280">说明</th>
        </tr>${rows}
      </table>

      <div style="text-align:center;margin:22px 0 8px">${detailUrl}</div>

      <p style="color:#9ca3af;font-size:12px;margin:18px 0 0;line-height:1.5">
        本邮件由 ComplianceScan 自动监控于 ${new Date().toISOString().slice(0, 10)} 发出。<br/>
        合规告警基于每日自动重扫结果，建议尽快整改以降低被监管处罚风险。
      </p>
    </div>
  </div>`;
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

    // 追加趋势历史（仅成功扫描时记录）
    let history = Array.isArray(m.score_history) ? m.score_history : [];
    if (scan.fetchError == null) {
      history = history.concat({ ts: new Date().toISOString(), score: scan.score });
      if (history.length > 30) history = history.slice(-30);
    }

    if (shouldAlert) {
      const subject = `[ComplianceScan] 合规告警：${m.url} 评分 ${m.last_score ?? '—'} → ${scan.score}`;
      await sendAlert(m.email, subject, alertHtml(m, scan, diff, history));
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
        score_history: history,
      }
    ).catch((e) => console.error('[monitor] 回写失败:', e.message));

    scanned++;
  }

  return { scanned, alerts, skipped };
}

module.exports = { runMonitor, isSubscriptionActive, diffChecks };
