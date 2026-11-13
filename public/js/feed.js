'use strict';
// ====== Лента, посты, комментарии, репосты, загрузка ======
const ACT = {}; // обработчики data-act (подключаются в main.js)

function storePost(p) { S.posts.set(p.id, p); return p; }
function paintPost(p) {
  storePost(p);
  $$(`[data-post="${p.id}"]`).forEach((el) => {
    const set = (cls, on) => $$(cls, el).forEach((b) => b.classList.toggle('on', on));
    set('.lk', p.liked); set('.rp', p.reposted); set('.bk', p.bookmarked);
    const cnt = (k, v) => $$(`[data-c=${k}]`, el).forEach((n) => (n.textContent = fmtN(v)));
    cnt('likes', p.likes); cnt('comments', p.comments); cnt('reposts', p.reposts);
  });
}
const postId = (el) => +el.closest('[data-post]').dataset.post;

function reelHTML(p) {
  const u = p.user, isVideo = p.type === 'video';
  const media = isVideo
    ? `<video class="reel-media" src="${esc(p.url)}" ${p.thumb ? `poster="${esc(p.thumb)}"` : ''} loop playsinline muted preload="metadata"></video>`
    : `<img class="reel-media bg" src="${esc(p.url)}" alt=""><img class="reel-media contain" src="${esc(p.url)}" alt="">`;
  return `<article class="reel" data-post="${p.id}"><div class="reel-card">
    ${media}<div class="reel-grad"></div><div class="flash"></div>
    ${isVideo ? `<button class="icon-btn mute-btn" data-act="mute" aria-label="Звук" style="background:rgba(20,18,50,.55)">${ic(S.muted ? 'mute' : 'vol')}</button>` : ''}
    <div class="reel-info">
      <div class="u"><a href="#/u/${esc(u.username)}" class="row" style="gap:8px">${avatar(u, 's')}<span>@${esc(u.username)}</span></a>
        ${p.mine || u.following ? '' : `<button class="btn sm" data-act="follow-user" data-uid="${u.id}" data-small="1" style="padding:4px 12px;background:rgba(255,255,255,.12)">Подписаться</button>`}</div>
      ${p.caption ? `<div class="cap" data-act="capopen">${rich(p.caption)}</div>` : ''}
      <div class="meta">${ic('eye', 'sm')} ${fmtN(p.views)} · ${ago(p.created_at)}</div>
    </div>
    <div class="reel-actions">
      <a href="#/u/${esc(u.username)}" class="follow-av ${p.mine || u.following ? 'done' : ''}" data-uid="${u.id}">${avatar(u)}<span class="plus" data-act="follow-user" data-uid="${u.id}">${ic('plus')}</span></a>
      <button class="act lk ${p.liked ? 'on' : ''}" data-act="like" aria-label="Нравится"><span class="b">${ic('heart')}</span><span data-c="likes">${fmtN(p.likes)}</span></button>
      <button class="act" data-act="comments" aria-label="Комментарии"><span class="b">${ic('comment')}</span><span data-c="comments">${fmtN(p.comments)}</span></button>
      <button class="act rp ${p.reposted ? 'on' : ''}" data-act="repost" aria-label="Репост"><span class="b">${ic('repeat')}</span><span data-c="reposts">${fmtN(p.reposts)}</span></button>
      <button class="act bk ${p.bookmarked ? 'on' : ''}" data-act="bookmark" aria-label="Сохранить"><span class="b">${ic('bookmark')}</span><span>Сохр.</span></button>
      <button class="act" data-act="share" aria-label="Поделиться"><span class="b">${ic('send')}</span><span>Отправить</span></button>
      <button class="act" data-act="postmenu" aria-label="Ещё"><span class="b">${ic('more')}</span></button>
    </div>
    ${isVideo ? '<div class="pbar"><i></i></div>' : ''}
  </div></article>`;
}

