// ComplianceScan 前端：扫描 + 评分渲染 + 结账 + 登录/历史
// 支持两种后端：① Supabase 真实账号（云端同步） ② 访客模式（localStorage 本地体验）

// ---------- DOM ----------
const form = document.getElementById('scan-form');
const input = document.getElementById('url-input');
const btn = document.getElementById('scan-btn');
const hint = document.getElementById('scan-hint');
const result = document.getElementById('result');
const scoreVal = document.getElementById('score-val');
const scoreLabel = document.getElementById('score-label');
const scoreUrl = document.getElementById('score-url');
const scoreSummary = document.getElementById('score-summary');
const engineTag = document.getElementById('engine-tag');
const checksEl = document.getElementById('checks');
const wcagBox = document.getElementById('wcag-box');
const wcagScoreEl = document.getElementById('wcag-score');
const wcagSummary = document.getElementById('wcag-summary');
const wcagChecksEl = document.getElementById('wcag-checks');
const ringFg = document.getElementById('ring-fg');
const trackersBox = document.getElementById('trackers-box');
const trackersEl = document.getElementById('trackers');
const recoBox = document.getElementById('reco-box');
const recoList = document.getElementById('reco-list');
const saveNote = document.getElementById('save-note');
const errorBox = document.getElementById('error-box');
const checkoutBtn = document.getElementById('checkout-btn');
const priceGrid = document.getElementById('price-grid');
const subStatus = document.getElementById('sub-status');
const demoNote = document.getElementById('demo-note');
const authArea = document.getElementById('auth-area');
const historySection = document.getElementById('history');
const historyList = document.getElementById('history-list');
const authModal = document.getElementById('auth-modal');
const authClose = document.getElementById('auth-close');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authMsg = document.getElementById('auth-msg');
const authTabs = document.querySelectorAll('.tab');

// ---------- 状态 ----------
const CIRC = 2 * Math.PI * 54;
const LS_HISTORY = 'cs_guest_history';
const LS_SUB = 'cs_guest_sub';
let config = { supabaseEnabled: false, creemDemo: true };
let sb = null;
let currentUser = null;
let guestMode = false;
let authMode = 'login';
let lastResult = null;

// ---------- localStorage 工具（访客模式） ----------
function getGuestHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; }
}
function setGuestHistory(arr) {
  localStorage.setItem(LS_HISTORY, JSON.stringify(arr));
}
function isGuestSub() { return localStorage.getItem(LS_SUB) === '1'; }
function setGuestSub(v) { v ? localStorage.setItem(LS_SUB, '1') : localStorage.removeItem(LS_SUB); }

// ---------- 初始化 ----------
async function init() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (_) {}
  renderPricing();

  if (config.supabaseEnabled && window.supabase) {
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnon);
    sb.auth.onAuthStateChange((_e, session) => {
      currentUser = session?.user || null;
      renderAuth();
      if (currentUser) { loadHistory(); loadMonitors(); } else { hideHistory(); hideMonitors(); }
    });
    const { data } = await sb.auth.getUser();
    currentUser = data.user || null;
    renderAuth();
    if (currentUser) { loadHistory(); loadMonitors(); }
  } else {
    guestMode = true;
    demoNote.textContent =
      '访客体验模式：扫描历史保存在本机浏览器，订阅为本地模拟。配置 Supabase + Creem 后即变为真实云端产品（详见 README）。';
    demoNote.classList.remove('hidden');
    renderAuth();
    loadHistory();
    if (isGuestSub()) showSubStatus('持续监控已开启（本机演示，未真实扣费）。', true);
  }
}

// ---------- 评分渲染 ----------
function setRing(score) {
  ringFg.style.strokeDashoffset = String(CIRC * (1 - score / 100));
  ringFg.style.stroke = scoreColor(score);
}
function scoreColor(score) {
  return score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--orange)' : 'var(--red)';
}
function grade(score) {
  if (score >= 80) return '合规良好';
  if (score >= 50) return '存在风险';
  return '高风险';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------- 扫描 ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  btn.disabled = true;
  btn.textContent = '扫描中…';
  hint.textContent = '正在抓取并分析合规项…';
  result.classList.add('hidden');
  errorBox.classList.add('hidden');
  saveNote.classList.add('hidden');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '扫描失败');
    lastResult = data;
    render(data);
    await afterScan(data);
  } catch (err) {
    errorBox.textContent = '⚠️ ' + err.message;
    errorBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '免费扫描';
  }
});

