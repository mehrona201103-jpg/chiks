'use strict';
const fs = require('fs');
const path = require('path');
const D = require('./db');
const U = require('./util');
const RT = require('./realtime');
const { HttpError } = U;

const MAX_UPLOAD = 5 * 1024 * 1024 * 1024; // 5 GB — качественные видео без потери
const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, handler });
}

// ---------- helpers ----------
const url = (f) => (f ? '/uploads/' + f : null);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const like = (q) => '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const must = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };

function pubUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name, avatar: url(u.avatar), bio: u.bio || '',
    is_private: !!u.is_private,
    online: u.show_online ? RT.isOnline(u.id) : false,
    last_seen: u.show_online ? u.last_seen : null,
  };
}
const brief = (u) => u && { id: u.id, username: u.username, display_name: u.display_name, avatar: url(u.avatar) };

function selfUser(u) {
  return {
    ...pubUser(u), email: u.email, show_online: !!u.show_online, show_likes: !!u.show_likes,
    allow_dm: u.allow_dm, allow_comments: u.allow_comments, created_at: u.created_at,
  };
}

function isBlocked(a, b) {
  return !!D.get('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)', a, b, b, a);
}
function isFollowing(a, b) {
  return !!D.get("SELECT 1 FROM follows WHERE follower_id=?1 AND following_id=?2 AND status='accepted'", a, b);
}
function canViewProfile(me, target) {
  if (!target.is_private || target.id === me) return true;
  return isFollowing(me, target.id);
}

function notify(userId, actorId, type, extra = {}) {
  if (userId === actorId) return;
  if (['like', 'repost', 'follow'].includes(type)) {
    const dup = D.get('SELECT id FROM notifications WHERE user_id=?1 AND actor_id=?2 AND type=?3 AND IFNULL(post_id,0)=?4', userId, actorId, type, extra.postId || 0);
    if (dup) return;
  }
  const r = D.run('INSERT INTO notifications(user_id,actor_id,type,post_id,chat_id,text,created_at) VALUES(?,?,?,?,?,?,?)',
    userId, actorId, type, extra.postId || null, extra.chatId || null, extra.text || '', U.now());
  const actor = D.get('SELECT * FROM users WHERE id=?', actorId);
  RT.push(userId, 'notification', { id: Number(r.lastInsertRowid), type, actor: brief(actor), post_id: extra.postId || null, text: extra.text || '' });
}

// ---------- posts ----------
const VIS = `(u.is_private=0 OR u.id=?1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=?1 AND f.following_id=u.id AND f.status='accepted'))
  AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))`;
const POST_SELECT = `SELECT p.*, u.username, u.display_name, u.avatar, u.is_private,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments,
  (SELECT COUNT(*) FROM reposts r WHERE r.post_id=p.id) AS reposts,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?1) AS liked,
  EXISTS(SELECT 1 FROM reposts r WHERE r.post_id=p.id AND r.user_id=?1) AS reposted,
  EXISTS(SELECT 1 FROM bookmarks k WHERE k.post_id=p.id AND k.user_id=?1) AS bookmarked,
  EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=?1 AND f.following_id=p.user_id AND f.status='accepted') AS following
  FROM posts p JOIN users u ON u.id=p.user_id`;

function mapPost(r, me) {
  return {
    id: r.id, type: r.type, url: url(r.file), thumb: r.thumb ? url(r.thumb) : r.type === 'photo' ? url(r.file) : null,
    caption: r.caption, views: r.views, created_at: r.created_at,
    likes: r.likes, comments: r.comments, reposts: r.reposts,
    liked: !!r.liked, reposted: !!r.reposted, bookmarked: !!r.bookmarked, mine: r.user_id === me,
    user: { id: r.user_id, username: r.username, display_name: r.display_name, avatar: url(r.avatar), following: !!r.following },
  };
}
const getPost = (id, me) => {
  const r = D.get(`${POST_SELECT} WHERE p.id=? AND (u.is_private=0 OR u.id=? OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id AND f.status='accepted'))`, id, me, me);
  return r ? mapPost(r, me) : null;
};
const postsWhere = (me, where, tail, ...params) => D.all(`${POST_SELECT} WHERE ${VIS} AND ${where} ${tail}`, me, ...params).map((r) => mapPost(r, me));

function interests(me) {
  const caps = D.all('SELECT p.caption FROM likes l JOIN posts p ON p.id=l.post_id WHERE l.user_id=?1 UNION ALL SELECT p.caption FROM reposts l JOIN posts p ON p.id=l.post_id WHERE l.user_id=?1 LIMIT 150', me);
  const m = new Map();
  for (const c of caps) for (const t of U.extractTags(c.caption)) m.set(t, (m.get(t) || 0) + 1);
  return m;
}
function seedRand(id, seed) { let h = (id * 2654435761 + seed * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h % 1000) / 1000; }

// ============================================================
//  AUTH
// ============================================================
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function newSession(userId, req) {
  const token = U.randHex(32);
  D.run('INSERT INTO sessions(token,user_id,device,ip,created_at) VALUES(?,?,?,?,?)', token, userId,
    str(req.headers['user-agent'], 160), req.socket.remoteAddress || '', U.now());
  return token;
}


// Постоянный чат техподдержки — все пользователи участники
const SUPPORT_HANDLE = 'chik_support';
function ensureSupportChat(userId) {
  let ch = D.get("SELECT * FROM chats WHERE handle=?", SUPPORT_HANDLE);
  if (!ch) {
    const r = D.run(
      "INSERT INTO chats(type,title,handle,description,owner_id,is_public,created_at) VALUES('group',?,?,?,?,1,?)",
      'Тех Поддержка Chikstagram', SUPPORT_HANDLE,
      'Пишите о проблемах и идеях. Сообщения видят администраторы.',
      userId || 1, U.now()
    );
    ch = D.get('SELECT * FROM chats WHERE id=?', Number(r.lastInsertRowid));
    D.run("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'owner',?)", ch.id, userId || 1, U.now());
    D.run('INSERT INTO messages(chat_id,user_id,text,created_at) VALUES(?,?,?,?)',
      ch.id, null, 'Добро пожаловать в Тех Поддержку Chikstagram! Опишите проблему или идею — мы ответим.', U.now());
  }
  if (userId) {
    D.run("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", ch.id, userId, U.now());
  }
  return ch;
}

route('POST', '/api/auth/register', { auth: false }, (c) => {
  const ip = c.req.socket.remoteAddress || '';
  must(U.rateLimit('reg:' + ip, 20, 3600e3), 429, 'Слишком много попыток. Попробуйте позже.');
  const username = str(c.body.username, 24), email = str(c.body.email, 120).toLowerCase();
  const display = str(c.body.display_name, 40) || username, password = String(c.body.password || '');
  must(USERNAME_RE.test(username), 400, 'Имя пользователя: 3–24 символа, латиница, цифры и _');
  must(EMAIL_RE.test(email), 400, 'Неверный email');
  must(password.length >= 8 && password.length <= 200 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password), 400, 'Пароль: минимум 8 символов, заглавная и строчная буква и цифра');
  must(!D.get('SELECT 1 FROM users WHERE username=?', username), 409, 'Это имя пользователя уже занято');
  must(!D.get('SELECT 1 FROM users WHERE email=?', email), 409, 'Этот email уже зарегистрирован');
  const { hash, salt } = U.hashPassword(password);
  const r = D.run('INSERT INTO users(username,email,display_name,password_hash,salt,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',
    username, email, display, hash, salt, U.now(), U.now());
  const user = D.get('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
  try { ensureSupportChat(user.id); } catch (e) { console.error('support', e.message); }
  return { token: newSession(user.id, c.req), user: selfUser(user) };
});

route('POST', '/api/auth/login', { auth: false }, (c) => {
  const id = str(c.body.login, 120).toLowerCase(), password = String(c.body.password || '');
  const ip = c.req.socket.remoteAddress || '';
  must(U.rateLimit('login:' + ip + id, 10, 600e3), 429, 'Слишком много попыток входа. Подождите 10 минут.');
  const user = D.get('SELECT * FROM users WHERE username=? OR email=?', id, id);
  const ok = user ? U.verifyPassword(password, user.password_hash, user.salt) : (U.hashPassword(password), false);
  must(ok, 401, 'Неверный логин или пароль');
  try { ensureSupportChat(user.id); } catch (e) { console.error('support', e.message); }
  return { token: newSession(user.id, c.req), user: selfUser(user) };
});


