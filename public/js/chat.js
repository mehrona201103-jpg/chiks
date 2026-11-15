'use strict';
// ====== Мессенджер: личные чаты, группы, каналы ======
const CH = { list: [], filter: 'all', q: '', active: null, info: null, msgs: [], more: false, replyTo: null, files: [], rec: null, typingUntil: 0 };
const EMOJI = '😀 😂 🥹 😍 😎 🤩 😭 😡 👍 👎 🙏 👏 🔥 ✨ 💜 💙 ❤️ 🚀 🌌 🌙 ⭐ 🪐 👽 🎉 🎶 💃 😴 🤔 😅 🥳 😱 🤝 💪 👀 🙌 💯 ✅ ❌ ☄️'.split(' ');
const TYPE_LABEL = { dm: 'Личный чат', group: 'Группа', channel: 'Канал' };
const chatAv = (c) => avatar({ ...c, username: c.handle || c.title, display_name: c.title }, '', c.type === 'dm');
const isAdminRole = (r) => r === 'owner' || r === 'admin';

function previewText(c) {
  const l = c.last; if (!l) return c.description || TYPE_LABEL[c.type];
  let t = l.text || (l.file ? { image: '🖼 Фото', video: '🎬 Видео', audio: '🎤 Голосовое', file: '📎 ' + (l.file.name || 'Файл') }[l.file.kind] : l.post ? '🎬 Публикация' : '');
  if (l.user && c.type === 'group') t = (l.user.id === S.user.id ? 'Вы' : l.user.display_name.split(' ')[0]) + ': ' + t;
  else if (l.user && l.user.id === S.user.id && c.type === 'dm') t = 'Вы: ' + t;
  return t;
}

function chatItemHTML(c) {
  const icon = (c.pinned ? ic('star', 'sm pin-i fill') : '') + (c.type === 'channel' ? ic('mega', 'sm') : c.type === 'group' ? ic('users', 'sm') : '');
  return `<div class="chat-i ${CH.active === c.id ? 'active' : ''}" data-act="open-chat" data-id="${c.id}">${chatAv(c)}
    <div class="grow"><div class="top"><b class="ellip">${icon} ${esc(c.title || 'Чат')}</b><span class="tm">${c.last ? ago(c.last.created_at) : ''}</span></div>
    <div class="row"><span class="pv ellip grow">${esc(previewText(c))}</span>${c.muted ? `<span class="dim">${ic('bellOff', 'sm')}</span>` : ''}${c.unread ? `<span class="un ${c.muted ? 'mute' : ''}">${c.unread}</span>` : ''}</div></div></div>`;
}
function paintList() {
  const box = $('#chat-scroll'); if (!box) return;
  const q = CH.q.toLowerCase();
  const items = CH.list.filter((c) => (CH.filter === 'all' || c.type === CH.filter) && (!q || (c.title || '').toLowerCase().includes(q)));
  box.innerHTML = items.length ? items.map(chatItemHTML).join('') : `<div class="empty">${ic('comment')}<p>${CH.list.length ? 'Ничего не найдено' : 'У вас пока нет чатов'}</p><p style="margin-top:14px"><button class="btn primary" data-act="new-chat">Начать общение</button></p></div>`;
}
async function loadList() {
  try { CH.list = await api.get('/chats'); paintList(); refreshCounters(); } catch (e) { fail(e); }
}

