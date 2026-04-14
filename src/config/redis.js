const { createClient } = require('redis');

let client;

async function getRedis() {
  if (client) return client;

  client = createClient({ url: process.env.REDIS_URL });

  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log('Redis connected'));

  await client.connect();
  return client;
}

// ── Presence helpers ─────────────────────────────────────────

/** Mark a user as online (key expires after 35 s; clients ping every 30 s). */
async function setOnline(userId) {
  const r = await getRedis();
  await r.set(`online:${userId}`, '1', { EX: 35 });
}

/** Remove online key immediately (on disconnect). */
async function setOffline(userId) {
  const r = await getRedis();
  await r.del(`online:${userId}`);
}

/** Returns true when the key exists (i.e. user is online). */
async function isOnline(userId) {
  const r = await getRedis();
  const val = await r.get(`online:${userId}`);
  return val === '1';
}

/** Check presence for a list of user IDs. Returns a Set of online IDs. */
async function bulkIsOnline(userIds) {
  if (!userIds.length) return new Set();
  const r = await getRedis();
  const keys = userIds.map((id) => `online:${id}`);
  const vals = await r.mGet(keys);
  const online = new Set();
  userIds.forEach((id, i) => { if (vals[i] === '1') online.add(id); });
  return online;
}

module.exports = { getRedis, setOnline, setOffline, isOnline, bulkIsOnline };
