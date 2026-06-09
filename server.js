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

// Motor de vistas EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');


// Archivos estáticos y lectura de formularios
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

// Hace que el usuario logueado esté disponible en todas las vistas
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  next();
});

// --- Autenticación ---
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { titulo: 'Iniciar sesión', error: null });
});

app.post('/login', async (req, res) => {
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Tablero principal
app.get('/', requireLogin, (req, res) => {
  res.render('index', { titulo: 'Inicio' });
});

// Rutas de catálogos (protegidas con login)
app.use('/libros', requireLogin, librosRouter);
app.use('/maestros', requireLogin, maestrosRouter);
app.use('/ventas', requireLogin, ventasRouter);
app.use('/reportes', requireLogin, reportesRouter);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});