function renderChats(view, chatId) {
  CH.active = chatId ? +chatId : null;
  view.innerHTML = `<div class="chat-layout ${chatId ? 'has-active' : ''}">
    <aside class="chat-list"><div class="head"><h1>Чаты</h1><button class="icon-btn" data-act="new-chat" aria-label="Новый чат" title="Новый чат">${ic('edit')}</button></div>
      <div style="padding:0 16px 8px" class="search-box"><input class="field" id="chat-q" placeholder="Поиск по чатам" style="border-radius:999px;padding:10px 16px"></div>
      <div class="chips" id="chat-f">${[['all', 'Все'], ['dm', 'Личные'], ['group', 'Группы'], ['channel', 'Каналы']].map(([k, l]) => `<button class="chip ${CH.filter === k ? 'active' : ''}" data-act="chat-filter" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="scroll" id="chat-scroll"></div></aside>
    <section class="chat-main" id="chat-main"><div class="chat-empty"><div>${ic('send', 'lg')}<h2 style="margin:10px 0 4px">Выберите чат</h2><p>или начните новый — личный, группу или канал</p><p style="margin-top:16px"><button class="btn primary" data-act="new-chat">Новый чат</button></p></div></div></section></div>`;
  if (CH.list.length) paintList(); else $('#chat-scroll').innerHTML = '<div class="spinner"></div>';
  $('#chat-q').oninput = (e) => { CH.q = e.target.value; paintList(); };
  loadList();
  if (chatId) openChat(+chatId);

  const refresh = debounce(loadList, 250);
  const offs = [
    on('rt:message', ({ chat_id, message }) => {
      if (CH.active === chat_id) appendMessage(message);
      refresh();
    }),
    on('rt:chat', ({ chat_id, deleted }) => {
      refresh();
      if (deleted && CH.active === chat_id) { toast('Чат больше недоступен', 'err'); location.hash = '#/chats'; }
      else if (CH.active === chat_id) reloadInfo();
    }),
    on('rt:message_deleted', ({ chat_id, id }) => { if (CH.active === chat_id) { $(`.msg[data-mid="${id}"]`)?.remove(); CH.msgs = CH.msgs.filter((m) => m.id !== id); } refresh(); }),
    on('rt:message_update', ({ chat_id, message }) => {
      if (CH.active !== chat_id) return;
      const i = CH.msgs.findIndex((x) => x.id === message.id); if (i < 0) return;
      const wasPinned = CH.msgs[i].pinned; CH.msgs[i] = message;
      const el = $(`.msg[data-mid="${message.id}"]`);
      if (el) { const tmp = document.createElement('div'); tmp.innerHTML = msgHTML(message, CH.msgs[i - 1], CH.msgs[i + 1]); el.replaceWith(tmp.firstElementChild); }
      if (wasPinned !== message.pinned) reloadInfo();
      refresh();
    }),
    on('rt:read', ({ chat_id, last_read_id }) => {
      if (CH.active !== chat_id || !CH.info) return;
      CH.info.other_read_id = last_read_id;
      $$('.tick:not(.read)').forEach((t) => { const id = +t.closest('.msg')?.dataset.mid; if (id && id <= last_read_id) { t.classList.add('read'); t.textContent = '✓✓'; } });
    }),
    on('rt:typing', ({ chat_id, user }) => {
      if (CH.active !== chat_id) return;
      const t = $('#typing'); if (!t) return;
      t.textContent = `${user.display_name} печатает…`;
      clearTimeout(CH.typingT); CH.typingT = setTimeout(() => { t.textContent = ''; }, 3500);
    }),
  ];
  S.cleanup = () => { offs.forEach((f) => f()); CH.active = null; CH.rec?.stop?.(); };
}

ACT['open-chat'] = (el) => (location.hash = '#/chats/' + el.dataset.id);
ACT['chat-filter'] = (el) => { CH.filter = el.dataset.f; $$('#chat-f .chip').forEach((c) => c.classList.toggle('active', c === el)); paintList(); };
ACT['chat-back'] = () => (location.hash = '#/chats');

// ---------- открытие чата ----------
async function openChat(id) {
  const main = $('#chat-main'); if (!main) return;
  main.innerHTML = '<div class="spinner" style="margin-top:40vh"></div>';
  CH.replyTo = null; CH.files = [];
  try {
    CH.info = await api.get('/chats/' + id);
  } catch (e) { main.innerHTML = `<div class="chat-empty"><div><h3>${esc(e.message)}</h3><p style="margin-top:12px"><a class="btn" href="#/chats">К чатам</a></p></div></div>`; return; }
  const info = CH.info;
  const canRead = info.joined || (info.type === 'channel' && info.is_public);
  CH.msgs = []; CH.more = false;
  if (canRead) {
    try { const d = await api.get(`/chats/${id}/messages?limit=40`); CH.msgs = d.items; CH.more = d.has_more; } catch (e) { fail(e); }
  }
  if (CH.active !== id) return;
  main.innerHTML = `<header class="chat-head"><button class="icon-btn back" data-act="chat-back" aria-label="Назад">${ic('back')}</button>
    <div data-act="chat-info" style="cursor:pointer">${chatAv(info)}</div>
    <div class="t grow" data-act="chat-info"><b class="ellip" id="ch-title"></b><span id="ch-sub"></span></div>
    <button class="icon-btn" data-act="chat-search" aria-label="Поиск в чате">${ic('search')}</button><button class="icon-btn" data-act="chat-info" aria-label="Информация">${ic('info')}</button></header>
    <div id="pinbar"></div><div class="msgs" id="msgs"></div><div class="typing" id="typing"></div><div id="composer-wrap"></div>`;
  paintHeader();
  paintMessages();
  paintComposer();
  const box = $('#msgs');
  box.scrollTop = box.scrollHeight;
  box.addEventListener('scroll', async () => {
    if (box.scrollTop > 60 || !CH.more || CH.loadingMore) return;
    CH.loadingMore = true;
    try {
      const h = box.scrollHeight;
      const d = await api.get(`/chats/${id}/messages?limit=40&before=${CH.msgs[0].id}`);
      CH.msgs = [...d.items, ...CH.msgs]; CH.more = d.has_more;
      paintMessages(); box.style.scrollBehavior = 'auto'; box.scrollTop = box.scrollHeight - h; box.style.scrollBehavior = '';
    } catch {}
    CH.loadingMore = false;
  });
  if (info.joined) markRead();
}
const markRead = debounce(() => { if (CH.active) api.post(`/chats/${CH.active}/read`).then(() => { const c = CH.list.find((x) => x.id === CH.active); if (c) { c.unread = 0; paintList(); } refreshCounters(); }).catch(() => {}); }, 400);
async function reloadInfo() {
  if (!CH.active) return;
  try { CH.info = await api.get('/chats/' + CH.active); paintHeader(); paintComposer(); } catch {}
}
function paintHeader() {
  const i = CH.info; if (!i || !$('#ch-title')) return;
  $('#ch-title').innerHTML = esc(i.title || 'Чат');
  const pb = $('#pinbar'); if (pb) pb.innerHTML = i.pinned ? `<div class="pin-bar" data-act="goto-msg" data-mid="${i.pinned.id}">${ic('star', 'sm fill')}<div class="grow ellip"><b>Закреплённое</b> ${esc((i.pinned.text || i.pinned.file?.name || (i.pinned.post ? 'Публикация' : 'Вложение')).slice(0, 100))}</div></div>` : '';
  $('#ch-sub').textContent = i.type === 'dm' ? lastSeen(i.other) : `${i.members} ${i.type === 'channel' ? 'подписчиков' : 'участников'}${i.handle ? ' · @' + i.handle : ''}`;
}

// ---------- сообщения ----------
function msgHTML(m, prev, next) {
  if (!m.user) return `<div class="sys" data-mid="${m.id}">${esc(m.text)}</div>`;
  const info = CH.info, me = m.user.id === S.user.id, ch = info.type === 'channel', grp = info.type === 'group';
  const gap = !prev || !prev.user || prev.user.id !== m.user.id || m.created_at - prev.created_at > 300000;
  const last = !next || !next.user || next.user.id !== m.user.id || next.created_at - m.created_at > 300000;
  let body = '';
  if (m.forward_from) body += `<div class="fwd">↪ Переслано от ${esc(m.forward_from)}</div>`;
  if (m.reply) body += `<div class="rpl" data-act="goto-msg" data-mid="${m.reply.id}"><b>${esc(m.reply.name || '')}</b>${esc((m.reply.text || '').slice(0, 90))}</div>`;
  if (m.post) body += `<a class="post-c" href="#/post/${m.post.id}">${m.post.thumb ? `<img src="${esc(m.post.thumb)}" alt="">` : ''}<div><b>@${esc(m.post.username)}</b><div style="font-size:13px;opacity:.8">${esc((m.post.caption || 'Публикация').slice(0, 70))}</div></div></a>`;
  if (m.file) {
    const f = m.file;
    if (f.kind === 'image') body += `<img class="mi" src="${esc(f.url)}" alt="" loading="lazy" data-act="lightbox" data-src="${esc(f.url)}" data-kind="image">`;
    else if (f.kind === 'video') body += `<video class="mv" src="${esc(f.url)}#t=0.1" controls playsinline preload="metadata"></video>`;
    else if (f.kind === 'audio') body += `<audio src="${esc(f.url)}" controls preload="metadata"></audio>`;
    else body += `<a class="file-c" href="${esc(f.url)}?dl=1" download><span class="fi">${ic('file')}</span><span class="grow"><b class="ellip" style="display:block;max-width:200px">${esc(f.name || 'Файл')}</b><small>${fmtSize(f.size || 0)}</small></span>${ic('dl', 'sm')}</a>`;
  }
  if (m.text) body += `<div class="tx">${rich(m.text)}</div>`;
  const canDel = me || (info.type !== 'dm' && isAdminRole(info.role));
  const acts = false ? `<div class="macts"><button class="icon-btn" data-act="msg-reply" data-mid="${m.id}" title="Ответить">${ic('reply', 'sm')}</button>${canDel ? `<button class="icon-btn" data-act="msg-del" data-mid="${m.id}" title="Удалить">${ic('trash', 'sm')}</button>` : ''}</div>` : '';
  const av = !me && grp ? (last ? avatar(m.user, 's') : '<div style="width:32px;flex:none"></div>') : '';
  const name = !me && grp && gap ? `<div class="nm">${esc(m.user.display_name)}</div>` : ch && gap ? `<div class="nm">${esc(info.title)}</div>` : '';
  const rx = m.reactions && m.reactions.length ? `<div class="reacts">${m.reactions.map((r) => `<span class="react ${r.users.includes(S.user.id) ? 'mine' : ''}" data-act="msg-react" data-mid="${m.id}" data-e="${r.emoji}">${r.emoji}<b>${r.count}</b></span>`).join('')}</div>` : '';
  const tick = me && info.type === 'dm' ? (m.id <= (info.other_read_id || 0) ? '<span class="tick read">✓✓</span>' : '<span class="tick">✓✓</span>') : '';
  return `<div class="msg ${me && !ch ? 'me' : ''} ${gap ? 'gap' : ''}" data-mid="${m.id}">${av}<div class="bub" data-act="msg-menu" data-mid="${m.id}">${name}${body}${rx}<span class="tm">${m.pinned ? ic('star', 'sm fill') + ' ' : ''}${m.edited_at ? '<span class="ed">изм.</span>' : ''}${hhmm(m.created_at)}${tick}</span></div></div>`;
}
function paintMessages() {
  const box = $('#msgs'); if (!box) return;
  if (!CH.info.joined && !(CH.info.type === 'channel' && CH.info.is_public)) {
    box.innerHTML = `<div class="chat-empty"><div>${chatAv(CH.info)}<h3 style="margin:10px 0 4px">${esc(CH.info.title)}</h3><p>${esc(CH.info.description || '')}</p><p class="dim" style="margin:6px 0 14px">${CH.info.members} участников</p></div></div>`;
    return;
  }
  let html = '', lastDay = '';
  CH.msgs.forEach((m, i) => {
    const d = dayLabel(m.created_at);
    if (d !== lastDay) { html += `<div class="day">${d}</div>`; lastDay = d; }
    html += msgHTML(m, CH.msgs[i - 1], CH.msgs[i + 1]);
  });
  box.innerHTML = html || `<div class="chat-empty"><div class="muted">${CH.info.type === 'channel' ? 'В канале пока нет публикаций' : 'Сообщений пока нет — напишите первым 👋'}</div></div>`;
}
function appendMessage(m) {
  const box = $('#msgs'); if (!box || $(`[data-mid="${m.id}"]`, box) || CH.msgs.some((x) => x.id === m.id)) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  CH.msgs.push(m);
  $('.chat-empty', box)?.remove();
  const prev = CH.msgs[CH.msgs.length - 2];
  const d = dayLabel(m.created_at);
  if (!prev || dayLabel(prev.created_at) !== d) box.insertAdjacentHTML('beforeend', `<div class="day">${d}</div>`);
  box.insertAdjacentHTML('beforeend', msgHTML(m, prev, null));
  if (prev && prev.user && m.user && prev.user.id === m.user.id) { // обновим «последнее в серии» у предыдущего
    const pe = $(`.msg[data-mid="${prev.id}"]`, box);
    if (pe && CH.info.type === 'group' && m.user.id !== S.user.id) { const a = $('.av', pe); if (a) a.replaceWith(Object.assign(document.createElement('div'), { style: 'width:32px;flex:none' })); }
  }
  if (near || m.user?.id === S.user.id) box.scrollTop = box.scrollHeight;
  if (m.user && m.user.id !== S.user.id) markRead();
}

ACT.lightbox = (el) => lightbox(`<img src="${esc(el.dataset.src)}" alt="">`);
ACT['goto-msg'] = (el) => { const t = $(`.msg[data-mid="${el.dataset.mid}"]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.animate([{ background: 'rgba(217,105,26,.4)' }, { background: 'transparent' }], 1200); } };
ACT['msg-menu'] = (el) => {
  const m = CH.msgs.find((x) => x.id === +el.dataset.mid), i = CH.info; if (!m || !m.user || !i) return;
  const mine = m.user.id === S.user.id, admin = isAdminRole(i.role), j = i.joined;
  const items = [
    j && { k: 'reply', icon: 'reply', label: 'Ответить' }, m.text && { k: 'copy', icon: 'file', label: 'Копировать текст' }, { k: 'fwd', icon: 'send', label: 'Переслать' },
    j && (i.type === 'dm' || admin) && { k: 'pin', icon: 'star', label: m.pinned ? 'Открепить' : 'Закрепить' },
    mine && m.text && !m.forward_from && { k: 'edit', icon: 'edit', label: 'Изменить' },
    j && (mine || (i.type !== 'dm' && admin)) && { k: 'del', icon: 'trash', label: 'Удалить', danger: true },
  ].filter(Boolean);
  const mm = modal(`<div class="modal-b" style="padding:8px">${j ? `<div class="react-row">${['👍', '❤️', '🔥', '😂', '😮', '😢', '👎', '🎉'].map((e) => `<button data-r="${e}">${e}</button>`).join('')}</div>` : ''}${items.map((it) => `<button class="menu-i ${it.danger ? 'danger' : ''}" data-k="${it.k}">${ic(it.icon)}<span>${it.label}</span></button>`).join('')}</div>`, { cls: 'sheet' });
  mm.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]'), b = e.target.closest('[data-k]');
    if (r) { mm.close(); return react(m.id, r.dataset.r); }
    if (!b) return; mm.close();
    const k = b.dataset.k;
    if (k === 'reply') { CH.replyTo = m; paintComposer(true); }
    else if (k === 'copy') navigator.clipboard?.writeText(m.text).then(() => toast('Скопировано', 'ok', 1200));
    else if (k === 'fwd') openForward(m);
    else if (k === 'pin') api.post(`/messages/${m.id}/pin`, { pinned: !m.pinned }).then(() => toast(m.pinned ? 'Откреплено' : 'Закреплено', 'ok', 1500)).catch(fail);
    else if (k === 'edit') { const v = await promptBox('Изменить сообщение', 'Текст', { value: m.text, okLabel: 'Сохранить' }); if (v !== null && v.trim()) api.patch('/messages/' + m.id, { text: v }).catch(fail); }
    else if (k === 'del') { if (await confirmBox('Удалить сообщение?', 'Удалить')) api.del('/messages/' + m.id).catch(fail); }
  });
};
const react = (id, emoji) => api.post(`/messages/${id}/react`, { emoji }).catch(fail);
ACT['msg-react'] = (el) => react(+el.dataset.mid, el.dataset.e);
async function openForward(m) {
  if (!CH.list.length) await loadList();
  const chats = CH.list.filter((c) => c.type !== 'channel' || isAdminRole(c.role));
  const fm = modal(`${mHead('Переслать')}<div class="modal-b">${chats.length ? chats.map((c) => `<div class="list-i" data-chat="${c.id}">${chatAv(c)}<div class="grow"><b class="ellip" style="display:block">${esc(c.title || 'Чат')}</b><span class="muted" style="font-size:13px">${TYPE_LABEL[c.type]}</span></div></div>`).join('') : '<div class="empty">Нет доступных чатов</div>'}</div>`, { cls: 'tall' });
  fm.onclick = async (e) => { const r = e.target.closest('[data-chat]'); if (!r) return; try { await api.post(`/messages/${m.id}/forward`, { chat_id: +r.dataset.chat }); fm.close(); toast('Переслано'); } catch (er) { fail(er); } };
}
ACT['chat-search'] = () => {
  const sm = modal(`${mHead('Поиск в чате')}<div class="modal-b"><input class="field" id="cs-q" placeholder="Введите слово или фразу" autocomplete="off"><div id="cs-out" style="margin-top:10px"></div></div>`, { cls: 'tall' });
  const out = $('#cs-out', sm);
  const go = debounce(async () => {
    const q = $('#cs-q', sm).value.trim(); if (!q) { out.innerHTML = ''; return; }
    try {
      const d = await api.get(`/chats/${CH.active}/messages?q=${encodeURIComponent(q)}`);
      out.innerHTML = d.items.length ? d.items.map((m) => `<div class="list-i" data-mid="${m.id}">${avatar(m.user, 's')}<div class="grow"><b class="ellip" style="display:block">${esc(m.user?.display_name || '')}</b><span class="muted ellip" style="display:block">${esc(m.text)}</span></div><span class="dim" style="font-size:12px">${ago(m.created_at)}</span></div>`).join('') : '<div class="empty">Ничего не найдено</div>';
    } catch (e) { fail(e); }
  }, 300);
  $('#cs-q', sm).oninput = go;
  out.onclick = async (e) => {
    const r = e.target.closest('[data-mid]'); if (!r) return; const id = +r.dataset.mid; sm.close();
    for (let n = 0; n < 15 && !$(`.msg[data-mid="${id}"]`) && CH.more; n++) {
      const d = await api.get(`/chats/${CH.active}/messages?limit=60&before=${CH.msgs[0].id}`); CH.msgs = [...d.items, ...CH.msgs]; CH.more = d.has_more; paintMessages();
    }
    const t = $(`.msg[data-mid="${id}"]`); t ? ACT['goto-msg']({ dataset: { mid: id } }) : toast('Сообщение слишком давнее', 'err');
  };
};
ACT['chat-pin'] = async () => {
  try { const r = await api.post(`/chats/${CH.active}/pin`, { pinned: !CH.info.pinned_chat }); CH.info.pinned_chat = r.pinned; loadList(); CH.infoModal?.close(); openChatInfo(); toast(r.pinned ? 'Чат закреплён' : 'Чат откреплён', 'ok', 1500); } catch (e) { fail(e); }
};
ACT['msg-reply'] = (el) => { const m = CH.msgs.find((x) => x.id === +el.dataset.mid); if (!m) return; CH.replyTo = m; paintComposer(true); };
ACT['msg-del'] = async (el) => { if (!await confirmBox('Удалить сообщение?', 'Удалить')) return; api.del('/messages/' + el.dataset.mid).catch(fail); };

