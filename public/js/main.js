'use strict';
// ====== Запуск приложения: авторизация, оболочка, роутинг ======
const root = $('#root');

function renderAuth(mode = 'login') {
  disconnectStream();
  const googleReady = !!(window.google && google.accounts && google.accounts.id);
  root.innerHTML = `<div class="auth"><div class="card auth-card">
    <div class="logo">${LOGO}<span class="grad-text">Chikstagram</span></div>
    <p class="sub">TikTok + Instagram + Telegram в одном приложении</p>
    <div class="tabs"><button class="${mode === 'login' ? 'active' : ''}" data-m="login">Вход</button><button class="${mode === 'register' ? 'active' : ''}" data-m="register">Регистрация</button></div>
    <form id="auth-form" novalidate>
      ${mode === 'register' ? `<label class="auth-label">Имя (латиницей)</label>
        <input class="field" name="display_name" placeholder="Например, Alex" maxlength="40" autocomplete="name" required pattern="[A-Za-z][A-Za-z .'-]{1,39}">
        <label class="auth-label">Никнейм</label>
        <div class="username-field"><span>@</span><input class="field" name="username" placeholder="alex_2026" maxlength="24" autocomplete="username" required pattern="[A-Za-z0-9_]{3,24}"></div>
        <div class="auth-status" id="username-status">3–24 символа: английские буквы, цифры и _</div>
        <label class="auth-label">Электронная почта</label>
        <input class="field" name="email" type="email" placeholder="example@gmail.com" autocomplete="email" required>` : `<label class="auth-label">Никнейм или email</label><input class="field" name="login" placeholder="@username или email" autocomplete="username" required>`}
      <label class="auth-label">Пароль</label>
      <input class="field" name="password" type="password" placeholder="${mode === 'register' ? 'Минимум 8 символов' : 'Ваш пароль'}" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" ${mode === 'register' ? 'minlength="8"' : ''} required>
      ${mode === 'register' ? '<div class="auth-status">Нужны заглавная и строчная буквы, а также цифра.</div>' : ''}
      <div class="err" id="auth-err"></div>
      <button class="btn primary block" type="submit">${mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
    </form>
    <div class="auth-divider"><span>или</span></div>
    <div id="google-signin" class="google-signin"><button class="btn block google-btn" type="button" id="google-fallback">◉ Продолжить с Google</button></div>
    <p class="hint">${mode === 'login' ? 'Вход останется активным, пока вы не выйдете из аккаунта.' : 'Регистрируясь, вы соглашаетесь с правилами сообщества.'}</p>
  </div></div>`;
  $('.tabs', root).onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) renderAuth(b.dataset.m); };
  const form = $('#auth-form');
  const nameInput = $('input[name="display_name"]', form);
  const usernameInput = $('input[name="username"]', form);
  const status = $('#username-status');
  let checkTimer;
  if (usernameInput) {
    usernameInput.addEventListener('input', () => {
      usernameInput.value = usernameInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0,24);
      clearTimeout(checkTimer);
      const v = usernameInput.value;
      status.textContent = 'Проверяем никнейм…'; status.className = 'auth-status';
      if (!/^[a-z0-9_]{3,24}$/.test(v)) { status.textContent = '3–24 символа: английские буквы, цифры и _'; return; }
      checkTimer = setTimeout(async () => {
        try {
          const r = await api.get('/auth/username/' + encodeURIComponent(v));
          status.textContent = r.available ? '✓ Никнейм свободен' : '✕ Этот никнейм уже занят';
          status.className = 'auth-status ' + (r.available ? 'available' : 'taken');
        } catch { status.textContent = 'Не удалось проверить никнейм'; }
      }, 350);
    });
  }
  if (nameInput) nameInput.addEventListener('input', () => { nameInput.value = nameInput.value.replace(/[^a-zA-Z .'-]/g, '').slice(0,40); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)), btn = $('button[type=submit]', form), err = $('#auth-err');
    if (mode === 'login') data.login = String(data.login || '').replace(/^@/, '');
    if (mode === 'register') {
      data.username = String(data.username || '').replace(/^@/, '').toLowerCase();
      if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(data.display_name || '')) { err.textContent = 'Имя укажите латинскими буквами.'; return; }
      if (!/[A-Z]/.test(data.password) || !/[a-z]/.test(data.password) || !/\d/.test(data.password) || data.password.length < 8) { err.textContent = 'Пароль должен содержать 8+ символов, заглавную и строчную букву и цифру.'; return; }
    }
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api.post(mode === 'login' ? '/auth/login' : '/auth/register', data);
      setSession(r.token, r.user); location.hash = '#/'; startApp();
    } catch (er) { err.textContent = er.message; btn.disabled = false; }
  };
  $('#google-fallback').onclick = () => {
    if (window.google?.accounts?.id) window.google.accounts.id.prompt();
    else toast('Google-вход пока не настроен. Нужен Client ID.', 'err');
  };
  window.handleGoogleCredential = async (response) => {
    try {
      const r = await api.post('/auth/google', { credential: response.credential });
      setSession(r.token, r.user); location.hash = '#/'; startApp();
    } catch (e) { const el = $('#auth-err'); if (el) el.textContent = e.message; }
  };
  (async () => {
    let clientId = '';
    try { clientId = (await api.get('/auth/config')).googleClientId; } catch {}
    if (!clientId) return;
    let tries = 0;
    const poll = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(poll);
        google.accounts.id.initialize({ client_id: clientId, callback: window.handleGoogleCredential, auto_select: false });
        const host = $('#google-signin'); host.innerHTML = '';
        google.accounts.id.renderButton(host, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 320 });
      } else if (++tries > 30) clearInterval(poll);
    }, 250);
  })();
}

