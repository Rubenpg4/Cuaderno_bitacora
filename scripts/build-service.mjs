import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await mkdir('dist-service', { recursive: true });
await mkdir('dist-service/catalogs', { recursive: true });
await copyFile('shared/catalogs/asvs-5.0.0.en.json', 'dist-service/catalogs/asvs-5.0.0.en.json');
await copyFile('shared/catalogs/asvs-5.0.0.es.json', 'dist-service/catalogs/asvs-5.0.0.es.json');
await copyFile('resources/asvs/LICENSE.md', 'dist-service/catalogs/LICENSE.md');
await copyFile('resources/asvs/README.md', 'dist-service/catalogs/README.md');
await build({
  entryPoints: ['service/server.ts'],
  outfile: 'dist-service/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  define: { 'import.meta.url': '__filenameURL' },
  banner: {
    js: "const __filenameURL = require('node:url').pathToFileURL(__filename).href; process.env.BITACORA_WASM ||= require('node:path').join(__dirname,'sql-wasm.wasm');",
  },
  external: ['sql.js'],
});
// sql.js needs its own relative WASM loader; keep only the runtime beside the bundle.
await mkdir('dist-service/node_modules/sql.js/dist', { recursive: true });
await copyFile(
  require.resolve('sql.js/dist/sql-wasm.js'),
  'dist-service/node_modules/sql.js/dist/sql-wasm.js',
);
await writeFile(
  'dist-service/node_modules/sql.js/package.json',
  JSON.stringify({ name: 'sql.js', main: 'dist/sql-wasm.js' }),
);
await copyFile(require.resolve('sql.js/dist/sql-wasm.wasm'), 'dist-service/sql-wasm.wasm');
await build({
  entryPoints: ['service/mcp.ts'],
  outfile: 'dist-service/mcp.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  banner: { js: '(async () => {' },
  footer: {
    js: '})().catch(() => { process.stderr.write("No se pudo iniciar el conector.\\n"); process.exit(1); });',
  },
});
