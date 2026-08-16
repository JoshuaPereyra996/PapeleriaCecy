"use strict";
/* Pool de conexiones MySQL. Un pool, no conexiones sueltas: en hosting
   compartido las conexiones son un recurso limitado y una conexión abierta
   sin cerrar acaba tumbando la app. */
const mysql = require("mysql2/promise");

const cfg = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 5),
  queueLimit: 0,
  charset: "utf8mb4_unicode_ci",
  timezone: "Z",
};

const pool = mysql.createPool(cfg);

async function ping(){
  const c = await pool.getConnection();
  try { await c.query("SELECT 1"); return true; }
  finally { c.release(); }
}

/* Config sin credenciales, para express-mysql-session */
const sessionOptions = {
  host: cfg.host, port: cfg.port, user: cfg.user,
  password: cfg.password, database: cfg.database,
  createDatabaseTable: true,
  schema: { tableName: "sessions" },
  charset: "utf8mb4_bin",
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: Number(process.env.SESSION_TTL_MS || 30 * 24 * 3600 * 1000),
};

module.exports = { pool, ping, sessionOptions, cfg };