route('GET', '/api/auth/config', { auth: false }, () => ({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' }));

route('GET', '/api/auth/username/:name', { auth: false }, (c) => {
  const name = str(c.params.name, 24);
  must(USERNAME_RE.test(name), 400, 'Никнейм: 3–24 символа, латиница, цифры и _');
  return { available: !D.get('SELECT 1 FROM users WHERE username=?', name) };
});

route('POST', '/api/auth/google', { auth: false }, async (c) => {
  must(process.env.GOOGLE_CLIENT_ID, 503, 'Google-вход ещё не настроен администратором');
  const credential = str(c.body.credential, 5000);
  must(credential, 400, 'Не получен токен Google');
  const verify = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  must(verify.ok, 401, 'Не удалось проверить Google-аккаунт');
  const g = await verify.json();
  must(g.aud === process.env.GOOGLE_CLIENT_ID && g.email_verified === 'true' && g.sub && g.email, 401, 'Google-аккаунт не подтверждён');
  let user = D.get('SELECT * FROM users WHERE google_sub=? OR email=?', g.sub, String(g.email).toLowerCase());
  if (!user) {
    const base = String(g.email).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'user').slice(0, 17) || 'user';
    let username = base, n = 1;
    while (D.get('SELECT 1 FROM users WHERE username=?', username)) username = (base.slice(0, 18) + '_' + n++);
    const { hash, salt } = U.hashPassword(U.randHex(32));
    const r = D.run('INSERT INTO users(username,email,display_name,password_hash,salt,google_sub,created_at,last_seen) VALUES(?,?,?,?,?,?,?,?)',
      username, String(g.email).toLowerCase(), str(g.name, 40) || username, hash, salt, g.sub, U.now(), U.now());
    user = D.get('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
  } else if (!user.google_sub) {
    D.run('UPDATE users SET google_sub=? WHERE id=?', g.sub, user.id);
    user = D.get('SELECT * FROM users WHERE id=?', user.id);
  }
  try { ensureSupportChat(user.id); } catch (e) { console.error('support', e.message); }
  return { token: newSession(user.id, c.req), user: selfUser(user) };
});

route('POST', '/api/auth/logout', (c) => { D.run('DELETE FROM sessions WHERE token=?', c.token); return { ok: true }; });

route('GET', '/api/me', (c) => selfUser(c.user));

route('GET', '/api/me/counters', (c) => {
  const me = c.user.id;
  return {
    notifications: D.get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0', me).n,
    messages: D.get(`SELECT COUNT(*) n FROM chat_members cm JOIN messages m ON m.chat_id=cm.chat_id AND m.id>cm.last_read_id AND m.user_id IS NOT ?1
      JOIN chats ch ON ch.id=cm.chat_id WHERE cm.user_id=?1 AND cm.muted=0`, me).n,
    requests: D.get("SELECT COUNT(*) n FROM follows WHERE following_id=? AND status='pending'", me).n,
  };
});

route('PATCH', '/api/me', (c) => {
  const b = c.body, u = c.user, f = {};
  if (b.display_name !== undefined) { f.display_name = str(b.display_name, 40); must(f.display_name, 400, 'Имя не может быть пустым'); }
  if (b.bio !== undefined) f.bio = str(b.bio, 200);
  if (b.username !== undefined && b.username !== u.username) {
    const nu = str(b.username, 24);
    must(USERNAME_RE.test(nu), 400, 'Неверное имя пользователя');
    must(!D.get('SELECT 1 FROM users WHERE username=? AND id<>?', nu, u.id), 409, 'Имя пользователя занято');
    f.username = nu;
  }
  for (const k of ['is_private', 'show_online', 'show_likes']) if (b[k] !== undefined) f[k] = b[k] ? 1 : 0;
  for (const k of ['allow_dm', 'allow_comments']) if (b[k] !== undefined) { must(['everyone', 'followers', 'nobody'].includes(b[k]), 400, 'Неверное значение'); f[k] = b[k]; }
  const keys = Object.keys(f);
  if (keys.length) D.run(`UPDATE users SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => f[k]), u.id);
  // если аккаунт стал открытым — принимаем все ожидающие заявки
  if (f.is_private === 0) D.run("UPDATE follows SET status='accepted' WHERE following_id=? AND status='pending'", u.id);
  return selfUser(D.get('SELECT * FROM users WHERE id=?', u.id));
});

route('POST', '/api/me/avatar', { upload: true }, (c) => {
  const file = c.files[0];
  must(file, 400, 'Выберите изображение');
  const { name } = U.saveFile(D.UPLOADS, file, U.IMAGE_EXT);
  D.run('UPDATE users SET avatar=? WHERE id=?', name, c.user.id);
  return selfUser(D.get('SELECT * FROM users WHERE id=?', c.user.id));
});

route('POST', '/api/me/password', (c) => {
  const cur = String(c.body.current || ''), next = String(c.body.next || '');
  must(U.verifyPassword(cur, c.user.password_hash, c.user.salt), 403, 'Текущий пароль неверный');
  must(next.length >= 8 && next.length <= 200, 400, 'Новый пароль должен быть не короче 8 символов');
  const { hash, salt } = U.hashPassword(next);
  D.run('UPDATE users SET password_hash=?, salt=? WHERE id=?', hash, salt, c.user.id);
  D.run('DELETE FROM sessions WHERE user_id=? AND token<>?', c.user.id, c.token);
  return { ok: true };
});

route('DELETE', '/api/me', (c) => {
  must(U.verifyPassword(String(c.body.password || ''), c.user.password_hash, c.user.salt), 403, 'Неверный пароль');
  for (const p of D.all('SELECT file, thumb FROM posts WHERE user_id=?', c.user.id)) for (const f of [p.file, p.thumb]) if (f) fs.rmSync(path.join(D.UPLOADS, f), { force: true });
  D.run('DELETE FROM users WHERE id=?', c.user.id);
  return { ok: true };
});

route('GET', '/api/sessions', (c) => D.all('SELECT rowid AS id, device, ip, created_at, token FROM sessions WHERE user_id=? ORDER BY created_at DESC', c.user.id)
  .map((s) => ({ id: s.id, device: s.device, ip: s.ip, created_at: s.created_at, current: s.token === c.token })));
route('DELETE', '/api/sessions/:id', (c) => { D.run('DELETE FROM sessions WHERE rowid=? AND user_id=?', int(c.params.id), c.user.id); return { ok: true }; });
route('POST', '/api/sessions/revoke-others', (c) => { D.run('DELETE FROM sessions WHERE user_id=? AND token<>?', c.user.id, c.token); return { ok: true }; });

// ============================================================
//  USERS / FOLLOWS / BLOCKS
// ============================================================
function profileOf(target, me) {
  const rel = {
    following: isFollowing(me, target.id),
    pending: !!D.get("SELECT 1 FROM follows WHERE follower_id=? AND following_id=? AND status='pending'", me, target.id),
    follows_me: isFollowing(target.id, me),
    blocked: !!D.get('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', me, target.id),
    blocked_me: !!D.get('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', target.id, me),
  };
  const can = canViewProfile(me, target) && !rel.blocked_me;
  return {
    ...pubUser(target), created_at: target.created_at, rel, can_view: can, is_me: target.id === me,
    followers: D.get("SELECT COUNT(*) n FROM follows WHERE following_id=? AND status='accepted'", target.id).n,
    following_count: D.get("SELECT COUNT(*) n FROM follows WHERE follower_id=? AND status='accepted'", target.id).n,
    posts: D.get('SELECT COUNT(*) n FROM posts WHERE user_id=?', target.id).n,
    likes_total: D.get('SELECT COUNT(*) n FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=?', target.id).n,
    show_likes: !!target.show_likes,
  };
}
const userByName = (name) => {
  const u = D.get('SELECT * FROM users WHERE username=?', name);
  must(u, 404, 'Пользователь не найден');
  return u;
};

route('GET', '/api/users/:username', (c) => profileOf(userByName(c.params.username), c.user.id));

route('GET', '/api/users/:username/posts', (c) => {
  const t = userByName(c.params.username), me = c.user.id;
  const p = profileOf(t, me);
  if (!p.can_view) return { items: [], locked: true };
  const tab = c.query.get('tab') || 'posts';
  if (tab === 'reposts') return { items: postsWhere(me, 'p.id IN (SELECT post_id FROM reposts WHERE user_id=?2)', 'ORDER BY p.id DESC LIMIT 60', t.id) };
  if (tab === 'likes') {
    if (!t.show_likes && t.id !== me) return { items: [], hidden: true };
    return { items: postsWhere(me, 'p.id IN (SELECT post_id FROM likes WHERE user_id=?2)', 'ORDER BY p.id DESC LIMIT 60', t.id) };
  }
  return { items: postsWhere(me, 'p.user_id=?2', 'ORDER BY p.created_at DESC LIMIT 60', t.id) };
});

function userList(rows, me) {
  return rows.map((u) => ({ ...pubUser(u), following: isFollowing(me, u.id), is_me: u.id === me }));
}
route('GET', '/api/users/:username/followers', (c) => {
  const t = userByName(c.params.username);
  must(profileOf(t, c.user.id).can_view, 403, 'Аккаунт закрыт');
  return userList(D.all("SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=? AND f.status='accepted' ORDER BY f.created_at DESC LIMIT 200", t.id), c.user.id);
});
route('GET', '/api/users/:username/following', (c) => {
  const t = userByName(c.params.username);
  must(profileOf(t, c.user.id).can_view, 403, 'Аккаунт закрыт');
  return userList(D.all("SELECT u.* FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=? AND f.status='accepted' ORDER BY f.created_at DESC LIMIT 200", t.id), c.user.id);
});

route('POST', '/api/users/:id/follow', (c) => {
  const me = c.user.id, id = int(c.params.id);
  must(id !== me, 400, 'Нельзя подписаться на себя');
  const t = D.get('SELECT * FROM users WHERE id=?', id);
  must(t, 404, 'Пользователь не найден');
  must(!isBlocked(me, id), 403, 'Действие недоступно');
  const ex = D.get('SELECT status FROM follows WHERE follower_id=? AND following_id=?', me, id);
  if (ex) { D.run('DELETE FROM follows WHERE follower_id=? AND following_id=?', me, id); return { following: false, pending: false }; }
  const status = t.is_private ? 'pending' : 'accepted';
  D.run('INSERT INTO follows(follower_id,following_id,status,created_at) VALUES(?,?,?,?)', me, id, status, U.now());
  notify(id, me, status === 'pending' ? 'follow_request' : 'follow');
  return { following: status === 'accepted', pending: status === 'pending' };
});

route('GET', '/api/follow-requests', (c) => D.all("SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=? AND f.status='pending' ORDER BY f.created_at DESC", c.user.id).map(pubUser));
route('POST', '/api/follow-requests/:id/:action', (c) => {
  const id = int(c.params.id), me = c.user.id;
  const r = D.get("SELECT 1 FROM follows WHERE follower_id=? AND following_id=? AND status='pending'", id, me);
  must(r, 404, 'Заявка не найдена');
  if (c.params.action === 'accept') { D.run("UPDATE follows SET status='accepted' WHERE follower_id=? AND following_id=?", id, me); notify(id, me, 'follow'); }
  else D.run('DELETE FROM follows WHERE follower_id=? AND following_id=?', id, me);
  return { ok: true };
});

route('POST', '/api/users/:id/block', (c) => {
  const me = c.user.id, id = int(c.params.id);
  must(id !== me, 400, 'Нельзя заблокировать себя');
  must(D.get('SELECT 1 FROM users WHERE id=?', id), 404, 'Пользователь не найден');
  if (D.get('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', me, id)) { D.run('DELETE FROM blocks WHERE user_id=? AND blocked_id=?', me, id); return { blocked: false }; }
  D.tx(() => {
    D.run('INSERT INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)', me, id, U.now());
    D.run('DELETE FROM follows WHERE (follower_id=?1 AND following_id=?2) OR (follower_id=?2 AND following_id=?1)', me, id);
  });
  return { blocked: true };
});
route('GET', '/api/me/blocks', (c) => D.all('SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?', c.user.id).map(pubUser));

route('POST', '/api/report', (c) => {
  const type = str(c.body.type, 20);
  must(['post', 'user', 'comment', 'chat'].includes(type), 400, 'Неверный тип');
  D.run('INSERT INTO reports(reporter_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?)', c.user.id, type, int(c.body.id), str(c.body.reason, 300), U.now());
  return { ok: true };
});


// ============================================================
//  STORIES (24 часа)
// ============================================================
const STORY_TTL = 24 * 3600 * 1000;

function mapStory(r, me) {
  return {
    id: r.id,
    type: r.type,
    url: url(r.file),
    thumb: r.thumb ? url(r.thumb) : (r.type === 'photo' ? url(r.file) : null),
    caption: r.caption || '',
    created_at: r.created_at,
    expires_at: r.expires_at,
    views: r.views || 0,
    viewed: !!r.viewed,
    mine: r.user_id === me,
    user: { id: r.user_id, username: r.username, display_name: r.display_name, avatar: url(r.avatar) },
  };
}

// Лента сторис: свои + подписки, только неистёкшие
route('GET', '/api/stories', (c) => {
  const me = c.user.id, t = U.now();
  // удаляем просроченные (мягкая очистка)
  const expired = D.all('SELECT id, file, thumb FROM stories WHERE expires_at < ?', t);
  for (const s of expired) {
    D.run('DELETE FROM stories WHERE id=?', s.id);
    for (const f of [s.file, s.thumb]) if (f) try { require('fs').rmSync(require('path').join(D.UPLOADS, f), { force: true }); } catch {}
  }
  const rows = D.all(`
    SELECT s.*, u.username, u.display_name, u.avatar,
      (SELECT COUNT(*) FROM story_views v WHERE v.story_id=s.id) AS views,
      EXISTS(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=?1) AS viewed
    FROM stories s
    JOIN users u ON u.id=s.user_id
    WHERE s.expires_at > ?2
      AND (s.user_id=?1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=?1 AND f.following_id=s.user_id AND f.status='accepted'))
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=s.user_id) OR (b.user_id=s.user_id AND b.blocked_id=?1))
    ORDER BY s.created_at DESC
  `, me, t);
  // группируем по пользователю
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user: { id: r.user_id, username: r.username, display_name: r.display_name, avatar: url(r.avatar) }, items: [], has_unseen: false });
    const g = byUser.get(r.user_id);
    const m = mapStory(r, me);
    g.items.push(m);
    if (!m.viewed && !m.mine) g.has_unseen = true;
  }
  // свои первыми, потом с непросмотренными, потом остальные
  const mine = byUser.get(me);
  const others = [...byUser.values()].filter((g) => g.user.id !== me);
  others.sort((a, b) => (b.has_unseen - a.has_unseen) || (b.items[0].created_at - a.items[0].created_at));
  // сортируем items внутри группы по времени (старые → новые для прогресса)
  const groups = [];
  if (mine) { mine.items.sort((a, b) => a.created_at - b.created_at); groups.push(mine); }
  for (const g of others) { g.items.sort((a, b) => a.created_at - b.created_at); groups.push(g); }
  return { groups };
});

route('GET', '/api/stories/user/:id', (c) => {
  const me = c.user.id, uid = int(c.params.id), t = U.now();
  const rows = D.all(`
    SELECT s.*, u.username, u.display_name, u.avatar,
      (SELECT COUNT(*) FROM story_views v WHERE v.story_id=s.id) AS views,
      EXISTS(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=?1) AS viewed
    FROM stories s JOIN users u ON u.id=s.user_id
    WHERE s.user_id=?2 AND s.expires_at > ?3
    ORDER BY s.created_at ASC
  `, me, uid, t);
  return { items: rows.map((r) => mapStory(r, me)) };
});

route('POST', '/api/stories', { upload: true }, async (c) => {
  const file = c.files.find((f) => f.field === 'file') || c.files[0];
  must(file, 400, 'Выберите фото или видео');
  const ext = U.extOf(file);
  const type = U.VIDEO_EXT.has(ext) ? 'video' : U.IMAGE_EXT.has(ext) ? 'photo' : null;
  must(type, 415, 'Поддерживаются фото и видео');
  const caption = str(c.body.caption, 200);
  const { name } = U.saveFile(D.UPLOADS, file);
  const thumb = type === 'video' ? await U.makeThumb(D.UPLOADS, name) : null;
  const created = U.now();
  const r = D.run('INSERT INTO stories(user_id,type,file,thumb,caption,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
    c.user.id, type, name, thumb, caption, created, created + STORY_TTL);
  const id = Number(r.lastInsertRowid);
  const row = D.get(`SELECT s.*, u.username, u.display_name, u.avatar, 0 AS views, 0 AS viewed
    FROM stories s JOIN users u ON u.id=s.user_id WHERE s.id=?`, id);
  return mapStory(row, c.user.id);
});

route('POST', '/api/stories/:id/view', (c) => {
  const id = int(c.params.id), me = c.user.id;
  const s = D.get('SELECT * FROM stories WHERE id=? AND expires_at > ?', id, U.now());
  must(s, 404, 'Сторис не найдена или истекла');
  if (s.user_id !== me) {
    D.run('INSERT OR IGNORE INTO story_views(story_id,user_id,created_at) VALUES(?,?,?)', id, me, U.now());
  }
  return { ok: true, views: D.get('SELECT COUNT(*) n FROM story_views WHERE story_id=?', id).n };
});

route('DELETE', '/api/stories/:id', (c) => {
  const s = D.get('SELECT * FROM stories WHERE id=? AND user_id=?', int(c.params.id), c.user.id);
  must(s, 404, 'Сторис не найдена');
  D.run('DELETE FROM stories WHERE id=?', s.id);
  for (const f of [s.file, s.thumb]) if (f) try { require('fs').rmSync(require('path').join(D.UPLOADS, f), { force: true }); } catch {}
  return { ok: true };
});

// ============================================================
//  POSTS
// ============================================================
route('GET', '/api/feed', (c) => {
  const me = c.user.id, tab = c.query.get('tab') || 'foryou';
  const offset = Math.max(0, int(c.query.get('offset'))), limit = Math.min(20, int(c.query.get('limit'), 8));
  const seed = int(c.query.get('seed'), 1);
  if (tab === 'following') {
    const rows = postsWhere(me, "(u.id=?1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=?1 AND f.following_id=u.id AND f.status='accepted'))", `ORDER BY p.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`);
    return { items: rows.slice(0, limit), next: rows.length > limit ? offset + limit : null };
  }
  const rows = D.all(`${POST_SELECT} WHERE ${VIS} ORDER BY p.created_at DESC LIMIT 500`, me);
  const interest = interests(me), t = U.now();
  const scored = rows.map((r) => {
    const age = (t - r.created_at) / 3.6e6;
    let s = (r.likes * 3 + r.comments * 4 + r.reposts * 5 + Math.log(r.views + 1) * 2 + 2) / Math.pow(1 + age / 48, 1.1);
    if (r.following) s *= 2;
    let match = 0;
    for (const tag of U.extractTags(r.caption)) if (interest.has(tag)) match++;
    s *= 1 + 0.45 * Math.min(match, 3);
    if (r.user_id === me) s *= 0.4;
    s *= 0.8 + 0.4 * seedRand(r.id, seed);
    return { r, s };
  }).sort((a, b) => b.s - a.s);
  const slice = scored.slice(offset, offset + limit).map((x) => mapPost(x.r, me));
  return { items: slice, next: offset + limit < scored.length ? offset + limit : null };
});

route('GET', '/api/explore', (c) => {
  const me = c.user.id;
  const rows = D.all(`${POST_SELECT} WHERE ${VIS} AND p.created_at > ?2 ORDER BY p.created_at DESC LIMIT 300`, me, U.now() - 30 * 86400e3);
  const items = rows.map((r) => ({ r, s: r.likes * 3 + r.comments * 4 + r.reposts * 5 + r.views * 0.2 })).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => mapPost(x.r, me));
  const tagCount = new Map();
  for (const r of D.all('SELECT caption FROM posts WHERE created_at > ? ORDER BY id DESC LIMIT 500', U.now() - 14 * 86400e3))
    for (const t of U.extractTags(r.caption)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const tags = [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count }));
  return { items, tags };
});

route('GET', '/api/tags/:tag/posts', (c) => ({
  items: postsWhere(c.user.id, "p.caption LIKE ?2 ESCAPE '\\'", 'ORDER BY p.created_at DESC LIMIT 60', like('#' + decodeURIComponent(c.params.tag).replace(/^#/, ''))),
}));

route('GET', '/api/suggestions', (c) => {
  const me = c.user.id;
  const rows = D.all(`SELECT u.*, (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id AND f.status='accepted') AS fc FROM users u
    WHERE u.id<>?1 AND NOT EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=?1 AND f.following_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))
    ORDER BY fc DESC, u.id DESC LIMIT 8`, me);
  return rows.map(pubUser);
});

route('GET', '/api/posts/:id', (c) => {
  const p = getPost(int(c.params.id), c.user.id);
  must(p, 404, 'Публикация не найдена');
  return p;
});

route('POST', '/api/posts', { upload: true }, async (c) => {
  const file = c.files.find((f) => f.field === 'file') || c.files[0];
  must(file, 400, 'Выберите видео или фото');
  const ext = U.extOf(file);
  const type = U.VIDEO_EXT.has(ext) ? 'video' : U.IMAGE_EXT.has(ext) ? 'photo' : null;
  must(type, 415, 'Поддерживаются видео (mp4, webm, mov) и фото (jpg, png, webp, gif)');
  const caption = str(c.body.caption, 500);
  const { name } = U.saveFile(D.UPLOADS, file);
  let thumb = null;
  if (type === 'video') {
    try { thumb = await U.makeThumb(D.UPLOADS, name); } catch (e) { console.error('thumb', e.message); }
  }
  const r = D.run('INSERT INTO posts(user_id,type,file,thumb,caption,created_at) VALUES(?,?,?,?,?,?)', c.user.id, type, name, thumb, caption, U.now());
  const id = Number(r.lastInsertRowid);
  for (const m of U.extractMentions(caption)) {
    const mu = D.get('SELECT id FROM users WHERE username=?', m);
    if (mu && !isBlocked(c.user.id, mu.id)) notify(mu.id, c.user.id, 'mention', { postId: id, text: 'упомянул(а) вас в публикации' });
  }
  const post = getPost(id, c.user.id);
  must(post, 500, 'Не удалось создать публикацию');
  return post;
});

route('PATCH', '/api/posts/:id', (c) => {
  const id = int(c.params.id);
  must(D.get('SELECT 1 FROM posts WHERE id=? AND user_id=?', id, c.user.id), 404, 'Публикация не найдена');
  D.run('UPDATE posts SET caption=? WHERE id=?', str(c.body.caption, 500), id);
  return getPost(id, c.user.id);
});

route('DELETE', '/api/posts/:id', (c) => {
  const p = D.get('SELECT * FROM posts WHERE id=? AND user_id=?', int(c.params.id), c.user.id);
  must(p, 404, 'Публикация не найдена');
  D.run('DELETE FROM posts WHERE id=?', p.id);
  for (const f of [p.file, p.thumb]) if (f) fs.rmSync(path.join(D.UPLOADS, f), { force: true });
  return { ok: true };
});

function toggle(table, c, notifType) {
  const id = int(c.params.id), me = c.user.id;
  const p = getPost(id, me);
  must(p, 404, 'Публикация не найдена');
  const has = D.get(`SELECT 1 FROM ${table} WHERE user_id=? AND post_id=?`, me, id);
  if (has) D.run(`DELETE FROM ${table} WHERE user_id=? AND post_id=?`, me, id);
  else {
    D.run(`INSERT INTO ${table}(user_id,post_id,created_at) VALUES(?,?,?)`, me, id, U.now());
    if (notifType) notify(p.user.id, me, notifType, { postId: id });
  }
  return getPost(id, me);
}
route('POST', '/api/posts/:id/like', (c) => toggle('likes', c, 'like'));
route('POST', '/api/posts/:id/repost', (c) => toggle('reposts', c, 'repost'));
route('POST', '/api/posts/:id/bookmark', (c) => toggle('bookmarks', c, null));
route('POST', '/api/posts/:id/view', (c) => {
  const id = int(c.params.id);
  if (U.rateLimit(`view:${c.user.id}:${id}`, 1, 600e3)) D.run('UPDATE posts SET views=views+1 WHERE id=?', id);
  return { ok: true };
});
route('GET', '/api/me/bookmarks', (c) => ({ items: postsWhere(c.user.id, 'p.id IN (SELECT post_id FROM bookmarks WHERE user_id=?1)', 'ORDER BY p.id DESC LIMIT 100') }));

// ---------- comments ----------
function mapComment(r, me) {
  return { id: r.id, post_id: r.post_id, parent_id: r.parent_id || null, text: r.text, created_at: r.created_at, likes: r.likes || 0, liked: !!r.liked, mine: r.user_id === me, user: brief(r) };
}
route('GET', '/api/posts/:id/comments', (c) => {
  const id = int(c.params.id);
  must(getPost(id, c.user.id), 404, 'Публикация не найдена');
  return D.all(`SELECT c.*, u.username, u.display_name, u.avatar, (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id=c.id) AS likes, EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id=c.id AND cl.user_id=?1) AS liked FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=?2
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=c.user_id) OR (b.user_id=c.user_id AND b.blocked_id=?1)) ORDER BY c.created_at ASC LIMIT 300`, c.user.id, id).map((r) => mapComment(r, c.user.id));
});
route('POST', '/api/posts/:id/comments', (c) => {
  const id = int(c.params.id), me = c.user.id;
  const p = getPost(id, me);
  must(p, 404, 'Публикация не найдена');
  const text = str(c.body.text, 500);
  must(text, 400, 'Комментарий пуст');
  const owner = D.get('SELECT allow_comments FROM users WHERE id=?', p.user.id);
  if (p.user.id !== me) {
    must(owner.allow_comments !== 'nobody', 403, 'Автор отключил комментарии');
    must(owner.allow_comments !== 'followers' || isFollowing(me, p.user.id), 403, 'Комментировать могут только подписчики автора');
  }
  let parent = c.body.parent_id ? D.get('SELECT * FROM comments WHERE id=? AND post_id=?', int(c.body.parent_id), id) : null;
  if (c.body.parent_id) must(parent, 400, 'Комментарий для ответа не найден');
  if (parent && parent.parent_id) parent = D.get('SELECT * FROM comments WHERE id=?', parent.parent_id) || parent;
  const r = D.run('INSERT INTO comments(post_id,user_id,text,parent_id,created_at) VALUES(?,?,?,?,?)', id, me, text, parent ? parent.id : null, U.now());
  notify(p.user.id, me, 'comment', { postId: id, text: text.slice(0, 80) });
  if (parent && parent.user_id !== me && parent.user_id !== p.user.id && !isBlocked(me, parent.user_id)) notify(parent.user_id, me, 'comment', { postId: id, text: 'ответил(а): ' + text.slice(0, 70) });
  for (const m of U.extractMentions(text)) {
    const mu = D.get('SELECT id FROM users WHERE username=?', m);
    if (mu && mu.id !== p.user.id && !isBlocked(me, mu.id)) notify(mu.id, me, 'mention', { postId: id, text: text.slice(0, 80) });
  }
  const row = D.get('SELECT c.*, u.username, u.display_name, u.avatar, 0 AS likes, 0 AS liked FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?', Number(r.lastInsertRowid));
  return mapComment(row, me);
});
route('DELETE', '/api/comments/:id', (c) => {
  const cm = D.get('SELECT c.*, p.user_id AS owner FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?', int(c.params.id));
  must(cm && (cm.user_id === c.user.id || cm.owner === c.user.id), 404, 'Комментарий не найден');
  D.run('DELETE FROM comments WHERE parent_id=?', cm.id);
  D.run('DELETE FROM comments WHERE id=?', cm.id);
  return { ok: true };
});
route('POST', '/api/comments/:id/like', (c) => {
  const cm = D.get('SELECT c.* FROM comments c WHERE c.id=?', int(c.params.id));
  must(cm && getPost(cm.post_id, c.user.id), 404, 'Комментарий не найден');
  const had = D.get('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?', cm.id, c.user.id);
  if (had) D.run('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?', cm.id, c.user.id);
  else D.run('INSERT INTO comment_likes(comment_id,user_id) VALUES(?,?)', cm.id, c.user.id);
  return { liked: !had, likes: D.get('SELECT COUNT(*) n FROM comment_likes WHERE comment_id=?', cm.id).n };
});

// ============================================================
//  SEARCH
// ============================================================
route('GET', '/api/search', (c) => {
  const q = str(c.query.get('q'), 60), me = c.user.id;
  if (!q) return { users: [], posts: [], channels: [], groups: [], tags: [] };
  const lk = like(q.replace(/^[@#]/, ''));
  const users = D.all(`SELECT u.* FROM users u WHERE (u.username LIKE ?2 ESCAPE '\\' OR u.display_name LIKE ?2 ESCAPE '\\')
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))
    ORDER BY (u.username=?3) DESC, (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id) DESC LIMIT 20`, me, lk, q.replace(/^@/, '')).map((u) => ({ ...pubUser(u), following: isFollowing(me, u.id), is_me: u.id === me }));
  const posts = postsWhere(me, "(p.caption LIKE ?2 ESCAPE '\\' OR u.username LIKE ?2 ESCAPE '\\')", 'ORDER BY p.created_at DESC LIMIT 30', lk);
  const chatRows = D.all(`SELECT c.*, (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id=c.id) AS members,
    EXISTS(SELECT 1 FROM chat_members m WHERE m.chat_id=c.id AND m.user_id=?1) AS joined
    FROM chats c WHERE c.is_public=1 AND c.type IN ('group','channel') AND (c.title LIKE ?2 ESCAPE '\\' OR c.handle LIKE ?2 ESCAPE '\\' OR c.description LIKE ?2 ESCAPE '\\') ORDER BY members DESC LIMIT 20`, me, lk).map(mapChatBrief);
  const tagCount = new Map();
  for (const r of D.all("SELECT caption FROM posts WHERE caption LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 300", like('#' + q.replace(/^#/, ''))))
    for (const t of U.extractTags(r.caption)) if (t.includes(q.replace(/^#/, '').toLowerCase())) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  return {
    users, posts, channels: chatRows.filter((x) => x.type === 'channel'), groups: chatRows.filter((x) => x.type === 'group'),
    tags: [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
  };
});

// ============================================================
//  NOTIFICATIONS
// ============================================================
route('GET', '/api/notifications', (c) => {
  const rows = D.all(`SELECT n.*, u.username, u.display_name, u.avatar, p.thumb, p.file, p.type AS ptype FROM notifications n
    LEFT JOIN users u ON u.id=n.actor_id LEFT JOIN posts p ON p.id=n.post_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 80`, c.user.id);
  return rows.map((n) => ({
    id: n.id, type: n.type, text: n.text, is_read: !!n.is_read, created_at: n.created_at, post_id: n.post_id, chat_id: n.chat_id,
    actor: brief({ id: n.actor_id, username: n.username, display_name: n.display_name, avatar: n.avatar }),
    thumb: n.post_id ? (n.thumb ? url(n.thumb) : n.ptype === 'photo' ? url(n.file) : null) : null,
    following: n.actor_id ? isFollowing(c.user.id, n.actor_id) : false,
  }));
});
route('POST', '/api/notifications/read', (c) => { D.run('UPDATE notifications SET is_read=1 WHERE user_id=?', c.user.id); return { ok: true }; });

// ============================================================
//  CHATS
// ============================================================
function mapChatBrief(c) {
  return { id: c.id, type: c.type, title: c.title, handle: c.handle, description: c.description, avatar: url(c.avatar), is_public: !!c.is_public, members: c.members, joined: !!c.joined };
}
const member = (chatId, userId) => D.get('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?', chatId, userId);
const isAdmin = (m) => m && (m.role === 'owner' || m.role === 'admin');
function chatOr404(id) { const ch = D.get('SELECT * FROM chats WHERE id=?', id); must(ch, 404, 'Чат не найден'); return ch; }

function fileKind(ext) { return U.IMAGE_EXT.has(ext) ? 'image' : U.VIDEO_EXT.has(ext) ? 'video' : ['.mp3', '.ogg', '.wav', '.m4a'].includes(ext) ? 'audio' : 'file'; }
function mapMessage(m) {
  return {
    id: m.id, chat_id: m.chat_id, text: m.text, created_at: m.created_at, reply_to: m.reply_to || null, edited_at: m.edited_at || null, pinned: !!m.pinned, forward_from: m.forward_from || null,
    reactions: D.all('SELECT emoji, COUNT(*) AS n, GROUP_CONCAT(user_id) AS ids FROM reactions WHERE message_id=? GROUP BY emoji ORDER BY MIN(rowid)', m.id).map((r) => ({ emoji: r.emoji, count: r.n, users: String(r.ids).split(',').map(Number) })),
    file: m.file ? { url: url(m.file), name: m.file_name, kind: m.file_type, size: m.file_size } : null,
    post: m.post_id ? (() => { const p = D.get('SELECT p.id,p.type,p.file,p.thumb,p.caption,u.username FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?', m.post_id); return p ? { id: p.id, type: p.type, thumb: p.thumb ? url(p.thumb) : p.type === 'photo' ? url(p.file) : null, caption: p.caption, username: p.username } : null; })() : null,
    reply: m.reply_to ? (() => { const r = D.get('SELECT m.id, m.text, m.file_name, u.display_name FROM messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.id=?', m.reply_to); return r ? { id: r.id, text: r.text || r.file_name || '', name: r.display_name } : null; })() : null,
    user: m.user_id ? brief({ id: m.user_id, username: m.username, display_name: m.display_name, avatar: m.avatar }) : null,
  };
}
const MSG_SELECT = 'SELECT m.*, u.username, u.display_name, u.avatar FROM messages m LEFT JOIN users u ON u.id=m.user_id';

route('GET', '/api/chats', (c) => {
  try { ensureSupportChat(c.user.id); } catch {}

  const me = c.user.id;
  const rows = D.all(`SELECT c.*, cm.role, cm.last_read_id, cm.muted, cm.pinned AS cpinned,
    (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.id>cm.last_read_id AND m.user_id IS NOT ?1) AS unread,
    (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id=c.id) AS members,
    (SELECT MAX(id) FROM messages WHERE chat_id=c.id) AS last_id
    FROM chat_members cm JOIN chats c ON c.id=cm.chat_id WHERE cm.user_id=?1`, me);
  const list = rows.map((c2) => {
    const last = c2.last_id ? D.get(`${MSG_SELECT} WHERE m.id=?`, c2.last_id) : null;
    const out = { ...mapChatBrief({ ...c2, joined: 1 }), role: c2.role, muted: !!c2.muted, pinned: !!c2.cpinned, unread: c2.unread, last: last ? mapMessage(last) : null, updated_at: last ? last.created_at : c2.created_at };
    if (c2.type === 'dm') {
      const other = D.get('SELECT u.* FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.user_id<>?', c2.id, me);
      if (other) { out.title = other.display_name; out.avatar = url(other.avatar); out.other = pubUser(other); }
    }
    return out;
  });
  return list.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
});

function dmAllowed(me, target) {
  must(!isBlocked(me, target.id), 403, 'Вы не можете писать этому пользователю');
  if (target.allow_dm === 'nobody') throw new HttpError(403, 'Пользователь отключил личные сообщения');
  if (target.allow_dm === 'followers' && !isFollowing(me, target.id)) throw new HttpError(403, 'Писать могут только подписчики этого пользователя');
}

route('POST', '/api/chats', (c) => {
  const me = c.user.id, b = c.body, type = str(b.type, 10);
  const now = U.now();
  if (type === 'dm') {
    const target = D.get('SELECT * FROM users WHERE id=?', int(b.user_id));
    must(target && target.id !== me, 400, 'Выберите пользователя');
    dmAllowed(me, target);
    let chat = D.get(`SELECT c.id FROM chats c WHERE c.type='dm' AND EXISTS(SELECT 1 FROM chat_members WHERE chat_id=c.id AND user_id=?1) AND EXISTS(SELECT 1 FROM chat_members WHERE chat_id=c.id AND user_id=?2)`, me, target.id);
    if (!chat) {
      const r = D.run("INSERT INTO chats(type,created_at) VALUES('dm',?)", now);
      chat = { id: Number(r.lastInsertRowid) };
      D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", chat.id, me, now);
      D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", chat.id, target.id, now);
    } else if (!member(chat.id, me)) D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", chat.id, me, now);
    return { id: chat.id };
  }
  must(type === 'group' || type === 'channel', 400, 'Неверный тип чата');
  const title = str(b.title, 60);
  must(title, 400, 'Введите название');
  const isPublic = b.is_public ? 1 : 0;
  let handle = str(b.handle, 32).replace(/^@/, '') || null;
  if (isPublic) must(handle, 400, 'Для публичного чата нужно имя (@handle)');
  if (handle) {
    must(/^[a-zA-Z0-9_]{4,32}$/.test(handle), 400, 'Имя: 4–32 символа, латиница, цифры и _');
    must(!D.get('SELECT 1 FROM chats WHERE handle=?', handle), 409, 'Это имя уже занято');
  }
  const id = D.tx(() => {
    const r = D.run('INSERT INTO chats(type,title,handle,description,owner_id,is_public,created_at) VALUES(?,?,?,?,?,?,?)', type, title, handle, str(b.description, 300), me, isPublic, now);
    const cid = Number(r.lastInsertRowid);
    D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'owner',?)", cid, me, now);
    for (const uid of (Array.isArray(b.members) ? b.members : []).slice(0, 200).map(int)) {
      if (uid === me || !D.get('SELECT 1 FROM users WHERE id=?', uid) || isBlocked(me, uid)) continue;
      D.run("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", cid, uid, now);
    }
    return cid;
  });
  for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', id)) RT.push(m.user_id, 'chat', { chat_id: id });
  systemMessage(id, me, type === 'channel' ? 'Канал создан' : 'Группа создана');
  return { id };
});

function systemMessage(chatId, userId, text) {
  const r = D.run('INSERT INTO messages(chat_id,user_id,text,created_at) VALUES(?,NULL,?,?)', chatId, text, U.now());
  broadcastMessage(chatId, Number(r.lastInsertRowid));
}
function broadcastMessage(chatId, messageId) {
  const msg = mapMessage(D.get(`${MSG_SELECT} WHERE m.id=?`, messageId));
  for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', chatId)) RT.push(m.user_id, 'message', { chat_id: chatId, message: msg });
  return msg;
}

route('GET', '/api/chats/by-handle/:handle', (c) => {
  const ch = D.get('SELECT * FROM chats WHERE handle=? AND is_public=1', c.params.handle);
  must(ch, 404, 'Чат не найден');
  return { id: ch.id };
});

route('GET', '/api/chats/:id', (c) => {
  const ch = chatOr404(int(c.params.id)), me = c.user.id, m = member(ch.id, me);
  must(m || ch.is_public, 403, 'Нет доступа');
  const out = { ...mapChatBrief({ ...ch, members: D.get('SELECT COUNT(*) n FROM chat_members WHERE chat_id=?', ch.id).n, joined: !!m }), role: m?.role || null, muted: !!m?.muted, pinned_chat: !!m?.pinned, owner_id: ch.owner_id };
  const pm = D.get(`${MSG_SELECT} WHERE m.chat_id=? AND m.pinned=1 ORDER BY m.id DESC LIMIT 1`, ch.id);
  out.pinned = pm ? mapMessage(pm) : null;
  if (ch.type === 'dm') {
    out.other_read_id = D.get('SELECT last_read_id AS r FROM chat_members WHERE chat_id=? AND user_id<>?', ch.id, me)?.r || 0;
    const other = D.get('SELECT u.* FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=? AND cm.user_id<>?', ch.id, me);
    if (other) { out.title = other.display_name; out.avatar = url(other.avatar); out.other = pubUser(other); }
  }
  if (m && ch.type !== 'dm' && (ch.type === 'group' || isAdmin(m))) {
    out.member_list = D.all('SELECT u.*, cm.role FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=? ORDER BY cm.joined_at LIMIT 300', ch.id).map((u) => ({ ...pubUser(u), role: u.role }));
  }
  return out;
});

route('PATCH', '/api/chats/:id', (c) => {
  const ch = chatOr404(int(c.params.id));
  must(isAdmin(member(ch.id, c.user.id)) && ch.type !== 'dm', 403, 'Недостаточно прав');
  const f = {}, b = c.body;
  if (b.title !== undefined) { f.title = str(b.title, 60); must(f.title, 400, 'Введите название'); }
  if (b.description !== undefined) f.description = str(b.description, 300);
  if (b.is_public !== undefined) f.is_public = b.is_public ? 1 : 0;
  if (b.handle !== undefined) {
    const h = str(b.handle, 32).replace(/^@/, '') || null;
    if (h) { must(/^[a-zA-Z0-9_]{4,32}$/.test(h), 400, 'Неверное имя'); must(!D.get('SELECT 1 FROM chats WHERE handle=? AND id<>?', h, ch.id), 409, 'Имя занято'); }
    f.handle = h;
  }
  if ((f.is_public ?? ch.is_public) && !(f.handle !== undefined ? f.handle : ch.handle)) throw new HttpError(400, 'Для публичного чата нужно имя (@handle)');
  const keys = Object.keys(f);
  if (keys.length) D.run(`UPDATE chats SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => f[k]), ch.id);
  for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', ch.id)) RT.push(m.user_id, 'chat', { chat_id: ch.id });
  return { ok: true };
});

