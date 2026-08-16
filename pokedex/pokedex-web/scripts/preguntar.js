"use strict";
/* ============================================================================
   Lectura de datos por teclado, con ocultación de contraseñas.

   Dos caminos, porque readline se comporta muy distinto según la entrada:

   · TERMINAL REAL → una única interfaz de readline reutilizada. Crear una por
     pregunta pierde lo que readline ya leyó por adelantado y la segunda
     pregunta se cuelga. Para ocultar el tecleo se silencia el eco.

   · ENTRADA CANALIZADA (pruebas, scripts) → readline emite todas las líneas de
     golpe, antes de que la segunda pregunta llegue a registrarse, y esa
     respuesta se pierde. Aquí leemos stdin entero de una vez y vamos sirviendo
     las líneas. Ocultar no aplica: no hay tecleo visible.
   ========================================================================== */
const readline = require("readline");

const esTerminal = () => !!process.stdin.isTTY;
let rl = null;        // interfaz para terminal
let cola = null;      // líneas pendientes para entrada canalizada

async function leerTodo(){
  if (cola) return cola;
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  cola = Buffer.concat(trozos).toString("utf8").split(/\r?\n/);
  return cola;
}

function iface(){
  if (!rl) rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
  });
  return rl;
}

async function preguntar(texto, oculto = false){
  if (!esTerminal()){
    const lineas = await leerTodo();
    process.stdout.write(texto + "\n");
    return lineas.shift() ?? "";
  }
  const r = iface();
  return new Promise(resolve => {
    if (!oculto) return r.question(texto, a => resolve(a));
    process.stdout.write(texto);
    const original = r._writeToOutput;
    r._writeToOutput = () => {};                 // silencia el eco
    r.question("", a => {
      r._writeToOutput = original;
      process.stdout.write("\n");
      resolve(a);
    });
  });
}

function cerrar(){ if (rl){ rl.close(); rl = null; } }

module.exports = { preguntar, cerrar };
