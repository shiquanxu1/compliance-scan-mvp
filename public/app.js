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
const ringFg = document.getElementById('ring-fg');
const trackersBox = document.getElementById('trackers-box');
const trackersEl = document.getElementById('trackers');
const recoBox = document.getElementById('reco-box');
const recoList = document.getElementById('reco-list');
const saveNote = document.getElementById('save-note');
const errorBox = document.getElementById('error-box');
const checkoutBtn = document.getElementById('checkout-btn');
const priceBtn = document.getElementById('price-btn');
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

  if (config.supabaseEnabled && window.supabase) {
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnon);
    sb.auth.onAuthStateChange((_e, session) => {
      currentUser = session?.user || null;
      renderAuth();
      if (currentUser) loadHistory(); else hideHistory();
    });
    const { data } = await sb.auth.getUser();
    currentUser = data.user || null;
    renderAuth();
    if (currentUser) loadHistory();
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
async function goCheckout() {
  checkoutBtn.disabled = true;
  priceBtn.disabled = true;
  const original = checkoutBtn.textContent;
  checkoutBtn.textContent = '跳转中…';
  try {
    const body = currentUser ? JSON.stringify({ email: currentUser.email }) : '{}';
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    // 无真实结账链接：演示 / 访客模式 → 本地模拟订阅
    if (guestMode) {
      setGuestSub(true);
      showSubStatus('✅ 持续监控已开启（本机演示，未真实扣费）。配置 Creem 后即真实订阅。', true);
    } else {
      showSubStatus('演示环境：结账已模拟，未真实扣费。配置 CREEM_API_KEY 后为真实收款。', true);
    }
    checkoutBtn.textContent = '持续监控已开启 ✓';
  } catch (err) {
    alert('结账失败：' + err.message);
  } finally {
    checkoutBtn.disabled = false;
    priceBtn.disabled = false;
    if (checkoutBtn.textContent === '跳转中…') checkoutBtn.textContent = original;
  }
}
function showSubStatus(msg, ok) {
  subStatus.textContent = msg;
  subStatus.className = 'sub-status ' + (ok ? 'ok' : 'error');
  subStatus.classList.remove('hidden');
}
checkoutBtn.addEventListener('click', goCheckout);
priceBtn.addEventListener('click', goCheckout);

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

init();
