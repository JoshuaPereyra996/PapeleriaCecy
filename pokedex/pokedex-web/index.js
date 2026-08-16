"use strict";
/* ============================================================================
   Arranque independiente. Úsalo para desarrollo local o si decides desplegar
   la Pokédex en un subdominio propio (pokedex.tudominio.com).

   Si en cambio la vas a montar dentro de tu app Node.js existente, NO uses
   este archivo: en tu app pon

       const crearPokedex = require("./pokedex-web/src/pokedex");
       app.use("/pokedex", crearPokedex());
   ========================================================================== */
require("dotenv").config();

const express = require("express");
const crearPokedex = require("./src/pokedex");
const { ping } = require("./src/db");

const PORT      = Number(process.env.PORT || 3000);
const BASE_PATH = process.env.BASE_PATH || "/pokedex";

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32){
  console.error("✖ SESSION_SECRET falta o es demasiado corto (mínimo 32 caracteres).");
  console.error("  Genera uno con:  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);          // vamos detrás del proxy de Hostinger

app.use(BASE_PATH, crearPokedex({ basePath: BASE_PATH }));
app.get("/", (_req, res) => res.redirect(BASE_PATH + "/"));

(async () => {
  try{
    await ping();
    console.log("✔ Conexión a MySQL correcta");
  }catch(e){
    console.error("✖ No se pudo conectar a MySQL:", e.message);
    console.error("  Revisa DB_HOST / DB_USER / DB_PASSWORD / DB_NAME en .env");
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`✔ Pokédex TCG en http://localhost:${PORT}${BASE_PATH}/`);
    console.log(`  Proveedor de cartas: ${(process.env.PROVIDER || "pokemontcg")}`);
  });
})();
