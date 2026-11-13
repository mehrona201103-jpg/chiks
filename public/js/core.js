'use strict';
// ====== Ядро: утилиты, API, модальные окна, события, realtime, звёзды ======
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  plus: 'M12 5v14M5 12h14',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  userplus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM20 8v6M23 11h-6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  x: 'M18 6L6 18M6 6l12 12',
  more: 'M12 12h.01M19 12h.01M5 12h.01',
  vol: 'M11 5L6 9H2v6h4l5 4zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07',
  mute: 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6',
  play: 'M6 3l14 9-14 9z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  back: 'M19 12H5M12 19l-7-7 7-7',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
  mega: 'M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
  check: 'M20 6L9 17l-5-5',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M21 15l-5-5L5 21',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  dl: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  reply: 'M9 17l-5-5 5-5M4 12h10a6 6 0 0 1 6 6v1',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  ban: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4.93 4.93l14.14 14.14',
  video: 'M23 7l-7 5 7 5zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  bellOff: 'M13.73 21a2 2 0 0 1-3.46 0M18.63 13A17.89 17.89 0 0 1 18 8M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.33-5M1 1l22 22',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1z',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n] || ''}"/></svg>`;
const LOGO = `<svg viewBox="0 0 64 64"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0761f"/><stop offset="1" stop-color="#b4531a"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#lg)"/><path d="M43 22.5a15 15 0 1 0 0 19" fill="none" stroke="#0b0b0c" stroke-width="7" stroke-linecap="round"/></svg>`;

// ---------- state ----------
const S = {
  token: null, user: null, muted: true, counters: { notifications: 0, messages: 0, requests: 0 },
  cleanup: null, posts: new Map(),
};
try { S.token = localStorage.getItem('chik_token'); } catch {}

// ---------- события ----------
const bus = new EventTarget();
const on = (ev, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(ev, h); return () => bus.removeEventListener(ev, h); };
const emit = (ev, detail) => bus.dispatchEvent(new CustomEvent(ev, { detail }));

