'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
// Файлы, которые безопасно показывать прямо в браузере. Всё остальное отдаётся как скачивание.
const INLINE_SAFE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4', '.m4v', '.webm', '.mov', '.ogv', '.mp3', '.ogg', '.wav', '.m4a', '.pdf']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.3gp', '.mkv']);
const TYPE_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp', 'video/x-matroska': '.mkv', 'video/ogg': '.ogv', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-m4a': '.m4a' };

const randHex = (n = 16) => crypto.randomBytes(n).toString('hex');
const now = () => Date.now();

function hashPassword(password, salt = randHex(16)) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  const a = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' || Buffer.isBuffer(data) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(body);
}

// ---------- потоковое чтение тела (JSON / маленькие тела) ----------
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Файл слишком большой')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- multipart: до 48 МБ в память (надёжно), больше — поток на диск ----------
const MEM_UPLOAD_LIMIT = 48 * 1024 * 1024;

function parseMultipart(buf, boundary) {
  const fields = {}; const files = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    // часть заканчивается \r\n перед boundary
    let end = next;
    if (end >= 2 && buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
    const part = buf.subarray(start, end);
    const hEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (hEnd !== -1) {
      const head = part.subarray(0, hEnd).toString('utf8');
      const body = part.subarray(hEnd + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (filename !== undefined && filename !== '') files.push({ field: name, filename, type, data: body, size: body.length });
      else if (name) fields[name] = body.toString('utf8');
    }
    pos = next;
  }
  return { fields, files };
}

function parseMultipartStream(req, boundary, fileLimit, tempDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(tempDir, { recursive: true });
    const delim = Buffer.from('\r\n--' + boundary);
    const first = Buffer.from('--' + boundary);
    const fields = {};
    const files = [];
    const temps = [];
    let total = 0;
    let buf = Buffer.alloc(0);
    let state = 'preamble';
    let headerStr = '';
    let fieldName = null, filename = null, contentType = null;
    let fieldChunks = [];
    let ws = null, fileSize = 0, currentTemp = null;
    let settled = false;

    const cleanup = () => {
      if (ws) { try { ws.destroy(); } catch {} ws = null; }
      for (const p of temps) { try { fs.rmSync(p, { force: true }); } catch {} }
      temps.length = 0;
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch {}
      cleanup();
      reject(err instanceof HttpError ? err : new HttpError(400, (err && err.message) || 'Ошибка разбора загрузки'));
    };
    const ok = (v) => {
      if (settled) return;
      settled = true;
      // не чистим temps успешных файлов
      resolve(v);
    };

    const closeWs = () => new Promise((res) => {
      if (!ws) return res();
      const s = ws; ws = null;
      s.end(() => res());
      s.on('error', () => res());
    });

    const finishPart = async () => {
      if (state === 'body-file') {
        await closeWs();
        files.push({
          field: fieldName,
          filename: filename || 'file',
          type: contentType || 'application/octet-stream',
          path: currentTemp,
          size: fileSize,
        });
        const i = temps.indexOf(currentTemp);
        // оставляем path для saveFile, убираем из cleanup-списка
        if (i >= 0) temps.splice(i, 1);
        currentTemp = null; fileSize = 0;
      } else if (state === 'body-field' && fieldName) {
        fields[fieldName] = Buffer.concat(fieldChunks).toString('utf8');
        fieldChunks = [];
      }
      state = 'headers';
      headerStr = ''; fieldName = null; filename = null; contentType = null;
    };

    const openFile = () => {
      currentTemp = path.join(tempDir, 'up_' + Date.now().toString(36) + '_' + randHex(8) + '.part');
      temps.push(currentTemp);
      fileSize = 0;
      ws = fs.createWriteStream(currentTemp, { highWaterMark: 1024 * 1024 });
      ws.on('error', fail);
      state = 'body-file';
    };

    const writeBody = (chunk) => {
      if (!chunk.length) return;
      if (state === 'body-file') {
        if (!ws.write(chunk)) {
          req.pause();
          ws.once('drain', () => req.resume());
        }
        fileSize += chunk.length;
        total += chunk.length;
        if (total > fileLimit) fail(new HttpError(413, 'Файл слишком большой (максимум 5 ГБ)'));
      } else if (state === 'body-field') {
        fieldChunks.push(chunk);
        total += chunk.length;
        if (total > fileLimit) fail(new HttpError(413, 'Файл слишком большой'));
      }
    };

    // очередь обработки, чтобы finishPart (async) не гонял state
    let chain = Promise.resolve();
    const enqueue = (fn) => { chain = chain.then(fn).catch(fail); };

    const process = () => {
      while (buf.length && !settled) {
        if (state === 'preamble') {
          const idx = buf.indexOf(first);
          if (idx === -1) {
            if (buf.length > first.length + 16) buf = buf.subarray(buf.length - first.length);
            return;
          }
          let after = idx + first.length;
          if (buf.length < after + 2) return;
          if (buf[after] === 45 && buf[after + 1] === 45) { ok({ fields, files }); return; }
          if (buf[after] === 13 && buf[after + 1] === 10) after += 2;
          buf = buf.subarray(after);
          state = 'headers';
          continue;
        }
        if (state === 'headers') {
          const hEnd = buf.indexOf(Buffer.from('\r\n\r\n'));
          if (hEnd === -1) {
            if (buf.length > 16384) return fail(new HttpError(400, 'Слишком большие заголовки'));
            return;
          }
          headerStr = buf.subarray(0, hEnd).toString('utf8');
          buf = buf.subarray(hEnd + 4);
          fieldName = /name="([^"]*)"/i.exec(headerStr)?.[1] || null;
          const fn = /filename="([^"]*)"/i.exec(headerStr);
          filename = fn ? fn[1] : null;
          contentType = /content-type:\s*([^\r\n]+)/i.exec(headerStr)?.[1]?.trim() || null;
          if (filename !== null && filename !== '') openFile();
          else { state = 'body-field'; fieldChunks = []; }
          continue;
        }
        // body
        const idx = buf.indexOf(delim);
        if (idx === -1) {
          const keep = delim.length;
          if (buf.length > keep) {
            const chunk = buf.subarray(0, buf.length - keep);
            buf = buf.subarray(buf.length - keep);
            writeBody(chunk);
          }
          return;
        }
        const partBody = buf.subarray(0, idx);
        writeBody(partBody);
        let after = idx + delim.length;
        if (buf.length < after + 2) {
          buf = buf.subarray(idx);
          return;
        }
        const isEnd = buf[after] === 45 && buf[after + 1] === 45;
        if (!isEnd && buf[after] === 13 && buf[after + 1] === 10) after += 2;
        buf = buf.subarray(after);
        // finish part then continue
        enqueue(async () => {
          await finishPart();
          if (isEnd) ok({ fields, files });
        });
        if (isEnd) return;
        // state already headers after finishPart (async) — wait
        return;
      }
    };

    req.on('data', (chunk) => {
      if (settled) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      enqueue(async () => { process(); });
    });
    req.on('end', () => {
      enqueue(async () => {
        if (!settled) fail(new HttpError(400, 'Неполный multipart'));
      });
    });
    req.on('error', fail);
  });
}