route('POST', '/api/chats/:id/avatar', { upload: true }, (c) => {
  const ch = chatOr404(int(c.params.id));
  must(isAdmin(member(ch.id, c.user.id)) && ch.type !== 'dm', 403, 'Недостаточно прав');
  must(c.files[0], 400, 'Выберите изображение');
  const { name } = U.saveFile(D.UPLOADS, c.files[0], U.IMAGE_EXT);
  D.run('UPDATE chats SET avatar=? WHERE id=?', name, ch.id);
  for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', ch.id)) RT.push(m.user_id, 'chat', { chat_id: ch.id });
  return { avatar: url(name) };
});

route('POST', '/api/chats/:id/join', (c) => {
  const ch = chatOr404(int(c.params.id));
  must(ch.is_public && ch.type !== 'dm', 403, 'Чат закрыт. Нужно приглашение.');
  if (!member(ch.id, c.user.id)) {
    D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", ch.id, c.user.id, U.now());
    if (ch.type === 'group') systemMessage(ch.id, c.user.id, `${c.user.display_name} присоединился(ась)`);
  }
  RT.push(c.user.id, 'chat', { chat_id: ch.id });
  return { ok: true };
});

route('POST', '/api/chats/:id/leave', (c) => {
  const ch = chatOr404(int(c.params.id)), m = member(ch.id, c.user.id);
  must(m, 404, 'Вы не участник');
  must(m.role !== 'owner' || ch.type === 'dm', 400, 'Владелец не может выйти. Удалите чат или передайте права.');
  D.run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', ch.id, c.user.id);
  if (ch.type === 'dm' && !D.get('SELECT 1 FROM chat_members WHERE chat_id=?', ch.id)) D.run('DELETE FROM chats WHERE id=?', ch.id);
  else if (ch.type === 'group') systemMessage(ch.id, c.user.id, `${c.user.display_name} вышел(ла)`);
  return { ok: true };
});