// ---------- ввод ----------
function paintComposer(keepText) {
  const wrap = $('#composer-wrap'); if (!wrap) return;
  const info = CH.info, old = $('#comp-text')?.value || '';
  if (!info.joined) {
    wrap.innerHTML = `<div class="join-bar">${info.is_public && info.type !== 'dm' ? `<button class="btn primary" data-act="join-chat">${info.type === 'channel' ? 'Подписаться' : 'Вступить в группу'}</button>` : '<span class="muted">Нужно приглашение</span>'}</div>`;
    return;
  }
  if (info.type === 'channel' && !isAdminRole(info.role)) {
    wrap.innerHTML = `<div class="join-bar"><button class="btn" data-act="chat-mute">${info.muted ? ic('bell', 'sm') + ' Включить звук' : ic('bellOff', 'sm') + ' Отключить звук'}</button></div>`;
    return;
  }
  wrap.innerHTML = `<div class="composer">
    ${CH.replyTo ? `<div class="reply-bar">${ic('reply', 'sm')}<div class="grow ellip"><b>${esc(CH.replyTo.user?.display_name || '')}</b> ${esc((CH.replyTo.text || CH.replyTo.file?.name || 'Вложение').slice(0, 80))}</div><button class="icon-btn" data-act="cancel-reply" style="width:28px;height:28px">${ic('x', 'sm')}</button></div>` : ''}
    <div class="pending" id="pending">${CH.files.map((f, i) => `<span class="pc"><span class="ellip">${esc(f.name)}</span><button class="icon-btn" style="width:24px;height:24px" data-act="rm-file" data-i="${i}">${ic('x', 'sm')}</button></span>`).join('')}</div>
    <div class="comp-bar">
      <button class="icon-btn" data-act="emoji" aria-label="Эмодзи">${ic('smile')}</button>
      <button class="icon-btn" data-act="attach" aria-label="Прикрепить файл">${ic('clip')}</button>
      <textarea id="comp-text" rows="1" placeholder="${info.type === 'channel' ? 'Опубликовать в канале…' : 'Сообщение…'}" maxlength="4000"></textarea>
      <button class="icon-btn ${CH.rec ? 'rec' : ''}" data-act="voice" aria-label="Голосовое">${ic('mic')}</button>
      <button class="send" data-act="send-msg" aria-label="Отправить">${ic('send', 'sm')}</button></div>
    <input type="file" id="comp-file" multiple hidden></div>`;
  const ta = $('#comp-text');
  if (keepText !== false) ta.value = old;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  ta.oninput = () => { grow(); typing(); };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ACT['send-msg'](); } };
  $('#comp-file').onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { try { CH.files.push(await prepMedia(f)); } catch (er) { fail(er); } } paintComposer(); };
  grow(); if (matchMedia('(pointer:fine)').matches) ta.focus();
}
let lastTyping = 0;
function typing() { if (Date.now() - lastTyping > 3000 && CH.active) { lastTyping = Date.now(); api.post(`/chats/${CH.active}/typing`).catch(() => {}); } }

