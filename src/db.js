const mysql = require('mysql2');

/* Zona horaria del negocio. El centro de México es UTC-6 fijo: el país eliminó
   el horario de verano en 2022, así que no hay que ajustarla dos veces al año.
   Se puede sobreescribir con DB_TIMEZONE en el .env. */
const ZONA = /^[+-]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || '')
  ? process.env.DB_TIMEZONE
  : '-06:00';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  /* Devuelve los DATETIME como texto 'YYYY-MM-DD HH:MM:SS', tal cual están en
     la base. Sin esto mysql2 los convierte a Date interpretándolos en la zona
     del proceso Node (en Hostinger, UTC), y la hora del ticket se corría. */
  dateStrings: true
});

/* Cada conexión nueva del pool fija la zona de la sesión, para que
   CURRENT_TIMESTAMP escriba la hora del centro de México y no la del servidor. */
pool.on('connection', (conexion) => {
  conexion.query('SET time_zone = ?', [ZONA], (error) => {
    // Algunos hostings no traen cargadas las tablas de zonas horarias; con el
    // desfase numérico ('-06:00') no hace falta, pero si fallara no se debe
    // tumbar la conexión: solo se avisa.
    if (error) console.error('No se pudo fijar la zona horaria de MySQL:', error.message);
  });
});

module.exports = pool.promise();