// ---------- лента ----------
function renderFeed(view, { tab = 'foryou', single = null } = {}) {
  const seed = Math.floor(Math.random() * 100000);
  view.innerHTML = `<div class="feed-wrap">
    ${single ? `<div class="back-bar"><button class="icon-btn" data-act="back" aria-label="Назад">${ic('back')}</button></div>` : `<div class="ig-top">
      <div class="ig-brand">Chikstagram</div>
      <div class="ig-top-actions">
        <button class="icon-btn" data-act="upload" aria-label="Создать">${ic('plus')}</button>
        <a class="icon-btn" href="#/notifications" aria-label="Уведомления">${ic('bell')}<span class="badge hidden" data-badge="notifications"></span></a>
        <a class="icon-btn" href="#/chats" aria-label="Сообщения">${ic('send')}<span class="badge hidden" data-badge="messages"></span></a>
      </div>
    </div>
    <div class="stories-bar" id="stories-bar"><div class="stories-scroll" id="stories-scroll"></div></div>
    <div class="feed-tabs">
      <button class="t ${tab === 'following' ? 'active' : ''}" data-act="feedtab" data-tab="following">Подписки</button>
      <button class="t ${tab === 'foryou' ? 'active' : ''}" data-act="feedtab" data-tab="foryou">Для вас</button>
    </div>`}
    <div class="feed" id="feed"><div class="spinner"></div></div></div>`;
  const feed = $('#feed');
  let offset = 0, next = 0, loading = false, count = 0;
  if (!single) loadStoriesBar();

  const media = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = $('video', e.target), card = e.target;
      if (e.isIntersecting && e.intersectionRatio >= .6) {
        if (v) {
          v.muted = S.muted; v.play().catch(() => { v.muted = true; S.muted = true; v.play().catch(() => {}); });
          if (!card._viewed) { card._viewed = 1; api.post(`/posts/${card.dataset.post}/view`).catch(() => {}); }
        } else if (!card._viewed) { card._viewed = 1; api.post(`/posts/${card.dataset.post}/view`).catch(() => {}); }
        if (next !== null && card === feed.lastElementChild?.previousElementSibling) more();
        if (next !== null && card.nextElementSibling === feed.lastElementChild) more();
      } else if (v) v.pause();
    }
  }, { root: feed, threshold: [0, .6] });

  function addReels(items) {
    const frag = document.createElement('div');
    frag.innerHTML = items.map(reelHTML).join('');
    for (const el of [...frag.children]) {
      const v = $('video', el);
      if (v) {
        const bar = $('.pbar i', el);
        v.addEventListener('timeupdate', () => { bar.style.width = (v.currentTime / (v.duration || 1)) * 100 + '%'; });
        media.add(v);
      }
      feed.insertBefore(el, $('.feed-end', feed));
      io.observe(el);
    }
  }
  async function more() {
    if (loading || next === null) return;
    loading = true;
    try {
      const d = await api.get(`/feed?tab=${tab}&offset=${next}&limit=8&seed=${seed}`);
      d.items.forEach(paintPostSilent);
      next = d.next; offset = d.next;
      if (count === 0 && !d.items.length) {
        $('.spinner', feed)?.remove();
        feed.innerHTML = `<div class="feed-end"><div>${ic('video', 'lg')}<h2 style="margin:10px 0 6px">${tab === 'following' ? 'Пока здесь пусто' : 'Лента пуста'}</h2><p>${tab === 'following' ? 'Подпишитесь на авторов, и их видео появятся здесь.' : 'Станьте первым — загрузите видео!'}</p><p style="margin-top:16px"><a class="btn primary" href="${tab === 'following' ? '#/search' : '#/upload'}">${tab === 'following' ? 'Найти людей' : 'Загрузить'}</a></p></div></div>`;
        return;
      }
      if (count === 0) { feed.innerHTML = '<div class="feed-end" style="display:none"></div>'; }
      count += d.items.length;
      addReels(d.items);
      const end = $('.feed-end', feed);
      if (next === null) { end.style.display = 'grid'; end.innerHTML = `<div>${ic('star', 'lg')}<h3 style="margin:8px 0">Вы посмотрели всё!</h3><p>Загляните позже или найдите новых авторов.</p><p style="margin-top:14px"><a class="btn" href="#/search">Поиск</a></p></div>`; }
      else end.style.display = 'none';
    } catch (e) { $('.spinner', feed)?.remove(); fail(e); }
    loading = false;
  }
  const paintPostSilent = storePost;

  if (single) {
    api.get('/posts/' + single).then((p) => { storePost(p); feed.innerHTML = '<div class="feed-end" style="display:none"></div>'; addReels([p]); }).catch((e) => { feed.innerHTML = `<div class="feed-end"><div><h3>${esc(e.message)}</h3><p style="margin-top:12px"><a class="btn" href="#/">В ленту</a></p></div></div>`; });
  } else more();

  const key = (e) => {
    if (e.target.matches('input,textarea,select') || modalStack.length) return;
    const cur = $$('.reel', feed).find((r) => Math.abs(r.getBoundingClientRect().top - feed.getBoundingClientRect().top) < 40);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); (cur?.nextElementSibling || cur)?.scrollIntoView({ behavior: 'smooth' }); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); cur?.previousElementSibling?.scrollIntoView({ behavior: 'smooth' }); }
    else if (cur && e.key === 'l') $('[data-act=like]', cur).click();
    else if (e.key === 'm') ACT.mute();
    else if (e.key === ' ' && cur) { e.preventDefault(); toggleVideo(cur); }
  };
  document.addEventListener('keydown', key);
  S.cleanup = () => { io.disconnect(); document.removeEventListener('keydown', key); media.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); };
}