ACT['cancel-reply'] = () => { CH.replyTo = null; paintComposer(); };
ACT.attach = () => $('#comp-file').click();
ACT['rm-file'] = (el) => { CH.files.splice(+el.dataset.i, 1); paintComposer(); };
ACT.emoji = () => {
  const ex = $('.emoji-p'); if (ex) return ex.remove();
  const p = document.createElement('div'); p.className = 'emoji-p'; p.innerHTML = EMOJI.map((e) => `<button type="button">${e}</button>`).join('');
  p.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const ta = $('#comp-text'); ta.setRangeText(b.textContent, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); };
  $('.composer').appendChild(p);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!e.target.closest('.emoji-p,[data-act=emoji]')) { p.remove(); document.removeEventListener('click', h); } }), 0);
};
ACT['send-msg'] = async (_el, kind) => {
  const ta = $('#comp-text'); if (!ta || CH.sending) return;
  const text = ta.value.trim(), files = CH.files.slice(), cid = CH.active;
  if (!text && !files.length) return;
  CH.sending = true;
  const fd = new FormData();
  fd.append('text', text);
  if (CH.replyTo) fd.append('reply_to', CH.replyTo.id);
  if (kind === 'voice') fd.append('kind', 'voice');
  files.forEach((f) => fd.append('file', f, f.name));
  try {
    const r = await api('POST', `/chats/${cid}/messages`, fd);
    if (CH.active === cid) {
      CH.files = []; CH.replyTo = null; paintComposer(false);
      const t = $('#comp-text'); if (t) t.value = '';
      r.messages.forEach(appendMessage);
    }
  } catch (e) { fail(e); }
  CH.sending = false;
};
ACT.voice = async (el) => {
  if (CH.rec) { CH.rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Запись голоса не поддерживается в этом браузере', 'err');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream), chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); CH.rec = null;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const ext = /ogg/.test(blob.type) ? 'ogg' : /mp4|aac/.test(blob.type) ? 'm4a' : 'webm';
      if (blob.size > 500 && CH.active) { CH.files = [new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type })]; ACT['send-msg'](null, 'voice'); }
      else paintComposer();
    };
    mr.start(); CH.rec = mr; paintComposer(); toast('Идёт запись… нажмите микрофон ещё раз, чтобы отправить', 'ok', 2500);
  } catch { toast('Нет доступа к микрофону', 'err'); }
};
ACT['join-chat'] = async () => { try { await api.post(`/chats/${CH.active}/join`); const d = await api.get(`/chats/${CH.active}/messages?limit=40`); CH.msgs = d.items; await reloadInfo(); paintMessages(); $('#msgs').scrollTop = 1e9; loadList(); toast('Вы присоединились'); } catch (e) { fail(e); } };
ACT['chat-mute'] = async () => { try { await api.post(`/chats/${CH.active}/mute`, { muted: !CH.info.muted }); CH.info.muted = !CH.info.muted; paintComposer(); loadList(); } catch (e) { fail(e); } };

