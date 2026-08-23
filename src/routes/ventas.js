const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// El logo del ticket es opcional: si el archivo no está, el ticket sale solo
// con el nombre del negocio en texto.
const LOGO_TICKET = fs.existsSync(path.join(__dirname, '../../public/Image_Logo/logo-blanco.png'))
  ? '/Image_Logo/logo-blanco.png'
  : '';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT) || 587,
  secure: Number(process.env.MAIL_PORT) === 465,
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
});

function aArreglo(valor) {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

async function obtenerVentaDetalle(id) {
  const [vfilas] = await db.query('SELECT * FROM ventas WHERE id = ?', [id]);
  if (vfilas.length === 0) return { venta: null, items: [] };
  const [items] = await db.query(`
    SELECT vi.precio, l.titulo AS libro, l.autor, m.nombre_completo AS maestro
    FROM venta_items vi
    JOIN libros l   ON l.id = vi.libro_id
    JOIN maestros m ON m.id = vi.maestro_id
    WHERE vi.venta_id = ?
  `, [id]);
  return { venta: vfilas[0], items };
}

function construirNota(venta, items) {
  const negocio = process.env.NEGOCIO_NOMBRE || 'Papelería';
  const fecha = new Date(venta.fecha).toLocaleDateString('es-MX');
  let txt = `${negocio}\nNota de compra\n\n`;
  txt += `Alumno: ${venta.alumno_nombre}\n`;
  txt += `Grado/Grupo: ${venta.grado}° ${venta.grupo}\n`;
  txt += `Turno: ${venta.turno}\n`;
  txt += `Fecha: ${fecha}\n\nLibros:\n`;
  items.forEach(it => { txt += `- ${it.libro}: $${Number(it.precio).toFixed(2)}\n`; });
  txt += `\nTOTAL: $${Number(venta.total).toFixed(2)}\n`;
  if (venta.notas) txt += `\nNotas: ${venta.notas}\n`;
  txt += `\n¡Gracias por su compra!`;
  return txt;
}

async function enviarTicket(correo, ventaId) {
  const { venta, items } = await obtenerVentaDetalle(ventaId);
  if (!venta) return;
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to: correo,
    subject: `Nota de compra - ${venta.alumno_nombre}`,
    text: construirNota(venta, items)
  });
}

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

router.get('/nueva', async (req, res) => {
  const datos = await datosFormulario();
  res.render('ventas/form', { titulo: 'Registrar venta', ...datos, venta: null, items: [], totalAnterior: 0, error: null });
});

router.post('/', async (req, res) => { await guardarVenta(req, res, null); });

router.get('/:id/editar', async (req, res) => {
  const [vfilas] = await db.query('SELECT * FROM ventas WHERE id = ?', [req.params.id]);
  if (vfilas.length === 0) return res.redirect('/ventas');
  const [items] = await db.query('SELECT libro_id, maestro_id, precio FROM venta_items WHERE venta_id = ?', [req.params.id]);
  const datos = await datosFormulario();
  res.render('ventas/form', { titulo: 'Corrección de venta', ...datos, venta: vfilas[0], items, totalAnterior: Number(vfilas[0].total), error: null });
});

// Ticket para impresora térmica de 58mm (2.2"). Se renderiza sin el layout del
// sitio. El monto pagado y el cambio se calculan en el navegador y no se
// guardan: la tabla ventas no tiene columnas de pago.
router.get('/:id/ticket', async (req, res) => {
  const { venta, items } = await obtenerVentaDetalle(req.params.id);
  if (!venta) return res.redirect('/ventas');
  res.render('ventas/ticket', {
    layout: false,
    venta, items,
    negocio:   process.env.NEGOCIO_NOMBRE    || 'Papelería Cecy',
    logo: LOGO_TICKET
  });
});