function toggleVideo(reel) {
  const v = $('video', reel), fl = $('.flash', reel);
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
  fl.innerHTML = ic(v.paused ? 'pause' : 'play', 'lg fill'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
}
function burst(card, x, y) {
  const b = document.createElement('div'); b.className = 'burst'; b.innerHTML = ic('heart');
  const r = card.getBoundingClientRect(); b.style.left = x - r.left + 'px'; b.style.top = y - r.top + 'px';
  card.appendChild(b); setTimeout(() => b.remove(), 900);
}
// тап = пауза, двойной тап = лайк
let tapT = null;
document.addEventListener('click', (e) => {
  const card = e.target.closest('.reel-card');
  if (!card || e.target.closest('button,a,.act,.reel-actions,.cap')) return;
  const reel = card.closest('.reel');
  if (tapT) {
    clearTimeout(tapT); tapT = null;
    burst(card, e.clientX, e.clientY);
    const p = S.posts.get(+reel.dataset.post);
    if (p && !p.liked) api.post(`/posts/${p.id}/like`).then(paintPost).catch(fail);
  } else tapT = setTimeout(() => { tapT = null; toggleVideo(reel); }, 260);
});

ACT.feedtab = (el) => { const t = el.dataset.tab; renderFeed($('#view'), { tab: t }); };
ACT.back = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
ACT.capopen = (el) => el.classList.toggle('open');
ACT.mute = () => {
  S.muted = !S.muted;
  $$('video').forEach((v) => (v.muted = S.muted));
  $$('.mute-btn').forEach((b) => (b.innerHTML = ic(S.muted ? 'mute' : 'vol')));
  if (!S.muted) toast('Звук включён', 'ok', 1200);
};
ACT.like = (el) => api.post(`/posts/${postId(el)}/like`).then(paintPost).catch(fail);
ACT.repost = (el) => api.post(`/posts/${postId(el)}/repost`).then((p) => { paintPost(p); toast(p.reposted ? 'Репост добавлен в ваш профиль' : 'Репост удалён'); }).catch(fail);
ACT.bookmark = (el) => api.post(`/posts/${postId(el)}/bookmark`).then((p) => { paintPost(p); toast(p.bookmarked ? 'Сохранено' : 'Удалено из сохранённого', 'ok', 1500); }).catch(fail);
ACT['open-post'] = (el) => (location.hash = '#/post/' + el.dataset.id);

ACT['follow-user'] = async (el) => {
  const uid = +el.dataset.uid;
  try {
    const r = await api.post(`/users/${uid}/follow`);
    $$(`[data-act=follow-user][data-uid="${uid}"]`).forEach((b) => {
      if (b.classList.contains('plus')) return;
      if (b.dataset.small) b.remove();
      else { b.textContent = r.following ? 'Вы подписаны' : r.pending ? 'Запрос отправлен' : 'Подписаться'; b.classList.toggle('primary', !r.following && !r.pending); }
    });
    $$(`.follow-av[data-uid="${uid}"]`).forEach((f) => f.classList.toggle('done', r.following || r.pending));
    for (const p of S.posts.values()) if (p.user.id === uid) p.user.following = r.following;
    if (r.pending) toast('Запрос на подписку отправлен');
    emit('follow-changed', { uid, ...r });
  } catch (e) { fail(e); }
  return false;
};

// ---------- комментарии ----------
ACT.comments = (el) => openComments(postId(el));
async function openComments(id) {
  const m = modal(`${mHead('Комментарии')}<div class="modal-b" id="cm-list"><div class="spinner"></div></div>
    <div id="cm-reply" class="reply-bar hidden"></div>
    <form class="cm-form"><input class="field" placeholder="Добавить комментарий…" maxlength="500" autocomplete="off"><button class="btn primary" type="submit" aria-label="Отправить">${ic('send', 'sm')}</button></form>`, { cls: 'tall' });
  const list = $('#cm-list', m), form = $('form', m), inp = $('input', form), rbar = $('#cm-reply', m);
  let all = [], replyTo = null;
  const isOwner = () => S.posts.get(id)?.mine;
  const row = (c, isReply) => `<div class="cm ${isReply ? 'rep' : ''}" data-cid="${c.id}">${avatar(c.user, 's')}<div class="b"><div><a class="n" href="#/u/${esc(c.user.username)}" data-close>${esc(c.user.display_name)}</a> <span class="tm">${ago(c.created_at)}</span></div><div class="tx">${rich(c.text)}</div><div class="cm-acts"><button data-act="cm-reply" data-id="${c.id}" data-n="${esc(c.user.username)}">Ответить</button>${c.mine || isOwner() ? `<button data-act="del-comment" data-id="${c.id}">Удалить</button>` : ''}</div></div><button class="cm-like ${c.liked ? 'on' : ''}" data-act="cm-like" data-id="${c.id}" aria-label="Нравится">${ic('heart', 'sm')}<span>${c.likes || ''}</span></button></div>`;
  const paint = () => {
    const top = all.filter((c) => !c.parent_id), kids = (pid) => all.filter((c) => c.parent_id === pid);
    list.innerHTML = top.length ? top.map((c) => { const k = kids(c.id); return row(c) + (k.length ? `<div class="cm-kids">${k.map((x) => row(x, true)).join('')}</div>` : ''); }).join('') : `<div class="empty">${ic('comment')}<p>Пока нет комментариев. Будьте первым!</p></div>`;
  };
  try { all = await api.get(`/posts/${id}/comments`); paint(); } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  const setReply = (c) => { replyTo = c; rbar.classList.toggle('hidden', !c); if (c) { rbar.innerHTML = `<span class="grow ellip">Ответ для <b>@${esc(c.n)}</b></span><button class="icon-btn" type="button" data-act="cm-cancel" style="width:28px;height:28px">${ic('x', 'sm')}</button>`; inp.focus(); } };
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const cid = +b.dataset.id;
    if (b.dataset.act === 'cm-cancel') return setReply(null);
    if (b.dataset.act === 'cm-reply') { const c = all.find((x) => x.id === cid); setReply({ id: c.parent_id || c.id, n: b.dataset.n }); inp.value = `@${b.dataset.n} `; return; }
    if (b.dataset.act === 'cm-like') { try { const r = await api.post(`/comments/${cid}/like`); const c = all.find((x) => x.id === cid); c.liked = r.liked; c.likes = r.likes; b.classList.toggle('on', r.liked); $('span', b).textContent = r.likes || ''; } catch (er) { fail(er); } return; }
    if (b.dataset.act === 'del-comment') { try { await api.del('/comments/' + cid); const gone = all.filter((x) => x.id === cid || x.parent_id === cid).length; all = all.filter((x) => x.id !== cid && x.parent_id !== cid); paint(); const p = S.posts.get(id); if (p) { p.comments = Math.max(0, p.comments - gone); paintPost(p); } } catch (er) { fail(er); } }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = inp.value.trim(); if (!text) return;
    inp.disabled = true;
    try {
      const c = await api.post(`/posts/${id}/comments`, { text, parent_id: replyTo ? replyTo.id : undefined });
      all.push(c); paint(); list.scrollTop = replyTo ? list.scrollTop : list.scrollHeight;
      inp.value = ''; setReply(null); const p = S.posts.get(id); if (p) { p.comments++; paintPost(p); }
    } catch (er) { fail(er); }
    inp.disabled = false; inp.focus();
  };
}

