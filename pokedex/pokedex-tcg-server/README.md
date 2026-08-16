# Pokédex TCG · API Gateway

Middleware entre `pokedex-tcg-alpha.html` y los proveedores de datos de cartas.

## Arrancar

Las dependencias ya vienen instaladas y el `.env` ya está creado con `PROVIDER=pokemontcg`:

```bash
cd pokedex-tcg-server
npm start
```

Abre después `pokedex-tcg-alpha.html`. Detecta el gateway sola: abajo a la derecha
debe decir **gateway · pokemontcg.io** en verde. Si el servidor no está corriendo,
dice **directo · pokemontcg.io** en ámbar y la app sigue funcionando sin backend.

Requiere Node 18 o superior (usa `fetch` nativo).

## Por qué existe

| Problema | Sin gateway | Con gateway |
|---|---|---|
| 502 de Cloudflare en pokemontcg.io | "Failed to fetch" en pantalla | Se reintenta aquí; si está cacheado, invisible |
| Recargar la página | Vuelve a pedir todo el catálogo | Sirve desde caché en memoria |
| API key de Scrydex | Visible en el HTML | Nunca sale del servidor |
| Catálogo AR/SAR | 19 peticiones desde el navegador | 1 petición al gateway |

## Cambiar a Scrydex

Scrydex es el sucesor oficial de pokemontcg.io. **No tiene capa gratuita**: exige
plan de pago (desde 29 USD/mes por 5.000 créditos), API key y Team ID.

Cuando te suscribas, en `.env`:

```
PROVIDER=scrydex
SCRYDEX_API_KEY=tu_key
SCRYDEX_TEAM_ID=tu_team_id
```

Reinicia el servidor. **El frontend no cambia ni una línea**: el adaptador
traduce la respuesta de Scrydex a la misma forma canónica.

| | pokemontcg.io | Scrydex |
|---|---|---|
| base | `api.pokemontcg.io/v2` | `api.scrydex.com/pokemon/v1` |
| auth | opcional | `X-Api-Key` + `X-Team-ID` obligatorios |
| expansión | `set` | `expansion` |
| nº Pokédex | `nationalPokedexNumbers` | `national_pokedex_numbers` |
| fecha | `set.releaseDate` | `expansion.release_date` |
| imágenes | objeto `{small,large}` | array `[{type,small,medium,large}]` |
| página máx. | 250 | 100 |
| idiomas | solo inglés | inglés + japonés (filtramos `language:english`) |

Ojo con los créditos: cargar el catálogo AR/SAR completo consume ~19 créditos la
primera vez y 0 después durante 12 horas gracias a la caché.

## Endpoints

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/health` | proveedor activo, estado de credenciales y caché |
| GET | `/api/pokemon` | listado nacional completo `[{id,name}]` |
| GET | `/api/pokemon/:id` | nombre (es/en), sprite y artwork |
| GET | `/api/expansions?series=` | expansiones normalizadas |
| GET | `/api/cards/pokemon/:nationalId` | cartas de esa especie |
| GET | `/api/cards/illustration-rares?series=&refresh=1` | catálogo AR/SAR + `failed[]` |
| DELETE | `/api/cache` | vacía la caché |

Forma canónica de carta que devuelven todos los endpoints:

```json
{
  "id": "sv8-238",
  "name": "Pikachu ex",
  "number": "238",
  "rarity": "Special Illustration Rare",
  "artist": "PLANETA Mochizuki",
  "types": ["Lightning"],
  "dex": [25],
  "images": { "small": "...", "large": "..." },
  "set": { "id": "sv8", "name": "Surging Sparks", "series": "Scarlet & Violet", "releaseDate": "2024/11/08" }
}
```

## Notas de la fase ALPHA

- `cors()` acepta cualquier origen. Antes de exponer esto fuera de tu máquina,
  restringe `origin` a tu dominio.
- La caché es en memoria: reiniciar el servidor la vacía. Para que sobreviva,
  cambia `node-cache` por Redis (mismo API de `get`/`set`).
- Si una expansión falla, la respuesta de `illustration-rares` la lista en
  `failed[]` y sólo se cachea 2 minutos, para que el reintento sirva de algo.
