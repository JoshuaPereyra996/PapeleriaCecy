/* ============================================================================
   POKÉDEX TCG · API Gateway
   ---------------------------------------------------------------------------
   Middleware entre el frontend y los proveedores de datos de cartas.
   Resuelve tres problemas que el navegador no puede resolver solo:

     1. La API key de Scrydex nunca sale del servidor.
     2. Caché en memoria: pokemontcg.io/Scrydex se consultan una vez cada
        varias horas, no en cada recarga de la página.
     3. Los 502 intermitentes de Cloudflare se reintentan aquí; si el catálogo
        ya está cacheado, el usuario ni se entera de que el proveedor cayó.

   Proveedores intercambiables vía PROVIDER en .env:
     - pokemontcg  (gratis, sin key, con cortes)   ← por defecto
     - scrydex     (sucesor oficial, requiere plan de pago + key + team id)

   Ambos devuelven al frontend EXACTAMENTE la misma forma de carta, así que
   cambiar de proveedor no toca una sola línea del frontend.
   ========================================================================== */
"use strict";

require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const NodeCache = require("node-cache");

const PORT      = Number(process.env.PORT || 3001);
const PROVIDER  = (process.env.PROVIDER || "pokemontcg").toLowerCase();
const RETRIES   = Number(process.env.RETRIES || 5);
const BACKOFF   = Number(process.env.BACKOFF_MS || 700);

/* TTLs en segundos. Las expansiones y las cartas casi nunca cambian;
   lo que cambia son los precios, que aquí no pedimos. */
const TTL = {
  pokemon    : 30 * 24 * 3600,
  expansions : 24 * 3600,
  cards      : 24 * 3600,
  rares      : 12 * 3600,
};

const cache = new NodeCache({ stdTTL: TTL.cards, checkperiod: 600, useClones: false });
const inflight = new Map();          // colapsa peticiones idénticas simultáneas

const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- fetch -- */
/* Reintenta 5xx y errores de red con backoff exponencial + jitter.
   pokemontcg.io devuelve 502 de Cloudflare por rachas de varios minutos. */
