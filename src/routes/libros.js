const express = require('express');
const router = express.Router();
const db = require('../db');

function aArreglo(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

router.get('/', async (req, res) => {
  const [libros] = await db.query(`
    SELECT l.*,
           GROUP_CONCAT(m.nombre_completo ORDER BY m.nombre_completo SEPARATOR ', ') AS maestros
    FROM libros l
    LEFT JOIN libro_maestro lm ON lm.libro_id = l.id
    LEFT JOIN maestros m ON m.id = lm.maestro_id AND m.activo = 1
    WHERE l.activo = 1
    GROUP BY l.id
    ORDER BY l.titulo
  `);
  res.render('libros/index', { titulo: 'Libros', libros });
});

router.get('/nuevo', async (req, res) => {
  const [maestros] = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
  res.render('libros/form', { titulo: 'Nuevo libro', libro: null, maestros, asignados: [], error: null });
});

router.post('/', async (req, res) => {
  const { titulo, autor, precio, cantidad_entregada } = req.body;
  const grado = req.body.grado ? Number(req.body.grado) : null;   // vacío = sin clasificar
  const maestrosSel = aArreglo(req.body.maestros);
  try {
    const [resultado] = await db.query(
      'INSERT INTO libros (titulo, autor, precio, cantidad_entregada, grado) VALUES (?, ?, ?, ?, ?)',
      [titulo, autor, precio, cantidad_entregada || 0, grado]
    );
    const libroId = resultado.insertId;
    for (const maestroId of maestrosSel) {
      await db.query('INSERT INTO libro_maestro (libro_id, maestro_id) VALUES (?, ?)', [libroId, maestroId]);
    }
    res.redirect('/libros');
  } catch (error) {
    console.error(error);
    const [maestros] = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
    res.render('libros/form', { titulo: 'Nuevo libro', libro: req.body, maestros, asignados: maestrosSel, error: 'No se pudo guardar el libro' });
  }
});

router.get('/:id/editar', async (req, res) => {
  const [filas] = await db.query('SELECT * FROM libros WHERE id = ?', [req.params.id]);
  if (filas.length === 0) return res.redirect('/libros');
  const [maestros] = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
  const [rel] = await db.query('SELECT maestro_id FROM libro_maestro WHERE libro_id = ?', [req.params.id]);
  const asignados = rel.map(r => String(r.maestro_id));
  res.render('libros/form', { titulo: 'Editar libro', libro: filas[0], maestros, asignados, error: null });
});

router.post('/:id', async (req, res) => {
  const { titulo, autor, precio, cantidad_entregada } = req.body;
  const grado = req.body.grado ? Number(req.body.grado) : null;   // vacío = sin clasificar
  const maestrosSel = aArreglo(req.body.maestros);
  try {
    await db.query(
      'UPDATE libros SET titulo = ?, autor = ?, precio = ?, cantidad_entregada = ?, grado = ? WHERE id = ?',
      [titulo, autor, precio, cantidad_entregada || 0, grado, req.params.id]
    );
    await db.query('DELETE FROM libro_maestro WHERE libro_id = ?', [req.params.id]);
    for (const maestroId of maestrosSel) {
      await db.query('INSERT INTO libro_maestro (libro_id, maestro_id) VALUES (?, ?)', [req.params.id, maestroId]);
    }
    res.redirect('/libros');
  } catch (error) {
    console.error(error);
    const [maestros] = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
    res.render('libros/form', { titulo: 'Editar libro', libro: { ...req.body, id: req.params.id }, maestros, asignados: maestrosSel, error: 'No se pudo actualizar' });
  }
});

router.post('/:id/eliminar', async (req, res) => {
  await db.query('UPDATE libros SET activo = 0 WHERE id = ?', [req.params.id]);
  res.redirect('/libros');
});

module.exports = router;