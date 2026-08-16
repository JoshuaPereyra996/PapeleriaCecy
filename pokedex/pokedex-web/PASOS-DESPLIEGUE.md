# Pokédex TCG en `www.tudominio.com/pokedex` — pasos de despliegue

## Antes de empezar: dos restricciones de Hostinger

**1. Node.js sólo existe en Business y Cloud.** Los planes Premium y Single no
lo incluyen. Si tu plan es Premium, tendrás que subir a Business antes de nada.
Como ya corres una app Node.js en el dominio, es probable que estés bien.

**2. No se puede montar una app Node.js en un subdirectorio desde hPanel.** La
documentación de Hostinger lo dice sin rodeos: *"Node.js websites must be
deployed as a new website"*. Cada app Node = un sitio = un dominio o subdominio.
No hay campo para poner `/pokedex`.

Por eso la Pokédex está construida como **router de Express montable**, no como
servidor independiente. La montas dentro de la app Node.js que ya tienes en el
dominio y obtienes la URL exacta que querías, con un solo despliegue.

> Si prefirieras `pokedex.tudominio.com` en vez de `/pokedex`, el proyecto
> también arranca solo con `node index.js` — sería un segundo sitio en hPanel.
> El resto de estos pasos aplica igual.

---

## Paso 1 · Crear la base de datos

hPanel → **Bases de datos** → **Administración de bases de datos MySQL**.

1. Crea una base, por ejemplo `pokedex`. Hostinger le antepondrá tu prefijo:
   queda como `u123456789_pokedex`.
2. Crea un usuario con contraseña larga y asígnale **todos los permisos** sobre
   esa base.
3. Apunta los cuatro datos: nombre de base, usuario, contraseña y host.
   Desde la app el host es `localhost`.

## Paso 2 · Crear las tablas

hPanel → **phpMyAdmin** → elige tu base → pestaña **SQL**.

Pega el contenido completo de `db/schema.sql` y ejecútalo. Crea cuatro tablas:
`users`, `pokedex_entries`, `rare_entries` y `sessions`. Es idempotente: puedes
volver a ejecutarlo sin romper nada.

> **Si ya tenías las tablas creadas de antes**, el `CREATE TABLE IF NOT EXISTS`
> no añade columnas nuevas. Ejecuta además esto una vez, para el LED rojo de
> "busco alterna":
>
> ```sql
> ALTER TABLE pokedex_entries
>   ADD COLUMN wants_alt TINYINT(1) NOT NULL DEFAULT 0 AFTER set_name,
>   ADD INDEX idx_pokedex_wants_alt (user_id, wants_alt);
> ```
>
> Con acceso local a la base, `npm run migrar` detecta y aplica esto solo.

## Paso 3 · Crear tu usuario

En hosting compartido **no se pueden ejecutar comandos npm por SSH**, así que
esto se hace desde tu computadora:

```bash
cd pokedex-web
npm install
node scripts/generar-hash.js joshua
```

Te pide la contraseña (mínimo 10 caracteres, no se muestra al teclearla) y
escupe un `INSERT` con el hash bcrypt. Pégalo en phpMyAdmin → SQL.

La contraseña en claro nunca sale de tu máquina ni queda en el historial.

## Paso 4 · Colocar la Pokédex dentro de tu proyecto

Copia la carpeta `pokedex-web/` completa dentro del repositorio de tu app
Node.js actual:

```
tu-proyecto/
├── package.json          ← el de tu app
├── app.js                ← tu servidor
└── pokedex-web/
    ├── src/  public/  db/  scripts/
```

**Fusiona las dependencias.** Hostinger ejecuta `npm install` sólo en el
`package.json` de la raíz; un `package.json` anidado se ignora. Añade estas al
tuyo (si ya tienes `express`, déjalo como esté):

```json
"bcryptjs": "^2.4.3",
"express-mysql-session": "^3.0.3",
"express-rate-limit": "^7.4.0",
"express-session": "^1.18.0",
"helmet": "^7.1.0",
"mysql2": "^3.11.0",
"node-cache": "^5.1.2"
```

Todas son JavaScript puro: no compilan nada nativo, que es justo lo que suele
fallar en hosting compartido. Por eso `bcryptjs` y no `bcrypt`.

## Paso 5 · Montar el router (3 líneas)

En tu app principal, **antes** de cualquier middleware que capture rutas
desconocidas (404, catch-all, `app.get("*")`):

```js
app.set("trust proxy", 1);                                    // ← imprescindible

const crearPokedex = require("./pokedex-web/src/pokedex");
app.use("/pokedex", crearPokedex({ basePath: "/pokedex" }));
```