async function parseRequest(req, fileLimit, tempDir) {
  const ct = req.headers['content-type'] || '';
  if (req.method === 'GET' || req.method === 'HEAD' || (req.method === 'DELETE' && !ct)) return { body: {}, files: [] };
  if (ct.startsWith('multipart/form-data')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!boundary) throw new HttpError(400, 'Неверный multipart');
    const b = (boundary[1] || boundary[2] || '').trim();
    if (!b) throw new HttpError(400, 'Неверный multipart');
    const cl = parseInt(req.headers['content-length'] || '0', 10);
    // маленькие загрузки (или неизвестный CL, но лимит не огромный) — буферный парсер надёжнее
    if ((cl > 0 && cl <= MEM_UPLOAD_LIMIT) || fileLimit <= MEM_UPLOAD_LIMIT) {
      const buf = await readBody(req, Math.min(fileLimit, MEM_UPLOAD_LIMIT * 2));
      const parsed = parseMultipart(buf, b);
      return { body: parsed.fields, files: parsed.files };
    }
    const dir = tempDir || path.join(require('os').tmpdir(), 'chik-up');
    const { fields, files } = await parseMultipartStream(req, b, fileLimit, dir);
    return { body: fields, files };
  }
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return { body: {}, files: [] };
  try { return { body: JSON.parse(buf.toString('utf8')), files: [] }; } catch { throw new HttpError(400, 'Неверный JSON'); }
}

// ---------- сохранение файлов ----------
function extOf(file) {
  let ext = path.extname(file.filename || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const t = TYPE_EXT[String(file.type || '').split(';')[0].trim().toLowerCase()];
  if (t && (!ext || ((IMAGE_EXT.has(t) || VIDEO_EXT.has(t)) && !IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)))) ext = t;
  return ext || '.bin';
}

function saveFile(dir, file, allowedExts) {
  const ext = extOf(file);
  if (allowedExts && !allowedExts.has(ext)) {
    if (file.path) try { fs.rmSync(file.path, { force: true }); } catch {}
    throw new HttpError(415, 'Неподдерживаемый формат файла: ' + ext);
  }
  const name = Date.now().toString(36) + randHex(6) + ext;
  const dest = path.join(dir, name);
  if (file.path) {
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      try {
        fs.renameSync(file.path, dest);
        ok = true;
      } catch {
        if (i === 7) {
          fs.copyFileSync(file.path, dest);
          try { fs.rmSync(file.path, { force: true }); } catch {}
          ok = true;
        } else {
          const end = Date.now() + 30 * (i + 1);
          while (Date.now() < end) { /* spin */ }
        }
      }
    }
  } else if (file.data) {
    fs.writeFileSync(dest, file.data);
  } else {
    throw new HttpError(400, 'Пустой файл');
  }
  const size = file.size || (file.data ? file.data.length : 0) || (() => { try { return fs.statSync(dest).size; } catch { return 0; } })();
  if (!size) {
    try { fs.rmSync(dest, { force: true }); } catch {}
    throw new HttpError(400, 'Файл пустой или не загрузился');
  }
  return { name, ext, size };
}

function makeThumb(dir, videoName) {
  return new Promise((resolve) => {
    const out = videoName.replace(/\.[^.]+$/, '') + '_t.jpg';
    // -ss до -i быстрее для больших файлов (keyframe seek)
    execFile('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', '0.5',
      '-i', path.join(dir, videoName),
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-q:v', '6',
      path.join(dir, out),
    ], { timeout: 180000 }, (err) => resolve(err || !fs.existsSync(path.join(dir, out)) ? null : out));
  });
}

// ---------- ограничитель запросов ----------
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(t); hits.set(key, arr); return true;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

const extractTags = (text) => [...new Set((String(text || '').match(/#[\p{L}\p{N}_]{2,32}/gu) || []).map((t) => t.toLowerCase()))];
const extractMentions = (text) => [...new Set((String(text || '').match(/@[a-zA-Z0-9_]{3,24}/g) || []).map((t) => t.slice(1).toLowerCase()))];

module.exports = {
  MIME, INLINE_SAFE, IMAGE_EXT, VIDEO_EXT, extOf, randHex, now, hashPassword, verifyPassword, HttpError, send,
  parseRequest, saveFile, makeThumb, rateLimit, extractTags, extractMentions,
};