// ---------- поделиться ----------
ACT.share = (el) => openShare(postId(el));
async function openShare(id) {
  const link = location.origin + '/#/post/' + id;
  const m = modal(`${mHead('Поделиться')}<div class="modal-b">
    <div class="row" style="flex-wrap:wrap;margin-bottom:12px">${navigator.share ? `<button class="btn" data-native>${ic('share', 'sm')} Другие приложения</button>` : ''}<button class="btn" data-copy>${ic('link', 'sm')} Копировать ссылку</button><button class="btn" data-rp>${ic('repeat', 'sm')} Репост на профиль</button></div>
    <div class="sect" style="margin-top:6px">Отправить в чат</div><div id="sh-list"><div class="spinner"></div></div></div>`);
  $('[data-copy]', m).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку', link); } };
  const nat = $('[data-native]', m); if (nat) nat.onclick = () => navigator.share({ title: 'Chikstagram', text: (S.posts.get(id)?.caption || '').slice(0, 100), url: link }).catch(() => {});
  $('[data-rp]', m).onclick = () => { const p = S.posts.get(id); if (p && p.reposted) return toast('Уже в ваших репостах'); api.post(`/posts/${id}/repost`).then((p2) => { paintPost(p2); toast('Репост добавлен'); m.close(); }).catch(fail); };
  try {
    const chats = (await api.get('/chats')).filter((c) => c.type !== 'channel' || c.role === 'owner' || c.role === 'admin');
    const box = $('#sh-list', m);
    box.innerHTML = chats.length ? chats.map((c) => `<div class="list-i" data-chat="${c.id}">${avatar({ ...c, username: c.handle || c.title }, '')}<div class="grow"><b class="ellip" style="display:block">${esc(c.title || 'Чат')}</b><span class="muted" style="font-size:13px">${{ dm: 'Личный чат', group: 'Группа', channel: 'Канал' }[c.type]}</span></div><span class="btn sm primary">Отправить</span></div>`).join('') : '<div class="empty" style="padding:20px">Нет чатов. Начните диалог на вкладке «Чаты».</div>';
    box.onclick = async (e) => {
      const r = e.target.closest('[data-chat]'); if (!r) return;
      try { await api.post(`/chats/${r.dataset.chat}/messages`, { post_id: id }); toast('Отправлено'); m.close(); } catch (er) { fail(er); }
    };
  } catch (e) { fail(e); }
}