Tienes el ejemplo completo en `EJEMPLO-app-principal.js`.

`trust proxy` no es opcional: Hostinger sirve tu app detrás de un proxy y, sin
esa línea, Express cree que la conexión es HTTP, no manda la cookie marcada como
`secure` y el login entra en un bucle de redirecciones.

## Paso 6 · Variables de entorno

hPanel → tu sitio → **Environment Variables**. En el servidor no se usa el
archivo `.env`; se cargan aquí.

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `BASE_PATH` | `/pokedex` — debe coincidir con el `app.use()` |
| `SESSION_SECRET` | 64 caracteres aleatorios, ver abajo |
| `DB_HOST` | `localhost` |
| `DB_NAME` | `u123456789_pokedex` |
| `DB_USER` | tu usuario MySQL |
| `DB_PASSWORD` | su contraseña |
| `PROVIDER` | `pokemontcg` |

Genera el secreto de sesión así:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Si cambias ese valor después, todas las sesiones abiertas se invalidan.

## Paso 7 · Desplegar

hPanel → tu sitio Node.js → despliegue por **GitHub** (recomendado: cada push
redespliega) o subiendo un **.zip**.

- Entry file: el de tu app, `app.js` o `index.js`
- Versión de Node: 18, 20, 22 o 24

Asegúrate de que `.env` **no** viaje en el repositorio ni en el zip. El
`.gitignore` incluido ya lo excluye.

## Paso 8 · Comprobar

1. Abre `www.tudominio.com/pokedex` → debe llevarte a la pantalla de login.
2. Entra con tu usuario. Deberías ver la Pokédex y tu nombre arriba.
3. Registra una carta y **recarga la página**: si sigue ahí, la base de datos
   está funcionando.
4. Confírmalo en phpMyAdmin: `SELECT * FROM pokedex_entries;`
5. Pulsa **Salir** y vuelve a `/pokedex`: debe pedirte contraseña otra vez.

Si algo falla, hPanel → tu sitio → **Deployments** → log de despliegue, y los
`console.error` del servidor salen en los logs de runtime.

---

## Migrar lo que ya tenías

Si registraste cartas en la versión local (localStorage):

1. Abre el archivo viejo → pestaña **Datos** → **Exportar colección**.
2. En la versión desplegada → pestaña **Datos** → **Importar colección**.
3. Te pregunta si reemplazar o fusionar.

El formato JSON es idéntico al de antes, así que los respaldos antiguos sirven.

---

## Qué protege esto, y qué no

**Sí cubre:**

- Contraseñas con bcrypt (coste 12). En la base sólo hay hashes.
- Cookie de sesión `httpOnly` (JavaScript no la puede leer, así que un XSS no
  te roba la sesión), `sameSite=lax` (corta CSRF desde otros dominios),
  `secure` en producción y `path=/pokedex` (no viaja al resto de tu sitio).
- Regeneración del id de sesión al entrar, contra fijación de sesión.
- Límite de 10 intentos de login por IP cada 15 minutos.
- Comparación bcrypt aunque el usuario no exista, para que el tiempo de
  respuesta no revele qué nombres están dados de alta.
- Todas las consultas SQL con parámetros preparados.
- Cabeceras de seguridad vía helmet, con CSP acotada a los dominios de imágenes
  que la app necesita.
- Los endpoints de cartas exigen sesión: nadie más gasta tus créditos de API.
- La página de login lleva `noindex, nofollow`.

**No cubre, y conviene tenerlo presente:**

- No hay 2FA ni recuperación de contraseña. Si la pierdes, regeneras el hash
  con el script del paso 3.
- No hay registro público: los usuarios se crean a mano por diseño.
- Las sesiones caducan a los 30 días (`SESSION_TTL_MS`).
- La caché de cartas es en memoria: al reiniciar la app se vacía y el primer
  usuario que entre pagará la recarga del catálogo.
- Si algún día abres el registro a más gente, harán falta verificación por
  correo y una política de contraseñas más estricta.

---

## Desarrollo en tu computadora

```bash
cd pokedex-web
cp .env.example .env     # rellena SESSION_SECRET y los datos de MySQL
npm install
npm start                # http://localhost:3000/pokedex/
```

Para apuntar a la base de datos real de Hostinger desde tu máquina: hPanel →
Bases de datos → **MySQL remoto** → añade tu IP pública, y pon `DB_HOST` con el
host remoto que te dé el panel. Recuerda quitar la IP cuando termines.

Con `.env` local sí funciona `npm run crear-usuario` y `npm run migrar`.
