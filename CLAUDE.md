# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start

# Create a Papelería user (required to log in at /papeleria)
node database/crear_usuario.js "Nombre Completo" usuario contraseña

# Create a Pokédex user (required to log in at /pokedex)
cd pokedex/pokedex-web && node scripts/crear-usuario.js "Nombre" usuario contraseña
```

There is no test suite, lint config, or build step — this is a plain server-rendered EJS app.

## Environment variables (.env)

A single root `.env` is loaded once (`require('dotenv').config()` in `server.js`) and shared by both apps — the Pokédex sub-router reads `process.env` directly without its own `dotenv.config()` call, so it must never be run standalone in this repo without the root env already loaded.

```
# ── Compartidas ────────────────────────────────────────────────────────────
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
SESSION_SECRET=          # mínimo 32 caracteres, usada por ambas apps

# ── Papelería ───────────────────────────────────────────────────────────────
MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=
MAIL_FROM=
NEGOCIO_NOMBRE=

# ── Pokédex ─────────────────────────────────────────────────────────────────
NODE_ENV=production
BASE_PATH=/pokedex
SESSION_TTL_MS=2592000000
DB_POOL=5
PROVIDER=pokemontcg      # o "scrydex"
POKEMONTCG_API_KEY=      # opcional; sin key funciona con límites menores
SCRYDEX_API_KEY=
SCRYDEX_TEAM_ID=
```

## Database setup

Both apps use the **same MySQL database** — table names don't conflict.

**Papelería** — run in order:

1. `database/schema.sql` — initial tables (`usuarios`, `libros`, `maestros`, `ventas`)
2. `database/mejoras_v2.sql` — restructures ventas into `ventas` (header) + `venta_items` (lines); adds `libro_maestro` many-to-many table
3. `database/mejoras_v3.sql` — adds `comision_maestro` column to `libros`
4. `database/cambiosBase2.sql`, `database/datos_prueba.sql` — further changes / optional seed data

**Pokédex** — run in the same database:

5. `pokedex/pokedex-web/db/schema.sql` — tables: `users`, `pokedex_entries`, `rare_entries`, `sessions`

## Repo layout — two apps, two git repos

`pokedex/pokedex-web/` is a **separate git project** (its own `.git`), developed independently and vendored into this repo as a subtree, not a submodule reference. When editing Pokédex code, be aware changes live in a different repo history than the rest of the project (untracked from the outer repo's point of view unless explicitly added).

## Sub-path architecture (www.moiras.tech/papeleria + /pokedex)

`server.js` is the single Hostinger Node entry point (`app.listen`). It mounts two independent apps under one Express instance:

- `app.use('/papeleria', papeleriaApp)` — the bookstore app, defined inline in `server.js` (routes, session, view engine all set up there)
- `app.use('/pokedex', crearPokedex({ basePath: '/pokedex' }))` — Pokédex, mounted via a **router factory** exported from `pokedex/pokedex-web/src/pokedex.js` (`module.exports = function createPokedex(opts)`), not a full sub-app — it returns an `express.Router()`, so there's no separate `app.listen()` to worry about for this half
- `GET /` redirects to `/papeleria`
- `app.set('trust proxy', 1)` is required — Hostinger sits behind a proxy, and without it secure cookies never get sent, which sends the Pokédex login into a redirect loop

**Session isolation**: each half has its own session middleware and cookie name (`connect.sid` default for Papelería vs `pokedex.sid` for Pokédex, `cookie.path` scoped to `/pokedex`), so logging into one does not affect the other.

**Key pattern — redirect auto-prefix (Papelería only)**: `papeleriaApp` has a middleware that:
1. Captures `req.baseUrl` (`'/papeleria'`) at mount time
2. Exposes it as `res.locals.base` for use in EJS templates (`<%= base %>`)
3. Patches `res.redirect` so any `res.redirect('/foo')` inside any route automatically becomes `res.redirect('/papeleria/foo')` — no changes needed in route files

The Pokédex router does the equivalent manually — every internal redirect is written as `res.redirect(basePath + '/...')` rather than relying on middleware patching.

## Architecture (Papelería)

Four routers under `src/routes/`, all mounted with `requireLogin` session middleware (`src/middleware/auth.js`).

**Data model (current state after all migrations):**
- `libros` — books with `precio`, `margen_papeleria`, `comision_maestro`, `cantidad_entregada`
- `maestros` — teachers
- `libro_maestro` — many-to-many between books and teachers (which teacher sells which book)
- `ventas` — sale header (student info, grade, group, shift, specialty)
- `venta_items` — sale line items (`venta_id`, `libro_id`, `maestro_id`, `precio`)
- `usuarios` — system users with bcrypt-hashed passwords

**Routes:**
- `/libros` — CRUD for books; also manages `libro_maestro` assignments
- `/maestros` — CRUD for teachers
- `/ventas` — register/edit/delete sales; a sale is saved by replacing all its `venta_items` (delete + reinsert) rather than diffing; supports optional email ticket via nodemailer; detail view shows a plain-text receipt
- `/reportes` — two reports: `editorial` (sales per book with margin breakdown, filterable by date range and book) and `maestros` (commissions per teacher with student counts and a per-teacher drilldown)

**Views:** EJS with `express-ejs-layouts`. All views extend `src/views/partials/layout.ejs`. Views live under `src/views/<module>/`.

**Pattern for updates vs. deletes:** Soft-delete (set `activo = 0`) for `libros` and `maestros`, so historical sales/reports keep working. Hard delete for `ventas` (cascades to `venta_items`).

**Email:** Nodemailer transporter is created once at module load in `src/routes/ventas.js`. Ticket sending on a new sale is best-effort — a failure is logged but does not roll back the sale.

## Architecture (Pokédex)

`pokedex/pokedex-web/src/pokedex.js` exports a factory (`createPokedex(opts)`) returning an `express.Router()` — the whole app (auth, static files, JSON API, security headers) is self-contained in that one file, mountable at any base path.

- **Auth**: `bcryptjs` + `express-session` backed by a MySQL session store (`express-mysql-session`, table `sessions`), rate-limited login (`express-rate-limit`, 10 attempts/15 min/IP), session regenerated on login to prevent fixation, timing-safe login (always runs `bcrypt.compare` even for unknown usernames).
- **Data model**: `pokedex_entries` (one row per national dex slot the user owns, `dex_id` 1–65535) and `rare_entries` (owned "illustration rare" cards, keyed by `card_id` with a condition grade `NM/LP/MP/HP/DMG`) — both scoped by `user_id`. `PUT`/`DELETE` on `/api/collection/pokedex/:dexId` and `/api/collection/rares/:cardId` are the mutation surface; `/api/collection/import` bulk-loads a JSON backup (same shape the old localStorage-only version exported) inside a transaction.
- **Card data providers**: `src/providers.js` abstracts over two upstream card catalogs — `pokemontcg.io` (default) and `scrydex` — selected at runtime via `PROVIDER` env var, both normalized to the same shape. Species list comes from PokéAPI directly. All provider responses are cached in-process (`node-cache`) with an in-flight de-dupe map (`cached()` in `pokedex.js`) so concurrent requests for the same key share one upstream call.
- **CSP**: `helmet` is configured with an explicit `img-src`/`connect-src` allowlist for the card-image CDNs and API hosts in use — extend that list rather than relaxing the policy if a new provider/host is added.
- Can also run standalone via `pokedex/pokedex-web/index.js` (`npm start`/`npm run dev` inside that directory), but in this repo it's always mounted as a sub-router from the root `server.js`.