// ---------- информация о чате ----------
ACT['chat-info'] = () => openChatInfo();
function openChatInfo() {
  const i = CH.info; if (!i) return;
  const admin = isAdminRole(i.role) && i.type !== 'dm';
  const link = i.handle ? `${location.origin}/#/c/${i.handle}` : '';
  const members = (i.member_list || []).map((u) => userRow(u, { actions: `${u.role !== 'member' ? `<span class="pill">${u.role === 'owner' ? 'владелец' : 'админ'}</span>` : ''}${i.role === 'owner' && u.role !== 'owner' ? `<button class="icon-btn" data-act="member-role" data-uid="${u.id}" data-role="${u.role === 'admin' ? 'member' : 'admin'}" title="${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}">${ic('shield', 'sm')}</button>` : ''}${admin && u.role !== 'owner' && u.id !== S.user.id ? `<button class="icon-btn" data-act="member-kick" data-uid="${u.id}" title="Исключить">${ic('x', 'sm')}</button>` : ''}` })).join('');
  const m = modal(`${mHead(i.type === 'dm' ? 'Информация' : TYPE_LABEL[i.type])}<div class="modal-b">
    <div class="col" style="align-items:center;text-align:center;gap:6px">${avatar({ ...i, username: i.handle || i.title, display_name: i.title }, 'xl')}
      <h2 style="margin-top:8px">${esc(i.title || '')}</h2>
      ${i.type === 'dm' ? `<span class="muted">${esc(lastSeen(i.other))} · <a class="tag" href="#/u/${esc(i.other?.username)}" data-close>@${esc(i.other?.username)}</a></span>` : `<span class="muted">${i.members} ${i.type === 'channel' ? 'подписчиков' : 'участников'} · ${i.is_public ? 'публичный' : 'приватный'}</span>`}
      ${i.description ? `<p style="margin-top:6px">${rich(i.description)}</p>` : ''}</div>
    ${link ? `<div class="row" style="margin-top:14px"><input class="field" readonly value="${esc(link)}"><button class="btn" data-copy="${esc(link)}">${ic('link', 'sm')}</button></div>` : ''}
    <div class="col" style="margin-top:14px;gap:4px">
      ${i.joined ? `<button class="menu-i" data-act="chat-pin">${ic('star')}<span>${i.pinned_chat ? 'Открепить чат' : 'Закрепить чат вверху'}</span></button><button class="menu-i" data-act="chat-mute2">${ic(i.muted ? 'bell' : 'bellOff')}<span>${i.muted ? 'Включить уведомления' : 'Отключить уведомления'}</span></button>` : ''}
      ${admin ? `<button class="menu-i" data-act="chat-edit">${ic('edit')}<span>Редактировать</span></button><button class="menu-i" data-act="member-add">${ic('userplus')}<span>Добавить участника</span></button>` : ''}
      ${i.type === 'dm' && i.other ? `<button class="menu-i danger" data-act="block-user" data-uid="${i.other.id}">${ic('ban')}<span>Заблокировать</span></button>` : ''}
      ${i.joined && i.role !== 'owner' && i.type !== 'dm' ? `<button class="menu-i danger" data-act="chat-leave">${ic('logout')}<span>${i.type === 'channel' ? 'Отписаться' : 'Выйти из группы'}</span></button>` : ''}
      ${i.role === 'owner' || (i.type === 'dm' && i.joined) ? `<button class="menu-i danger" data-act="chat-delete">${ic('trash')}<span>${i.type === 'dm' ? 'Удалить чат' : 'Удалить ' + (i.type === 'channel' ? 'канал' : 'группу')}</span></button>` : ''}</div>
    ${members ? `<div class="sect">Участники</div>${members}` : ''}</div>`, { cls: 'wide' });
  CH.infoModal = m;
  m.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Ссылка скопирована')); const u = e.target.closest('[data-user]'); if (u && !e.target.closest('button')) { m.close(); location.hash = '#/u/' + u.dataset.user; } });
}
const reopenInfo = async () => { CH.infoModal?.close(); await reloadInfo(); openChatInfo(); };
ACT['chat-mute2'] = async () => { await ACT['chat-mute'](); CH.infoModal?.close(); openChatInfo(); };
ACT['member-role'] = (el) => api.post(`/chats/${CH.active}/members/${el.dataset.uid}/role`, { role: el.dataset.role }).then(reopenInfo).catch(fail);
ACT['member-kick'] = async (el) => { if (await confirmBox('Исключить участника?', 'Исключить')) api.del(`/chats/${CH.active}/members/${el.dataset.uid}`).then(reopenInfo).catch(fail); };
ACT['member-add'] = async () => {
  CH.infoModal?.close();
  const users = await pickUsers({ title: 'Добавить участника', multi: true });
  if (!users) return;
  for (const u of users) { try { await api.post(`/chats/${CH.active}/members`, { user_id: u.id }); } catch (e) { fail(e); } }
  await reloadInfo(); toast('Участники добавлены');
};
ACT['chat-leave'] = async () => { if (!await confirmBox('Вы действительно хотите выйти?', 'Выйти')) return; api.post(`/chats/${CH.active}/leave`).then(() => { CH.infoModal?.close(); location.hash = '#/chats'; }).catch(fail); };
ACT['chat-delete'] = async () => { if (!await confirmBox(CH.info.type === 'dm' ? 'Удалить чат у себя?' : 'Удалить навсегда вместе со всей перепиской?', 'Удалить')) return; api.del('/chats/' + CH.active).then(() => { CH.infoModal?.close(); location.hash = '#/chats'; loadList(); }).catch(fail); };
ACT['block-user'] = async (el) => { if (!await confirmBox('Заблокировать пользователя? Переписка станет недоступной.', 'Заблокировать')) return; api.post(`/users/${el.dataset.uid}/block`).then(() => { toast('Пользователь заблокирован'); CH.infoModal?.close(); }).catch(fail); };
ACT['chat-edit'] = () => {
  CH.infoModal?.close();
  const i = CH.info;
  const m = modal(`${mHead('Редактировать')}<div class="modal-b col">
    <div class="row">${avatar({ ...i, username: i.handle || i.title, display_name: i.title }, 'l')}<button class="btn sm" id="ce-av" type="button">Сменить фото</button><input type="file" id="ce-file" accept="image/*" hidden></div>
    <div><label class="lbl">Название</label><input class="field" id="ce-t" maxlength="60" value="${esc(i.title)}"></div>
    <div><label class="lbl">Описание</label><textarea class="field" id="ce-d" rows="3" maxlength="300">${esc(i.description || '')}</textarea></div>
    <div><label class="lbl">Публичное имя (@handle)</label><input class="field" id="ce-h" maxlength="32" value="${esc(i.handle || '')}" placeholder="например, my_channel"></div>
    <div class="row"><div class="grow"><div class="t" style="font-weight:600">Публичный</div><div class="muted" style="font-size:13px">Можно найти через поиск и вступить по ссылке</div></div><button class="switch ${i.is_public ? 'on' : ''}" id="ce-p" type="button" aria-label="Публичный"></button></div></div>
    <div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="ce-ok">Сохранить</button></div>`);
  $('#ce-p', m).onclick = (e) => e.currentTarget.classList.toggle('on');
  $('#ce-av', m).onclick = () => $('#ce-file', m).click();
  $('#ce-file', m).onchange = async (e) => { const fd = new FormData(); fd.append('file', e.target.files[0]); try { await api('POST', `/chats/${i.id}/avatar`, fd); toast('Фото обновлено'); loadList(); } catch (er) { fail(er); } };
  $('#ce-ok', m).onclick = async () => {
    try {
      await api.patch('/chats/' + i.id, { title: $('#ce-t', m).value, description: $('#ce-d', m).value, handle: $('#ce-h', m).value, is_public: $('#ce-p', m).classList.contains('on') });
      m.close(); await reloadInfo(); loadList(); toast('Сохранено');
    } catch (e) { fail(e); }
  };
};

