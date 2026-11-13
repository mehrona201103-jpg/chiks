'use strict';
// SQLite (встроенный node:sqlite) — бесплатно, без внешних зависимостей.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CHIK_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(process.env.CHIK_DB || path.join(DATA_DIR, 'chikstagram.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  bio TEXT DEFAULT '',
  avatar TEXT,
  is_private INTEGER DEFAULT 0,
  show_online INTEGER DEFAULT 1,
  show_likes INTEGER DEFAULT 1,
  allow_dm TEXT DEFAULT 'everyone',      -- everyone | followers | nobody
  allow_comments TEXT DEFAULT 'everyone',-- everyone | followers | nobody
  last_seen INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                    -- video | photo
  file TEXT NOT NULL,
  thumb TEXT,
  caption TEXT DEFAULT '',
  views INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(created_at DESC);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
CREATE TABLE IF NOT EXISTS reposts(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS bookmarks(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows(
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted', -- accepted | pending
  created_at INTEGER NOT NULL,
  PRIMARY KEY(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE TABLE IF NOT EXISTS blocks(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- dm | group | channel
  title TEXT,
  handle TEXT UNIQUE COLLATE NOCASE,     -- публичное имя @handle
  description TEXT DEFAULT '',
  avatar TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_public INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members(
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member
  last_read_id INTEGER DEFAULT 0,
  muted INTEGER DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT DEFAULT '',
  file TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  reply_to INTEGER,
  post_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,   -- like | comment | follow | follow_request | repost | message | mention
  post_id INTEGER,
  chat_id INTEGER,
  text TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,   -- post | user | comment | chat
  target_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comment_likes(
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS stories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                    -- photo | video
  file TEXT NOT NULL,
  thumb TEXT,
  caption TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_exp ON stories(expires_at);
CREATE TABLE IF NOT EXISTS story_views(
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(story_id, user_id)
);
CREATE TABLE IF NOT EXISTS reactions(
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id)
);
`);
for (const q of [
  'ALTER TABLE comments ADD COLUMN parent_id INTEGER',
  'ALTER TABLE messages ADD COLUMN edited_at INTEGER',
  'ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0',
  'ALTER TABLE messages ADD COLUMN forward_from TEXT',
  'ALTER TABLE chat_members ADD COLUMN pinned INTEGER DEFAULT 0',
]) { try { db.exec(q); } catch { /* колонка уже есть */ } }

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
// Node's built-in SQLite positional binding is normalized here so legacy ?1/?2
// placeholders (including repeated references) work consistently.
function bindings(sql, params) {
  const numbered = /\?(\d+)/.test(sql);
  if (!numbered) return { sql, params: clean(params) };
  const expanded = sql.replace(/\?(\d+)/g, '?');
  const values = [...sql.matchAll(/\?(\d+)/g)].map((m) => params[Number(m[1]) - 1]);
  return { sql: expanded, params: clean(values) };
}

module.exports = {
  db,
  DATA_DIR,
  UPLOADS: path.join(DATA_DIR, 'uploads'),
  get: (sql, ...p) => { const b = bindings(sql, p); return stmt(b.sql).get(...b.params); },
  all: (sql, ...p) => { const b = bindings(sql, p); return stmt(b.sql).all(...b.params); },
  run: (sql, ...p) => { const b = bindings(sql, p); return stmt(b.sql).run(...b.params); },
  tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};

try { db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT'); } catch {}
