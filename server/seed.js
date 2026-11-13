'use strict';
// Демо-данные: пользователи, видео/фото (генерируются ffmpeg), лайки, комментарии, чаты, каналы.
// Запуск: npm run seed  (также выполняется автоматически при первом старте с пустой БД).
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const D = require('./db');
const U = require('./util');

const PASSWORD = 'chik12345';
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find((f) => fs.existsSync(f));

let s = 7;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const USERS = [
  ['demo', 'Демо Пилот', 'Добро пожаловать в Chikstagram ✦ Это демо-аккаунт'],
  ['nova_x', 'Нова ✨', 'Ловлю закаты и туманности 🌌 #космос'],
  ['orbit.kid', 'Orbit Kid', 'Видео про технику и гаджеты 🚀'],
  ['luna_wave', 'Луна Вэйв', 'Музыка, неон и ночные города 🌙'],
  ['astro_max', 'Макс Астро', 'Астрофотограф. Снимаю небо над горами 🔭'],
  ['cosmo_chef', 'Космо-Шеф', 'Готовлю как на орбите 🍜'],
  ['neon_drifter', 'Neon Drifter', 'Дрифт, неон, ночные трассы 🏎️'],
  ['stellar_jane', 'Джейн Стеллар', 'Путешествия по планете и за её пределы 🌍'],
  ['pixel_comet', 'Pixel Comet', 'Пиксель-арт и ретро-игры 👾'],
  ['void_walker', 'Void Walker', 'Тишина космоса. Ambient & lo-fi 🎧'],
];

// [автор, тип, подпись, надпись на картинке, цвета c0,c1,c2]
const POSTS = [
  ['nova_x', 'video', 'Туманность Ориона в моём окне ✨ #космос #туманность #вечер', 'ОРИОН', '0x12084a', '0xff2e9a', '0x18d0ff'],
  ['luna_wave', 'video', 'Ночной ритм города 🌙 #неон #музыка #vibes', 'NEON', '0x0a0020', '0x7b2dff', '0xff4bd8'],
  ['orbit.kid', 'video', 'Топ-3 гаджета для будущих астронавтов 🚀 #технологии #космос', 'GADGETS', '0x041a3a', '0x00e0ff', '0x6a5cff'],
  ['astro_max', 'video', 'Млечный путь над хребтом. Таймлапс 🔭 #космос #астрофото #горы', 'MILKY WAY', '0x02051a', '0x3a2cff', '0x00ffd5'],
  ['cosmo_chef', 'video', 'Лапша за 5 минут — вкус как на орбите 🍜 #еда #рецепт', 'РАМЕН', '0x2a0a1a', '0xff7a18', '0xffd000'],
  ['neon_drifter', 'video', 'Ночной дрифт под дождём 🏎️ #неон #авто #vibes', 'DRIFT', '0x0b0b2b', '0xff1f5a', '0x00c8ff'],
  ['stellar_jane', 'video', 'Закат на краю света 🌍 #путешествия #закат', 'SUNSET', '0x2b0f3a', '0xff5e62', '0xffc371'],
  ['void_walker', 'video', 'Lo-fi для глубокого космоса 🎧 #музыка #lofi #vibes', 'LO-FI', '0x050514', '0x4b3bff', '0xb06bff'],
  ['pixel_comet', 'video', 'Ретро-игры никогда не умрут 👾 #игры #пиксели #vibes', 'PIXEL', '0x10002b', '0x39ff14', '0xff00e5'],
  ['nova_x', 'video', 'Утро на Марсе (почти) 🔴 #космос #марс', 'MARS', '0x2a0800', '0xff4d1a', '0xffb36b'],
  ['luna_wave', 'video', 'Танцуем под северным сиянием 💃 #танцы #музыка #неон', 'AURORA', '0x001a2a', '0x00ffa6', '0x7a5cff'],
  ['demo', 'video', 'Первое видео в Chikstagram! Привет, вселенная 👋 #привет #космос', 'HELLO', '0x1a0b4a', '0xff2e9a', '0x18d0ff'],
  ['astro_max', 'photo', 'Луна в 400 мм 🌕 #космос #астрофото #луна', 'MOON', '0x02020a', '0x8888ff', '0xffffff'],
  ['stellar_jane', 'photo', 'Горное озеро на рассвете 🏔️ #путешествия #горы', 'LAKE', '0x0b2540', '0x13c4a3', '0xf5d76e'],
  ['pixel_comet', 'photo', 'Новый пиксель-арт: космопорт 👾 #пиксели #игры #арт', 'PORT', '0x1a0033', '0xff3df2', '0x00e5ff'],
  ['neon_drifter', 'photo', 'Огни ночной трассы 🚦 #неон #авто', 'NIGHT', '0x04041a', '0xff0055', '0x00aaff'],
  ['cosmo_chef', 'photo', 'Десерт «Галактика» 🍰 #еда #рецепт #космос', 'GALAXY', '0x1f0a3a', '0xc13cff', '0xff8fd8'],
  ['void_walker', 'photo', 'Тишина. Просто тишина 🌌 #космос #ambient', 'VOID', '0x000008', '0x2a1a6a', '0x6a8cff'],
];

