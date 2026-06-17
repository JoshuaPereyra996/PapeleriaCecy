const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) { console.log('Uso: node database/generar_hash.js tuContraseña'); process.exit(1); }
console.log(bcrypt.hashSync(password, 10));