function render(data) {
  result.classList.remove('hidden');
  scoreUrl.textContent = data.url;
  engineTag.textContent = '扫描引擎：' + (data.engine === 'playwright' ? 'Playwright 真浏览器' : '正则');

  if (data.fetchError) {
    scoreVal.textContent = '—';
    scoreLabel.textContent = '无法访问';
    scoreLabel.style.color = 'var(--red)';
    scoreSummary.textContent = data.fetchError + '。请确认域名正确且站点可公开访问。';
    checksEl.innerHTML = '';
    wcagBox.classList.add('hidden');
    trackersBox.classList.add('hidden');
    recoBox.classList.add('hidden');
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  setRing(data.score);
  scoreVal.textContent = String(data.score);
  scoreLabel.textContent = grade(data.score);
  scoreLabel.style.color = scoreColor(data.score);
  scoreSummary.textContent =
    data.score >= 80
      ? '你的站点合规基础扎实，建议开启持续监控以防回退。'
      : '发现若干合规缺口，按下方建议整改可降低被罚风险。';

  checksEl.innerHTML = data.checks
    .map(
      (c) => `
      <div class="check ${c.pass ? 'pass' : 'fail'}">
        <div class="check-icon">${c.pass ? '✓' : '✕'}</div>
        <div class="check-body">
          <div class="check-label">${c.label}<span class="weight">权重 ${c.weight}</span></div>
          <div class="check-detail">${c.detail}</div>
        </div>
      </div>`
    )
    .join('');

  renderWcag(data.wcag);

  if (data.foundTrackers && data.foundTrackers.length) {
    trackersEl.innerHTML = data.foundTrackers.map((t) => `<span class="chip">${t}</span>`).join('');
    trackersBox.classList.remove('hidden');
  } else {
    trackersBox.classList.add('hidden');
  }

  if (data.recommendations && data.recommendations.length) {
    recoList.innerHTML = data.recommendations.map((r) => `<li>${r}</li>`).join('');
    recoBox.classList.remove('hidden');
  } else {
    recoBox.classList.add('hidden');
  }

  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderWcag(wcag) {
  if (!wcag || typeof wcag.score !== 'number') {
    wcagBox.classList.add('hidden');
    return;
  }
  wcagBox.classList.remove('hidden');
  const s = wcag.score;
  wcagScoreEl.textContent = String(s);
  wcagScoreEl.style.background = scoreColor(s);
  wcagSummary.textContent =
    s >= 80
      ? '无障碍支持良好，符合 WCAG 2.1 AA 大部分要求。'
      : '存在无障碍缺陷，可能影响欧盟 / 英国合规（EN 301 549）与用户体验。';
  wcagChecksEl.innerHTML = (wcag.checks || [])
    .map(
      (c) => `
      <div class="check ${c.pass ? 'pass' : 'fail'}">
        <div class="check-icon">${c.pass ? '✓' : '✕'}</div>
        <div class="check-body">
          <div class="check-label">${c.label}<span class="weight">权重 ${c.weight}</span></div>
          <div class="check-detail">${c.detail}</div>
        </div>
      </div>`
    )
    .join('');
}

// 扫描后：保存历史 / 提示
async function afterScan(data) {
  if (data.fetchError) return;
  if (guestMode) {
    saveGuestHistory(data);
    saveNote.textContent = '✓ 已保存到本机（访客模式）';
    saveNote.classList.remove('hidden');
    return;
  }
  if (currentUser) {
    const saved = await saveHistory(data);
    saveNote.textContent = saved ? '✓ 已保存到你的扫描历史' : '历史保存失败，请稍后重试。';
  } else if (config.supabaseEnabled) {
    saveNote.textContent = '登录后可自动保存扫描历史。';
  } else {
    return;
  }
  saveNote.classList.remove('hidden');
}

// ---------- 结账 ----------
async function goCheckout(plan) {
  plan = plan || 'starter';
  checkoutBtn.disabled = true;
  const original = checkoutBtn.textContent;
  checkoutBtn.textContent = '跳转中…';
  try {
    const body = currentUser
      ? JSON.stringify({ email: currentUser.email, plan })
      : JSON.stringify({ plan });
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();

    // Paddle 真实结账：用 Paddle.js 打开 hosted checkout
    if (data.provider === 'paddle' && data.transactionId && config.paddleClientToken) {
      await openPaddleCheckout(data);
      checkoutBtn.textContent = original;
      return;
    }
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    // 无真实结账链接：演示 / 访客模式 → 本地模拟订阅
    if (guestMode) {
      setGuestSub(true);
      showSubStatus(
        `✅ 持续监控已开启（本机演示，未真实扣费）。配置 ${(config.paymentProvider || 'creem').toUpperCase()} 支付密钥后即真实订阅。`,
        true
      );
    } else {
      showSubStatus(
        `演示环境：结账已模拟，未真实扣费。配置支付密钥（当前通道 ${(config.paymentProvider || 'creem').toUpperCase()}）后为真实收款。`,
        true
      );
    }
    checkoutBtn.textContent = '持续监控已开启 ✓';
  } catch (err) {
    alert('结账失败：' + err.message);
  } finally {
    checkoutBtn.disabled = false;
    if (checkoutBtn.textContent === '跳转中…') checkoutBtn.textContent = original;
  }
}

function loadPaddleScript() {
  return new Promise((resolve, reject) => {
    if (window.Paddle) return resolve(window.Paddle);
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.async = true;
    s.onload = () => resolve(window.Paddle);
    s.onerror = () => reject(new Error('Paddle.js 加载失败'));
    document.head.appendChild(s);
  });
}
async function openPaddleCheckout(data) {
  const Paddle = await loadPaddleScript();
  if (data.sandbox) Paddle.Environment.set('sandbox');
  Paddle.Initialize({ token: config.paddleClientToken });
  Paddle.Checkout.open({ transactionId: data.transactionId });
}

function showSubStatus(msg, ok) {
  subStatus.textContent = msg;
  subStatus.className = 'sub-status ' + (ok ? 'ok' : 'error');
  subStatus.classList.remove('hidden');
}
checkoutBtn.addEventListener('click', () => goCheckout('starter'));

// 多档定价卡片渲染（依据 /api/config 的 plans）
function renderPricing() {
  if (!priceGrid || !Array.isArray(config.plans)) return;
  priceGrid.innerHTML = config.plans
    .map((p) => {
      const price = p.priceMonthly === 0 ? '免费' : `¥${p.priceMonthly}<span>/月</span>`;
      const cta =
        p.priceMonthly === 0
          ? `<button class="btn-ghost price-btn" data-plan="${p.id}">免费开始</button>`
          : `<button class="btn-primary price-btn" data-plan="${p.id}">订阅 ${p.name}</button>`;
      const feats = p.features.map((f) => `<li>✓ ${f}</li>`).join('');
      const sites =
        p.monitorSites === 0 ? '手动扫描' : `${p.monitorSites} 站点监控`;
      return `
      <div class="price-card${p.id === 'pro' ? ' featured' : ''}">
        <div class="price-name">${p.name}</div>
        <div class="price">${price}</div>
        <div class="price-sites">${sites}</div>
        <ul>${feats}</ul>
        ${cta}
      </div>`;
    })
    .join('');
  priceGrid.querySelectorAll('.price-btn').forEach((b) => {
    b.addEventListener('click', () => goCheckout(b.dataset.plan));
  });
}

// ---------- 登录 / 历史 ----------
function renderAuth() {
  if (guestMode) {
    authArea.innerHTML =
      `<div class="user-chip guest"><span class="email">访客体验</span>` +
      `<span class="logout" id="clear-btn">清空本地历史</span></div>`;
    document.getElementById('clear-btn').addEventListener('click', clearGuestHistory);
    return;
  }
  if (!config.supabaseEnabled) {
    authArea.innerHTML = '';
    return;
  }
  if (currentUser) {
    authArea.innerHTML = `<div class="user-chip"><span class="email">${escapeHtml(
      currentUser.email
    )}</span><span class="logout" id="logout-btn">登出</span></div>`;
    document.getElementById('logout-btn').addEventListener('click', logout);
  } else {
    authArea.innerHTML = `<button class="auth-btn" id="login-btn">登录 / 注册</button>`;
    document.getElementById('login-btn').addEventListener('click', openAuth);
  }
}

function clearGuestHistory() {
  setGuestHistory([]);
  hideHistory();
  saveNote.textContent = '已清空本机扫描历史。';
  saveNote.classList.remove('hidden');
}

function openAuth() {
  authModal.classList.remove('hidden');
  authMsg.textContent = '';
}
authClose.addEventListener('click', () => authModal.classList.add('hidden'));
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) authModal.classList.add('hidden');
});
authTabs.forEach((t) =>
  t.addEventListener('click', () => {
    authMode = t.dataset.tab;
    authTabs.forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    authSubmit.textContent = authMode === 'login' ? '登录' : '注册';
    authMsg.textContent = '';
  })
);

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authSubmit.disabled = true;
  try {
    if (authMode === 'signup') {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      authMsg.className = 'auth-msg ok';
      authMsg.textContent = '注册成功，验证后即可登录（若后台开启了邮件确认）。';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authModal.classList.add('hidden');
      authForm.reset();
    }
  } catch (err) {
    authMsg.className = 'auth-msg error';
    authMsg.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

async function logout() {
  if (sb) await sb.auth.signOut();
}

async function loadHistory() {
  if (guestMode) {
    const arr = getGuestHistory();
    if (!arr.length) { hideHistory(); return; }
    historyList.innerHTML = arr
      .map(
        (r) => `
        <div class="history-item">
          <div>
            <div class="h-url">${escapeHtml(r.url)}</div>
            <div class="h-meta">${new Date(r.created_at).toLocaleString()} · ${
          r.engine === 'playwright' ? '真浏览器' : '正则'
        }</div>
          </div>
          <div class="h-score" style="color:${scoreColor(r.score)}">${r.score}</div>
        </div>`
      )
      .join('');
    historySection.classList.remove('hidden');
    return;
  }
  if (!sb || !currentUser) return;
  const { data, error } = await sb
    .from('scans')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error(error); return; }
  if (!data || !data.length) { hideHistory(); return; }
  historyList.innerHTML = data
    .map(
      (r) => `
      <div class="history-item">
        <div>
          <div class="h-url">${escapeHtml(r.url)}</div>
          <div class="h-meta">${new Date(r.created_at).toLocaleString()}</div>
        </div>
        <div class="h-score" style="color:${scoreColor(r.score)}">${r.score}</div>
      </div>`
    )
    .join('');
  historySection.classList.remove('hidden');
}
function hideHistory() {
  historySection.classList.add('hidden');
}

