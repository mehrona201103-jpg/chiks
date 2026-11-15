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
    ? `<button class="btn" data-act="edit-profile">${ic('edit', 'sm')} Редактировать</button><button class="btn" data-act="share-profile">${ic('share', 'sm')}</button><a class="btn" href="#/monetization">${ic('star', 'sm')} Монетизация</a><a class="btn" href="#/settings">${ic('sliders', 'sm')}</a>`
    : `<button class="btn ${r.following || r.pending ? '' : 'primary'}" data-act="follow-user" data-uid="${p.id}">${r.following ? 'Вы подписаны' : r.pending ? 'Запрос отправлен' : r.follows_me ? 'Подписаться в ответ' : 'Подписаться'}</button><button class="btn" data-act="dm-user" data-uid="${p.id}">${ic('send', 'sm')} Написать</button><button class="icon-btn" data-act="user-menu" aria-label="Ещё">${ic('more')}</button>`;
  view.innerHTML = page(`<div class="prof-head">${avatar(p, 'xl', true)}<div class="info">
      <h2>${esc(p.display_name)}${p.verified ? ' <span class="vbadge" title="Верифицированный аккаунт">✓</span>' : ''}${p.is_creator ? ' <span class="cbadge" title="Creator">★</span>' : ''} ${p.is_private ? `<span title="Закрытый аккаунт">${ic('lock', 'sm')}</span>` : ''}</h2>
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
    <div class="card pad row">${avatar(u, 'l')}<div class="grow"><b>${esc(u.display_name)}${u.verified ? ' <span class="vbadge" title="Верифицирован">✓</span>' : ''}</b><div class="muted">@${esc(u.username)} · ${esc(u.email)}</div></div><button class="btn sm" data-act="edit-profile">Изменить</button></div>

    <div class="sect">Верификация</div>
    <div class="card pad" id="verif-box"><div class="spinner"></div></div>

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
  loadBlocks(); loadSessions(); loadVerification();
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
  async function loadVerification() {
    const box = $('#verif-box', view);
    try {
      const d = await api.get('/verification');
      if (d.verified && d.paid) {
        box.innerHTML = `<div class="set-row"><div class="grow"><div class="t">Оранжевая галочка <span class="vbadge">✓</span></div><div class="d">Ваш аккаунт верифицирован</div></div><span class="pill" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#111">Активна</span></div>`;
        return;
      }
      if (d.verified && d.free_until) {
        const left = Math.max(0, Math.ceil((d.free_until - Date.now()) / 86400000));
        box.innerHTML = `<div class="set-row"><div class="grow"><div class="t">Бесплатная галочка <span class="vbadge">✓</span></div><div class="d">Для новых пользователей — ещё ${left} дн. Потом можно купить за ${d.price} сомони</div></div>
          <button class="btn primary sm" data-act="buy-verif">Купить навсегда</button></div>`;
        return;
      }
      if (d.last_request && ['pending','paid','reviewing'].includes(d.last_request.status)) {
        const stMap = { pending: 'Ожидает оплаты', paid: 'Оплачено', reviewing: 'На проверке у админа' };
        box.innerHTML = `<div class="set-row"><div class="grow"><div class="t">Заявка на галочку</div><div class="d">${stMap[d.last_request.status] || d.last_request.status}</div></div>
          ${d.last_request.status === 'pending' ? `<button class="btn primary sm" data-act="verif-receipt">Загрузить чек</button>` : '<span class="pill">Ждём</span>'}</div>`;
        return;
      }
      if (d.last_request && d.last_request.status === 'rejected') {
        box.innerHTML = `<div class="set-row"><div class="grow"><div class="t">Заявка отклонена</div><div class="d">${esc(d.last_request.reject_reason || 'Причина не указана')}</div></div>
          <button class="btn primary sm" data-act="buy-verif">Подать снова</button></div>`;
        return;
      }
      box.innerHTML = `<div class="set-row"><div class="grow"><div class="t">Купить оранжевую галочку</div><div class="d">Подтвердите личность и получите значок ✓ рядом с именем. Цена: <b>${d.price} сомони</b></div></div>
        <button class="btn primary sm" data-act="buy-verif">Купить галочку</button></div>`;
    } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
  }
  view.RELOAD = () => { loadBlocks(); loadSessions(); loadVerification(); };
}