const COMMENTS = ['Огонь! 🔥', 'Это просто космос 🚀', 'Как ты это снял?', 'Атмосфера 😍', 'Сохранил себе ✦', 'Вау, красота!', 'Подписался!', 'Ещё хочу такое 🙌', 'Жду продолжения', 'Топ контент 💜'];

function gen(file, kind, title, c0, c1, c2, seed) {
  const out = path.join(D.UPLOADS, file);
  const g = `gradients=s=360x640:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:speed=0.03:seed=${seed}:rate=24`;
  const txt = FONT ? `,drawtext=fontfile=${FONT}:text='${title}':fontcolor=white@0.85:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2-60:shadowcolor=black@0.5:shadowx=2:shadowy=2` : '';
  if (kind === 'video') {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', g, '-t', '6', '-vf', `hue=h=t*25:s=1.3,vignette=PI/4${txt},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart', out], { timeout: 60000 });
  } else {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', g, '-frames:v', '1', '-vf', `scale=720:960:flags=bicubic,vignette=PI/4${txt.replace('fontsize=44', 'fontsize=80')}`, '-q:v', '4', out], { timeout: 30000 });
  }
}

function run(log = console.log) {
  if (D.get('SELECT COUNT(*) n FROM users').n > 0) { log('База уже содержит данные — сид пропущен.'); return false; }
  const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (!hasFfmpeg) log('ffmpeg не найден: демо-публикации будут пропущены (загружайте свои файлы).');
  const now = U.now();
  const ids = {};
  const { hash, salt } = U.hashPassword(PASSWORD);
  USERS.forEach(([username, name, bio], i) => {
    const r = D.run('INSERT INTO users(username,email,display_name,password_hash,salt,bio,created_at,last_seen) VALUES(?,?,?,?,?,?,?,?)',
      username, `${username.replace(/\./g, '')}@chik.test`, name, hash, salt, bio, now - (30 - i) * 86400e3, now - i * 3600e3);
    ids[username] = Number(r.lastInsertRowid);
  });

  const postIds = [];
  if (hasFfmpeg) {
    POSTS.forEach(([author, type, caption, title, c0, c1, c2], i) => {
      const base = `seed${i}_${U.randHex(3)}`;
      const file = base + (type === 'video' ? '.mp4' : '.jpg');
      try {
        gen(file, type, title, c0, c1, c2, 10 + i);
        let thumb = null;
        if (type === 'video') {
          thumb = base + '_t.jpg';
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(D.UPLOADS, file), '-ss', '0.5', '-frames:v', '1', '-vf', 'scale=480:-2', path.join(D.UPLOADS, thumb)]);
        }
        const r = D.run('INSERT INTO posts(user_id,type,file,thumb,caption,views,created_at) VALUES(?,?,?,?,?,?,?)',
          ids[author], type, file, thumb, caption, Math.floor(rnd() * 3000) + 50, now - Math.floor((POSTS.length - i) * 5.5 * 3600e3 + rnd() * 3600e3));
        postIds.push(Number(r.lastInsertRowid));
        process.stdout.write('.');
      } catch (e) { log('\nНе удалось создать ' + file + ': ' + e.message.split('\n')[0]); }
    });
    process.stdout.write('\n');
  }

  const names = Object.keys(ids);
  // подписки
  for (const a of names) for (const b of names) if (a !== b && (rnd() < 0.45 || a === 'demo' && ['nova_x', 'luna_wave', 'astro_max'].includes(b))) {
    D.run("INSERT OR IGNORE INTO follows(follower_id,following_id,status,created_at) VALUES(?,?, 'accepted',?)", ids[a], ids[b], now - Math.floor(rnd() * 20 * 86400e3));
  }
  // лайки, репосты, комментарии
  for (const pid of postIds) {
    for (const u of names) if (rnd() < 0.5) D.run('INSERT OR IGNORE INTO likes(user_id,post_id,created_at) VALUES(?,?,?)', ids[u], pid, now - Math.floor(rnd() * 86400e3));
    for (const u of names) if (rnd() < 0.12) D.run('INSERT OR IGNORE INTO reposts(user_id,post_id,created_at) VALUES(?,?,?)', ids[u], pid, now - Math.floor(rnd() * 86400e3));
    const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) D.run('INSERT INTO comments(post_id,user_id,text,created_at) VALUES(?,?,?,?)', pid, ids[pick(names)], pick(COMMENTS), now - Math.floor(rnd() * 80000e3 / 1000));
  }

  // чаты
  const mkChat = (type, title, handle, desc, owner, isPublic, members) => {
    const r = D.run('INSERT INTO chats(type,title,handle,description,owner_id,is_public,created_at) VALUES(?,?,?,?,?,?,?)', type, title, handle, desc, ids[owner], isPublic, now - 20 * 86400e3);
    const cid = Number(r.lastInsertRowid);
    D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'owner',?)", cid, ids[owner], now - 20 * 86400e3);
    for (const m of members) D.run("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", cid, ids[m], now - 10 * 86400e3);
    return cid;
  };
  const say = (cid, user, text, minsAgo) => D.run('INSERT INTO messages(chat_id,user_id,text,created_at) VALUES(?,?,?,?)', cid, user ? ids[user] : null, text, now - minsAgo * 60e3);

  const official = mkChat('channel', 'Chikstagram Official', 'chikstagram', 'Новости и обновления платформы Chikstagram ✦', 'nova_x', 1, names);
  say(official, null, 'Канал создан', 20 * 1440);
  say(official, 'nova_x', '✦ Добро пожаловать в Chikstagram — TikTok и Telegram в одном приложении!', 19 * 1440);
  say(official, 'nova_x', 'Что уже есть: короткие видео, лайки и репосты, личные сообщения, группы и публичные каналы, поиск и рекомендации.', 5 * 1440);
  say(official, 'nova_x', 'Заглядывайте в «Поиск», чтобы найти новые каналы и людей 🚀', 90);

  const news = mkChat('channel', 'Космические новости', 'space_news', 'Всё самое интересное о космосе — каждый день', 'astro_max', 1, ['demo', 'nova_x', 'luna_wave', 'void_walker', 'stellar_jane']);
  say(news, 'astro_max', '🔭 На этой неделе виден парад планет — ищите на западе после заката.', 3 * 1440);
  say(news, 'astro_max', '🌕 Суперлуние: лучшее время для съёмки — за час до восхода.', 200);

  const pilots = mkChat('group', 'Ночные пилоты', 'night_pilots', 'Болтаем о ночных съёмках, музыке и всём подряд', 'luna_wave', 1, ['demo', 'nova_x', 'astro_max', 'neon_drifter', 'void_walker']);
  say(pilots, null, 'Группа создана', 9 * 1440);
  say(pilots, 'luna_wave', 'Всем привет! Кто сегодня в эфире? 🌙', 300);
  say(pilots, 'neon_drifter', 'Я! Едем ловить огни трассы 🏎️', 280);
  say(pilots, 'astro_max', 'Присоединюсь позже — небо сегодня идеальное 🔭', 240);
  say(pilots, 'nova_x', 'Скиньте потом фото, обязательно!', 60);

  const open = mkChat('group', 'Пиксели и ретро', 'pixel_club', 'Открытая группа любителей пиксель-арта и ретро-игр', 'pixel_comet', 1, ['orbit.kid', 'cosmo_chef']);
  say(open, 'pixel_comet', 'Добро пожаловать в клуб! Делимся работами 👾', 1440);

  const dm = (a, b, lines) => {
    const r = D.run("INSERT INTO chats(type,created_at) VALUES('dm',?)", now - 3 * 86400e3);
    const cid = Number(r.lastInsertRowid);
    for (const u of [a, b]) D.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?, 'member',?)", cid, ids[u], now - 3 * 86400e3);
    lines.forEach(([who, text, mins]) => say(cid, who, text, mins));
    return cid;
  };
  dm('demo', 'nova_x', [['nova_x', 'Привет! Видела твоё первое видео — классное 🔥', 190], ['demo', 'Спасибо! Только начинаю осваиваться 😄', 185], ['nova_x', 'Загляни в наш канал новостей, там много интересного 🚀', 40]]);
  dm('demo', 'orbit.kid', [['orbit.kid', 'Хочешь коллаб на тему гаджетов?', 600]]);

  // уведомления для демо-аккаунта
  const demoPosts = D.all('SELECT id FROM posts WHERE user_id=?', ids.demo);
  const n = (type, actor, postId, text, minsAgo) => D.run('INSERT INTO notifications(user_id,actor_id,type,post_id,text,created_at) VALUES(?,?,?,?,?,?)', ids.demo, ids[actor], type, postId || null, text || '', now - minsAgo * 60e3);
  n('follow', 'nova_x', null, '', 300);
  n('follow', 'luna_wave', null, '', 250);
  if (demoPosts[0]) { n('like', 'nova_x', demoPosts[0].id, '', 200); n('comment', 'astro_max', demoPosts[0].id, 'Отличный старт! 🚀', 120); n('repost', 'orbit.kid', demoPosts[0].id, '', 60); }

  log(`Готово: ${USERS.length} пользователей, ${postIds.length} публикаций. Вход: demo / ${PASSWORD}`);
  return true;
}

module.exports = { run, PASSWORD };
if (require.main === module) run();
