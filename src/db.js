import mysql from 'mysql2/promise';

const required = ['DB_HOST', 'DB_USER', 'DB_DATABASE'];
const missing = required.filter((k) => !process.env[k] && process.env[k] !== '');
if (missing.length) {
  throw new Error(`Missing required DB env vars: ${missing.join(', ')}. Check your .env file.`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,                               // must not be empty
  password: process.env.DB_PASSWORD ?? '',                 // send "" if blank, not undefined
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: process.env.DB_CONNECTION_LIMIT ? Number(process.env.DB_CONNECTION_LIMIT) : 10,
  queueLimit: 0
});

export default pool;
