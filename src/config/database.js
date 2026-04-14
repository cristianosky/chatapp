const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

/**
 * Execute a parameterized query.
 * @param {string} text  - SQL string with $1, $2 placeholders
 * @param {Array}  params - Values for placeholders
 */
const query = (text, params) => pool.query(text, params);

/**
 * Grab a client for transactions.
 * Remember to call client.release() when done.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
