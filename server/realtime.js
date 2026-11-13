'use strict';
// Реальное время через Server-Sent Events (бесплатно, без библиотек).
const clients = new Map(); // userId -> Set<res>

function add(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => {
    const set = clients.get(userId);
    if (set) { set.delete(res); if (!set.size) clients.delete(userId); }
  });
}

function push(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

const isOnline = (userId) => clients.has(userId);

setInterval(() => { for (const set of clients.values()) for (const res of set) res.write(': ping\n\n'); }, 25000).unref();

module.exports = { add, push, isOnline };