// ---------- форматирование ----------
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n || 0));
function ago(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин';
  if (d < 86400) return Math.floor(d / 3600) + ' ч';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' дн';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Сегодня';
  if (same(d, new Date(t - 864e5))) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function lastSeen(u) {
  if (!u) return '';
  if (u.online) return 'в сети';
  if (!u.last_seen) return 'был(а) недавно';
  return 'был(а) ' + ago(u.last_seen);
}
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
function rich(text) {
  return esc(text).replace(/(^|[\s(])#([\p{L}\p{N}_]{2,32})/gu, '$1<a class="tag" href="#/tag/$2">#$2</a>')
    .replace(/(^|[\s(])@([a-zA-Z0-9_]{3,24})/g, '$1<a class="mention" href="#/u/$2">@$2</a>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a class="tag" href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
function avatar(u, cls = '', dot = false) {
  if (!u) return `<div class="av ${cls}">✦</div>`;
  const name = u.display_name || u.title || u.username || '?';
  const hue = 16 + ([...String(u.username || u.handle || name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) % 26);
  const inner = u.avatar ? `<img src="${esc(u.avatar)}" alt="" loading="lazy">` : esc([...name.trim()][0] || '?');
  const bg = u.avatar ? '' : `style="background:linear-gradient(135deg,hsl(${hue} 58% 44%),hsl(${hue + 10} 55% 28%))"`;
  return `<div class="av ${cls}" ${bg}>${inner}${dot && u.online ? '<i class="dot"></i>' : ''}</div>`;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- API ----------
async function api(method, path, body) {
  const headers = {};
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: payload }); }
  catch { throw new Error('Нет соединения с сервером'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token && !path.startsWith('/auth/')) { setSession(null); location.hash = '#/'; location.reload(); }
    throw new Error(data.error || 'Ошибка ' + res.status);
  }
  return data;
}
api.get = (p) => api('GET', p); api.post = (p, b = {}) => api('POST', p, b);
api.patch = (p, b) => api('PATCH', p, b); api.del = (p, b) => api('DELETE', p, b);
function upload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api' + path);
    x.setRequestHeader('Authorization', 'Bearer ' + S.token);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => {
      let d = null;
      try { d = JSON.parse(x.responseText); } catch (e) {
        return reject(new Error(x.status >= 200 && x.status < 300
          ? 'Сервер вернул неверный ответ. Попробуйте файл поменьше или другой формат'
          : `Ошибка загрузки (код ${x.status})`));
      }
      if (x.status >= 200 && x.status < 300 && d && !d.error) return resolve(d);
      reject(new Error((d && d.error) || (x.status === 413 ? 'Файл слишком большой (максимум 5 ГБ)' : `Ошибка загрузки (код ${x.status})`)));
    };
    x.onerror = () => reject(new Error('Загрузка прервалась. Проверьте интернет или уменьшите файл'));
    x.onabort = () => reject(new Error('Загрузка отменена'));
    x.timeout = 120 * 60 * 1000;
    x.ontimeout = () => reject(new Error('Превышено время загрузки (для больших файлов нужно стабильное соединение)'));
    x.send(form);
  });
}
function setSession(token, user) {
  S.token = token; S.user = user || null;
  try { token ? localStorage.setItem('chik_token', token) : localStorage.removeItem('chik_token'); } catch {}
}

// ---------- подготовка файлов (телефоны: HEIC, нет расширения, огромные фото) ----------
const MAX_MB = 5120; // 5 ГБ — без потери качества
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-matroska': 'mkv', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
function fixName(file) {
  if (/\.[a-z0-9]{2,5}$/i.test(file.name)) return file;
  const e = EXT_BY_TYPE[file.type]; return e ? new File([file], (file.name || 'file') + '.' + e, { type: file.type }) : file;
}
async function prepImage(file, max = 1600, q = 0.86) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
  if (!blob) throw new Error('canvas');
  return new File([blob], (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
}
// Возвращает файл, готовый к отправке, или бросает понятную ошибку
async function prepMedia(file, { forceImage = false, max = 1600 } = {}) {
  if (file.type.startsWith('image/') || forceImage) {
    const keep = /^image\/(png|gif|webp)$/.test(file.type) && file.size < 8e6 && !forceImage && /\.[a-z0-9]{2,5}$/i.test(file.name);
    if (keep) return file;
    try { return await prepImage(file, max); } catch { throw new Error('Не удалось открыть это фото. Выберите JPG или PNG'); }
  }
  if (file.size > MAX_MB * 1048576) throw new Error(`Файл больше 5 ГБ. Выберите видео меньшего размера`);
  return fixName(file);
}

// ---------- UI: toast / modal ----------
function toast(msg, type = 'ok', ms = 3200, onClick) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `${ic(type === 'err' ? 'x' : 'check', 'sm')}<span>${esc(msg)}</span>`;
  el.onclick = () => { el.remove(); onClick && onClick(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
const fail = (e) => toast(e.message || String(e), 'err');

let modalStack = [];
function modal(html, { cls = '', onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { ov.remove(); modalStack = modalStack.filter((m) => m !== close); onClose && onClose(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.body.appendChild(ov);
  modalStack.push(close);
  const first = $('input:not([type=file]),textarea', ov); if (first && matchMedia('(pointer:fine)').matches) first.focus();
  ov.close = close;
  return ov;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1](); });
const mHead = (title, extra = '') => `<div class="modal-h"><span class="grow ellip">${esc(title)}</span>${extra}<button class="icon-btn" data-close aria-label="Закрыть">${ic('x')}</button></div>`;
function confirmBox(text, okLabel = 'Подтвердить', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`${mHead('Подтверждение')}<div class="modal-b">${esc(text)}</div><div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => !done && resolve(false) });
    $('[data-ok]', m).onclick = () => { done = true; m.close(); resolve(true); };
  });
}
function promptBox(title, label, { type = 'text', value = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`${mHead(title)}<div class="modal-b"><label class="lbl">${esc(label)}</label><input class="field" type="${type}" value="${esc(value)}" autocomplete="off"></div><div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => !done && resolve(null) });
    const inp = $('input', m);
    const go = () => { done = true; m.close(); resolve(inp.value); };
    $('[data-ok]', m).onclick = go; inp.onkeydown = (e) => e.key === 'Enter' && go();
  });
}
function lightbox(el) {
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = el; lb.onclick = (e) => { if (e.target.tagName !== 'VIDEO') lb.remove(); };
  const k = (e) => { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', k); } };
  document.addEventListener('keydown', k); document.body.appendChild(lb);
}
function actionSheet(items, title = '') {
  const m = modal(`${title ? mHead(title) : ''}<div class="modal-b" style="padding:8px">${items.filter(Boolean).map((it, i) => `<button class="menu-i ${it.danger ? 'danger' : ''}" data-i="${i}">${ic(it.icon || 'more')}<span>${esc(it.label)}</span></button>`).join('')}</div>`, { cls: 'sheet' });
  const list = items.filter(Boolean);
  $$('[data-i]', m).forEach((b) => (b.onclick = () => { m.close(); list[+b.dataset.i].fn(); }));
  return m;
}
function userRow(u, { actions = '' } = {}) {
  return `<div class="list-i" data-user="${esc(u.username)}">${avatar(u, '', true)}<div class="grow"><b class="ellip" style="display:block">${esc(u.display_name)}</b><span class="muted ellip" style="display:block;font-size:13px">@${esc(u.username)}${u.is_private ? ' · закрытый' : ''}</span></div>${actions}</div>`;
}
const followBtn = (u) => (u.is_me ? '' : `<button class="btn sm ${u.following ? '' : 'primary'}" data-act="follow-user" data-uid="${u.id}">${u.following ? 'Вы подписаны' : 'Подписаться'}</button>`);

// ---------- счётчики ----------
async function refreshCounters() {
  if (!S.token) return;
  try { S.counters = await api.get('/me/counters'); } catch { return; }
  paintBadges();
}
function paintBadges() {
  const set = (sel, n) => $$(sel).forEach((b) => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); });
  set('[data-badge=notifications]', S.counters.notifications + S.counters.requests);
  set('[data-badge=messages]', S.counters.messages);
  document.title = (S.counters.messages + S.counters.notifications ? `(${S.counters.messages + S.counters.notifications}) ` : '') + 'Chikstagram';
}

// ---------- realtime (SSE) ----------
let es;
function connectStream() {
  disconnectStream();
  es = new EventSource('/api/stream?token=' + encodeURIComponent(S.token));
  for (const ev of ['message', 'chat', 'typing', 'message_deleted', 'notification', 'message_update', 'read']) {
    es.addEventListener(ev, (e) => { try { emit('rt:' + ev, JSON.parse(e.data)); } catch {} });
  }
}
function disconnectStream() { if (es) { es.close(); es = null; } }

// ---------- роутер ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
function navigate() {
  if (typeof S.cleanup === 'function') { try { S.cleanup(); } catch {} }
  S.cleanup = null;
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const view = $('#view');
  if (!view) return;
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (m) { view.innerHTML = ''; $$('.nav-i,.bottom a').forEach((a) => a.classList.toggle('active', a.dataset.nav && (a.dataset.nav === path.split('/')[1] || (a.dataset.nav === 'feed' && (path === '/' || path.startsWith('/post') || path.startsWith('/feed')))))); fn(view, ...m.slice(1).map(decodeURIComponent)); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', () => { if (S.user) navigate(); });

// ---------- звёздное небо ----------
(function stars() {
  const cv = $('#stars'), ctx = cv.getContext('2d');
  return; // классическая тема: без анимированного фона
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  let w, h, dpr, list = [], shoot = null, mx = 0, my = 0;
  const init = () => {
    dpr = Math.min(devicePixelRatio || 1, 2); w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr;
    list = Array.from({ length: Math.min(160, Math.floor(innerWidth * innerHeight / 9000)) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.3 + .3) * dpr, p: Math.random() * 6.28, s: Math.random() * .02 + .005, z: Math.random() * .8 + .2 }));
  };
  addEventListener('resize', init); init();
  addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth - .5); my = (e.clientY / innerHeight - .5); }, { passive: true });
  (function frame(t) {
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, h);
      for (const s of list) {
        s.p += s.s;
        const a = .35 + .65 * Math.abs(Math.sin(s.p));
        ctx.globalAlpha = a * s.z; ctx.fillStyle = s.z > .8 ? '#cdbcff' : '#fff';
        ctx.beginPath(); ctx.arc(s.x + mx * 30 * s.z * dpr, s.y + my * 30 * s.z * dpr, s.r, 0, 6.28); ctx.fill();
      }
      if (!shoot && Math.random() < .004) shoot = { x: Math.random() * w, y: Math.random() * h * .5, l: 0 };
      if (shoot) {
        shoot.x += 14 * dpr; shoot.y += 6 * dpr; shoot.l++;
        const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - 90 * dpr, shoot.y - 40 * dpr);
        g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - 90 * dpr, shoot.y - 40 * dpr); ctx.stroke();
        if (shoot.l > 60) shoot = null;
      }
    }
    requestAnimationFrame(frame);
  })();
})();