// ---------- меню поста ----------
ACT.postmenu = (el) => {
  const id = postId(el), p = S.posts.get(id); if (!p) return;
  actionSheet(p.mine ? [
    { icon: 'edit', label: 'Изменить подпись', fn: async () => { const v = await promptBox('Подпись', 'Текст', { value: p.caption, okLabel: 'Сохранить' }); if (v === null) return; try { const np = await api.patch('/posts/' + id, { caption: v }); storePost(np); $$(`[data-post="${id}"] .cap`).forEach((c) => (c.innerHTML = rich(np.caption))); toast('Сохранено'); } catch (e) { fail(e); } } },
    { icon: 'link', label: 'Копировать ссылку', fn: () => navigator.clipboard?.writeText(location.origin + '/#/post/' + id).then(() => toast('Ссылка скопирована')) },
    { icon: 'dl', label: 'Скачать', fn: () => { const a = document.createElement('a'); a.href = p.url + '?dl=1'; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); } },
    { icon: 'trash', label: 'Удалить', danger: true, fn: async () => { if (!await confirmBox('Удалить публикацию навсегда?', 'Удалить')) return; try { await api.del('/posts/' + id); $$(`.reel[data-post="${id}"]`).forEach((r) => r.remove()); $$(`.tile[data-id="${id}"]`).forEach((r) => r.remove()); toast('Публикация удалена'); if (location.hash.startsWith('#/post/')) location.hash = '#/'; } catch (e) { fail(e); } } },
  ] : [
    { icon: 'user', label: 'Открыть профиль @' + p.user.username, fn: () => (location.hash = '#/u/' + p.user.username) },
    { icon: 'dl', label: 'Скачать', fn: () => { const a = document.createElement('a'); a.href = p.url + '?dl=1'; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); } },
    { icon: 'link', label: 'Копировать ссылку', fn: () => navigator.clipboard?.writeText(location.origin + '/#/post/' + id).then(() => toast('Ссылка скопирована')) },
    { icon: 'flag', label: 'Пожаловаться', fn: async () => { const r = await promptBox('Жалоба', 'Опишите причину'); if (r === null) return; api.post('/report', { type: 'post', id, reason: r }).then(() => toast('Жалоба отправлена')).catch(fail); } },
    { icon: 'ban', label: 'Заблокировать автора', danger: true, fn: async () => { if (!await confirmBox(`Заблокировать @${p.user.username}? Вы больше не увидите его контент.`, 'Заблокировать')) return; api.post(`/users/${p.user.id}/block`).then(() => { toast('Пользователь заблокирован'); navigate(); }).catch(fail); } },
  ]);
};