// ---------- 每日监控 ----------
const addMonitorBtn = document.getElementById('add-monitor-btn');
const monitorsSection = document.getElementById('monitors');
const monitorList = document.getElementById('monitor-list');
const monitorSub = document.getElementById('monitor-sub');

addMonitorBtn.addEventListener('click', async () => {
  if (!currentUser) {
    openAuth();
    return;
  }
  if (!lastResult || lastResult.fetchError) {
    alert('请先完成一次合规扫描，再将该站点加入监控。');
    return;
  }
  if (!config.monitorEnabled) {
    alert('每日监控需服务端配置 SUPABASE_SERVICE_KEY。当前为演示环境，该按钮仅展示流程。');
    return;
  }
  const { error } = await sb
    .from('monitors')
    .upsert(
      { user_id: currentUser.id, email: currentUser.email, url: lastResult.url, active: true },
      { onConflict: 'user_id,url' }
    );
  if (error) {
    alert('添加失败：' + error.message);
    return;
  }
  await loadMonitors();
  alert('已加入每日监控，每日自动重扫并在合规回退时邮件告警。');
});

async function loadMonitors() {
  if (!config.supabaseEnabled || !sb || !currentUser) {
    hideMonitors();
    return;
  }
  const { data, error } = await sb
    .from('monitors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); hideMonitors(); return; }
  if (!data || !data.length) {
    monitorSub.textContent = '你还没有监控任何站点。扫描后点「加入每日监控」即可。';
    monitorList.innerHTML = '';
    monitorsSection.classList.remove('hidden');
    return;
  }
  monitorSub.textContent = '每日自动重扫，合规评分回退或新增违规时邮件告警。点击「查看趋势」查看近期评分变化。';
  monitorList.innerHTML = data
    .map((m) => {
      const score = m.last_score != null ? m.last_score : '—';
      const color = m.last_score != null ? scoreColor(m.last_score) : 'var(--muted)';
      const meta =
        (m.last_scan_at ? '上次扫描 ' + new Date(m.last_scan_at).toLocaleString() : '尚未首次扫描') +
        (m.active ? '' : ' · 已暂停(订阅失效)');
      return `
      <div class="history-item monitor-item">
        <div class="monitor-head">
          <div>
            <div class="h-url">${escapeHtml(m.url)}</div>
            <div class="h-meta">${meta}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <div class="h-score" style="color:${color}">${score}</div>
            <span class="logout" data-del="${encodeURIComponent(m.url)}">移除</span>
          </div>
        </div>
        <button class="trend-toggle" data-toggle="${encodeURIComponent(m.url)}">📈 查看趋势</button>
        <div class="trend-box hidden" data-trend="${encodeURIComponent(m.url)}">${renderTrend(m.score_history)}</div>
      </div>`;
    })
    .join('');
  monitorsSection.classList.remove('hidden');
  monitorList.querySelectorAll('[data-del]').forEach((el) => {
    el.addEventListener('click', async () => {
      const url = decodeURIComponent(el.dataset.del);
      if (!confirm(`确认移除监控：${url}？`)) return;
      const { error } = await sb.from('monitors').delete().eq('user_id', currentUser.id).eq('url', url);
      if (error) { alert('移除失败：' + error.message); return; }
      loadMonitors();
    });
  });
  monitorList.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const box = monitorList.querySelector(`[data-trend="${el.dataset.toggle}"]`);
      if (!box) return;
      box.classList.toggle('hidden');
      el.textContent = box.classList.contains('hidden') ? '📈 查看趋势' : '📉 收起趋势';
    });
  });
}

