require('dotenv').config();
const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./src/db');
const { requireLogin } = require('./src/middleware/auth');
const librosRouter = require('./src/routes/libros');
const maestrosRouter = require('./src/routes/maestros');
const ventasRouter = require('./src/routes/ventas');
const reportesRouter = require('./src/routes/reportes');

const app = express();
const PORT = process.env.PORT || 3000;

// Hostinger pone la app detrás de un proxy; sin esto las cookies "secure"
// no se envían y el login de la Pokédex entra en bucle de redirecciones.
app.set("trust proxy", 1);

// Raíz → Papelería
app.get('/', (req, res) => res.redirect('/papeleria'));

// ─── SUB-APP: PAPELERÍA (/papeleria) ────────────────────────────────────────
const papeleriaApp = express();

papeleriaApp.set('view engine', 'ejs');
papeleriaApp.set('views', path.join(__dirname, 'src/views'));
papeleriaApp.use(expressLayouts);
papeleriaApp.set('layout', 'partials/layout');
papeleriaApp.use(express.static(path.join(__dirname, 'public')));

// Sesión y body parser solo para /papeleria — la Pokédex tiene su propia sesión
papeleriaApp.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
papeleriaApp.use(express.urlencoded({ extended: true }));

// Inyecta `base` en vistas y parcha res.redirect para que siempre incluya el
// prefijo de montaje (/papeleria), independientemente de qué router lo llame.
papeleriaApp.use((req, res, next) => {
  const base = req.baseUrl; // '/papeleria' — capturado aquí antes de que Express
                            // lo sobreescriba al delegar a routers hijos
  res.locals.usuario = req.session.usuario || null;
  res.locals.base = base;

  const _redirect = res.redirect.bind(res);
  res.redirect = function (statusOrUrl, url) {
    if (url === undefined) {
      url = statusOrUrl;
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith(base)) {
        url = base + url;
      }
      return _redirect.call(res, url);
    }
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith(base)) {
      url = base + url;
    }
    return _redirect.call(res, statusOrUrl, url);
  };
  next();
});

// Autenticación
papeleriaApp.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { titulo: 'Iniciar sesión', error: null });
});

papeleriaApp.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const [filas] = await db.query(
      'SELECT * FROM usuarios WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    if (filas.length === 0) {
      return res.render('login', { titulo: 'Iniciar sesión', error: 'Usuario o contraseña incorrectos' });
    }
    const user = filas[0];
    const coincide = await bcrypt.compare(password, user.password_hash);
    if (!coincide) {
      return res.render('login', { titulo: 'Iniciar sesión', error: 'Usuario o contraseña incorrectos' });
    }
    req.session.usuario = { id: user.id, nombre: user.nombre, usuario: user.usuario };
    res.redirect('/');
  } catch (error) {
    console.error('Error en login:', error);
    res.render('login', { titulo: 'Iniciar sesión', error: 'Ocurrió un error, intenta de nuevo' });
  }
});

papeleriaApp.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

papeleriaApp.get('/', requireLogin, (req, res) => {
  res.render('index', { titulo: 'Inicio' });
});

papeleriaApp.use('/libros', requireLogin, librosRouter);
papeleriaApp.use('/maestros', requireLogin, maestrosRouter);
papeleriaApp.use('/ventas', requireLogin, ventasRouter);
papeleriaApp.use('/reportes', requireLogin, reportesRouter);

app.use('/papeleria', papeleriaApp);

// ─── SUB-APP: POKÉDEX (/pokedex) ────────────────────────────────────────────
// La Pokédex exporta un factory que devuelve un Express Router, con su propia
// sesión (cookie "pokedex.sid"), helmet y base de datos. No interfiere con la
// sesión de la Papelería.
const crearPokedex = require('./pokedex/pokedex-web/src/pokedex');
app.use('/pokedex', crearPokedex({ basePath: '/pokedex' }));

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`  Papelería → http://localhost:${PORT}/papeleria`);
  console.log(`  Pokédex   → http://localhost:${PORT}/pokedex`);
});