// ---------- сетки ----------
function tiles(items) {
  if (!items.length) return `<div class="empty">${ic('video')}<p>Здесь пока ничего нет</p></div>`;
  return `<div class="grid">${items.map((p) => { storePost(p); return `<div class="tile" data-act="open-post" data-id="${p.id}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : `<div class="ph">${ic('video', 'lg')}</div>`}${p.type === 'video' ? `<span class="tp">${ic('play', 'sm fill')}</span>` : ''}<span class="ov">${ic('heart', 'sm fill')} ${fmtN(p.likes)}</span></div>`; }).join('')}</div>`;
}

// ---------- загрузка ----------
ACT.upload = () => openUpload();
function openUpload() {
  let file = null, busy = false;
  const m = modal(`${mHead('Новая публикация')}<div class="modal-b">
    <div id="up-drop" class="dropzone">${ic('video', 'lg')}<p style="margin:10px 0 4px;color:var(--text);font-weight:600">Перетащите видео или фото сюда</p><p style="font-size:13px">MP4, WebM, MOV, JPG, PNG, WebP, GIF · видео до 5 ГБ без потери качества</p><button class="btn primary" style="margin-top:14px" type="button">Выбрать файл</button></div>
    <input type="file" id="up-file" accept="video/*,image/*" hidden>
    <div id="up-form" class="hidden"><div class="preview" id="up-prev"></div>
      <label class="lbl">Подпись</label><textarea class="field" id="up-cap" rows="3" maxlength="500" placeholder="О чём ваше видео? Добавьте #хештеги и @упоминания"></textarea>
      <div class="progress hidden" id="up-prog" style="margin-top:14px"><i></i></div></div></div>
    <div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="up-go" disabled>Опубликовать</button></div>`, { cls: 'wide' });
  const inp = $('#up-file', m), drop = $('#up-drop', m);
  const pick = async (f0) => {
    if (!f0) return;
    if (!/^(video|image)\//.test(f0.type) && !/\.(mp4|mov|webm|m4v|3gp|mkv|jpe?g|png|webp|gif|heic)$/i.test(f0.name)) return toast('Выберите видео или изображение', 'err');
    let f;
    try { f = await prepMedia(f0); } catch (e) { return fail(e); }
    file = f; const url = URL.createObjectURL(f);
    $('#up-prev', m).innerHTML = f.type.startsWith('video') ? `<video src="${url}" controls muted playsinline loop></video>` : `<img src="${url}" alt="">`;
    drop.classList.add('hidden'); $('#up-form', m).classList.remove('hidden'); $('#up-go', m).disabled = false;
  };
  drop.onclick = () => inp.click(); inp.onchange = () => { pick(inp.files[0]); inp.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); pick(e.dataTransfer.files[0]); };
  $('#up-go', m).onclick = async () => {
    if (!file || busy) return; busy = true;
    const go = $('#up-go', m); go.disabled = true; go.textContent = 'Загрузка…';
    const fd = new FormData(); fd.append('caption', $('#up-cap', m).value); fd.append('file', file, file.name);
    $('#up-prog', m).classList.remove('hidden');
    try {
      const p = await upload('/posts', fd, (r) => ($('#up-prog i', m).style.width = Math.round(r * 100) + '%'));
      storePost(p); m.close();
      S.muted = false; // сразу со звуком
      toast('Опубликовано! Видео/фото видно сразу со звуком' , 'ok', 2500);
      location.hash = '#/post/' + p.id;
    } catch (e) { fail(e); busy = false; go.disabled = false; go.textContent = 'Опубликовать'; }
  };
}