// 基于监控历史分数的 SVG 折线趋势图（纯前端，无外部依赖）
function renderTrend(history) {
  if (!history || history.length < 2) {
    return '<p class="trend-empty">监控至少运行 2 次后才会显示趋势图。</p>';
  }
  const w = 560, h = 140, pad = 26;
  const scores = history.map((p) => p.score);
  const min = Math.min(...scores, 0), max = Math.max(...scores, 100);
  const range = max - min || 1;
  const pts = history.map((p, i) => {
    const x = pad + (i * (w - 2 * pad)) / (history.length - 1);
    const y = h - pad - ((p.score - min) / range) * (h - 2 * pad);
    return [x, y];
  });
  const poly = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPts = `${pad},${h - pad} ${poly} ${w - pad},${h - pad}`;
  const y80 = h - pad - ((80 - min) / range) * (h - 2 * pad);
  const every = Math.ceil(history.length / 5);
  const labels = history
    .map((p, i) => {
      if (i % every !== 0 && i !== history.length - 1) return '';
      const x = pad + (i * (w - 2 * pad)) / (history.length - 1);
      const d = new Date(p.ts);
      return `<text x="${x.toFixed(1)}" y="${h - pad + 16}" font-size="10" fill="#9ca3af" text-anchor="middle">${
        d.getMonth() + 1
      }/${d.getDate()}</text>`;
    })
    .join('');
  const last = pts[pts.length - 1];
  return `<svg class="trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(139,92,246,.28)"/><stop offset="100%" stop-color="rgba(139,92,246,0)"/>
    </linearGradient></defs>
    <polygon points="${areaPts}" fill="url(#tg)"/>
    <line x1="${pad}" y1="${y80.toFixed(1)}" x2="${w - pad}" y2="${y80.toFixed(1)}" stroke="#22c55e" stroke-dasharray="4 4" stroke-width="1"/>
    <text x="${w - pad}" y="${(y80 - 5).toFixed(1)}" font-size="10" fill="#22c55e" text-anchor="end">及格线 80</text>
    <polyline points="${poly}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="#8b5cf6"/>
    ${labels}
  </svg>`;
}
function hideMonitors() {
  monitorsSection.classList.add('hidden');
}

