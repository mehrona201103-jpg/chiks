'use strict';
// ====== Страницы: поиск, профиль, уведомления, настройки ======
function bindUserClicks(box, onNav) {
  box.addEventListener('click', (e) => {
    const r = e.target.closest('[data-user]');
    if (!r || e.target.closest('button,a')) return;
    onNav && onNav(); location.hash = '#/u/' + r.dataset.user;
  });
}
const page = (inner, extra = '') => `<div class="page"><div class="inner" ${extra}>${inner}</div></div>`;

// ---------- поиск и рекомендации ----------
function renderSearch(view) {
  let tab = 'all', q = '';
  view.innerHTML = page(`<h1>Поиск</h1><div class="search-box">${ic('search')}<input class="field" id="s-q" placeholder="Люди, видео, каналы, группы, #хештеги" autocomplete="off"></div>
    <div class="chips hidden" id="s-tabs">${[['all', 'Всё'], ['users', 'Люди'], ['videos', 'Видео'], ['channels', 'Каналы'], ['groups', 'Группы']].map(([k, l]) => `<button class="chip ${k === 'all' ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="s-out"></div>`);
  const out = $('#s-out', view), inp = $('#s-q', view);
  bindUserClicks(out);

  async function home() {
    out.innerHTML = '<div class="spinner"></div>';
    try {
      const [ex, sug, chats] = await Promise.all([api.get('/explore'), api.get('/suggestions'), api.get('/discover/chats')]);
      out.innerHTML = `${ex.tags.length ? `<div class="sect">Тренды</div><div class="chips">${ex.tags.map((t) => `<a class="chip" href="#/tag/${esc(t.tag.slice(1))}">${esc(t.tag)} <span class="dim">${t.count}</span></a>`).join('')}</div>` : ''}
        ${sug.length ? `<div class="sect">Рекомендуем подписаться</div><div class="card" style="padding:6px">${sug.map((u) => userRow(u, { actions: followBtn({ ...u, following: false }) })).join('')}</div>` : ''}
        ${chats.length ? `<div class="sect">Каналы и группы</div><div class="card" style="padding:6px">${chats.map(chatCardHTML).join('')}</div>` : ''}
        <div class="sect">Популярное</div>${tiles(ex.items)}`;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  const run = debounce(async () => {
    q = inp.value.trim();
    $('#s-tabs', view).classList.toggle('hidden', !q);
    if (!q) return home();
    try {
      const r = await api.get('/search?q=' + encodeURIComponent(q));
      if (q !== inp.value.trim()) return;
      const sec = (title, html, n) => (n ? `<div class="sect">${title}</div>${html}` : '');
      const parts = {
        users: sec('Люди', `<div class="card" style="padding:6px">${r.users.map((u) => userRow(u, { actions: followBtn(u) })).join('')}</div>`, r.users.length),
        videos: sec('Видео и фото', tiles(r.posts), r.posts.length),
        channels: sec('Каналы', `<div class="card" style="padding:6px">${r.channels.map(chatCardHTML).join('')}</div>`, r.channels.length),
        groups: sec('Группы', `<div class="card" style="padding:6px">${r.groups.map(chatCardHTML).join('')}</div>`, r.groups.length),
      };
      const tags = r.tags.length ? `<div class="sect">Хештеги</div><div class="chips">${r.tags.map((t) => `<a class="chip" href="#/tag/${esc(t.tag.slice(1))}">${esc(t.tag)} <span class="dim">${t.count}</span></a>`).join('')}</div>` : '';
      const html = tab === 'all' ? tags + parts.users + parts.channels + parts.groups + parts.videos : parts[tab];
      out.innerHTML = html || `<div class="empty">${ic('search')}<p>По запросу «${esc(q)}» ничего не найдено</p></div>`;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }, 280);
  inp.oninput = run;
  $('#s-tabs', view).onclick = (e) => { const c = e.target.closest('[data-t]'); if (!c) return; tab = c.dataset.t; $$('#s-tabs .chip', view).forEach((x) => x.classList.toggle('active', x === c)); run(); };
  home(); if (matchMedia('(pointer:fine)').matches) inp.focus();
}

function renderTag(view, tag) {
  view.innerHTML = page(`<div class="topbar"><button class="icon-btn" data-act="back">${ic('back')}</button><h1 class="grad-text">#${esc(tag)}</h1></div><div id="t-out"><div class="spinner"></div></div>`);
  api.get('/tags/' + encodeURIComponent(tag) + '/posts').then((d) => { $('#t-out', view).innerHTML = tiles(d.items); }).catch((e) => { $('#t-out', view).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
}
function renderSaved(view) {
  view.innerHTML = page(`<div class="topbar"><button class="icon-btn" data-act="back">${ic('back')}</button><h1>Сохранённое</h1></div><div id="t-out"><div class="spinner"></div></div>`);
  api.get('/me/bookmarks').then((d) => { $('#t-out', view).innerHTML = tiles(d.items); }).catch(fail);
}

// ---------- профиль ----------
async function renderProfile(view, username) {
  view.innerHTML = page('<div class="spinner"></div>');
  let p;
  try { p = await api.get('/users/' + encodeURIComponent(username)); } catch (e) { view.innerHTML = page(`<div class="empty">${ic('user')}<h3>${esc(e.message)}</h3><p style="margin-top:12px"><a class="btn" href="#/">В ленту</a></p></div>`); return; }
  let tab = 'posts';
  const r = p.rel;
  const btns = p.is_me
    ? `<button class="btn" data-act="edit-profile">${ic('edit', 'sm')} Редактировать</button><button class="btn" data-act="share-profile">${ic('share', 'sm')}</button><a class="btn" href="#/settings">${ic('sliders', 'sm')}</a>`
    : `<button class="btn ${r.following || r.pending ? '' : 'primary'}" data-act="follow-user" data-uid="${p.id}">${r.following ? 'Вы подписаны' : r.pending ? 'Запрос отправлен' : r.follows_me ? 'Подписаться в ответ' : 'Подписаться'}</button><button class="btn" data-act="dm-user" data-uid="${p.id}">${ic('send', 'sm')} Написать</button><button class="icon-btn" data-act="user-menu" aria-label="Ещё">${ic('more')}</button>`;
  view.innerHTML = page(`<div class="prof-head">${avatar(p, 'xl', true)}<div class="info">
      <h2>${esc(p.display_name)} ${p.is_private ? `<span title="Закрытый аккаунт">${ic('lock', 'sm')}</span>` : ''}</h2>
      <div class="muted">@${esc(p.username)}${p.online ? ' · <span style="color:var(--ok)">в сети</span>' : ''}</div>
      <div class="stats"><div><b>${fmtN(p.posts)}</b><span class="muted">публикаций</span></div>
        <button data-act="followers" data-u="${esc(p.username)}"><b id="p-fc">${fmtN(p.followers)}</b>подписчиков</button>
        <button data-act="following" data-u="${esc(p.username)}"><b>${fmtN(p.following_count)}</b>подписок</button>
        <div><b>${fmtN(p.likes_total)}</b><span class="muted">лайков</span></div></div>
      ${p.bio ? `<p style="margin-bottom:12px">${rich(p.bio)}</p>` : ''}
      ${r.blocked_me && !p.is_me ? '' : `<div class="row" style="flex-wrap:wrap">${btns}</div>`}</div></div>
    ${r.blocked ? `<div class="empty">${ic('ban')}<p>Вы заблокировали этого пользователя</p><p style="margin-top:12px"><button class="btn" data-act="user-menu">Разблокировать</button></p></div>`
      : !p.can_view ? `<div class="empty">${ic('lock')}<h3>Это закрытый аккаунт</h3><p>Подпишитесь, чтобы видеть публикации</p></div>`
      : `<div class="tabs-l" id="p-tabs"><button class="active" data-t="posts">${ic('video', 'sm')} Публикации</button><button data-t="reposts">${ic('repeat', 'sm')} Репосты</button>${p.show_likes || p.is_me ? `<button data-t="likes">${ic('heart', 'sm')} Понравилось</button>` : ''}${p.is_me ? `<button data-t="saved">${ic('bookmark', 'sm')} Сохранённое</button>` : ''}</div><div id="p-out"><div class="spinner"></div></div>`}`);
  const unsub = on('follow-changed', (d) => { if (d.uid === p.id) { p.followers += d.following ? 1 : -1; const el = $('#p-fc'); if (el) el.textContent = fmtN(Math.max(0, p.followers)); $('[data-act=follow-user][data-uid]', view)?.classList.toggle('primary', !d.following && !d.pending); if (p.is_private && !d.following) navigate(); else if (d.following && p.is_private) navigate(); } });
  S.cleanup = unsub;
  view.PROFILE = p;
  const out = $('#p-out', view); if (!out) return;
  async function load() {
    out.innerHTML = '<div class="spinner"></div>';
    try {
      const d = tab === 'saved' ? await api.get('/me/bookmarks') : await api.get(`/users/${encodeURIComponent(p.username)}/posts?tab=${tab}`);
      out.innerHTML = d.hidden ? `<div class="empty">${ic('lock')}<p>Пользователь скрыл лайки</p></div>` : tiles(d.items);
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  $('#p-tabs', view).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; $$('#p-tabs button', view).forEach((x) => x.classList.toggle('active', x === b)); load(); };
  load();
}
ACT['dm-user'] = (el) => startDM(+el.dataset.uid);
ACT['share-profile'] = () => navigator.clipboard?.writeText(`${location.origin}/#/u/${S.user.username}`).then(() => toast('Ссылка на профиль скопирована'));
async function userListModal(title, path) {
  const m = modal(`${mHead(title)}<div class="modal-b"><div class="spinner"></div></div>`, { cls: 'tall' });
  try {
    const list = await api.get(path);
    $('.modal-b', m).innerHTML = list.length ? list.map((u) => userRow(u, { actions: followBtn(u) })).join('') : `<div class="empty">Список пуст</div>`;
    bindUserClicks($('.modal-b', m), () => m.close());
  } catch (e) { $('.modal-b', m).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.followers = (el) => userListModal('Подписчики', `/users/${el.dataset.u}/followers`);
ACT.following = (el) => userListModal('Подписки', `/users/${el.dataset.u}/following`);
ACT['user-menu'] = () => {
  const p = $('#view').PROFILE; if (!p) return;
  actionSheet([
    { icon: 'ban', label: p.rel.blocked ? 'Разблокировать' : 'Заблокировать', danger: !p.rel.blocked, fn: async () => { if (!p.rel.blocked && !await confirmBox(`Заблокировать @${p.username}?`, 'Заблокировать')) return; api.post(`/users/${p.id}/block`).then((r) => { toast(r.blocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован'); navigate(); }).catch(fail); } },
    { icon: 'flag', label: 'Пожаловаться', fn: async () => { const t = await promptBox('Жалоба', 'Опишите причину'); if (t !== null) api.post('/report', { type: 'user', id: p.id, reason: t }).then(() => toast('Жалоба отправлена')).catch(fail); } },
    { icon: 'link', label: 'Копировать ссылку', fn: () => navigator.clipboard?.writeText(`${location.origin}/#/u/${p.username}`).then(() => toast('Скопировано')) },
  ]);
};
ACT['edit-profile'] = () => {
  const u = S.user;
  const m = modal(`${mHead('Редактировать профиль')}<div class="modal-b col">
    <div class="row"><div id="ep-av">${avatar(u, 'l')}</div><button class="btn sm" id="ep-pick" type="button">Сменить фото</button><input type="file" id="ep-file" accept="image/*" hidden></div>
    <div><label class="lbl">Имя</label><input class="field" id="ep-n" maxlength="40" value="${esc(u.display_name)}"></div>
    <div><label class="lbl">Имя пользователя</label><input class="field" id="ep-u" maxlength="24" value="${esc(u.username)}"></div>
    <div><label class="lbl">О себе</label><textarea class="field" id="ep-b" rows="3" maxlength="200">${esc(u.bio)}</textarea></div></div>
    <div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="ep-ok">Сохранить</button></div>`);
  $('#ep-pick', m).onclick = () => $('#ep-file', m).click();
  $('#ep-file', m).onchange = async (e) => {
    const f0 = e.target.files[0]; e.target.value = ''; if (!f0) return;
    try { const f = await prepMedia(f0, { forceImage: true, max: 640 }); const fd = new FormData(); fd.append('file', f, f.name); S.user = await api('POST', '/me/avatar', fd); $('#ep-av', m).innerHTML = avatar(S.user, 'l'); paintMe(); toast('Фото обновлено'); } catch (er) { fail(er); }
  };
  $('#ep-ok', m).onclick = async () => {
    try { S.user = await api.patch('/me', { display_name: $('#ep-n', m).value, username: $('#ep-u', m).value, bio: $('#ep-b', m).value }); m.close(); paintMe(); toast('Профиль обновлён'); location.hash = '#/u/' + S.user.username; navigate(); } catch (e) { fail(e); }
  };
};

// ---------- уведомления ----------
const NOTIF_TEXT = { like: 'оценил(а) вашу публикацию', comment: 'прокомментировал(а)', follow: 'подписался(ась) на вас', follow_request: 'хочет подписаться на вас', repost: 'сделал(а) репост вашей публикации', mention: 'упомянул(а) вас', message: 'отправил(а) сообщение' };
const NOTIF_IC = { like: 'heart', comment: 'comment', follow: 'userplus', follow_request: 'userplus', repost: 'repeat', mention: 'hash', message: 'send' };
async function renderNotifications(view) {
  view.innerHTML = page(`<div class="topbar"><h1>Уведомления</h1><span class="grow"></span></div><div id="n-out"><div class="spinner"></div></div>`);
  const out = $('#n-out', view);
  async function load() {
    try {
      const [list, reqs] = await Promise.all([api.get('/notifications'), api.get('/follow-requests')]);
      out.innerHTML = `${reqs.length ? `<div class="sect">Запросы на подписку</div><div class="card" style="padding:6px">${reqs.map((u) => userRow(u, { actions: `<button class="btn sm primary" data-act="req" data-uid="${u.id}" data-a="accept">Принять</button><button class="btn sm" data-act="req" data-uid="${u.id}" data-a="decline">Отклонить</button>` })).join('')}</div>` : ''}
        ${reqs.length && list.length ? '<div class="sect">Активность</div>' : ''}
        ${list.length ? list.map((n) => `<div class="notif ${n.is_read ? '' : 'unread'}" data-nid="${n.id}" data-post="${n.post_id || ''}" data-chat="${n.chat_id || ''}" data-u="${esc(n.actor?.username || '')}">
          <div style="position:relative">${avatar(n.actor)}<span class="notif-ic t-${n.type}">${ic(NOTIF_IC[n.type] || 'bell')}</span></div>
          <div class="grow"><b>${esc(n.actor?.display_name || 'Chikstagram')}</b> ${NOTIF_TEXT[n.type] || ''}${n.text && ['comment', 'mention'].includes(n.type) ? `: <span class="muted">«${esc(n.text)}»</span>` : ''}<div class="dim" style="font-size:12px">${ago(n.created_at)}</div></div>
          ${n.thumb ? `<img class="nt" src="${esc(n.thumb)}" alt="">` : n.type === 'follow' && n.actor ? `<button class="btn sm ${n.following ? '' : 'primary'}" data-act="follow-user" data-uid="${n.actor.id}">${n.following ? 'Вы подписаны' : 'Подписаться'}</button>` : ''}</div>`).join('') : (reqs.length ? '' : `<div class="empty">${ic('bell')}<p>Пока нет уведомлений</p></div>`)}`;
      if (list.some((n) => !n.is_read)) api.post('/notifications/read').then(refreshCounters).catch(() => {});
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  out.onclick = (e) => {
    const rq = e.target.closest('[data-act=req]');
    if (rq) { api.post(`/follow-requests/${rq.dataset.uid}/${rq.dataset.a}`).then(() => { toast(rq.dataset.a === 'accept' ? 'Запрос принят' : 'Запрос отклонён'); load(); refreshCounters(); }).catch(fail); return; }
    if (e.target.closest('button')) return;
    const n = e.target.closest('.notif'); const ur = e.target.closest('[data-user]');
    if (ur) { location.hash = '#/u/' + ur.dataset.user; return; }
    if (!n) return;
    location.hash = n.dataset.post ? '#/post/' + n.dataset.post : n.dataset.chat ? '#/chats/' + n.dataset.chat : n.dataset.u ? '#/u/' + n.dataset.u : '#/notifications';
  };
  await load();
  S.cleanup = on('rt:notification', () => load());
}

// ---------- настройки ----------
async function renderSettings(view) {
  const u = S.user;
  const sw = (key, on_) => `<button class="switch ${on_ ? 'on' : ''}" data-act="set-toggle" data-k="${key}" role="switch" aria-checked="${!!on_}"></button>`;
  const sel = (key, v) => `<select class="field" data-act-change="set-select" data-k="${key}"><option value="everyone" ${v === 'everyone' ? 'selected' : ''}>Все</option><option value="followers" ${v === 'followers' ? 'selected' : ''}>Только подписчики</option><option value="nobody" ${v === 'nobody' ? 'selected' : ''}>Никто</option></select>`;
  view.innerHTML = page(`<h1>Настройки</h1>
    <div class="card pad row">${avatar(u, 'l')}<div class="grow"><b>${esc(u.display_name)}</b><div class="muted">@${esc(u.username)} · ${esc(u.email)}</div></div><button class="btn sm" data-act="edit-profile">Изменить</button></div>
    <div class="sect">Приватность</div><div class="card pad">
      <div class="set-row"><div class="grow"><div class="t">Закрытый аккаунт</div><div class="d">Подписываться смогут только с вашего одобрения, контент увидят лишь подписчики</div></div>${sw('is_private', u.is_private)}</div>
      <div class="set-row"><div class="grow"><div class="t">Статус «в сети»</div><div class="d">Показывать, когда вы онлайн и время последнего визита</div></div>${sw('show_online', u.show_online)}</div>
      <div class="set-row"><div class="grow"><div class="t">Показывать понравившееся</div><div class="d">Вкладка «Понравилось» в профиле видна другим</div></div>${sw('show_likes', u.show_likes)}</div>
      <div class="set-row"><div class="grow"><div class="t">Кто может писать мне</div><div class="d">Личные сообщения</div></div>${sel('allow_dm', u.allow_dm)}</div>
      <div class="set-row"><div class="grow"><div class="t">Кто может комментировать</div><div class="d">Комментарии под вашими публикациями</div></div>${sel('allow_comments', u.allow_comments)}</div></div>
    <div class="sect">Заблокированные</div><div class="card pad" id="blocks"><div class="spinner"></div></div>
    <div class="sect">Безопасность</div><div class="card pad">
      <div class="set-row"><div class="grow"><div class="t">Сменить пароль</div><div class="d">После смены вы выйдете на остальных устройствах</div></div><button class="btn sm" data-act="chg-pass">Изменить</button></div>
      <div id="sessions"><div class="spinner"></div></div></div>
    <div class="sect">Аккаунт</div><div class="card pad">
      <div class="set-row"><div class="grow"><div class="t">Сохранённые публикации</div></div><a class="btn sm" href="#/saved">Открыть</a></div>
      <div class="set-row"><div class="grow"><div class="t">Выйти</div></div><button class="btn sm" data-act="logout">${ic('logout', 'sm')} Выйти</button></div>
      <div class="set-row"><div class="grow"><div class="t" style="color:#ff8197">Удалить аккаунт</div><div class="d">Все публикации и данные будут удалены безвозвратно</div></div><button class="btn sm danger" data-act="del-account">Удалить</button></div></div>`);
  $('.page', view).addEventListener('change', async (e) => {
    const s = e.target.closest('[data-act-change=set-select]'); if (!s) return;
    try { S.user = await api.patch('/me', { [s.dataset.k]: s.value }); toast('Сохранено', 'ok', 1200); } catch (er) { fail(er); }
  });
  loadBlocks(); loadSessions();
  async function loadBlocks() {
    const box = $('#blocks', view);
    try {
      const l = await api.get('/me/blocks');
      box.innerHTML = l.length ? l.map((b) => userRow(b, { actions: `<button class="btn sm" data-act="unblock" data-uid="${b.id}">Разблокировать</button>` })).join('') : '<span class="muted">Список пуст</span>';
    } catch (e) { box.textContent = e.message; }
  }
  async function loadSessions() {
    const box = $('#sessions', view);
    try {
      const l = await api.get('/sessions');
      box.innerHTML = `<div class="t" style="font-weight:600;margin:14px 0 6px">Активные сеансы</div>` + l.map((s) => `<div class="set-row"><div class="grow"><div class="t ellip" style="max-width:420px">${esc(shortUA(s.device))}${s.current ? ' <span class="pill">этот</span>' : ''}</div><div class="d">${esc(s.ip)} · ${new Date(s.created_at).toLocaleString('ru-RU')}</div></div>${s.current ? '' : `<button class="btn sm" data-act="kill-session" data-id="${s.id}">Завершить</button>`}</div>`).join('') + (l.length > 1 ? '<button class="btn sm danger" data-act="kill-others" style="margin-top:10px">Завершить все остальные</button>' : '');
    } catch (e) { box.textContent = e.message; }
  }
  view.RELOAD = () => { loadBlocks(); loadSessions(); };
}
const shortUA = (ua) => { const b = /(Edg|Chrome|Firefox|Safari|OPR)\//.exec(ua || ''); const o = /(Windows|Mac OS X|Android|iPhone|Linux|iPad)/.exec(ua || ''); return `${{ Edg: 'Edge', OPR: 'Opera' }[b?.[1]] || b?.[1] || 'Браузер'}${o ? ' · ' + o[1].replace('Mac OS X', 'macOS') : ''}`; };
ACT['set-toggle'] = async (el) => {
  const k = el.dataset.k, v = !el.classList.contains('on');
  try { S.user = await api.patch('/me', { [k]: v }); el.classList.toggle('on', v); el.setAttribute('aria-checked', v); toast(k === 'is_private' ? (v ? 'Аккаунт стал закрытым' : 'Аккаунт открыт') : 'Сохранено', 'ok', 1500); } catch (e) { fail(e); }
};
ACT.unblock = (el) => api.post(`/users/${el.dataset.uid}/block`).then(() => { toast('Пользователь разблокирован'); $('#view').RELOAD?.(); }).catch(fail);
ACT['kill-session'] = (el) => api.del('/sessions/' + el.dataset.id).then(() => $('#view').RELOAD?.()).catch(fail);
ACT['kill-others'] = () => api.post('/sessions/revoke-others').then(() => { toast('Остальные сеансы завершены'); $('#view').RELOAD?.(); }).catch(fail);
ACT['chg-pass'] = () => {
  const m = modal(`${mHead('Смена пароля')}<div class="modal-b col"><div><label class="lbl">Текущий пароль</label><input class="field" type="password" id="pw0" autocomplete="current-password"></div><div><label class="lbl">Новый пароль (от 8 символов)</label><input class="field" type="password" id="pw1" autocomplete="new-password"></div></div><div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="pw-ok">Сменить</button></div>`);
  $('#pw-ok', m).onclick = () => api.post('/me/password', { current: $('#pw0', m).value, next: $('#pw1', m).value }).then(() => { m.close(); toast('Пароль изменён'); $('#view').RELOAD?.(); }).catch(fail);
};
ACT['del-account'] = async () => {
  if (!await confirmBox('Удалить аккаунт навсегда? Это действие необратимо.', 'Продолжить')) return;
  const pw = await promptBox('Подтверждение', 'Введите пароль', { type: 'password', okLabel: 'Удалить аккаунт' }); if (!pw) return;
  api.del('/me', { password: pw }).then(() => { toast('Аккаунт удалён'); doLogout(true); }).catch(fail);
};
