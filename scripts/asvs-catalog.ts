import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { format, resolveConfig } from 'prettier';
import { generateOfficialAsvsCatalog, MAX_ASVS_CSV_BYTES } from '../service/asvs/importCatalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function generateAsvsCatalogFile(source: string, output: string, check = false) {
  if ((await stat(source)).size > MAX_ASVS_CSV_BYTES) throw Error('CSV ASVS demasiado grande.');
  // Validate fully before touching the last valid generated artifact.
  const content = await format(generateOfficialAsvsCatalog(await readFile(source)), {
    ...(await resolveConfig(resolve(root, '.prettierrc.json'))),
    parser: 'json',
  });
  if (check) {
    if ((await readFile(output, 'utf8')) !== content)
      throw Error('Catálogo ASVS desactualizado; ejecuta pnpm run asvs:generate.');
  } else {
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, 'utf8');
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv[2] === '--check';
  if (process.argv.length !== 3 || (!check && process.argv[2] !== '--write'))
    throw Error('Uso: tsx scripts/asvs-catalog.ts --check | --write');
  await generateAsvsCatalogFile(
    resolve(root, 'resources/asvs/5.0.0.en.csv'),
    resolve(root, 'shared/catalogs/asvs-5.0.0.en.json'),
    check,
  );
  console.log(
    check ? 'Catálogo ASVS íntegro y reproducible.' : 'Catálogo OWASP ASVS 5.0.0 generado.',
  );
}
