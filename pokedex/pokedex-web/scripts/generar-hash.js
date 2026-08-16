"use strict";
/* ============================================================================
   Genera el hash bcrypt de tu contraseña y el INSERT listo para pegar en
   phpMyAdmin. NO toca la base de datos ni necesita .env.

   Existe porque en el hosting compartido de Hostinger no se pueden ejecutar
   comandos npm por SSH, así que "npm run crear-usuario" no sirve en el
   servidor. Este script lo corres en TU computadora.

       node scripts/generar-hash.js joshua

   La contraseña se teclea a mano: no la pases como argumento o quedará
   guardada en el historial del shell.
   ========================================================================== */
const bcrypt = require("bcryptjs");
const { preguntar, cerrar } = require("./preguntar");
const preguntarOculto = t => preguntar(t, true);

(async () => {
  try{
    const username = (process.argv[2] || "").trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,64}$/.test(username))
      throw new Error("Uso: node scripts/generar-hash.js <usuario>   (3-64 caracteres: a-z 0-9 . _ -)");

    const p1 = await preguntarOculto("Contraseña: ");
    if (p1.length < 10) throw new Error("Usa al menos 10 caracteres.");
    const p2 = await preguntarOculto("Repite la contraseña: ");
    if (p1 !== p2) throw new Error("Las contraseñas no coinciden.");

    const hash = await bcrypt.hash(p1, 12);

    console.log("\n─────────────────────────────────────────────────────────────");
    console.log("Pega esto en hPanel → Bases de datos → phpMyAdmin → pestaña SQL:\n");
    console.log(`INSERT INTO users (username, password_hash)`);
    console.log(`VALUES ('${username}', '${hash}')`);
    console.log(`ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash);`);
    console.log("\n─────────────────────────────────────────────────────────────");
    console.log("El hash NO es la contraseña: no se puede revertir. Si lo pierdes,");
    console.log("vuelve a correr este script y ejecuta el INSERT otra vez.");
  }catch(e){
    console.error("✖", e.message);
    process.exitCode = 1;
  }finally{
    cerrar();
  }
})();
