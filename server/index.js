'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./db');
const U = require('./util');
const RT = require('./realtime');
const { dispatch, findUser } = require('./api');

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

// Отдача файла с поддержкой Range (нужно для видео и перемотки).
function serveFile(req, res, file, { download, name } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return U.send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const inline = U.INLINE_SAFE.has(ext) && !download;
    const headers = {
      ...SEC,
      'Content-Type': U.MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(name || path.basename(file))}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? +range[1] : st.size - +range[2];
      let end = range[1] && range[2] ? +range[2] : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA fallback
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return U.send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return U.send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const headers = {
      ...SEC,
      'Content-Type': U.MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache',
    };
    if (ext === '.html') headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob: https://*.googleusercontent.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://accounts.google.com/gsi/ https://oauth2.googleapis.com; frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'";
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const p = urlObj.pathname;

    if (p === '/api/stream') {
      const user = findUser(urlObj.searchParams.get('token'));
      if (!user) return U.send(res, 401, { error: 'Требуется вход' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      RT.add(user.id, res);
      return;
    }
    if (p === '/api/health') return U.send(res, 200, { ok: true, name: 'Chikstagram' });
    if (p.startsWith('/api/')) return dispatch(req, res, urlObj);

    if (p.startsWith('/uploads/')) {
      const name = path.basename(decodeURIComponent(p));
      // имена в БД, чтобы отдавать оригинальное имя при скачивании
      let dl;
      if (urlObj.searchParams.has('dl')) {
        const m = D.get('SELECT file_name FROM messages WHERE file=?', name);
        dl = { download: true, name: m?.file_name };
      }
      return serveFile(req, res, path.join(D.UPLOADS, name), dl);
    }
    serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) U.send(res, 500, 'Server error');
  }
});

if (require.main === module) {
  // Демо-аккаунты и демо-видео отключены. Только реальные регистрации.
  // Чтобы заполнить демо-данными: CHIK_SEED=1 npm start
  if (process.env.CHIK_SEED === '1') require('./seed').run((m) => console.log('  [seed]', m));
  // Очистка оборванных загрузок (.tmp/*.part старше 24 ч)
  try {
    const tmp = path.join(D.UPLOADS, '.tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const cutoff = Date.now() - 24 * 3600e3;
    for (const f of fs.readdirSync(tmp)) {
      const fp = path.join(tmp, f);
      try {
        const st = fs.statSync(fp);
        if (st.mtimeMs < cutoff) fs.rmSync(fp, { force: true });
      } catch {}
    }
  } catch {}
  server.listen(PORT, () => console.log(`\n  ✦ Chikstagram запущен: http://localhost:${PORT}\n`));
}
module.exports = server;
