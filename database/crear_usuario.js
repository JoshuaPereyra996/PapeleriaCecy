require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function crearUsuario() {
  const [, , nombre, usuario, password] = process.argv;
  if (!nombre || !usuario || !password) {
    console.log('Uso: node database/crear_usuario.js "Nombre Completo" usuario contraseña');
    process.exit(1);
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO usuarios (nombre, usuario, password_hash) VALUES (?, ?, ?)',
      [nombre, usuario, hash]
    );
    console.log(`Usuario "${usuario}" creado correctamente.`);
  } catch (error) {
    console.error('Error al crear el usuario:', error.message);
  } finally {
    process.exit();
  }
}

crearUsuario();