const redis = require('../redis');
const db = require('../db');

const QUEUE = 'clicks:queue';
const BATCH = 500;
let timer = null;
let flushing = false;

// Called AFTER the redirect response is sent. Fire-and-forget: one fast Redis LPUSH,
// no PostgreSQL write on the redirect path.
function enqueueClick(click) {
  redis.lpush(QUEUE, JSON.stringify(click)).catch((e) =>
    console.error('click enqueue failed:', e.message)
  );
}

// Worker: drain the queue in batches and bulk-insert into PostgreSQL.
async function flushOnce() {
  const items = await redis.rpop(QUEUE, BATCH); // FIFO with LPUSH
  if (!items || !items.length) return 0;

  const rows = items.map((s) => JSON.parse(s));
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO clicks (url_id, clicked_at, ip, user_agent, referrer)
       SELECT * FROM unnest($1::bigint[], $2::timestamptz[], $3::text[], $4::text[], $5::text[])`,
      [
        rows.map((r) => r.urlId),
        rows.map((r) => r.at),
        rows.map((r) => r.ip),
        rows.map((r) => r.ua),
        rows.map((r) => r.ref),
      ]
    );
    await client.query(
      `UPDATE urls u SET click_count = u.click_count + c.n
       FROM (SELECT url_id, COUNT(*) AS n FROM unnest($1::bigint[]) AS url_id GROUP BY url_id) c
       WHERE u.id = c.url_id`,
      [rows.map((r) => r.urlId)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await redis.rpush(QUEUE, ...items); // put back; retried on next tick
    console.error('click flush failed, requeued:', e.message);
    return 0;
  } finally {
    client.release();
  }
  return rows.length;
}

async function flushAll() {
  if (flushing) return;
  flushing = true;
  try {
    while ((await flushOnce()) === BATCH) { /* keep draining */ }
  } catch (e) {
    console.error('flush error:', e.message);
  } finally {
    flushing = false;
  }
}

function startClickWorker(intervalMs = 2000) {
  timer = setInterval(flushAll, intervalMs);
}

async function stopClickWorker() {
  if (timer) clearInterval(timer);
  await flushAll(); // final drain on shutdown
}

module.exports = { enqueueClick, startClickWorker, stopClickWorker };
