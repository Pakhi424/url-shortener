const { Pool } = require('pg');
const { databaseUrl } = require('./config');

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
pool.on('error', (err) => console.error('Unexpected PG error', err.message));

module.exports = pool;
