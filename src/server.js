const express = require('express');
const config = require('./config');
const db = require('./db');
const redis = require('./redis');
const { startClickWorker, stopClickWorker } = require('./services/clickQueue');

const app = express();
app.set('trust proxy', 1); // correct client IP behind a reverse proxy / load balancer
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/urls', require('./routes/urls'));
app.use('/', require('./routes/redirect')); // must be last: catches /:code

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.port, () => {
  console.log(`Listening on ${config.port}`);
  startClickWorker();
});

async function shutdown() {
  server.close();
  await stopClickWorker();
  await db.end();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