function saveGuestHistory(data) {
  const arr = getGuestHistory();
  arr.unshift({
    url: data.url,
    score: data.score,
    created_at: new Date().toISOString(),
    engine: data.engine,
  });
  setGuestHistory(arr.slice(0, 20));
  loadHistory();
}

async function saveHistory(data) {
  if (!sb || !currentUser) return false;
  const { error } = await sb
    .from('scans')
    .insert({ user_id: currentUser.id, url: data.url, score: data.score, result: data });
  if (error) { console.error(error); return false; }
  loadHistory();
  return true;
}

// ---------- 合规文档生成 ----------
const genDocBtn = document.getElementById('gen-doc-btn');
const docModal = document.getElementById('doc-modal');
const docClose = document.getElementById('doc-close');
const docForm = document.getElementById('doc-form');
const docType = document.getElementById('doc-type');
const docCompany = document.getElementById('doc-company');
const docEmail = document.getElementById('doc-email');
const docCountry = document.getElementById('doc-country');
const docSubmit = document.getElementById('doc-submit');
const docMsg = document.getElementById('doc-msg');
const docResult = document.getElementById('doc-result');
const docResultTitle = document.getElementById('doc-result-title');
const docPreview = document.getElementById('doc-preview');
const docCopy = document.getElementById('doc-copy');
const docDownload = document.getElementById('doc-download');
let lastDocMarkdown = '';