route('DELETE', '/api/chats/:id', (c) => {
  const ch = chatOr404(int(c.params.id)), m = member(ch.id, c.user.id);
  must(m && (m.role === 'owner' || ch.type === 'dm'), 403, 'Только владелец может удалить чат');
  if (ch.type === 'dm') { D.run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', ch.id, c.user.id); if (!D.get('SELECT 1 FROM chat_members WHERE chat_id=?', ch.id)) D.run('DELETE FROM chats WHERE id=?', ch.id); return { ok: true }; }
  const members = D.all('SELECT user_id FROM chat_members WHERE chat_id=?', ch.id);
  D.run('DELETE FROM chats WHERE id=?', ch.id);
  for (const x of members) RT.push(x.user_id, 'chat', { chat_id: ch.id, deleted: true });
  return { ok: true };
});

route('POST', '/api/chats/:id/members', (c) => {
  const ch = chatOr404(int(c.params.id));
  must(ch.type !== 'dm', 400, 'Нельзя добавить участников в личный чат');
  must(isAdmin(member(ch.id, c.user.id)), 403, 'Недостаточно прав');
  const target = D.get('SELECT * FROM users WHERE id=?', int(c.body.user_id));
  must(target, 404, 'Пользователь не найден');
  must(!isBlocked(c.user.id, target.id), 403, 'Действие недоступно');
  D.run("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", ch.id, target.id, U.now());
  RT.push(target.id, 'chat', { chat_id: ch.id });
  if (ch.type === 'group') systemMessage(ch.id, c.user.id, `${target.display_name} добавлен(а)`);
  return { ok: true };
});
route('DELETE', '/api/chats/:id/members/:uid', (c) => {
  const ch = chatOr404(int(c.params.id)), uid = int(c.params.uid), tm = member(ch.id, uid);
  must(isAdmin(member(ch.id, c.user.id)) && tm && tm.role !== 'owner', 403, 'Недостаточно прав');
  D.run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', ch.id, uid);
  RT.push(uid, 'chat', { chat_id: ch.id, deleted: true });
  return { ok: true };
});
route('POST', '/api/chats/:id/members/:uid/role', (c) => {
  const ch = chatOr404(int(c.params.id)), uid = int(c.params.uid);
  must(member(ch.id, c.user.id)?.role === 'owner', 403, 'Только владелец может назначать администраторов');
  must(['admin', 'member'].includes(c.body.role) && member(ch.id, uid) && uid !== c.user.id, 400, 'Неверный запрос');
  D.run('UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=?', c.body.role, ch.id, uid);
  return { ok: true };
});
route('POST', '/api/chats/:id/mute', (c) => { D.run('UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?', c.body.muted ? 1 : 0, int(c.params.id), c.user.id); return { ok: true }; });

route('GET', '/api/chats/:id/messages', (c) => {
  const ch = chatOr404(int(c.params.id)), m = member(ch.id, c.user.id);
  must(m || (ch.is_public && ch.type === 'channel'), 403, 'Нет доступа');
  const sq = str(c.query.get('q'), 60);
  if (sq) return { items: D.all(`${MSG_SELECT} WHERE m.chat_id=? AND m.text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 40`, ch.id, like(sq)).map(mapMessage), has_more: false };
  const before = int(c.query.get('before'), 9e15), limit = Math.min(60, int(c.query.get('limit'), 40));
  const rows = D.all(`${MSG_SELECT} WHERE m.chat_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`, ch.id, before, limit).reverse();
  return { items: rows.map(mapMessage), has_more: rows.length === limit };
});

route('POST', '/api/chats/:id/messages', { upload: true }, (c) => {
  const ch = chatOr404(int(c.params.id)), me = c.user.id;
  let m = member(ch.id, me);
  must(m, 403, 'Вы не участник этого чата');
  if (ch.type === 'channel') must(isAdmin(m), 403, 'В канале публикуют только администраторы');
  if (ch.type === 'dm') {
    const other = D.get('SELECT u.* FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=? AND cm.user_id<>?', ch.id, me)
      || D.get('SELECT u.* FROM users u WHERE 0');
    if (other) dmAllowed(me, other);
  }
  const text = str(c.body.text, 4000);
  const postId = c.body.post_id ? int(c.body.post_id) : null;
  if (postId) must(getPost(postId, me), 404, 'Публикация не найдена');
  const replyTo = c.body.reply_to ? int(c.body.reply_to) : null;
  if (replyTo) must(D.get('SELECT 1 FROM messages WHERE id=? AND chat_id=?', replyTo, ch.id), 400, 'Сообщение не найдено');
  must(text || c.files.length || postId, 400, 'Пустое сообщение');
  const ids = [];
  const insert = (t, f) => {
    const r = D.run('INSERT INTO messages(chat_id,user_id,text,file,file_name,file_type,file_size,reply_to,post_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ch.id, me, t, f?.name || null, f?.orig || null, f?.kind || null, f?.size || null, ids.length ? null : replyTo, ids.length ? null : postId, U.now());
    ids.push(Number(r.lastInsertRowid));
  };
  if (!c.files.length) insert(text, null);
  c.files.slice(0, 10).forEach((file, i) => {
    const { name, ext } = U.saveFile(D.UPLOADS, file);
    let kind = fileKind(ext);
    if (c.body.kind === 'voice' && kind !== 'file') kind = 'audio';
    insert(i === 0 ? text : '', { name, orig: file.filename.slice(0, 120), kind, size: file.size || 0 });
  });
  // восстановим участие в DM, если собеседник удалил чат у себя
  if (ch.type === 'dm') for (const mm of [me]) void mm;
  const msgs = ids.map((id) => broadcastMessage(ch.id, id));
  D.run('UPDATE chat_members SET last_read_id=? WHERE chat_id=? AND user_id=?', ids[ids.length - 1], ch.id, me);
  for (const mt of D.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?', ch.id, me)) RT.push(mt.user_id, 'chat', { chat_id: ch.id });
  for (const mn of U.extractMentions(text)) {
    const mu = D.get('SELECT u.id FROM users u JOIN chat_members cm ON cm.user_id=u.id AND cm.chat_id=? WHERE u.username=?', ch.id, mn);
    if (mu && ch.type !== 'dm') notify(mu.id, me, 'mention', { chatId: ch.id, text: text.slice(0, 80) });
  }
  return { messages: msgs };
});

route('POST', '/api/chats/:id/read', (c) => {
  const ch = chatOr404(int(c.params.id));
  const last = D.get('SELECT MAX(id) AS id FROM messages WHERE chat_id=?', ch.id).id || 0;
  D.run('UPDATE chat_members SET last_read_id=? WHERE chat_id=? AND user_id=?', last, ch.id, c.user.id);
  if (ch.type === 'dm') for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?', ch.id, c.user.id)) RT.push(m.user_id, 'read', { chat_id: ch.id, last_read_id: last });
  return { ok: true };
});

route('POST', '/api/chats/:id/typing', (c) => {
  const ch = chatOr404(int(c.params.id));
  if (!member(ch.id, c.user.id) || ch.type === 'channel') return { ok: true };
  for (const m of D.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?', ch.id, c.user.id))
    RT.push(m.user_id, 'typing', { chat_id: ch.id, user: brief(c.user) });
  return { ok: true };
});

route('DELETE', '/api/messages/:id', (c) => {
  const m = D.get('SELECT m.*, ch.type FROM messages m JOIN chats ch ON ch.id=m.chat_id WHERE m.id=?', int(c.params.id));
  must(m, 404, 'Сообщение не найдено');
  const mem = member(m.chat_id, c.user.id);
  must(mem && (m.user_id === c.user.id || (m.type !== 'dm' && isAdmin(mem))), 403, 'Нельзя удалить это сообщение');
  D.run('DELETE FROM messages WHERE id=?', m.id);
  if (m.file && !D.get('SELECT 1 FROM messages WHERE file=?', m.file)) fs.rmSync(path.join(D.UPLOADS, m.file), { force: true });
  for (const x of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', m.chat_id)) RT.push(x.user_id, 'message_deleted', { chat_id: m.chat_id, id: m.id });
  return { ok: true };
});

route('GET', '/api/discover/chats', (c) => D.all(`SELECT c.*, (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id=c.id) AS members,
  EXISTS(SELECT 1 FROM chat_members m WHERE m.chat_id=c.id AND m.user_id=?1) AS joined
  FROM chats c WHERE c.is_public=1 AND c.type IN ('group','channel') ORDER BY members DESC LIMIT 20`, c.user.id).map(mapChatBrief));

// ---------- реакции, правка, закрепление, пересылка ----------
function msgAccess(id, me, needMember = true) {
  const m = D.get('SELECT m.*, ch.type AS ctype, ch.title AS ctitle, ch.is_public AS cpub FROM messages m JOIN chats ch ON ch.id=m.chat_id WHERE m.id=?', id);
  must(m, 404, 'Сообщение не найдено');
  const mem = member(m.chat_id, me);
  must(mem || (!needMember && m.cpub && m.ctype === 'channel'), 403, 'Нет доступа');
  return { m, mem };
}
function pushUpdate(chatId, messageId) {
  const msg = mapMessage(D.get(`${MSG_SELECT} WHERE m.id=?`, messageId));
  for (const x of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', chatId)) RT.push(x.user_id, 'message_update', { chat_id: chatId, message: msg });
  return msg;
}
const ALLOWED_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '👎', '🎉'];
route('POST', '/api/messages/:id/react', (c) => {
  const { m } = msgAccess(int(c.params.id), c.user.id);
  const emoji = String(c.body.emoji || '');
  must(ALLOWED_REACTIONS.includes(emoji), 400, 'Недопустимая реакция');
  const cur = D.get('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?', m.id, c.user.id);
  if (cur && cur.emoji === emoji) D.run('DELETE FROM reactions WHERE message_id=? AND user_id=?', m.id, c.user.id);
  else D.run('INSERT OR REPLACE INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)', m.id, c.user.id, emoji);
  return pushUpdate(m.chat_id, m.id);
});
route('PATCH', '/api/messages/:id', (c) => {
  const { m } = msgAccess(int(c.params.id), c.user.id);
  must(m.user_id === c.user.id, 403, 'Можно редактировать только свои сообщения');
  const text = str(c.body.text, 4000);
  must(text || m.file || m.post_id, 400, 'Сообщение не может быть пустым');
  D.run('UPDATE messages SET text=?, edited_at=? WHERE id=?', text, U.now(), m.id);
  return pushUpdate(m.chat_id, m.id);
});
route('POST', '/api/messages/:id/pin', (c) => {
  const { m, mem } = msgAccess(int(c.params.id), c.user.id);
  must(m.ctype === 'dm' || isAdmin(mem), 403, 'Закреплять могут только администраторы');
  const on = c.body.pinned ? 1 : 0;
  if (on) D.run('UPDATE messages SET pinned=0 WHERE chat_id=?', m.chat_id);
  D.run('UPDATE messages SET pinned=? WHERE id=?', on, m.id);
  const msg = pushUpdate(m.chat_id, m.id);
  for (const x of D.all('SELECT user_id FROM chat_members WHERE chat_id=?', m.chat_id)) RT.push(x.user_id, 'chat', { chat_id: m.chat_id });
  return msg;
});
route('POST', '/api/messages/:id/forward', (c) => {
  const me = c.user.id;
  const { m } = msgAccess(int(c.params.id), me, false);
  const ch = chatOr404(int(c.body.chat_id)), mem = member(ch.id, me);
  must(mem, 403, 'Вы не участник чата');
  if (ch.type === 'channel') must(isAdmin(mem), 403, 'В канале публикуют только администраторы');
  if (ch.type === 'dm') { const other = D.get('SELECT u.* FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=? AND cm.user_id<>?', ch.id, me); if (other) dmAllowed(me, other); }
  let from = m.forward_from;
  if (!from) from = m.ctype === 'channel' ? m.ctitle : (D.get('SELECT display_name FROM users WHERE id=?', m.user_id)?.display_name || 'Chikstagram');
  const r = D.run('INSERT INTO messages(chat_id,user_id,text,file,file_name,file_type,file_size,post_id,forward_from,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ch.id, me, m.text, m.file, m.file_name, m.file_type, m.file_size, m.post_id, from, U.now());
  const id = Number(r.lastInsertRowid);
  const msg = broadcastMessage(ch.id, id);
  D.run('UPDATE chat_members SET last_read_id=? WHERE chat_id=? AND user_id=?', id, ch.id, me);
  for (const x of D.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?', ch.id, me)) RT.push(x.user_id, 'chat', { chat_id: ch.id });
  return msg;
});
route('POST', '/api/chats/:id/pin', (c) => {
  const ch = chatOr404(int(c.params.id));
  must(member(ch.id, c.user.id), 403, 'Нет доступа');
  if (c.body.pinned) must(D.get('SELECT COUNT(*) n FROM chat_members WHERE user_id=? AND pinned=1', c.user.id).n < 5, 400, 'Можно закрепить не более 5 чатов');
  D.run('UPDATE chat_members SET pinned=? WHERE chat_id=? AND user_id=?', c.body.pinned ? 1 : 0, ch.id, c.user.id);
  return { ok: true, pinned: !!c.body.pinned };
});

// ============================================================
//  DISPATCH
// ============================================================
function findUser(token) {
  if (!token) return null;
  const u = D.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', token);
  if (u && U.now() - u.last_seen > 60e3) D.run('UPDATE users SET last_seen=? WHERE id=?', U.now(), u.id);
  return u;
}

async function dispatch(req, res, urlObj) {
  const pathname = urlObj.pathname;
  let matched = null, params = {}, pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== req.method) continue;
    matched = r;
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    break;
  }
  if (!matched) return U.send(res, pathMatched ? 405 : 404, { error: pathMatched ? 'Метод не поддерживается' : 'Не найдено' });
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = findUser(token);
    if (matched.opts.auth !== false && !user) throw new HttpError(401, 'Требуется вход');
    const tempDir = path.join(D.UPLOADS, '.tmp');
    const { body, files } = await U.parseRequest(req, matched.opts.upload ? MAX_UPLOAD : 1024 * 1024, tempDir);
    const result = await matched.handler({ req, res, user, token, params, query: urlObj.searchParams, body, files });
    U.send(res, 200, result === undefined ? { ok: true } : result);
  } catch (e) {
    if (e instanceof HttpError) return U.send(res, e.status, { error: e.message });
    console.error('API error', req.method, pathname, e);
    U.send(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
}

module.exports = { dispatch, findUser };
