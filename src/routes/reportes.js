const express = require('express');
const router = express.Router();
const db = require('../db');

// Filtro de fechas reutilizable
function filtroFechas(desde, hasta) {
  const cond = [], params = [];
  if (desde) { cond.push('v.fecha >= ?'); params.push(desde + ' 00:00:00'); }
  if (hasta) { cond.push('v.fecha <= ?'); params.push(hasta + ' 23:59:59'); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

// Página principal de reportes
router.get('/', (req, res) => {
  res.render('reportes/index', { titulo: 'Reportes' });
});

// Reporte general para la editorial (por libro)
router.get('/editorial', async (req, res) => {
  const { desde, hasta } = req.query;
  // Ahora puede llegar uno o varios libros; lo normalizamos a arreglo
  let librosSel = req.query.libro_id || [];
  if (!Array.isArray(librosSel)) librosSel = [librosSel];
  librosSel = librosSel.filter(x => x); // quita vacíos

  const { where, params } = filtroFechas(desde, hasta);
  const [librosLista] = await db.query('SELECT id, titulo FROM libros WHERE activo = 1 ORDER BY titulo');

  // Filtro por libros seleccionados (IN con tantos signos ? como libros)
  let cond = where, condParams = [...params];
  if (librosSel.length > 0) {
    const marcadores = librosSel.map(() => '?').join(', ');
    cond = cond ? cond + ` AND l.id IN (${marcadores})` : `WHERE l.id IN (${marcadores})`;
    condParams.push(...librosSel);
  }

  const [filas] = await db.query(`
    SELECT l.titulo, l.precio, l.margen_papeleria, l.cantidad_entregada,
           COUNT(vi.id)            AS unidades,
           SUM(vi.precio)          AS total_cobrado,
           SUM(l.margen_papeleria) AS total_margen
    FROM venta_items vi
    JOIN libros l ON l.id = vi.libro_id
    JOIN ventas v ON v.id = vi.venta_id
    ${cond}
    GROUP BY l.id
    ORDER BY l.titulo
  `, condParams);

  let tCobrado = 0, tMargen = 0, tUnidades = 0;
  filas.forEach(f => {
    f.total_editorial = Number(f.total_cobrado) - Number(f.total_margen);
    f.restantes = Number(f.cantidad_entregada) - Number(f.unidades);
    tCobrado += Number(f.total_cobrado);
    tMargen  += Number(f.total_margen);
    tUnidades += Number(f.unidades);
  });

  res.render('reportes/editorial', {
    titulo: 'Reporte general (editorial)', filas, desde, hasta,
    librosLista, librosSel: librosSel.map(String),
    totales: { cobrado: tCobrado, margen: tMargen, unidades: tUnidades, editorial: tCobrado - tMargen }
  });
});

// Reporte de comisiones por maestro (resumen)
router.get('/maestros', async (req, res) => {
  const { desde, hasta } = req.query;
  const { where, params } = filtroFechas(desde, hasta);
  const [filas] = await db.query(`
    SELECT m.id, m.nombre_completo,
           COUNT(vi.id) AS libros_vendidos,
           COUNT(DISTINCT CONCAT(v.alumno_nombre,'|',v.grado,'|',v.grupo)) AS alumnos
    FROM venta_items vi
    JOIN maestros m ON m.id = vi.maestro_id
    JOIN ventas v   ON v.id = vi.venta_id
    ${where}
    GROUP BY m.id
    ORDER BY m.nombre_completo
  `, params);
  res.render('reportes/maestros', { titulo: 'Comisiones por maestro', filas, desde, hasta });
});

// Detalle de un maestro: qué alumnos compraron su libro
router.get('/maestros/:id', async (req, res) => {
  const { desde, hasta } = req.query;
  const { where, params } = filtroFechas(desde, hasta);
  const [mfilas] = await db.query('SELECT * FROM maestros WHERE id = ?', [req.params.id]);
  if (mfilas.length === 0) return res.redirect('/reportes/maestros');
  const cond = where ? where + ' AND vi.maestro_id = ?' : 'WHERE vi.maestro_id = ?';
  const [items] = await db.query(`
    SELECT v.alumno_nombre, v.grado, v.grupo, v.turno, v.fecha,
           l.titulo AS libro, l.comision_maestro
    FROM venta_items vi
    JOIN ventas v ON v.id = vi.venta_id
    JOIN libros l ON l.id = vi.libro_id
    ${cond}
    ORDER BY v.alumno_nombre, l.titulo
  `, [...params, req.params.id]);
  res.render('reportes/maestro_detalle', { titulo: 'Detalle de maestro', maestro: mfilas[0], items, desde, hasta });
});

module.exports = router;