// ========== STORIES (24 часа, как Instagram) ==========
async function loadStoriesBar() {
  const bar = $('#stories-scroll');
  if (!bar) return;
  try {
    const d = await api.get('/stories');
    const me = S.user;
    const hasMine = d.groups.some((g) => g.user.id === me.id);
    let html = `<button class="story-item own" data-act="add-story" type="button">
      <span class="story-ring none"><span class="av">${me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : esc((me.display_name || me.username || '?')[0])}</span>
        <span class="story-plus">${ic('plus')}</span></span>
      <span class="story-name">Ваша история</span></button>`;
    for (const g of d.groups) {
      const isMe = g.user.id === me.id;
      if (isMe) {
        // заменить «Ваша история» на кольцо со сторис
        html = `<button class="story-item own" data-act="open-stories" data-uid="${g.user.id}" type="button">
          <span class="story-ring ${g.has_unseen ? 'unseen' : 'seen'}"><span class="av">${g.user.avatar ? `<img src="${esc(g.user.avatar)}" alt="">` : esc((g.user.display_name || '?')[0])}</span>
            <span class="story-plus" data-act="add-story">${ic('plus')}</span></span>
          <span class="story-name">Ваша история</span></button>`;
        continue;
      }
      html += `<button class="story-item" data-act="open-stories" data-uid="${g.user.id}" type="button">
        <span class="story-ring ${g.has_unseen ? 'unseen' : 'seen'}"><span class="av">${g.user.avatar ? `<img src="${esc(g.user.avatar)}" alt="">` : esc((g.user.display_name || '?')[0])}</span></span>
        <span class="story-name">${esc(g.user.username)}</span></button>`;
    }
    bar.innerHTML = html;
    // сохраняем группы для вьюера
    S.storyGroups = d.groups;
  } catch (e) {
    bar.innerHTML = `<button class="story-item own" data-act="add-story" type="button">
      <span class="story-ring none"><span class="av">${S.user.avatar ? `<img src="${esc(S.user.avatar)}" alt="">` : '?'}</span>
        <span class="story-plus">${ic('plus')}</span></span>
      <span class="story-name">Ваша история</span></button>`;
  }
}

ACT['add-story'] = (el, e) => { if (e) e.stopPropagation(); openStoryUpload(); };
ACT['open-stories'] = (el) => openStoryViewer(+el.dataset.uid);