genDocBtn.addEventListener('click', () => {
  docModal.classList.remove('hidden');
  docResult.classList.add('hidden');
  docMsg.textContent = '';
  // 已登录时预填邮箱
  if (currentUser && !docEmail.value) docEmail.value = currentUser.email;
  if (lastResult?.url && !docCompany.value) {
    // 尝试从 URL 推导公司名占位
  }
});
docClose.addEventListener('click', () => docModal.classList.add('hidden'));
docModal.addEventListener('click', (e) => {
  if (e.target === docModal) docModal.classList.add('hidden');
});

docForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!lastResult) {
    docMsg.className = 'auth-msg error';
    docMsg.textContent = '请先完成一次扫描再生成文档。';
    return;
  }
  docSubmit.disabled = true;
  docSubmit.textContent = '生成中…';
  docMsg.textContent = '';
  try {
    const res = await fetch('/api/generate-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docType: docType.value,
        companyName: docCompany.value.trim(),
        email: docEmail.value.trim(),
        country: docCountry.value.trim(),
        url: lastResult.url,
        scanResult: lastResult,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失败');
    lastDocMarkdown = data.markdown;
    docResultTitle.textContent =
      (data.docType === 'cookie' ? 'Cookie 声明' : data.docType === 'dpa' ? '数据处理协议 (DPA)' : '隐私政策') +
      ' · 草稿';
    docPreview.textContent = data.markdown;
    docResult.classList.remove('hidden');
  } catch (err) {
    docMsg.className = 'auth-msg error';
    docMsg.textContent = '⚠️ ' + err.message;
  } finally {
    docSubmit.disabled = false;
    docSubmit.textContent = '生成';
  }
});

docCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastDocMarkdown);
    docCopy.textContent = '已复制 ✓';
    setTimeout(() => (docCopy.textContent = '复制'), 1500);
  } catch (_) {
    alert('复制失败，请手动选择文本复制。');
  }
});
docDownload.addEventListener('click', () => {
  const blob = new Blob([lastDocMarkdown], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `compliance-${docType.value}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

init();
