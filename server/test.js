'use strict';
// Интеграционный тест: поднимает сервер на временной БД и проверяет все основные функции API.
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chik-'));
process.env.CHIK_DATA = tmp;
process.env.CHIK_DB = path.join(tmp, 't.db');
const assert = require('assert');
const server = require('./index');

let pass = 0;
const ok = (name) => { pass++; console.log('  ✓', name); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let base;

async function call(method, p, body, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let b = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + '/api' + p, { method, headers, body: b });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
const expect = async (promise, status, label) => { const r = await promise; assert.strictEqual(r.status, status, `${label}: ожидали ${status}, получили ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const file = (name, buf, type, fields = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fd.append('file', new Blob([buf], { type }), name); return fd; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('Тест на', base);

  // --- статика и здоровье
  assert.strictEqual((await fetch(base + '/')).status, 200); ok('главная страница отдаётся');
  assert.strictEqual((await fetch(base + '/js/core.js')).status, 200); ok('статические файлы');
  await expect(call('GET', '/health'), 200, 'health'); ok('health');
  await expect(call('GET', '/me'), 401, 'без токена'); ok('защита API без токена');

  // --- регистрация / вход
  const A = await expect(call('POST', '/auth/register', { username: 'alice', email: 'a@x.io', password: 'Password1', display_name: 'Alice' }), 200, 'reg A');
  const B = await expect(call('POST', '/auth/register', { username: 'bob', email: 'b@x.io', password: 'Password2' }), 200, 'reg B');
  const C = await expect(call('POST', '/auth/register', { username: 'carol', email: 'c@x.io', password: 'Password3' }), 200, 'reg C');
  const ta = A.token, tb = B.token, tc = C.token, ida = A.user.id, idb = B.user.id, idc = C.user.id;
  ok('регистрация 3 пользователей');
  await expect(call('POST', '/auth/register', { username: 'alice', email: 'z@x.io', password: 'Password1' }), 409, 'dup'); ok('уникальность username');
  await expect(call('POST', '/auth/register', { username: 'x', email: 'bad', password: '1' }), 400, 'validation'); ok('валидация регистрации');
  await expect(call('POST', '/auth/login', { login: 'alice', password: 'wrong' }), 401, 'bad login'); ok('неверный пароль отклонён');
  const L = await expect(call('POST', '/auth/login', { login: 'a@x.io', password: 'Password1' }), 200, 'login'); ok('вход по email');
  assert.ok(L.token && L.user.username === 'alice');

  // --- профиль
  const pr = await expect(call('PATCH', '/me', { bio: 'hello', display_name: 'Alice W' }, ta), 200, 'patch me');
  assert.strictEqual(pr.bio, 'hello'); ok('редактирование профиля');
  const av = await expect(call('POST', '/me/avatar', file('a.png', PNG, 'image/png'), ta), 200, 'avatar');
  assert.ok(av.avatar); ok('загрузка аватара');

  // --- посты
  const post = await expect(call('POST', '/posts', file('p.png', PNG, 'image/png', { caption: 'Привет #космос @bob' }), ta), 200, 'post');
  assert.strictEqual(post.type, 'photo'); ok('загрузка фото-публикации');
  await expect(call('POST', '/posts', file('x.exe', PNG, 'application/octet-stream'), ta), 415, 'bad ext'); ok('запрет опасных форматов');
  const img = await fetch(base + post.url); assert.strictEqual(img.status, 200); ok('медиа отдаётся');
  const rng = await fetch(base + post.url, { headers: { Range: 'bytes=0-9' } }); assert.strictEqual(rng.status, 206); ok('Range-запросы (видео-перемотка)');
  const feed = await expect(call('GET', '/feed?tab=foryou', null, tb), 200, 'feed');
  assert.ok(feed.items.some((p) => p.id === post.id)); ok('публикация видна в ленте рекомендаций');

  // --- лайки / репосты / комментарии
  let p = await expect(call('POST', `/posts/${post.id}/like`, {}, tb), 200, 'like'); assert.ok(p.liked && p.likes === 1); ok('лайк');
  p = await expect(call('POST', `/posts/${post.id}/like`, {}, tb), 200, 'unlike'); assert.ok(!p.liked && p.likes === 0); ok('снятие лайка');
  await call('POST', `/posts/${post.id}/like`, {}, tb);
  p = await expect(call('POST', `/posts/${post.id}/repost`, {}, tb), 200, 'repost'); assert.ok(p.reposted); ok('репост');
  p = await expect(call('POST', `/posts/${post.id}/bookmark`, {}, tb), 200, 'bm'); assert.ok(p.bookmarked); ok('закладка');
  await expect(call('POST', `/posts/${post.id}/comments`, { text: 'Круто!' }, tb), 200, 'comment');
  const cms = await expect(call('GET', `/posts/${post.id}/comments`, null, ta), 200, 'cms'); assert.strictEqual(cms.length, 1); ok('комментарии');
  await expect(call('POST', `/posts/${post.id}/comments`, { text: '' }, tb), 400, 'empty comment'); ok('пустой комментарий отклонён');
  const rp = await expect(call('GET', '/users/bob/posts?tab=reposts', null, ta), 200, 'reposts'); assert.strictEqual(rp.items.length, 1); ok('вкладка репостов');

  // --- уведомления
  const notes = await expect(call('GET', '/notifications', null, ta), 200, 'notes');
  const types = notes.map((n) => n.type);
  assert.ok(types.includes('like') && types.includes('comment') && types.includes('repost')); ok('уведомления: лайк, комментарий, репост');
  const cnt = await expect(call('GET', '/me/counters', null, ta), 200, 'counters'); assert.ok(cnt.notifications >= 3); ok('счётчики');
  await expect(call('POST', '/notifications/read', {}, ta), 200, 'read');
  assert.strictEqual((await call('GET', '/me/counters', null, ta)).data.notifications, 0); ok('прочтение уведомлений');

  // --- подписки
  let f = await expect(call('POST', `/users/${ida}/follow`, {}, tb), 200, 'follow'); assert.ok(f.following); ok('подписка');
  const prof = await expect(call('GET', '/users/alice', null, tb), 200, 'profile'); assert.strictEqual(prof.followers, 1); assert.ok(prof.rel.following); ok('профиль и счётчики подписчиков');
  const fol = await expect(call('GET', '/feed?tab=following', null, tb), 200, 'following feed'); assert.ok(fol.items.length === 1); ok('лента подписок');

  // --- приватность
  await expect(call('PATCH', '/me', { is_private: true }, ta), 200, 'private');
  const lockedPosts = await expect(call('GET', '/users/alice/posts', null, tc), 200, 'locked'); assert.ok(lockedPosts.locked && lockedPosts.items.length === 0); ok('закрытый аккаунт скрывает публикации');
  const feedC = await expect(call('GET', '/feed?tab=foryou', null, tc), 200, 'feedC'); assert.ok(!feedC.items.some((x) => x.id === post.id)); ok('закрытый контент не попадает в ленту чужих');
  await expect(call('GET', `/posts/${post.id}`, null, tc), 404, 'private post'); ok('прямой доступ к закрытому посту запрещён');
  f = await expect(call('POST', `/users/${ida}/follow`, {}, tc), 200, 'req'); assert.ok(f.pending); ok('запрос на подписку к закрытому аккаунту');
  const reqs = await expect(call('GET', '/follow-requests', null, ta), 200, 'reqs'); assert.strictEqual(reqs.length, 1);
  await expect(call('POST', `/follow-requests/${idc}/accept`, {}, ta), 200, 'accept');
  await expect(call('GET', `/posts/${post.id}`, null, tc), 200, 'now visible'); ok('одобрение заявки открывает доступ');
  await expect(call('PATCH', '/me', { is_private: false, allow_comments: 'nobody' }, ta), 200, 'unprivate');
  await expect(call('POST', `/posts/${post.id}/comments`, { text: 'x' }, tc), 403, 'comments off'); ok('запрет комментариев автором');
  await call('PATCH', '/me', { allow_comments: 'everyone' }, ta);

  // --- поиск
  const s = await expect(call('GET', '/search?q=ali', null, tb), 200, 'search'); assert.ok(s.users.some((u) => u.username === 'alice')); ok('поиск пользователей');
  const s2 = await expect(call('GET', '/search?q=' + encodeURIComponent('космос'), null, tb), 200, 'search2'); assert.ok(s2.posts.length >= 1 && s2.tags.length >= 1); ok('поиск публикаций и хештегов');
  const ex = await expect(call('GET', '/explore', null, tb), 200, 'explore'); assert.ok(Array.isArray(ex.tags)); ok('обзор / тренды');

  // --- личные сообщения
  const dm = await expect(call('POST', '/chats', { type: 'dm', user_id: idb }, ta), 200, 'dm');
  const dm2 = await expect(call('POST', '/chats', { type: 'dm', user_id: ida }, tb), 200, 'dm again'); assert.strictEqual(dm.id, dm2.id); ok('создание личного чата (без дублей)');
  const sse = await new Promise((resolve) => {
    const http = require('http'); let buf = '';
    const req = http.get(base + '/api/stream?token=' + tb, (res) => {
      res.on('data', (d) => { buf += d; if (buf.includes('event: message')) { req.destroy(); resolve(buf); } });
      setTimeout(async () => { await call('POST', `/chats/${dm.id}/messages`, { text: 'Привет, Боб!' }, ta); }, 150);
      setTimeout(() => { req.destroy(); resolve(buf); }, 4000);
    });
  });
  assert.ok(sse.includes('Привет, Боб!')); ok('сообщения приходят в реальном времени (SSE)');
  const fm = await expect(call('POST', `/chats/${dm.id}/messages`, file('doc.txt', Buffer.from('hello'), 'text/plain', { text: 'файл' }), ta), 200, 'file msg');
  assert.strictEqual(fm.messages[0].file.kind, 'file'); ok('отправка файла в чат');
  const im = await expect(call('POST', `/chats/${dm.id}/messages`, file('pic.png', PNG, 'image/png'), tb), 200, 'img msg'); assert.strictEqual(im.messages[0].file.kind, 'image'); ok('отправка фото в чат');
  const vm = await expect(call('POST', `/chats/${dm.id}/messages`, file('v.webm', Buffer.from('xxxx'), 'audio/webm', { kind: 'voice' }), tb), 200, 'voice'); assert.strictEqual(vm.messages[0].file.kind, 'audio'); ok('голосовое сообщение');
  const sp = await expect(call('POST', `/chats/${dm.id}/messages`, { post_id: post.id, reply_to: fm.messages[0].id }, tb), 200, 'share post'); assert.ok(sp.messages[0].post && sp.messages[0].reply); ok('репост публикации в чат + ответ на сообщение');
  const hist = await expect(call('GET', `/chats/${dm.id}/messages`, null, tb), 200, 'hist'); assert.ok(hist.items.length >= 4);
  await call('POST', `/chats/${dm.id}/messages`, { text: 'ещё одно' }, ta);
  const list = await expect(call('GET', '/chats', null, tb), 200, 'chats'); assert.ok(list[0].unread >= 1 && list[0].title === 'Alice W'); ok('список чатов и непрочитанные');
  await call('POST', `/chats/${dm.id}/read`, {}, tb);
  assert.strictEqual((await call('GET', '/chats', null, tb)).data[0].unread, 0); ok('отметка «прочитано»');
  await call('DELETE', `/messages/${hist.items[0].id}`, null, tb); // не его сообщение
  await expect(call('DELETE', `/messages/${fm.messages[0].id}`, null, tb), 403, 'del foreign'); ok('нельзя удалить чужое сообщение');
  await expect(call('DELETE', `/messages/${im.messages[0].id}`, null, tb), 200, 'del own'); ok('удаление своего сообщения');

  // --- группы и каналы
  const grp = await expect(call('POST', '/chats', { type: 'group', title: 'Team', is_public: true, handle: 'team_chat', members: [idb] }, ta), 200, 'group');
  await expect(call('POST', '/chats', { type: 'group', title: 'Dup', is_public: true, handle: 'team_chat' }, ta), 409, 'dup handle'); ok('группа и уникальный @handle');
  await expect(call('POST', `/chats/${grp.id}/join`, {}, tc), 200, 'join'); ok('вступление в публичную группу');
  await expect(call('POST', `/chats/${grp.id}/messages`, { text: 'hi all' }, tc), 200, 'group msg');
  const gi = await expect(call('GET', `/chats/${grp.id}`, null, ta), 200, 'ginfo'); assert.strictEqual(gi.member_list.length, 3); ok('участники группы');
  await expect(call('POST', `/chats/${grp.id}/members/${idb}/role`, { role: 'admin' }, ta), 200, 'role'); ok('назначение администратора');
  await expect(call('DELETE', `/chats/${grp.id}/members/${idc}`, null, ta), 200, 'kick'); ok('исключение участника');
  const ch = await expect(call('POST', '/chats', { type: 'channel', title: 'News', is_public: true, handle: 'news_feed' }, ta), 200, 'channel');
  await expect(call('POST', `/chats/${ch.id}/join`, {}, tb), 200, 'sub');
  await expect(call('POST', `/chats/${ch.id}/messages`, { text: 'Новость' }, tb), 403, 'sub post'); ok('в канале пишут только админы');
  await expect(call('POST', `/chats/${ch.id}/messages`, { text: 'Новость' }, ta), 200, 'admin post'); ok('публикация в канале');
  const pubRead = await expect(call('GET', `/chats/${ch.id}/messages`, null, tc), 200, 'public read'); assert.ok(pubRead.items.length >= 2); ok('чтение публичного канала без подписки');
  const bh = await expect(call('GET', '/chats/by-handle/news_feed', null, tc), 200, 'by handle'); assert.strictEqual(bh.id, ch.id); ok('вход по ссылке @handle');
  const sc = await expect(call('GET', '/search?q=news', null, tc), 200, 'search chats'); assert.ok(sc.channels.length === 1); ok('поиск каналов и групп');
  const disc = await expect(call('GET', '/discover/chats', null, tc), 200, 'discover'); assert.ok(disc.length >= 2); ok('обзор публичных чатов');
  await expect(call('POST', `/chats/${ch.id}/leave`, {}, tb), 200, 'leave'); ok('выход из канала');

  // --- приватность сообщений и блокировки
  await call('PATCH', '/me', { allow_dm: 'followers' }, ta);
  await expect(call('POST', '/chats', { type: 'dm', user_id: ida }, tc), 200, 'dm c->a (follows)'); // carol подписана (одобрена)
  await call('PATCH', '/me', { allow_dm: 'nobody' }, ta);
  await expect(call('POST', '/chats', { type: 'dm', user_id: ida }, (await call('POST', '/auth/register', { username: 'dave', email: 'd@x.io', password: 'Password4' })).data.token), 403, 'dm nobody'); ok('настройка «кто может писать»');
  const bl = await expect(call('POST', `/users/${idb}/block`, {}, ta), 200, 'block'); assert.ok(bl.blocked);
  await expect(call('GET', `/posts/${post.id}`, null, tb), 404, 'blocked post'); ok('блокировка скрывает контент');
  await expect(call('POST', `/users/${ida}/follow`, {}, tb), 403, 'blocked follow'); ok('заблокированный не может подписаться');
  await call('POST', `/users/${idb}/block`, {}, ta);

  // --- безопасность
  await expect(call('POST', '/me/password', { current: 'bad', next: 'newPassword1' }, ta), 403, 'bad cur');
  await expect(call('POST', '/me/password', { current: 'Password1', next: 'newPassword1' }, ta), 200, 'chg'); ok('смена пароля');
  await expect(call('POST', '/auth/login', { login: 'alice', password: 'newPassword1' }), 200, 'login new');
  const ss = await expect(call('GET', '/sessions', null, ta), 200, 'sessions'); assert.ok(ss.some((x) => x.current)); ok('список сеансов');
  await expect(call('POST', '/auth/logout', {}, tb), 200, 'logout');
  await expect(call('GET', '/me', null, tb), 401, 'after logout'); ok('выход инвалидирует токен');

  // --- новые функции
  const tb2 = (await call('POST', '/auth/login', { login: 'bob', password: 'Password2' })).data.token;
  const ph = await expect(call('POST', '/posts', file('IMG_0001', PNG, 'image/png', { caption: 'без расширения' }), ta), 200, 'no-ext'); assert.strictEqual(ph.type, 'photo'); ok('загрузка файла без расширения (определяется по MIME)');
  const mv = await expect(call('POST', '/posts', file('clip.MOV', Buffer.from('x'), 'video/quicktime', {}), ta), 200, 'mov'); assert.strictEqual(mv.type, 'video'); ok('видео .MOV с телефона');
  const cp = await expect(call('POST', `/posts/${ph.id}/comments`, { text: 'родитель' }, tb2), 200, 'cparent');
  const cr = await expect(call('POST', `/posts/${ph.id}/comments`, { text: 'ответ', parent_id: cp.id }, tc), 200, 'creply'); assert.strictEqual(cr.parent_id, cp.id); ok('ответ на комментарий');
  const cl = await expect(call('POST', `/comments/${cp.id}/like`, {}, tc), 200, 'clike'); assert.ok(cl.liked && cl.likes === 1); ok('лайк комментария');
  const cl2 = await expect(call('GET', `/posts/${ph.id}/comments`, null, tc), 200, 'clist'); assert.ok(cl2.find((x) => x.id === cp.id).liked && cl2.length === 2); ok('лайки и ответы в списке комментариев');
  const m1 = (await expect(call('POST', `/chats/${dm.id}/messages`, { text: 'для реакций' }, ta), 200, 'm1')).messages[0];
  let ru = await expect(call('POST', `/messages/${m1.id}/react`, { emoji: '🔥' }, ta), 200, 'react'); assert.strictEqual(ru.reactions[0].count, 1); ok('реакция на сообщение');
  ru = await expect(call('POST', `/messages/${m1.id}/react`, { emoji: '🔥' }, ta), 200, 'unreact'); assert.strictEqual(ru.reactions.length, 0); ok('снятие реакции');
  await expect(call('POST', `/messages/${m1.id}/react`, { emoji: '💩' }, ta), 400, 'bad emoji');
  const ed = await expect(call('PATCH', `/messages/${m1.id}`, { text: 'исправлено' }, ta), 200, 'edit'); assert.ok(ed.edited_at && ed.text === 'исправлено'); ok('редактирование сообщения');
  await expect(call('PATCH', `/messages/${m1.id}`, { text: 'чужое' }, tb2), 403, 'edit foreign'); ok('нельзя править чужое сообщение');
  await expect(call('POST', `/messages/${m1.id}/pin`, { pinned: true }, ta), 200, 'pin');
  const gi2 = await expect(call('GET', `/chats/${dm.id}`, null, ta), 200, 'pinned info'); assert.strictEqual(gi2.pinned.id, m1.id); ok('закрепление сообщения');
  const fw = await expect(call('POST', `/messages/${m1.id}/forward`, { chat_id: grp.id }, ta), 200, 'forward'); assert.ok(fw.forward_from); ok('пересылка сообщения');
  const sr = await expect(call('GET', `/chats/${dm.id}/messages?q=${encodeURIComponent('исправ')}`, null, ta), 200, 'msg search'); assert.strictEqual(sr.items.length, 1); ok('поиск по сообщениям чата');
  await expect(call('POST', `/chats/${dm.id}/pin`, { pinned: true }, ta), 200, 'pin chat');
  assert.ok((await call('GET', '/chats', null, ta)).data[0].pinned); ok('закрепление чата');
  await call('POST', `/chats/${dm.id}/read`, {}, tb2);
  assert.ok((await call('GET', `/chats/${dm.id}`, null, ta)).data.other_read_id >= m1.id); ok('статус «прочитано» (✓✓)');

  // --- удаление
  await expect(call('DELETE', `/posts/${post.id}`, null, ta), 200, 'del post'); ok('удаление публикации');
  await expect(call('DELETE', '/me', { password: 'newPassword1' }, ta), 200, 'del me'); ok('удаление аккаунта');

  console.log(`\n  Все проверки пройдены: ${pass} ✓\n`);
  server.close(); process.exit(0);
})().catch((e) => { console.error('\n  ✗ ОШИБКА:', e.message, '\n'); process.exit(1); });
