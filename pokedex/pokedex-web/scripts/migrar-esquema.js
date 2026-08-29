"use strict";
/* Ejecuta db/schema.sql contra la base configurada en .env.
   Es idempotente (todo es CREATE TABLE IF NOT EXISTS): puedes correrlo varias
   veces sin romper nada.   Uso:  npm run migrar                              */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { cfg } = require("../src/db");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  let conn;
  try{
    conn = await mysql.createConnection({ ...cfg, multipleStatements: true, connectionLimit: undefined });
    await conn.query(sql);

    /* Migraciones de columnas para instalaciones que ya existían.
       MySQL no admite ADD COLUMN IF NOT EXISTS, así que consultamos primero. */
    const columnas = [
      ["pokedex_entries", "wants_alt",
       "ALTER TABLE pokedex_entries ADD COLUMN wants_alt TINYINT(1) NOT NULL DEFAULT 0 AFTER set_name"],
    ];
    for (const [tabla, columna, ddl] of columnas){
      const [r] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [tabla, columna]);
      if (!r[0].n){ await conn.query(ddl); console.log(`  + columna ${tabla}.${columna} añadida`); }
    }

    /* Seed de carpetas ESPECIALES: cada usuario debe tener su carpeta Pokédex
       y su carpeta AR/SAR en el lienzo. Su interior sigue leyendo
       pokedex_entries / rare_entries; aquí solo creamos la tarjeta del lienzo.
       INSERT ... SELECT + NOT EXISTS lo hace idempotente y multiusuario. */
    const especiales = [
      ["pokedex", "Pokédex Nacional", "#ef4444"],
      ["rares",   "Illustration Rares", "#a855f7"],
    ];
    for (const [kind, name, color] of especiales){
      const [r] = await conn.query(
        `INSERT INTO folders (owner_id, name, color, kind, sort_order)
         SELECT u.id, ?, ?, ?, 0 FROM users u
         WHERE NOT EXISTS (
           SELECT 1 FROM folders f WHERE f.owner_id = u.id AND f.kind = ?
         )`, [name, color, kind, kind]);
      if (r.affectedRows) console.log(`  + carpeta especial '${kind}' creada para ${r.affectedRows} usuario(s)`);
    }

    const [t] = await conn.query("SHOW TABLES");
    console.log("✔ Esquema aplicado. Tablas:", t.map(r => Object.values(r)[0]).join(", "));
  }catch(e){
    console.error("✖ No se pudo aplicar el esquema:", e.message);
    process.exitCode = 1;
  }finally{
    if (conn) await conn.end();
  }
})();