function openStoryUpload() {
  let file = null, busy = false;
  const m = modal(`${mHead('Новая история')}<div class="modal-b">
    <div id="st-drop" class="dropzone">${ic('video', 'lg')}<p style="margin:10px 0 4px;font-weight:600">Фото или видео для истории</p>
      <p style="font-size:13px;opacity:.7">Исчезнет через 24 часа</p>
      <button class="btn primary" style="margin-top:14px" type="button">Выбрать</button></div>
    <input type="file" id="st-file" accept="video/*,image/*" hidden>
    <div id="st-form" class="hidden"><div class="preview" id="st-prev"></div>
      <label class="lbl">Подпись (необязательно)</label>
      <input class="field" id="st-cap" maxlength="200" placeholder="Текст к истории">
      <div class="progress hidden" id="st-prog" style="margin-top:14px"><i></i></div></div></div>
    <div class="modal-f"><button class="btn" data-close>Отмена</button><button class="btn primary" id="st-go" disabled>Опубликовать</button></div>`, { cls: 'wide' });
  const inp = $('#st-file', m), drop = $('#st-drop', m);
  const pick = async (f0) => {
    if (!f0) return;
    if (!/^(video|image)\//.test(f0.type) && !/\.(mp4|mov|webm|jpe?g|png|webp|gif)$/i.test(f0.name)) return toast('Выберите фото или видео', 'err');
    try { file = await prepMedia(f0, { max: 1920 }); } catch (e) { return fail(e); }
    const u = URL.createObjectURL(file);
    $('#st-prev', m).innerHTML = file.type.startsWith('video') ? `<video src="${u}" controls muted playsinline></video>` : `<img src="${u}" alt="">`;
    drop.classList.add('hidden'); $('#st-form', m).classList.remove('hidden'); $('#st-go', m).disabled = false;
  };
  drop.onclick = () => inp.click(); inp.onchange = () => { pick(inp.files[0]); inp.value = ''; };
  $('#st-go', m).onclick = async () => {
    if (!file || busy) return; busy = true;
    const go = $('#st-go', m); go.disabled = true; go.textContent = 'Загрузка…';
    const fd = new FormData(); fd.append('caption', $('#st-cap', m).value); fd.append('file', file, file.name);
    $('#st-prog', m).classList.remove('hidden');
    try {
      await upload('/stories', fd, (r) => ($('#st-prog i', m).style.width = Math.round(r * 100) + '%'));
      m.close(); toast('История опубликована · 24 часа');
      loadStoriesBar();
    } catch (e) { fail(e); busy = false; go.disabled = false; go.textContent = 'Опубликовать'; }
  };
}

function openStoryViewer(uid) {
  const groups = S.storyGroups || [];
  let gi = groups.findIndex((g) => g.user.id === uid);
  if (gi < 0) return;
  let si = 0;
  // начинаем с первой непросмотренной
  const firstUnseen = groups[gi].items.findIndex((it) => !it.viewed && !it.mine);
  if (firstUnseen >= 0) si = firstUnseen;

  const ov = document.createElement('div');
  ov.className = 'story-viewer';
  ov.innerHTML = `<div class="sv-progress" id="sv-prog"></div>
    <div class="sv-top"><button class="icon-btn" data-close aria-label="Закрыть">${ic('x')}</button>
      <div class="sv-user" id="sv-user"></div>
      <button class="icon-btn" id="sv-del" style="display:none" aria-label="Удалить">${ic('trash')}</button></div>
    <div class="sv-media" id="sv-media"></div>
    <div class="sv-cap" id="sv-cap"></div>
    <div class="sv-nav"><button type="button" id="sv-prev" aria-label="Назад"></button><button type="button" id="sv-next" aria-label="Далее"></button></div>`;
  document.body.appendChild(ov);

  let timer = null, videoEl = null, paused = false;

  const close = () => { clearTimeout(timer); if (videoEl) { videoEl.pause(); videoEl = null; } ov.remove(); loadStoriesBar(); };
  ov.querySelector('[data-close]').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  const show = async () => {
    clearTimeout(timer); if (videoEl) { videoEl.pause(); videoEl = null; }
    if (gi < 0 || gi >= groups.length) { close(); return; }
    const g = groups[gi];
    if (si < 0) {
      // к предыдущей группе
      if (gi > 0) { gi--; si = groups[gi].items.length - 1; } else { close(); return; }
    }
    if (si >= g.items.length) {
      if (gi + 1 < groups.length) { gi++; si = 0; } else { close(); return; }
    }
    const g2 = groups[gi];
    const item = g2.items[si];
    // прогресс-бары
    const prog = $('#sv-prog', ov);
    prog.innerHTML = g2.items.map((_, i) => `<div class="sv-bar"><i style="width:${i < si ? 100 : 0}%"></i></div>`).join('');
    const bar = $$('.sv-bar i', prog)[si];
    // юзер
    $('#sv-user', ov).innerHTML = `${avatar(g2.user, 's')}<div><b>@${esc(g2.user.username)}</b><small>${ago(item.created_at)}</small></div>`;
    $('#sv-del', ov).style.display = item.mine ? '' : 'none';
    $('#sv-del', ov).onclick = async () => {
      if (!await confirmBox('Удалить эту историю?', 'Удалить')) return;
      try { await api.del('/stories/' + item.id); g2.items.splice(si, 1); if (!g2.items.length) { groups.splice(gi, 1); gi = Math.min(gi, groups.length - 1); si = 0; } show(); } catch (e) { fail(e); }
    };
    $('#sv-cap', ov).textContent = item.caption || '';
    const media = $('#sv-media', ov);
    media.innerHTML = '';
    const duration = item.type === 'video' ? 15000 : 5000;
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.src = item.url; v.playsInline = true; v.autoplay = true; v.muted = false;
      v.setAttribute('playsinline', '');
      media.appendChild(v); videoEl = v;
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      v.onended = () => { si++; show(); };
      v.ontimeupdate = () => { if (v.duration && bar) bar.style.width = (v.currentTime / v.duration * 100) + '%'; };
    } else {
      media.innerHTML = `<img src="${esc(item.url)}" alt="">`;
      if (bar) {
        bar.style.transition = `width ${duration}ms linear`;
        requestAnimationFrame(() => { bar.style.width = '100%'; });
      }
      timer = setTimeout(() => { si++; show(); }, duration);
    }
    // отметить просмотр
    if (!item.viewed && !item.mine) {
      api.post('/stories/' + item.id + '/view').then(() => { item.viewed = true; }).catch(() => {});
    }
  };

  $('#sv-prev', ov).onclick = (e) => { e.stopPropagation(); si--; show(); };
  $('#sv-next', ov).onclick = (e) => { e.stopPropagation(); si++; show(); };
  // тап слева/справа
  $('#sv-media', ov).addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 3) { si--; show(); }
    else { si++; show(); }
  });
  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(ov)) return document.removeEventListener('keydown', onKey);
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') { si++; show(); }
    if (e.key === 'ArrowLeft') { si--; show(); }
  });
  show();
}
