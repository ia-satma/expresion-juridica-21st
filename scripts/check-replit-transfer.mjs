import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const pass = (condition, message) => { if (!condition) failures.push(message); };

const replit = read('.replit');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const dataPaths = read('server/data-paths.mjs');
const storage = read('server/app-storage.mjs');

pass(packageJson.engines?.node?.startsWith('>=20'), 'package.json debe exigir Node 20 o superior');
pass(/run\s*=\s*"npm start"/.test(replit), '.replit debe arrancar con npm start');
pass(/deploymentTarget\s*=\s*"cloudrun"/.test(replit), '.replit debe mantener el destino Cloud Run');
pass(/localPort\s*=\s*3000/.test(replit), '.replit debe exponer el puerto local 3000');
pass(!/replit-objstore-[a-f0-9-]+/.test(replit), '.replit no debe fijar el bucket de otra cuenta');
pass(/\[userenv\.shared\]\s+CMS_DATA_SCOPE\s*=\s*"development"/.test(replit), '.replit debe usar development en el workspace');
pass(/\[deployment\][\s\S]*?run\s*=\s*\["env",\s*"CMS_DATA_SCOPE=production",\s*"npm",\s*"start"\]/.test(replit), '.replit debe usar production al ejecutar el Deployment');
pass(envExample.includes('BETTER_AUTH_SECRET='), '.env.example debe documentar BETTER_AUTH_SECRET');
pass(envExample.includes('BETTER_AUTH_URL='), '.env.example debe documentar BETTER_AUTH_URL');
pass(envExample.includes('CMS_OWNER_EMAIL='), '.env.example debe documentar CMS_OWNER_EMAIL');
pass(envExample.includes('OPENAI_API_KEY'), '.env.example debe documentar OPENAI_API_KEY');
pass(dataPaths.includes('CMS_DATA_SCOPE'), 'data-paths.mjs debe usar CMS_DATA_SCOPE');
pass(dataPaths.includes('AUTH_DB_FILE') && dataPaths.includes('STORE_FILE'), 'SQLite y CMS JSON deben quedar dentro del scope');
pass(storage.includes('new Client(') && storage.includes('bucketId'), 'App Storage debe admitir el bucket de la cuenta destino');
pass(!fs.existsSync(path.join(root, 'data', 'production', 'auth.sqlite')), 'no debe existir una base de producción en el checkout');
pass(!fs.existsSync(path.join(root, 'data', 'production', 'cms.json')), 'no debe existir el CMS de producción en el checkout');

if (failures.length) {
  console.error('check-replit-transfer: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('check-replit-transfer: PASS');
console.log('- Node 20, Cloud Run, puerto 3000 y npm start');
console.log('- workspace development y Deployment production separados');
console.log('- bucket y datos de producción fuera del repositorio');
console.log('- Secrets y App Storage documentados para la cuenta destino');