router.get('/:id', async (req, res) => {
  const { venta, items } = await obtenerVentaDetalle(req.params.id);
  if (!venta) return res.redirect('/ventas');
  const nota = construirNota(venta, items);
  res.render('ventas/detalle', { titulo: 'Detalle de venta', venta, items, nota, correo: req.query.correo || null, nueva: req.query.nueva === '1' });
});

router.post('/:id', async (req, res) => { await guardarVenta(req, res, req.params.id); });

router.post('/:id/enviar-correo', async (req, res) => {
  const correo = (req.body.correo || '').trim();
  try {
    if (!correo) throw new Error('Falta el correo');
    await enviarTicket(correo, req.params.id);
    res.redirect('/ventas/' + req.params.id + '?correo=ok');
  } catch (error) {
    console.error('Error enviando correo:', error);
    res.redirect('/ventas/' + req.params.id + '?correo=error');
  }
});

router.post('/:id/eliminar', async (req, res) => {
  await db.query('DELETE FROM ventas WHERE id = ?', [req.params.id]);
  res.redirect('/ventas');
});

async function datosFormulario() {
  const [libros]     = await db.query('SELECT id, titulo, precio FROM libros WHERE activo = 1 ORDER BY titulo');
  const [maestros]   = await db.query('SELECT id, nombre_completo FROM maestros WHERE activo = 1 ORDER BY nombre_completo');
  const [relaciones] = await db.query('SELECT libro_id, maestro_id FROM libro_maestro');
  return { libros, maestros, relaciones };
}

async function guardarVenta(req, res, ventaId) {
  const { alumno_nombre, grado, grupo, turno, especialidad, notas } = req.body;
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

    let idFinal = ventaId;
    if (esCorreccion) {
      await db.query(
        'UPDATE ventas SET alumno_nombre=?, grado=?, grupo=?, turno=?, especialidad=?, notas=?, total=? WHERE id=?',
        [alumno_nombre, grado, grupo, turno, especialidad, notas || null, total, ventaId]
      );
      await db.query('DELETE FROM venta_items WHERE venta_id = ?', [ventaId]);
      for (const l of lineas) {
        await db.query('INSERT INTO venta_items (venta_id, libro_id, maestro_id, precio) VALUES (?, ?, ?, ?)', [ventaId, l.libro_id, l.maestro_id, l.precio]);
      }
    } else {
      const [resVenta] = await db.query(
        'INSERT INTO ventas (alumno_nombre, grado, grupo, turno, especialidad, notas, total, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [alumno_nombre, grado, grupo, turno, especialidad, notas || null, total, req.session.usuario.id]
      );
      idFinal = resVenta.insertId;
      for (const l of lineas) {
        await db.query('INSERT INTO venta_items (venta_id, libro_id, maestro_id, precio) VALUES (?, ?, ?, ?)', [idFinal, l.libro_id, l.maestro_id, l.precio]);
      }
    }

    // Ticket por correo (solo en venta nueva). Si falla, no tumba la venta.
    const correoTicket = (req.body.correo_ticket || '').trim();
    if (!esCorreccion && req.body.enviar_ticket && correoTicket) {
      try { await enviarTicket(correoTicket, idFinal); }
      catch (e) { console.error('No se pudo enviar el ticket:', e); }
    }

    res.redirect('/ventas/' + idFinal + (esCorreccion ? '' : '?nueva=1'));
  } catch (error) {
    console.error(error);
    const datos = await datosFormulario();
    const itemsPrevios = [];
    for (let i = 0; i < libroIds.length; i++) {
      if (libroIds[i]) itemsPrevios.push({ libro_id: libroIds[i], maestro_id: maestroIds[i] || '' });
    }
    res.render('ventas/form', {
      titulo: esCorreccion ? 'Corrección de venta' : 'Registrar venta', ...datos,
      venta: esCorreccion ? { id: ventaId, alumno_nombre, grado, grupo, turno, especialidad, notas } : null,
      items: itemsPrevios,
      totalAnterior: Number(req.body.total_anterior || 0),
      error: error.message || 'No se pudo guardar la venta'
    });
  }
}

module.exports = router;
