const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const [maestros] = await db.query(`
    SELECT m.*,
           GROUP_CONCAT(l.titulo ORDER BY l.titulo SEPARATOR ', ') AS libros
    FROM maestros m
    LEFT JOIN libro_maestro lm ON lm.maestro_id = m.id
    LEFT JOIN libros l ON l.id = lm.libro_id AND l.activo = 1
    WHERE m.activo = 1
    GROUP BY m.id
    ORDER BY m.nombre_completo
  `);
  res.render('maestros/index', { titulo: 'Maestros', maestros });
});

router.get('/nuevo', (req, res) => {
  res.render('maestros/form', { titulo: 'Nuevo maestro', maestro: null, error: null });
});

router.post('/', async (req, res) => {
  const { nombre_completo } = req.body;
  try {
    await db.query('INSERT INTO maestros (nombre_completo) VALUES (?)', [nombre_completo]);
    res.redirect('/maestros');
  } catch (error) {
    console.error(error);
    res.render('maestros/form', { titulo: 'Nuevo maestro', maestro: req.body, error: 'No se pudo guardar' });
  }
});

router.get('/:id/editar', async (req, res) => {
  const [filas] = await db.query('SELECT * FROM maestros WHERE id = ?', [req.params.id]);
  if (filas.length === 0) return res.redirect('/maestros');
  res.render('maestros/form', { titulo: 'Editar maestro', maestro: filas[0], error: null });
});

router.post('/:id', async (req, res) => {
  const { nombre_completo } = req.body;
  try {
    await db.query('UPDATE maestros SET nombre_completo = ? WHERE id = ?', [nombre_completo, req.params.id]);
    res.redirect('/maestros');
  } catch (error) {
    console.error(error);
    res.render('maestros/form', { titulo: 'Editar maestro', maestro: { ...req.body, id: req.params.id }, error: 'No se pudo actualizar' });
  }
});

router.post('/:id/eliminar', async (req, res) => {
  await db.query('UPDATE maestros SET activo = 0 WHERE id = ?', [req.params.id]);
  res.redirect('/maestros');
});

module.exports = router;