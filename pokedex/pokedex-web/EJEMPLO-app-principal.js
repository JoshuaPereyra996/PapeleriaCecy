"use strict";
/* ============================================================================
   CÓMO MONTAR LA POKÉDEX EN TU APP NODE.JS EXISTENTE
   ---------------------------------------------------------------------------
   Este archivo es sólo un ejemplo de referencia: NO se ejecuta ni se despliega.
   Copia las tres líneas marcadas a tu app real.

   Resultado:  www.tudominio.com/pokedex
   ========================================================================== */

require("dotenv").config();
const express = require("express");
const app = express();

// ── IMPORTANTE ──────────────────────────────────────────────────────────────
// Hostinger sirve tu app detrás de un proxy. Sin esto, las cookies "secure"
// no se envían y el login entra en un bucle de redirecciones.
app.set("trust proxy", 1);

/* ---------------------------------------------------------- tu sitio actual */
app.get("/", (req, res) => res.send("Mi página personal"));
// ...el resto de tus rutas, tal cual las tengas hoy...

/* ------------------------------------------------- ① MONTAR LA POKÉDEX ---- */
const crearPokedex = require("./pokedex-web/src/pokedex");   // ② ruta a la carpeta
app.use("/pokedex", crearPokedex({ basePath: "/pokedex" }));  // ③ punto de montaje

/* Notas:
   · La Pokédex trae su propio express.json(), su propia sesión y su propio
     helmet, todos limitados a este router. No tocan el resto de tu sitio.
   · La cookie de sesión se emite con path=/pokedex, así que no viaja en las
     peticiones al resto de tu página.
   · Si tu app ya usa express-session para otra cosa, no hay conflicto: los
     nombres de cookie son distintos (la Pokédex usa "pokedex.sid").
   · Si montas en otra ruta, cambia BASE_PATH en las variables de entorno para
     que coincida. Deben ser iguales.
*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Escuchando en " + PORT));
