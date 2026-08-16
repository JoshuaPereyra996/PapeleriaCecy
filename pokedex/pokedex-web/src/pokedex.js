"use strict";
/* ============================================================================
   POKÉDEX TCG · router Express montable
   ---------------------------------------------------------------------------
   Se usa de dos formas:

   A) Dentro de tu app Node.js existente (te da www.tudominio.com/pokedex):
        const pokedex = require("./pokedex-web/src/pokedex");
        app.use("/pokedex", pokedex());

   B) Como app independiente (subdominio o desarrollo local):
        node index.js

   Todo lo que sirve —HTML, API de cartas y API de colección— cuelga del punto
   de montaje, así que el mismo código funciona en cualquier ruta base.
   ========================================================================== */

const path       = require("path");
const express    = require("express");
const session    = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt     = require("bcryptjs");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const NodeCache  = require("node-cache");

const { pool, sessionOptions } = require("./db");
const providers = require("./providers");

const TTL = { pokemon: 30*24*3600, expansions: 24*3600, cards: 24*3600, rares: 12*3600 };
const cache = new NodeCache({ stdTTL: TTL.cards, checkperiod: 600, useClones: false });
const inflight = new Map();

async function cached(key, ttl, producer){
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { const v = await producer(); cache.set(key, v, ttl); return v; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

module.exports = function createPokedex(opts = {}){
  const basePath = opts.basePath || process.env.BASE_PATH || "/pokedex";
  const isProd   = process.env.NODE_ENV === "production";
  const router   = express.Router();

  /* ------------------------------------------------------------ seguridad -- */
  router.use(helmet({
    // La app carga imágenes de PokéAPI/pokemontcg/scrydex y usa estilos inline
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", "data:", "https://raw.githubusercontent.com",
                     "https://images.pokemontcg.io", "https://images.scrydex.com"],
        connectSrc: ["'self'", "https://pokeapi.co", "https://api.pokemontcg.io"],
        objectSrc:  ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  router.use(express.json({ limit: "2mb" }));   // el import de colección puede pesar

  const store = new MySQLStore(sessionOptions, pool);
  router.use(session({
    name: "pokedex.sid",
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      path: basePath || "/",        // la cookie no se manda al resto del sitio
      httpOnly: true,               // inaccesible desde JavaScript
      sameSite: "lax",              // corta CSRF desde otros dominios
      secure: isProd,               // solo por HTTPS en producción
      maxAge: Number(process.env.SESSION_TTL_MS || 30*24*3600*1000),
    },
  }));

  /* Freno de fuerza bruta: 10 intentos por IP cada 15 min */
  const loginLimiter = rateLimit({
    windowMs: 15*60*1000, limit: 10,
    standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Demasiados intentos. Espera 15 minutos." },
  });

  const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: "no autenticado" });
  };

  /* ============================== AUTENTICACIÓN ============================ */
  router.post("/api/login", loginLimiter, async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ error: "faltan credenciales" });
    try{
      const [rows] = await pool.execute(
        "SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1", [username]);
      const user = rows[0];

      // Comparamos siempre, exista o no el usuario, para no filtrar por tiempo
      // de respuesta qué nombres están dados de alta.
      const hash = user ? user.password_hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
      const ok = await bcrypt.compare(password, hash);
      if (!user || !ok) return res.status(401).json({ error: "usuario o contraseña incorrectos" });

      // Evita fijación de sesión: id nuevo tras autenticar
      req.session.regenerate(err => {
        if (err) return res.status(500).json({ error: "no se pudo iniciar sesión" });
        req.session.userId = user.id;
        req.session.username = user.username;
        pool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]).catch(()=>{});
        req.session.save(() => res.json({ ok: true, user: { username: user.username } }));
      });
    }catch(e){
      console.error("login:", e.message);
      res.status(500).json({ error: "error del servidor" });
    }
  });

  router.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("pokedex.sid", { path: basePath || "/" });
      res.json({ ok: true });
    });
  });

  router.get("/api/me", (req, res) => {
    if (req.session && req.session.userId) return res.json({ user: { username: req.session.username } });
    res.status(401).json({ error: "no autenticado" });
  });

  /* ============================== COLECCIÓN =============================== */
  /* Se devuelve con la MISMA forma que usaba localStorage, así el frontend
     casi no cambia y los respaldos .json antiguos siguen siendo importables. */
  router.get("/api/collection", requireAuth, async (req, res) => {
    try{
      const uid = req.session.userId;
      const [pk] = await pool.execute(
        "SELECT dex_id, card_id, card_name, card_image, set_name, wants_alt, updated_at FROM pokedex_entries WHERE user_id = ?", [uid]);
      const [rr] = await pool.execute(
        "SELECT card_id, card_condition, updated_at FROM rare_entries WHERE user_id = ?", [uid]);

      const pokedex_tcg = {}, illustration_rares = {};
      const day = d => (d instanceof Date ? d.toISOString().slice(0,10) : String(d || "").slice(0,10));
      for (const r of pk) pokedex_tcg[r.dex_id] = {
        owned: true, card_id: r.card_id, card_name: r.card_name,
        card_image: r.card_image, set_name: r.set_name,
        wants_alt: !!r.wants_alt, updated_at: day(r.updated_at),
      };
      for (const r of rr) illustration_rares[r.card_id] = {
        owned: true, condition: r.card_condition, updated_at: day(r.updated_at),
      };
      res.json({ pokedex_tcg, illustration_rares });
    }catch(e){
      console.error("collection:", e.message);
      res.status(500).json({ error: "no se pudo leer la colección" });
    }
  });

  const S = (v, max) => String(v ?? "").slice(0, max);

  router.put("/api/collection/pokedex/:dexId", requireAuth, async (req, res) => {
    const dex = Number(req.params.dexId);
    const cardId = S(req.body.card_id, 64);
    if (!Number.isInteger(dex) || dex < 1 || dex > 65535) return res.status(400).json({ error: "dex_id inválido" });
    if (!cardId) return res.status(400).json({ error: "card_id requerido" });
    try{
      await pool.execute(
        `INSERT INTO pokedex_entries (user_id, dex_id, card_id, card_name, card_image, set_name)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE card_id=VALUES(card_id), card_name=VALUES(card_name),
                                 card_image=VALUES(card_image), set_name=VALUES(set_name)`,
        [req.session.userId, dex, cardId, S(req.body.card_name,128), S(req.body.card_image,255), S(req.body.set_name,128)]);
      res.json({ ok: true });
    }catch(e){ console.error(e.message); res.status(500).json({ error: "no se pudo guardar" }); }
  });

  /* Marca "la tengo, pero busco otra versión" (arte alterno / rareza distinta).
     Va aparte del PUT que asigna la carta: son dos gestos distintos y así
     reasignar la carta no borra la marca. */
  router.put("/api/collection/pokedex/:dexId/alt", requireAuth, async (req, res) => {
    const dex = Number(req.params.dexId);
    if (!Number.isInteger(dex) || dex < 1 || dex > 65535) return res.status(400).json({ error: "dex_id inválido" });
    const flag = req.body.wants_alt ? 1 : 0;
    try{
      const [r] = await pool.execute(
        "UPDATE pokedex_entries SET wants_alt = ? WHERE user_id = ? AND dex_id = ?",
        [flag, req.session.userId, dex]);
      // Sin carta asignada no hay alterna que buscar
      if (!r.affectedRows) return res.status(404).json({ error: "ese slot no tiene carta asignada" });
      res.json({ ok: true, wants_alt: !!flag });
    }catch(e){ console.error(e.message); res.status(500).json({ error: "no se pudo guardar" }); }
  });

  router.delete("/api/collection/pokedex/:dexId", requireAuth, async (req, res) => {
    const dex = Number(req.params.dexId);
    if (!Number.isInteger(dex)) return res.status(400).json({ error: "dex_id inválido" });
    try{
      await pool.execute("DELETE FROM pokedex_entries WHERE user_id = ? AND dex_id = ?", [req.session.userId, dex]);
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: "no se pudo borrar" }); }
  });

  const CONDITIONS = ["NM","LP","MP","HP","DMG"];
  router.put("/api/collection/rares/:cardId", requireAuth, async (req, res) => {
    const cardId = S(req.params.cardId, 64);
    const cond = CONDITIONS.includes(req.body.condition) ? req.body.condition : "NM";
    if (!cardId) return res.status(400).json({ error: "card_id requerido" });
    try{
      await pool.execute(
        `INSERT INTO rare_entries (user_id, card_id, card_condition) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE card_condition = VALUES(card_condition)`,
        [req.session.userId, cardId, cond]);
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: "no se pudo guardar" }); }
  });

  router.delete("/api/collection/rares/:cardId", requireAuth, async (req, res) => {
    try{
      await pool.execute("DELETE FROM rare_entries WHERE user_id = ? AND card_id = ?",
        [req.session.userId, S(req.params.cardId, 64)]);
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: "no se pudo borrar" }); }
  });

  /* Importar un respaldo .json (el mismo formato que exportaba la versión local) */
  router.post("/api/collection/import", requireAuth, async (req, res) => {
    const pk = req.body.pokedex_tcg || {}, rr = req.body.illustration_rares || {};
    const uid = req.session.userId;
    const conn = await pool.getConnection();
    try{
      await conn.beginTransaction();
      if (req.body.replace){
        await conn.execute("DELETE FROM pokedex_entries WHERE user_id = ?", [uid]);
        await conn.execute("DELETE FROM rare_entries   WHERE user_id = ?", [uid]);
      }
      let n = 0;
      for (const [dex, e] of Object.entries(pk)){
        if (!e || !e.owned || !e.card_id) continue;
        const d = Number(dex); if (!Number.isInteger(d) || d < 1 || d > 65535) continue;
        await conn.execute(
          `INSERT INTO pokedex_entries (user_id, dex_id, card_id, card_name, card_image, set_name, wants_alt)
           VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE card_id=VALUES(card_id),
             card_name=VALUES(card_name), card_image=VALUES(card_image),
             set_name=VALUES(set_name), wants_alt=VALUES(wants_alt)`,
          [uid, d, S(e.card_id,64), S(e.card_name,128), S(e.card_image,255), S(e.set_name,128), e.wants_alt ? 1 : 0]);
        n++;
      }
      for (const [cid, e] of Object.entries(rr)){
        if (!e || !e.owned) continue;
        await conn.execute(
          `INSERT INTO rare_entries (user_id, card_id, card_condition) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE card_condition = VALUES(card_condition)`,
          [uid, S(cid,64), CONDITIONS.includes(e.condition) ? e.condition : "NM"]);
        n++;
      }
      await conn.commit();
      res.json({ ok: true, imported: n });
    }catch(e){
      await conn.rollback().catch(()=>{});
      console.error("import:", e.message);
      res.status(500).json({ error: "no se pudo importar" });
    }finally{ conn.release(); }
  });

  /* ============================ CARTAS (gateway) ========================== */
  /* Requieren sesión: no queremos que el mundo consuma nuestros créditos. */
  const api = () => providers.current();
  const fail = (res, e) => res.status(e.status && e.status < 500 ? e.status : 502)
                              .json({ error: e.message || "error del proveedor" });

  router.get("/api/health", (req, res) => {
    const k = (process.env.PROVIDER || "pokemontcg").toLowerCase();
    res.json({
      ok: true, provider: api().name, providerKey: k,
      credentialsConfigured: k !== "scrydex" || !!(process.env.SCRYDEX_API_KEY && process.env.SCRYDEX_TEAM_ID),
      authenticated: !!(req.session && req.session.userId),
      cache: { keys: cache.keys().length },
      basePath,
    });
  });

  router.get("/api/pokemon", requireAuth, async (_req, res) => {
    try{
      const data = await cached("species:all", TTL.pokemon, async () => {
        const j = await providers.fetchJSON("https://pokeapi.co/api/v2/pokemon-species?limit=20000");
        return (j.results||[])
          .map(r => ({ id: Number(r.url.split("/").filter(Boolean).pop()), name: r.name }))
          .filter(p => p.id < 10000).sort((a,b) => a.id - b.id);
      });
      res.json({ data, count: data.length });
    }catch(e){ fail(res, e); }
  });

  router.get("/api/expansions", requireAuth, async (req, res) => {
    try{
      let data = await cached("expansions", TTL.expansions, () => api().expansions());
      if (req.query.series) data = data.filter(s => s.series === req.query.series);
      res.json({ data, provider: api().name });
    }catch(e){ fail(res, e); }
  });

  router.get("/api/cards/pokemon/:nationalId", requireAuth, async (req, res) => {
    const id = Number(req.params.nationalId);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "id inválido" });
    try{
      const data = await cached(`cards:dex:${id}`, TTL.cards, () => api().cardsByDex(id));
      res.json({ data, count: data.length, provider: api().name });
    }catch(e){ fail(res, e); }
  });

  router.get("/api/cards/illustration-rares", requireAuth, async (req, res) => {
    const series = req.query.series || "Scarlet & Violet";
    const key = `rares:${series}`;
    if (req.query.refresh === "1") cache.del(key);
    try{
      const payload = await cached(key, TTL.rares, async () => {
        const all = await cached("expansions", TTL.expansions, () => api().expansions());
        const sets = all.filter(s => s.series === series);
        const cards = [], failed = [];
        for (const s of sets){
          try{
            cards.push(...await cached(`rares:set:${s.id}`, TTL.rares, () => api().raresByExpansion(s.id)));
          }catch(e){ failed.push({ id: s.id, name: s.name }); }
        }
        cards.sort((a,b) => a.set.releaseDate !== b.set.releaseDate
          ? (a.set.releaseDate < b.set.releaseDate ? -1 : 1)
          : (parseInt(a.number,10)||0) - (parseInt(b.number,10)||0));
        return { data: cards, failed, expansions: sets.length, series };
      });
      if (payload.failed.length) cache.ttl(key, 120);   // no cachear 12 h un catálogo incompleto
      res.json({ ...payload, provider: api().name });
    }catch(e){ fail(res, e); }
  });

  /* ================================ VISTAS =============================== */
  const PUBLIC = path.join(__dirname, "..", "public");

  router.get("/login", (req, res) => {
    if (req.session && req.session.userId) return res.redirect(basePath + "/");
    res.sendFile(path.join(PUBLIC, "login.html"));
  });

  router.get("/", (req, res) => {
    // El HTML usa rutas relativas ("api/collection"). Sin la barra final,
    // /pokedex las resolvería contra la raíz del dominio y todo fallaría.
    if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(301, basePath + "/");
    if (!(req.session && req.session.userId)) return res.redirect(basePath + "/login");
    res.sendFile(path.join(PUBLIC, "index.html"));
  });

  // Estáticos (iconos, etc.). index:false para que "/" pase por el guardia de arriba.
  router.use(express.static(PUBLIC, { index: false, maxAge: "1h" }));

  router.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "endpoint no encontrado" });
    res.redirect(basePath + "/");
  });

  return router;
};
