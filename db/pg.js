const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

function prepare(sql) {
  const p = getPool();
  const converted = sql.replace(/\?/g, (match, offset) => {
    const idx = sql.substring(0, offset).split('?').length;
    return `$${idx}`;
  });
  return {
    get: async (...params) => {
      const res = await p.query(converted, params);
      return res.rows[0] || null;
    },
    all: async (...params) => {
      const res = await p.query(converted, params);
      return res.rows;
    },
    run: async (...params) => {
      const res = await p.query(converted, params);
      return { rowCount: res.rowCount || 0 };
    }
  };
}

async function exec(sql, params) {
  await getPool().query(sql, params || []);
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPool, prepare, exec, transaction };
