const express = require('express');
const router = express.Router();
const db = require('../db');

function aArreglo(valor) {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// Listado (sin la columna de libros apilados; solo el conteo)
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  let where = '', params = [];
  if (q) { where = 'WHERE v.alumno_nombre LIKE ?'; params.push('%' + q + '%'); }
  const [ventas] = await db.query(`
    SELECT v.*, COUNT(vi.id) AS num_libros
    FROM ventas v
    LEFT JOIN venta_items vi ON vi.venta_id = v.id
    ${where}
    GROUP BY v.id
    ORDER BY v.fecha DESC
  `, params);
  res.render('ventas/index', { titulo: 'Ventas', ventas, q });
});

// Formulario para NUEVA venta
router.get('/nueva', async (req, res) => {
  const datos = await datosFormulario();
  res.render('ventas/form', { titulo: 'Registrar venta', ...datos, venta: null, items: [], totalAnterior: 0, error: null });
});

// Guardar nueva venta
router.post('/', async (req, res) => {
  await guardarVenta(req, res, null);
});

// Formulario de CORRECCIÓN (debe ir antes de '/:id')
router.get('/:id/editar', async (req, res) => {
  const [vfilas] = await db.query('SELECT * FROM ventas WHERE id = ?', [req.params.id]);
  if (vfilas.length === 0) return res.redirect('/ventas');
  const [items] = await db.query('SELECT libro_id, maestro_id, precio FROM venta_items WHERE venta_id = ?', [req.params.id]);
  const datos = await datosFormulario();
  res.render('ventas/form', {
    titulo: 'Corrección de venta', ...datos,
    venta: vfilas[0], items, totalAnterior: Number(vfilas[0].total), error: null
  });
});

// DETALLE de una venta
router.get('/:id', async (req, res) => {
  const [vfilas] = await db.query('SELECT * FROM ventas WHERE id = ?', [req.params.id]);
  if (vfilas.length === 0) return res.redirect('/ventas');
  const [items] = await db.query(`
    SELECT vi.precio, l.titulo AS libro, m.nombre_completo AS maestro
    FROM venta_items vi
    JOIN libros l   ON l.id = vi.libro_id
    JOIN maestros m ON m.id = vi.maestro_id
    WHERE vi.venta_id = ?
  `, [req.params.id]);
  res.render('ventas/detalle', { titulo: 'Detalle de venta', venta: vfilas[0], items });
});

// Guardar corrección
router.post('/:id', async (req, res) => {
  await guardarVenta(req, res, req.params.id);
});

router.post('/:id/eliminar', async (req, res) => {
  await db.query('DELETE FROM ventas WHERE id = ?', [req.params.id]);
  res.redirect('/ventas');
});

// --- Auxiliares ---
async function datosFormulario() {
  const [libros]     = await db.query('SELECT id, titulo, precio FROM libros WHERE activo = 1 ORDER BY titulo');
  const [maestros]   = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
  const [relaciones] = await db.query('SELECT libro_id, maestro_id FROM libro_maestro');
  return { libros, maestros, relaciones };
}

async function guardarVenta(req, res, ventaId) {
  const { alumno_nombre, grado, grupo, turno, especialidad } = req.body;
  const libroIds   = aArreglo(req.body.libro_id);
  const maestroIds = aArreglo(req.body.maestro_id);
  const esCorreccion = ventaId !== null;
  try {
    const lineas = [];
    for (let i = 0; i < libroIds.length; i++) {
      if (libroIds[i] && maestroIds[i]) lineas.push({ libro_id: libroIds[i], maestro_id: maestroIds[i] });
    }
    if (lineas.length === 0) throw new Error('Debes dejar al menos un libro. Si es un reembolso total, usa "Eliminar venta".');

    let total = 0;
    for (const linea of lineas) {
      const [f] = await db.query('SELECT precio FROM libros WHERE id = ?', [linea.libro_id]);
      linea.precio = f[0].precio;
      total += Number(f[0].precio);
    }

    if (esCorreccion) {
      await db.query(
        'UPDATE ventas SET alumno_nombre=?, grado=?, grupo=?, turno=?, especialidad=?, total=? WHERE id=?',
        [alumno_nombre, grado, grupo, turno, especialidad, total, ventaId]
      );
      await db.query('DELETE FROM venta_items WHERE venta_id = ?', [ventaId]);
      for (const l of lineas) {
        await db.query('INSERT INTO venta_items (venta_id, libro_id, maestro_id, precio) VALUES (?, ?, ?, ?)', [ventaId, l.libro_id, l.maestro_id, l.precio]);
      }
      res.redirect('/ventas/' + ventaId);
    } else {
      const [resVenta] = await db.query(
        'INSERT INTO ventas (alumno_nombre, grado, grupo, turno, especialidad, total, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [alumno_nombre, grado, grupo, turno, especialidad, total, req.session.usuario.id]
      );
      for (const l of lineas) {
        await db.query('INSERT INTO venta_items (venta_id, libro_id, maestro_id, precio) VALUES (?, ?, ?, ?)', [resVenta.insertId, l.libro_id, l.maestro_id, l.precio]);
      }
      res.redirect('/ventas');
    }
  } catch (error) {
    console.error(error);
    const datos = await datosFormulario();
    const itemsPrevios = [];
    for (let i = 0; i < libroIds.length; i++) {
      if (libroIds[i]) itemsPrevios.push({ libro_id: libroIds[i], maestro_id: maestroIds[i] || '' });
    }
    res.render('ventas/form', {
      titulo: esCorreccion ? 'Corrección de venta' : 'Registrar venta', ...datos,
      venta: esCorreccion ? { id: ventaId, alumno_nombre, grado, grupo, turno, especialidad } : null,
      items: itemsPrevios,
      totalAnterior: Number(req.body.total_anterior || 0),
      error: error.message || 'No se pudo guardar la venta'
    });
  }
}

module.exports = router;