// Покупка / подача на верификацию
ACT['buy-verif'] = async () => {
  let step = 1, fullName = '', passportFile = null, selfieFile = null;
  const m = modal(`${mHead('Купить галочку ✓')}<div class="modal-b" id="verif-step"></div>
    <div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="verif-next">Далее</button></div>`, { cls: 'wide' });
  const box = $('#verif-step', m);
  const nextBtn = $('#verif-next', m);

  function renderStep() {
    if (step === 1) {
      box.innerHTML = `
        <p class="muted" style="margin-bottom:12px">Галочка стоит <b>20 сомони</b>. Новым пользователям — бесплатно 3 дня.</p>
        <label class="lbl">ФИО как в паспорте</label>
        <input class="field" id="v-fio" placeholder="Иванов Иван Иванович" maxlength="120" value="${esc(fullName)}">
        <p class="muted" style="font-size:12px;margin-top:8px">Данные используются только для проверки личности и не публикуются.</p>`;
      nextBtn.textContent = 'Далее';
    } else if (step === 2) {
      box.innerHTML = `
        <label class="lbl">Фото передней стороны паспорта</label>
        <div class="dropzone" id="v-pass-drop" style="min-height:120px;padding:20px">${passportFile ? '<span class="pill">Файл выбран</span>' : ic('image','lg') + '<p>Нажмите или перетащите фото паспорта</p>'}</div>
        <input type="file" id="v-pass" accept="image/*" hidden>
        <label class="lbl" style="margin-top:14px">Селфи с паспортом в руках</label>
        <div class="dropzone" id="v-self-drop" style="min-height:120px;padding:20px">${selfieFile ? '<span class="pill">Файл выбран</span>' : ic('image','lg') + '<p>Лицо и паспорт должны быть чётко видны</p>'}</div>
        <input type="file" id="v-self" accept="image/*" hidden>`;
      const passDrop = $('#v-pass-drop', m), selfDrop = $('#v-self-drop', m);
      const passInp = $('#v-pass', m), selfInp = $('#v-self', m);
      passDrop.onclick = () => passInp.click();
      selfDrop.onclick = () => selfInp.click();
      passInp.onchange = () => { if (passInp.files[0]) { passportFile = passInp.files[0]; passDrop.innerHTML = '<span class="pill">✓ ' + esc(passportFile.name) + '</span>'; } };
      selfInp.onchange = () => { if (selfInp.files[0]) { selfieFile = selfInp.files[0]; selfDrop.innerHTML = '<span class="pill">✓ ' + esc(selfieFile.name) + '</span>'; } };
      nextBtn.textContent = 'Отправить и получить реквизиты';
    } else if (step === 3) {
      box.innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Отправляем данные…</p>`;
      nextBtn.disabled = true;
    }
  }
  renderStep();

  nextBtn.onclick = async () => {
    if (step === 1) {
      fullName = ($('#v-fio', m).value || '').trim();
      if (fullName.length < 5) return toast('Укажите полное ФИО', 'err');
      step = 2; renderStep();
      return;
    }
    if (step === 2) {
      if (!passportFile) return toast('Загрузите фото паспорта', 'err');
      if (!selfieFile) return toast('Загрузите селфи с паспортом', 'err');
      step = 3; renderStep();
      try {
        const fd = new FormData();
        fd.append('full_name', fullName);
        fd.append('passport', passportFile, passportFile.name);
        fd.append('selfie', selfieFile, selfieFile.name);
        const r = await api('POST', '/verification/apply', fd);
        m.close();
        // показать реквизиты
        const pay = r.payment || {};
        const m2 = modal(`${mHead('Оплата 20 сомони')}<div class="modal-b">
          <p>Переведите <b>${pay.amount || 20} ${pay.currency || 'сомони'}</b> по реквизитам:</p>
          <div class="card pad" style="margin:12px 0;background:var(--bg2)">
            <div><b>Банк / сервис:</b> ${esc(pay.bank || '—')}</div>
            <div style="margin-top:6px"><b>Счёт / карта:</b> <code style="font-size:16px">${esc(pay.account || '—')}</code></div>
            <div style="margin-top:6px"><b>Получатель:</b> ${esc(pay.name || '—')}</div>
            <div class="muted" style="margin-top:8px;font-size:13px">${esc(pay.note || '')}</div>
          </div>
          <p class="muted">После оплаты нажмите «Загрузить чек» в настройках и отправьте скриншот/фото чека. Админ проверит и выдаст галочку.</p>
        </div><div class="modal-f"><button class="btn primary" data-close>Понятно</button></div>`);
        toast('Данные приняты. Оплатите и загрузите чек.', 'ok');
        if ($('#view')?.RELOAD) $('#view').RELOAD();
      } catch (e) { fail(e); m.close(); }
    }
  };
};

ACT['verif-receipt'] = async () => {
  const m = modal(`${mHead('Загрузить чек')}<div class="modal-b">
    <p class="muted">Прикрепите фото или скриншот чека об оплате 20 сомони.</p>
    <div class="dropzone" id="rc-drop" style="min-height:140px;margin-top:12px">${ic('image','lg')}<p>Нажмите, чтобы выбрать файл</p></div>
    <input type="file" id="rc-file" accept="image/*" hidden>
  </div><div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="rc-go" disabled>Отправить на проверку</button></div>`);
  let file = null;
  const drop = $('#rc-drop', m), inp = $('#rc-file', m), go = $('#rc-go', m);
  drop.onclick = () => inp.click();
  inp.onchange = () => {
    if (inp.files[0]) {
      file = inp.files[0];
      drop.innerHTML = `<span class="pill">✓ ${esc(file.name)}</span>`;
      go.disabled = false;
    }
  };
  go.onclick = async () => {
    if (!file) return;
    go.disabled = true; go.textContent = 'Отправка…';
    try {
      const fd = new FormData();
      fd.append('receipt', file, file.name);
      await api('POST', '/verification/receipt', fd);
      m.close();
      toast('Чек отправлен. Ожидайте проверки админом.', 'ok');
      if ($('#view')?.RELOAD) $('#view').RELOAD();
    } catch (e) { fail(e); go.disabled = false; go.textContent = 'Отправить на проверку'; }
  };
};
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


// ---------- монетизация + верификация ----------
async function renderMonetization(view) {
  view.innerHTML = page(`<div class="topbar"><button class="icon-btn" data-act="back">${ic('back')}</button><h1>Монетизация</h1></div><div id="m-out"><div class="spinner"></div></div>`);
  const out = $('#m-out', view);
  try {
    const d = await api.get('/monetization');
    const stMap = {
      none: 'Не подключена',
      applied: 'Заявка на рассмотрении',
      active: 'Активна ✓',
      rejected: 'Отклонена',
    };
    const checks = Object.entries(d.checks || {}).map(([k, v]) => {
      const labels = { followers: 'Подписчики', views_30d: 'Просмотры за 30 дней', posts: 'Публикации', account_age: 'Дней аккаунту' };
      return `<div class="monet-check ${v.ok ? 'ok' : ''}">${v.ok ? '✓' : '○'} <b>${labels[k] || k}</b>: ${fmtN(v.value)} / ${fmtN(v.need)}</div>`;
    }).join('');
    out.innerHTML = `<div class="card" style="padding:18px">
      <div class="row" style="margin-bottom:12px;gap:10px;flex-wrap:wrap">
        <span class="pill">${stMap[d.status] || d.status}</span>
        ${d.verified ? '<span class="vbadge">✓ Верификация</span>' : ''}
        ${d.is_creator ? '<span class="cbadge">★ Creator</span>' : ''}
      </div>
      <h3 style="margin:8px 0 10px">Условия (как в TikTok)</h3>
      <ul class="monet-rules">${(d.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <div style="margin-top:14px">${checks}</div>
      <div style="margin-top:18px">
        ${d.status === 'none' || d.status === 'rejected'
          ? `<button class="btn primary" id="m-apply" ${d.eligible ? '' : 'disabled'}>Подать заявку</button>
             ${d.eligible ? '' : '<p class="hint" style="margin-top:8px">Выполните все условия, чтобы подать заявку</p>'}`
          : d.status === 'applied'
            ? '<p class="muted">Заявка отправлена. Администратор проверит аккаунт.</p>'
            : '<p class="muted">Поздравляем! Монетизация активна. Доход зависит от просмотров и вовлечённости.</p>'}
      </div>
    </div>
    `;

    const btn = $('#m-apply', view);
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      try { await api.post('/monetization/apply'); toast('Заявка отправлена'); renderMonetization(view); }
      catch (e) { fail(e); btn.disabled = false; }
    };
  } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