const NAV = [
  ['feed', '#/', 'home', 'Лента'], ['search', '#/search', 'search', 'Поиск'], ['chats', '#/chats', 'send', 'Чаты', 'messages'],
  ['notifications', '#/notifications', 'bell', 'Уведомления', 'notifications'],
];
function renderShell() {
  const u = S.user;
  root.innerHTML = `<div class="app">
    <nav class="side" aria-label="Навигация"><a class="logo" href="#/">${LOGO}<span class="grad-text">Chikstagram</span></a>
      ${NAV.map(([k, h, i, l, b]) => `<a class="nav-i" data-nav="${k}" href="${h}">${ic(i)}<span>${l}</span>${b ? `<i class="badge hidden" data-badge="${b}"></i>` : ''}</a>`).join('')}
      <a class="nav-i" data-nav="u" id="nav-prof" href="#/u/${esc(u.username)}">${ic('user')}<span>Профиль</span></a>
      <a class="nav-i" data-nav="settings" href="#/settings">${ic('sliders')}<span>Настройки</span></a>
      <button class="btn primary create" data-act="upload">${ic('plus', 'sm')}<span>Создать</span></button>
      <div class="me" id="me-card"></div></nav>
    <main id="view"></main>
    <nav class="bottom" aria-label="Навигация">
      <a data-nav="feed" href="#/" aria-label="Лента">${ic('home')}</a><a data-nav="search" href="#/search" aria-label="Поиск">${ic('search')}</a>
      <button class="plus" data-act="upload" aria-label="Создать">${ic('plus')}</button>
      <a data-nav="chats" href="#/chats" aria-label="Чаты">${ic('send')}<i class="badge hidden" data-badge="messages"></i></a>
      <a data-nav="u" id="nav-prof2" href="#/u/${esc(u.username)}" aria-label="Профиль">${ic('user')}</a></nav></div>`;
  paintMe();
}
function paintMe() {
  const u = S.user; if (!u) return;
  const me = $('#me-card');
  if (me) { me.innerHTML = `${avatar(u, 's')}<div class="grow nm" style="min-width:0"><b class="ellip" style="display:block">${esc(u.display_name)}</b><span class="muted ellip" style="display:block;font-size:12px">@${esc(u.username)}</span></div>`; me.onclick = () => (location.hash = '#/u/' + u.username); }
  $$('#nav-prof,#nav-prof2').forEach((a) => (a.href = '#/u/' + u.username));
}

async function doLogout(skipApi) {
  if (!skipApi) { try { await api.post('/auth/logout'); } catch {} }
  setSession(null); disconnectStream();
  location.hash = '#/';
  renderAuth();
}
ACT.logout = () => doLogout();

