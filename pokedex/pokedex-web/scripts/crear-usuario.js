"use strict";
/* Crea o actualiza tu usuario. La contraseña se pide por teclado y no se
   muestra ni queda en el historial del shell.

   Uso:  npm run crear-usuario -- joshua
*/
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("../src/db");
const { preguntar, cerrar } = require("./preguntar");

(async () => {
  try{
    let username = (process.argv[2] || "").trim().toLowerCase();
    if (!username) username = (await preguntar("Usuario: ")).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,64}$/.test(username))
      throw new Error("El usuario debe tener 3-64 caracteres: letras, números, punto, guion o guion bajo.");

    const pass1 = await preguntar("Contraseña: ", true);
    if (pass1.length < 10) throw new Error("Usa al menos 10 caracteres.");
    const pass2 = await preguntar("Repite la contraseña: ", true);
    if (pass1 !== pass2) throw new Error("Las contraseñas no coinciden.");

    const hash = await bcrypt.hash(pass1, 12);
    const [r] = await pool.execute(
      `INSERT INTO users (username, password_hash) VALUES (?,?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`, [username, hash]);

    console.log(r.affectedRows > 1
      ? `✔ Contraseña actualizada para "${username}".`
      : `✔ Usuario "${username}" creado.`);
  }catch(e){
    console.error("✖", e.message);
    process.exitCode = 1;
  }finally{
    cerrar();
    await pool.end();
  }
})();
