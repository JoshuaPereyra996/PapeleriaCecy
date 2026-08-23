"use strict";

/* Formato de fechas para vistas y correos.
 *
 * Las fechas llegan de MySQL como texto 'YYYY-MM-DD HH:MM:SS' (dateStrings en
 * src/db.js). Aquí se formatean tal cual, SIN pasar por new Date(): cualquier
 * conversión a Date reinterpreta la hora en la zona del proceso Node — que en
 * Hostinger es UTC — y corre la hora del ticket seis horas.
 *
 * Ojo: toLocaleString('es-MX') NO sirve para esto. El 'es-MX' cambia el idioma
 * y el orden de los campos, no la zona horaria.
 */

function partir(valor) {
  if (!valor) return null;

  // Red de seguridad: si algún día una consulta devuelve un Date en vez de
  // texto, se leen sus componentes locales en lugar de devolver vacío.
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return null;
    const dd = (n) => String(n).padStart(2, '0');
    return {
      anio: String(valor.getFullYear()), mes: dd(valor.getMonth() + 1), dia: dd(valor.getDate()),
      hora: valor.getHours(), min: dd(valor.getMinutes())
    };
  }

  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    anio: m[1], mes: m[2], dia: m[3],
    hora: m[4] === undefined ? null : Number(m[4]),
    min:  m[5] === undefined ? null : m[5]
  };
}

/** 22/08/2026 */
function soloFecha(valor) {
  const p = partir(valor);
  return p ? p.dia + '/' + p.mes + '/' + p.anio : '';
}

/** 12:36 p.m. */
function hora12(valor) {
  const p = partir(valor);
  if (!p || p.hora === null) return '';
  const sufijo = p.hora < 12 ? 'a.m.' : 'p.m.';
  let h = p.hora % 12;
  if (h === 0) h = 12;
  return h + ':' + p.min + ' ' + sufijo;
}

/** 22/08/2026  12:36 p.m. */
function fechaHora(valor) {
  const h = hora12(valor);
  const f = soloFecha(valor);
  return h ? f + '  ' + h : f;
}

module.exports = { soloFecha, hora12, fechaHora };