// ---------- выбор пользователей ----------
function pickUsers({ title = 'Выберите пользователей', multi = false } = {}) {
  return new Promise((resolve) => {
    let done = false; const sel = new Map();
    const m = modal(`${mHead(title)}<div class="modal-b"><input class="field" id="pk-q" placeholder="Поиск по имени или @нику" autocomplete="off"><div id="pk-sel" class="chips" style="margin-top:10px"></div><div id="pk-list" style="margin-top:6px"></div></div>${multi ? '<div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="pk-ok">Готово</button></div>' : ''}`, { cls: 'tall', onClose: () => !done && resolve(null) });
    const list = $('#pk-list', m);
    const paintSel = () => { $('#pk-sel', m).innerHTML = [...sel.values()].map((u) => `<span class="chip active" data-rm="${u.id}">${esc(u.display_name)} ✕</span>`).join(''); };
    const draw = (users) => { list.innerHTML = users.length ? users.filter((u) => !u.is_me).map((u) => userRow(u, { actions: multi ? `<span class="btn sm ${sel.has(u.id) ? 'primary' : ''}">${sel.has(u.id) ? '✓' : '+'}</span>` : '' })).join('') : '<div class="empty" style="padding:20px">Никого не найдено</div>'; list._users = users; };
    const search = debounce(async () => { const q = $('#pk-q', m).value.trim(); try { draw(q ? (await api.get('/search?q=' + encodeURIComponent(q))).users : await api.get('/suggestions')); } catch (e) { fail(e); } }, 250);
    $('#pk-q', m).oninput = search; search();
    list.onclick = (e) => {
      const r = e.target.closest('[data-user]'); if (!r) return;
      const u = list._users.find((x) => x.username === r.dataset.user);
      if (!multi) { done = true; m.close(); return resolve([u]); }
      sel.has(u.id) ? sel.delete(u.id) : sel.set(u.id, u); paintSel(); draw(list._users);
    };
    $('#pk-sel', m).onclick = (e) => { const c = e.target.closest('[data-rm]'); if (c) { sel.delete(+c.dataset.rm); paintSel(); draw(list._users); } };
    if (multi) $('#pk-ok', m).onclick = () => { done = true; m.close(); resolve([...sel.values()]); };
  });
}

