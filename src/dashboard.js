"use strict";

/* Datos del panel principal. Todas las consultas se agregan en la base y se
 * calculan contra la zona horaria de la sesión MySQL (-06:00, ver src/db.js),
 * así "hoy" y "este mes" son los del negocio, no los del servidor.
 *
 * Ojo con las fechas: las series (días/meses) se rellenan aquí para no dejar
 * huecos en las gráficas, pero la aritmética de calendario se hace en UTC puro
 * (Date.UTC + toISOString) para NO reinterpretar zonas — el mismo cuidado que
 * documenta src/fecha.js. El "hoy" de referencia lo da MySQL (CURDATE()).
 */

const db = require('./db');

// Resta k días a una fecha 'YYYY-MM-DD' tratándola como calendario puro.
function restarDias(iso, k) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - k * 86400000).toISOString().slice(0, 10);
}

// Resta k meses a un 'YYYY-MM'.
function restarMeses(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) - k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

const SEMESTRE = { '1': '1er semestre', '2': '3er semestre', '3': '5to semestre' };

async function datosDashboard() {
  // Fecha de referencia del negocio (zona de la sesión MySQL).
  const [[ref]] = await db.query("SELECT CURDATE() AS hoy, DATE_FORMAT(CURDATE(),'%Y-%m') AS ym");

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const [[hoy]] = await db.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS monto FROM ventas WHERE DATE(fecha) = CURDATE()");
  const [[mes]] = await db.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS monto FROM ventas WHERE YEAR(fecha)=YEAR(CURDATE()) AND MONTH(fecha)=MONTH(CURDATE())");
  const [[tot]] = await db.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS monto FROM ventas");
  const [[alum]] = await db.query(`
    SELECT COUNT(DISTINCT CONCAT(alumno_nombre,'|',grado,'|',grupo)) AS n
    FROM ventas WHERE YEAR(fecha)=YEAR(CURDATE()) AND MONTH(fecha)=MONTH(CURDATE())`);

  // ── Series y rankings ───────────────────────────────────────────────────────
  const [ventasDia] = await db.query(
    "SELECT DATE(fecha) AS dia, SUM(total) AS monto FROM ventas WHERE fecha >= CURDATE() - INTERVAL 29 DAY GROUP BY DATE(fecha)");
  const [ingresosMes] = await db.query(
    "SELECT DATE_FORMAT(fecha,'%Y-%m') AS ym, SUM(total) AS monto FROM ventas WHERE fecha >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH,'%Y-%m-01') GROUP BY ym");
  const [topLibros] = await db.query(`
    SELECT l.titulo, COUNT(vi.id) AS unidades
    FROM venta_items vi JOIN libros l ON l.id = vi.libro_id
    GROUP BY l.id ORDER BY unidades DESC, l.titulo LIMIT 10`);
  const [porSemestre] = await db.query("SELECT grado, COUNT(*) AS n FROM ventas GROUP BY grado ORDER BY grado");

  // ── Inventario: existencias restantes por libro ─────────────────────────────
  // Los vendidos se cuentan con venta_items (stock_actual no se decrementa al
  // vender). "Restante" = lo que dejó la editorial menos lo vendido; la barra
  // baja conforme se vende. Solo libros con entrega registrada (>0), porque sin
  // total no hay porcentaje que mostrar. Orden: los más vendidos primero.
  const [inventarioFilas] = await db.query(`
    SELECT l.titulo, l.cantidad_entregada AS entregada, COUNT(vi.id) AS vendidos
    FROM libros l
    LEFT JOIN venta_items vi ON vi.libro_id = l.id
    WHERE l.activo = 1 AND l.cantidad_entregada > 0
    GROUP BY l.id
    ORDER BY vendidos DESC, l.titulo`);

  // Rellenar días faltantes (30) con 0.
  const mapaDia = new Map(ventasDia.map(f => [f.dia, Number(f.monto)]));
  const serieDias = [];
  for (let i = 29; i >= 0; i--) {
    const iso = restarDias(ref.hoy, i);
    serieDias.push({ dia: iso, monto: mapaDia.get(iso) || 0 });
  }

  // Rellenar meses faltantes (12) con 0.
  const mapaMes = new Map(ingresosMes.map(f => [f.ym, Number(f.monto)]));
  const serieMeses = [];
  for (let i = 11; i >= 0; i--) {
    const ym = restarMeses(ref.ym, i);
    serieMeses.push({ ym, monto: mapaMes.get(ym) || 0 });
  }

  return {
    kpi: {
      hoy:    { n: hoy.n, monto: Number(hoy.monto) },
      mes:    { n: mes.n, monto: Number(mes.monto) },
      total:  { n: tot.n, monto: Number(tot.monto) },
      alumnos: alum.n,
    },
    serieDias,
    serieMeses,
    topLibros: topLibros.map(l => ({ titulo: l.titulo, unidades: l.unidades })),
    semestre:  porSemestre.map(s => ({ etiqueta: SEMESTRE[s.grado] || ('Grado ' + s.grado), n: s.n })),
    inventario: inventarioFilas.map(l => {
      const entregada = Number(l.entregada);
      const vendidos  = Number(l.vendidos);
      const restante  = Math.max(0, entregada - vendidos);
      const pct       = Math.round((restante / entregada) * 100);
      return { titulo: l.titulo, entregada, vendidos, restante, pct, alerta: pct < 20 };
    }),
  };
}

module.exports = { datosDashboard };
