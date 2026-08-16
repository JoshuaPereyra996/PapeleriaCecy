"use strict";
/* ============================================================================
   Proveedores de datos de cartas, intercambiables por PROVIDER en .env.
   Ambos normalizan a la misma forma canónica:

     { id, name, number, rarity, artist, types[], dex[],
       images:{small,large}, set:{id,name,series,releaseDate} }
   ========================================================================== */

const RETRIES = Number(process.env.RETRIES || 5);
const BACKOFF = Number(process.env.BACKOFF_MS || 700);
const RARITIES = ["Illustration Rare", "Special Illustration Rare"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* pokemontcg.io va tras Cloudflare y devuelve 502 por rachas; reintentamos. */
async function fetchJSON(url, headers = {}){
  let lastErr;
  for (let i = 0; i < RETRIES; i++){
    try{
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok){
        const e = new Error(`HTTP ${r.status} ${(await r.text().catch(()=> "")).slice(0,200)}`);
        e.status = r.status; throw e;                 // 4xx: reintentar no sirve
      }
      return await r.json();
    }catch(e){
      lastErr = e;
      if (e.status && e.status < 500) break;
      if (i === RETRIES - 1) break;
      await sleep(Math.round(BACKOFF * 2 ** i * (0.75 + Math.random() * 0.5)));
    }
  }
  throw lastErr;
}

const pokemontcg = {
  name: "pokemontcg.io",
  base: "https://api.pokemontcg.io/v2",
  select: "id,name,number,rarity,artist,images,set,nationalPokedexNumbers,types",
  headers(){ return process.env.POKEMONTCG_API_KEY ? {"X-Api-Key": process.env.POKEMONTCG_API_KEY} : {}; },

  normalize(c){
    return {
      id: c.id, name: c.name, number: c.number, rarity: c.rarity, artist: c.artist || "",
      types: c.types || [], dex: c.nationalPokedexNumbers || [],
      images: { small: (c.images||{}).small || "", large: (c.images||{}).large || "" },
      set: { id: (c.set||{}).id || "", name: (c.set||{}).name || "",
             series: (c.set||{}).series || "", releaseDate: (c.set||{}).releaseDate || "" },
    };
  },
  async expansions(){
    const j = await fetchJSON(`${this.base}/sets?pageSize=250&select=id,name,series,releaseDate`, this.headers());
    return (j.data||[]).map(s => ({id:s.id, name:s.name, series:s.series, releaseDate:s.releaseDate}));
  },
  async raresByExpansion(setId){
    const q = `set.id:${setId} (${RARITIES.map(r => `rarity:"${r}"`).join(" OR ")})`;
    const j = await fetchJSON(`${this.base}/cards?q=${encodeURIComponent(q)}&pageSize=250&orderBy=number&select=${this.select}`, this.headers());
    return (j.data||[]).map(c => this.normalize(c));
  },
  async cardsByDex(dexId){
    const j = await fetchJSON(`${this.base}/cards?q=${encodeURIComponent(`nationalPokedexNumbers:${dexId}`)}`
      + `&pageSize=250&orderBy=-set.releaseDate,number&select=${this.select}`, this.headers());
    return (j.data||[]).map(c => this.normalize(c));
  },
};

const scrydex = {
  name: "scrydex.com",
  base: "https://api.scrydex.com/pokemon/v1",
  select: "id,name,number,rarity,artist,images,expansion,national_pokedex_numbers,types",
  headers(){
    const k = process.env.SCRYDEX_API_KEY, t = process.env.SCRYDEX_TEAM_ID;
    if (!k || !t) throw new Error("Faltan SCRYDEX_API_KEY / SCRYDEX_TEAM_ID en .env");
    return { "X-Api-Key": k, "X-Team-ID": t };
  },

  normalize(c){
    const f = (c.images||[]).find(i => i.type === "front") || (c.images||[])[0] || {};
    const e = c.expansion || {};
    return {
      id: c.id, name: c.name, number: c.number, rarity: c.rarity, artist: c.artist || "",
      types: c.types || [], dex: c.national_pokedex_numbers || [],
      images: { small: f.small || f.medium || "", large: f.large || f.medium || "" },
      set: { id: e.id||"", name: e.name||"", series: e.series||"", releaseDate: e.release_date||"" },
    };
  },
  async page(path, params, maxPages = 30){          // page_size tope 100 → paginamos
    const out = [];
    for (let page = 1; page <= maxPages; page++){
      const qs = new URLSearchParams({...params, page: String(page), page_size: "100"});
      const j = await fetchJSON(`${this.base}${path}?${qs}`, this.headers());
      const d = j.data || []; out.push(...d);
      if (!d.length || out.length >= (j.totalCount ?? j.total_count ?? out.length)) break;
    }
    return out;
  },
  async expansions(){
    const d = await this.page("/expansions", {q:"language:english", select:"id,name,series,release_date", orderBy:"release_date"});
    return d.map(s => ({id:s.id, name:s.name, series:s.series, releaseDate:s.release_date}));
  },
  async raresByExpansion(expId){
    const d = await this.page(`/expansions/${encodeURIComponent(expId)}/cards`, {
      q: `language:english (${RARITIES.map(r => `rarity:"${r}"`).join(" OR ")})`,
      orderBy: "number", select: this.select,
    });
    return d.map(c => this.normalize(c));
  },
  async cardsByDex(dexId){
    const d = await this.page("/cards", {
      q: `national_pokedex_numbers:${dexId} language:english`,
      orderBy: "-expansion.release_date,number", select: this.select,
    }, 5);
    return d.map(c => this.normalize(c));
  },
};

const ALL = { pokemontcg, scrydex };

function current(){
  const k = (process.env.PROVIDER || "pokemontcg").toLowerCase();
  const p = ALL[k];
  if (!p) throw new Error(`PROVIDER "${k}" desconocido. Usa: ${Object.keys(ALL).join(" | ")}`);
  return p;
}

module.exports = { current, fetchJSON, ALL, RARITIES };