async function fetchJSON(url, headers = {}){
  let lastErr;
  for (let i = 0; i < RETRIES; i++){
    try{
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok){
        const body = await r.text().catch(() => "");
        const err = new Error(`HTTP ${r.status} ${body.slice(0,200)}`);
        err.status = r.status;
        throw err;                                    // 4xx: no tiene sentido reintentar
      }
      return await r.json();
    }catch(e){
      lastErr = e;
      if (e.status && e.status < 500) break;
      if (i === RETRIES - 1) break;
      const wait = Math.round(BACKOFF * 2 ** i * (0.75 + Math.random() * 0.5));
      log(`  reintento ${i+1}/${RETRIES} en ${wait}ms — ${e.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/* Cachea por clave y colapsa llamadas concurrentes al mismo recurso */
async function cached(key, ttl, producer){
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try{
      const v = await producer();
      cache.set(key, v, ttl);
      return v;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/* ============================================================================
   PROVEEDORES
   Cada uno expone expansions() y raresByExpansion() y cardsByDex(),
   normalizando su respuesta a la forma canónica:

     { id, name, number, rarity, artist, types[], dex[],
       images:{ small, large },
       set:{ id, name, series, releaseDate } }
   ========================================================================== */
const RARITIES = ["Illustration Rare", "Special Illustration Rare"];

/* --------------------------------------------------------- pokemontcg.io -- */
const pokemontcg = {
  name: "pokemontcg.io",
  base: "https://api.pokemontcg.io/v2",
  headers(){ return process.env.POKEMONTCG_API_KEY ? {"X-Api-Key": process.env.POKEMONTCG_API_KEY} : {}; },

  normalize(c){
    return {
      id: c.id, name: c.name, number: c.number, rarity: c.rarity, artist: c.artist || "",
      types: c.types || [], dex: c.nationalPokedexNumbers || [],
      images: { small: (c.images||{}).small || "", large: (c.images||{}).large || "" },
      set: {
        id: (c.set||{}).id || "", name: (c.set||{}).name || "",
        series: (c.set||{}).series || "", releaseDate: (c.set||{}).releaseDate || "",
      },
    };
  },

  async expansions(){
    const j = await fetchJSON(`${this.base}/sets?pageSize=250&select=id,name,series,releaseDate`, this.headers());
    return (j.data || []).map(s => ({
      id: s.id, name: s.name, series: s.series, releaseDate: s.releaseDate,
    }));
  },

  async raresByExpansion(setId){
    const q = `set.id:${setId} (${RARITIES.map(r => `rarity:"${r}"`).join(" OR ")})`;
    const url = `${this.base}/cards?q=${encodeURIComponent(q)}&pageSize=250&orderBy=number`
              + `&select=id,name,number,rarity,artist,images,set,nationalPokedexNumbers,types`;
    return (await fetchJSON(url, this.headers())).data?.map(c => this.normalize(c)) || [];
  },

  async cardsByDex(dexId){
    const url = `${this.base}/cards?q=${encodeURIComponent(`nationalPokedexNumbers:${dexId}`)}`
              + `&pageSize=250&orderBy=-set.releaseDate,number`
              + `&select=id,name,number,rarity,artist,images,set,nationalPokedexNumbers,types`;
    return (await fetchJSON(url, this.headers())).data?.map(c => this.normalize(c)) || [];
  },
};

/* ---------------------------------------------------------------- scrydex -- */
/* Diferencias respecto a pokemontcg.io:
     · base            /pokemon/v1  en api.scrydex.com
     · auth            X-Api-Key + X-Team-ID  (obligatorios, no hay tier gratis)
     · set             se llama  expansion
     · nationalPokedexNumbers → national_pokedex_numbers
     · set.releaseDate → expansion.release_date
     · images          es un ARRAY de {type,small,medium,large}, no un objeto
     · page_size       máximo 100 (antes 250) → hay que paginar
     · idiomas         incluye japonés; filtramos language:english               */
const scrydex = {
  name: "scrydex.com",
  base: "https://api.scrydex.com/pokemon/v1",
  headers(){
    const k = process.env.SCRYDEX_API_KEY, t = process.env.SCRYDEX_TEAM_ID;
    if (!k || !t) throw new Error("Faltan SCRYDEX_API_KEY / SCRYDEX_TEAM_ID en .env");
    return { "X-Api-Key": k, "X-Team-ID": t };
  },

  normalize(c){
    const front = (c.images || []).find(i => i.type === "front") || (c.images || [])[0] || {};
    const e = c.expansion || {};
    return {
      id: c.id, name: c.name, number: c.number, rarity: c.rarity, artist: c.artist || "",
      types: c.types || [], dex: c.national_pokedex_numbers || [],
      images: { small: front.small || front.medium || "", large: front.large || front.medium || "" },
      set: { id: e.id || "", name: e.name || "", series: e.series || "", releaseDate: e.release_date || "" },
    };
  },

  /* page_size tope 100 → paginamos hasta agotar totalCount */
  async page(path, params, maxPages = 30){
    const out = [];
    for (let page = 1; page <= maxPages; page++){
      const qs = new URLSearchParams({ ...params, page: String(page), page_size: "100" });
      const j  = await fetchJSON(`${this.base}${path}?${qs}`, this.headers());
      const d  = j.data || [];
      out.push(...d);
      const total = j.totalCount ?? j.total_count ?? out.length;
      if (!d.length || out.length >= total) break;
    }
    return out;
  },

  async expansions(){
    const d = await this.page("/expansions", {
      q: "language:english", select: "id,name,series,release_date", orderBy: "release_date",
    });
    return d.map(s => ({ id: s.id, name: s.name, series: s.series, releaseDate: s.release_date }));
  },

  async raresByExpansion(expId){
    const d = await this.page(`/expansions/${encodeURIComponent(expId)}/cards`, {
      q: `language:english (${RARITIES.map(r => `rarity:"${r}"`).join(" OR ")})`,
      orderBy: "number",
      select: "id,name,number,rarity,artist,images,expansion,national_pokedex_numbers,types",
    });
    return d.map(c => this.normalize(c));
  },

  async cardsByDex(dexId){
    const d = await this.page("/cards", {
      q: `national_pokedex_numbers:${dexId} language:english`,
      orderBy: "-expansion.release_date,number",
      select: "id,name,number,rarity,artist,images,expansion,national_pokedex_numbers,types",
    }, 5);
    return d.map(c => this.normalize(c));
  },
};

const PROVIDERS = { pokemontcg, scrydex };
const api = PROVIDERS[PROVIDER];
if (!api){
  console.error(`PROVIDER "${PROVIDER}" desconocido. Usa: ${Object.keys(PROVIDERS).join(" | ")}`);
  process.exit(1);
}

/* ============================================================================
   SERVIDOR
   ========================================================================== */
const app = express();
app.use(cors());                       // ALPHA local; en producción restringir origin
app.use((req, _res, next) => { log(req.method, req.originalUrl); next(); });

const fail = (res, e, code = 502) =>
  res.status(e.status && e.status < 500 ? e.status : code)
     .json({ error: e.message || "error del proveedor", provider: api.name });

/* --- salud + diagnóstico ------------------------------------------------- */
app.get("/api/health", (_req, res) => {
  const credsOk = PROVIDER !== "scrydex" || !!(process.env.SCRYDEX_API_KEY && process.env.SCRYDEX_TEAM_ID);
  res.json({
    ok: true, provider: api.name, providerKey: PROVIDER, credentialsConfigured: credsOk,
    cache: { keys: cache.keys().length, ...cache.getStats() },
    uptime: Math.round(process.uptime()),
  });
});

/* --- GET /api/pokemon/:id  → nombre, número e imagen base (PokéAPI) ------- */
app.get("/api/pokemon/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "id inválido" });
  try{
    const data = await cached(`pokemon:${id}`, TTL.pokemon, async () => {
      const j = await fetchJSON(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
      const es = (j.names || []).find(n => n.language.name === "es");
      return {
        id,
        name: j.name,
        name_es: es ? es.name : j.name,
        sprite:  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
        artwork: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
      };
    });
    res.json({ data });
  }catch(e){ fail(res, e); }
});

/* --- GET /api/pokemon  → listado nacional completo ------------------------ */
app.get("/api/pokemon", async (_req, res) => {
  try{
    const data = await cached("species:all", TTL.pokemon, async () => {
      const j = await fetchJSON("https://pokeapi.co/api/v2/pokemon-species?limit=20000");
      return (j.results || [])
        .map(r => ({ id: Number(r.url.split("/").filter(Boolean).pop()), name: r.name }))
        .filter(p => p.id < 10000)
        .sort((a, b) => a.id - b.id);
    });
    res.json({ data, count: data.length });
  }catch(e){ fail(res, e); }
});

/* --- GET /api/expansions[?series=] --------------------------------------- */
app.get("/api/expansions", async (req, res) => {
  try{
    let data = await cached("expansions", TTL.expansions, () => api.expansions());
    if (req.query.series) data = data.filter(s => s.series === req.query.series);
    res.json({ data, provider: api.name });
  }catch(e){ fail(res, e); }
});

/* --- GET /api/cards/pokemon/:nationalId ---------------------------------- */
app.get("/api/cards/pokemon/:nationalId", async (req, res) => {
  const id = Number(req.params.nationalId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "id inválido" });
  try{
    const data = await cached(`cards:dex:${id}`, TTL.cards, () => api.cardsByDex(id));
    res.json({ data, count: data.length, provider: api.name });
  }catch(e){ fail(res, e); }
});

/* --- GET /api/cards/illustration-rares[?series=&refresh=1] ---------------- */
/* Recorre las expansiones de la serie una por una. Si alguna falla, NO tumba
   la respuesta: se devuelve lo que sí se pudo traer más la lista de fallos,
   y el frontend ofrece reintentar sólo esas.                                */
app.get("/api/cards/illustration-rares", async (req, res) => {
  const series = req.query.series || "Scarlet & Violet";
  const key = `rares:${series}`;
  if (req.query.refresh === "1") cache.del(key);
  try{
    const payload = await cached(key, TTL.rares, async () => {
      const all  = await cached("expansions", TTL.expansions, () => api.expansions());
      const sets = all.filter(s => s.series === series);
      const cards = [], failed = [];
      for (const s of sets){
        try{
          const part = await cached(`rares:set:${s.id}`, TTL.rares, () => api.raresByExpansion(s.id));
          cards.push(...part);
        }catch(e){
          log(`  expansión omitida ${s.id}: ${e.message}`);
          failed.push({ id: s.id, name: s.name });
        }
      }
      cards.sort((a, b) =>
        a.set.releaseDate !== b.set.releaseDate
          ? (a.set.releaseDate < b.set.releaseDate ? -1 : 1)
          : (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));
      return { data: cards, failed, expansions: sets.length, series };
    });
    // si quedaron expansiones sin traer, no lo dejamos cacheado 12 h
    if (payload.failed.length) cache.ttl(key, 120);
    res.json({ ...payload, provider: api.name });
  }catch(e){ fail(res, e); }
});

/* --- DELETE /api/cache ---------------------------------------------------- */
app.delete("/api/cache", (_req, res) => { cache.flushAll(); res.json({ ok: true, flushed: true }); });

app.use((_req, res) => res.status(404).json({ error: "endpoint no encontrado" }));

app.listen(PORT, () => {
  log(`Pokédex TCG gateway escuchando en http://localhost:${PORT}`);
  log(`Proveedor: ${api.name} (PROVIDER=${PROVIDER})`);
  if (PROVIDER === "scrydex" && !(process.env.SCRYDEX_API_KEY && process.env.SCRYDEX_TEAM_ID))
    log("⚠  Faltan SCRYDEX_API_KEY / SCRYDEX_TEAM_ID en .env — las peticiones fallarán.");
});