// ---------- новый чат ----------
ACT['new-chat'] = () => openNewChat();
async function startDM(userId) {
  try { const r = await api.post('/chats', { type: 'dm', user_id: userId }); location.hash = '#/chats/' + r.id; } catch (e) { fail(e); }
}
function openNewChat(tab = 'dm') {
  const m = modal(`${mHead('Новый чат')}<div class="modal-b"><div class="chips" id="nc-tabs">${[['dm', 'Личное'], ['group', 'Группа'], ['channel', 'Канал'], ['discover', 'Обзор']].map(([k, l]) => `<button class="chip ${k === tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="nc-body"></div></div>`, { cls: 'wide tall' });
  const body = $('#nc-body', m);
  const show = async (t) => {
    $$('#nc-tabs .chip', m).forEach((c) => c.classList.toggle('active', c.dataset.t === t));
    if (t === 'dm') {
      body.innerHTML = `<input class="field" id="d-q" placeholder="Найти пользователя" autocomplete="off"><div id="d-list" style="margin-top:8px"><div class="spinner"></div></div>`;
      const draw = (us) => { $('#d-list', body).innerHTML = us.length ? us.map((u) => userRow(u)).join('') : '<div class="empty" style="padding:20px">Никого не найдено</div>'; };
      const go = debounce(async () => { const q = $('#d-q', body).value.trim(); try { draw(q ? (await api.get('/search?q=' + encodeURIComponent(q))).users.filter((u) => !u.is_me) : await api.get('/suggestions')); } catch (e) { fail(e); } }, 250);
      $('#d-q', body).oninput = go; go();
      $('#d-list', body).onclick = (e) => { const r = e.target.closest('[data-user]'); if (!r) return; api.get('/users/' + r.dataset.user).then((u) => { m.close(); startDM(u.id); }).catch(fail); };
    } else if (t === 'group' || t === 'channel') {
      const isCh = t === 'channel'; const members = new Map();
      body.innerHTML = `<div class="col"><div><label class="lbl">Название</label><input class="field" id="g-t" maxlength="60" placeholder="${isCh ? 'Название канала' : 'Название группы'}"></div>
        <div><label class="lbl">Описание</label><textarea class="field" id="g-d" rows="2" maxlength="300" placeholder="О чём этот ${isCh ? 'канал' : 'чат'}?"></textarea></div>
        <div class="row"><div class="grow"><b>Публичный</b><div class="muted" style="font-size:13px">Виден в поиске, вступить можно по ссылке</div></div><button class="switch ${isCh ? 'on' : ''}" id="g-p" type="button" aria-label="Публичный"></button></div>
        <div id="g-hw" class="${isCh ? '' : 'hidden'}"><label class="lbl">Публичное имя (@handle)</label><input class="field" id="g-h" maxlength="32" placeholder="латиница, цифры, _"></div>
        ${isCh ? '' : '<div><label class="lbl">Участники</label><div id="g-m" class="chips"></div><button class="btn sm" id="g-add" type="button">' + ic('userplus', 'sm') + ' Добавить</button></div>'}
        <button class="btn primary block" id="g-ok">${isCh ? 'Создать канал' : 'Создать группу'}</button></div>`;
      $('#g-p', body).onclick = (e) => { e.currentTarget.classList.toggle('on'); $('#g-hw', body).classList.toggle('hidden', !e.currentTarget.classList.contains('on') && !$('#g-h', body).value); };
      if (!isCh) $('#g-add', body).onclick = async () => { const us = await pickUsers({ title: 'Добавить участников', multi: true }); (us || []).forEach((u) => members.set(u.id, u)); $('#g-m', body).innerHTML = [...members.values()].map((u) => `<span class="chip">${esc(u.display_name)}</span>`).join(''); };
      $('#g-ok', body).onclick = async () => {
        try {
          const r = await api.post('/chats', { type: t, title: $('#g-t', body).value, description: $('#g-d', body).value, is_public: $('#g-p', body).classList.contains('on'), handle: $('#g-h', body).value, members: [...members.keys()] });
          m.close(); location.hash = '#/chats/' + r.id; toast(isCh ? 'Канал создан' : 'Группа создана');
        } catch (e) { fail(e); }
      };
    } else {
      body.innerHTML = '<div class="spinner"></div>';
      try {
        const list = await api.get('/discover/chats');
        body.innerHTML = list.length ? list.map(chatCardHTML).join('') : '<div class="empty">Публичных чатов пока нет</div>';
      } catch (e) { fail(e); }
    }
  };
  $('#nc-tabs', m).onclick = (e) => { const c = e.target.closest('[data-t]'); if (c) show(c.dataset.t); };
  m.addEventListener('click', (e) => { if (e.target.closest('[data-act=join-open],[data-act=open-chat]')) m.close(); });
  show(tab);
}
function chatCardHTML(c) {
  return `<div class="chat-card list-i" data-act="${c.joined ? 'open-chat' : 'join-open'}" data-id="${c.id}">${avatar({ ...c, username: c.handle, display_name: c.title }, '')}<div class="grow"><b class="ellip" style="display:block">${c.type === 'channel' ? ic('mega', 'sm') : ic('users', 'sm')} ${esc(c.title)}</b><span class="muted ellip" style="display:block;font-size:13px">${c.handle ? '@' + esc(c.handle) + ' · ' : ''}${c.members} ${c.type === 'channel' ? 'подписчиков' : 'участников'}</span>${c.description ? `<span class="dim ellip" style="display:block;font-size:12.5px">${esc(c.description)}</span>` : ''}</div><span class="btn sm ${c.joined ? '' : 'primary'}">${c.joined ? 'Открыть' : c.type === 'channel' ? 'Подписаться' : 'Вступить'}</span></div>`;
}
ACT['join-open'] = async (el) => { try { await api.post(`/chats/${el.dataset.id}/join`); toast('Вы присоединились'); location.hash = '#/chats/' + el.dataset.id; } catch (e) { fail(e); } };