// ---------- маршруты ----------
route(/^\/?$/, (v) => renderFeed(v));
route(/^\/feed$/, (v) => renderFeed(v));
route(/^\/post\/(\d+)$/, (v, id) => renderFeed(v, { single: id }));
route(/^\/search$/, (v) => renderSearch(v));
route(/^\/tag\/(.+)$/, (v, t) => renderTag(v, t));
route(/^\/saved$/, (v) => renderSaved(v));
route(/^\/chats$/, (v) => renderChats(v));
route(/^\/chats\/(\d+)$/, (v, id) => renderChats(v, id));
route(/^\/c\/([^/]+)$/, async (v, h) => { try { const r = await api.get('/chats/by-handle/' + encodeURIComponent(h)); location.replace('#/chats/' + r.id); } catch (e) { fail(e); location.hash = '#/chats'; } });
route(/^\/u\/([^/]+)$/, (v, name) => renderProfile(v, name));
route(/^\/notifications$/, (v) => renderNotifications(v));
route(/^\/settings$/, (v) => renderSettings(v));
route(/^\/upload$/, () => { history.replaceState(null, '', '#/'); navigate(); openUpload(); });

// ---------- глобальные обработчики ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.dataset.act === 'msg-menu' && e.target.closest('a,video,audio,.react')) return;
  e.preventDefault();
  const r = fn(el, e);
  if (r && r.catch) r.catch(fail);
});

// Звук уведомлений (ding.mp3)
let notifyAudio = null;
function playNotifySound() {
  try {
    if (!notifyAudio) {
      notifyAudio = new Audio('/sounds/ding.mp3');
      notifyAudio.preload = 'auto';
      notifyAudio.volume = 0.85;
    }
    notifyAudio.currentTime = 0;
    const p = notifyAudio.play();
    if (p && p.catch) p.catch(() => {});
  } catch {}
}
function showSystemNotify(title, body, onClick) {
  playNotifySound();
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, icon: '/icon.svg', badge: '/icon.svg', silent: true });
      n.onclick = () => { window.focus(); onClick && onClick(); n.close(); };
    } catch {}
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}
function toastFor(n) {
  const l = { like: 'оценил(а) вашу публикацию', comment: 'прокомментировал(а) вашу публикацию', follow: 'подписался(ась) на вас', follow_request: 'хочет подписаться на вас', repost: 'сделал(а) репост', mention: 'упомянул(а) вас', message: 'написал(а) вам' }[n.type] || 'новое уведомление';
  const text = `${n.actor?.display_name || 'Chikstagram'} ${l}`;
  const go = () => { location.hash = n.post_id ? '#/post/' + n.post_id : n.actor ? '#/u/' + n.actor.username : '#/notifications'; };
  playNotifySound();
  toast(text, 'ok', 4000, go);
  if (document.hidden) showSystemNotify('Chikstagram', text, go);
}
function wireRealtime() {
  on('rt:notification', (n) => { toastFor(n); refreshCounters(); });
  on('rt:message', ({ chat_id, message }) => {
    if (!message.user || message.user.id === S.user.id) return;
    const viewing = location.hash.startsWith('#/chats/' + chat_id) && !document.hidden;
    const c = CH.list.find((x) => x.id === chat_id);
    if (!viewing && !(c && c.muted)) {
      const t = message.text || (message.file ? '📎 Вложение' : message.post ? '🎬 Публикация' : '');
      const text = `${message.user.display_name}: ${t.slice(0, 60)}`;
      const go = () => (location.hash = '#/chats/' + chat_id);
      playNotifySound();
      toast(text, 'ok', 4000, go);
      if (document.hidden) showSystemNotify('Chikstagram', text, go);
    }
    refreshCounters();
  });
  on('rt:chat', refreshCounters);
  // разрешение на системные уведомления (чтобы звук и баннер работали в фоне вкладки)
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 2500);
  }
}
let wired = false;

async function startApp() {
  renderShell();
  connectStream();
  if (!wired) { wireRealtime(); wired = true; }
  refreshCounters();
  navigate();
}

(async function boot() {
  if (!S.token) return renderAuth();
  try {
    S.user = await api.get('/me');
    startApp();
  } catch { setSession(null); renderAuth(); }
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) refreshCounters(); });
setInterval(() => { if (S.user && !document.hidden) refreshCounters(); }, 60000);
