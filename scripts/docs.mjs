import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docsDir = join(root, 'docs');
const start = '<!-- docs:index:start -->';
const end = '<!-- docs:index:end -->';
const check = process.argv.includes('--check');

if (!check && !process.argv.includes('--sync')) {
  console.error('Uso: node scripts/docs.mjs --sync | --check');
  process.exit(2);
}

const docNames = (await readdir(docsDir))
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort((a, b) => a.localeCompare(b, 'es'));

const docs = [];
const errors = [];

for (const name of docNames) {
  const content = await readFile(join(docsDir, name), 'utf8');
  const title = content.match(/^# (.+)$/m)?.[1];
  const summary = content.match(/^<!-- doc:summary: (.+) -->$/m)?.[1];
  if (!title || !summary) {
    errors.push(`docs/${name}: falta título # o resumen doc:summary`);
    continue;
  }
  docs.push({ name, title, summary });
}

function indexFor(prefix, includeReadme) {
  const lines = docs.map(
    ({ name, title, summary }) => `- [${title}](${prefix}${name}): ${summary}`,
  );
  if (includeReadme) {
    lines.unshift('- [Índice completo](docs/README.md): punto de entrada a la documentación.');
  }
  return lines.join('\n');
}

async function updateIndex(file, index) {
  const content = await readFile(file, 'utf8');
  const a = content.indexOf(start);
  const b = content.indexOf(end);
  if (a < 0 || b < a || content.indexOf(start, a + start.length) >= 0) {
    errors.push(`${file}: marcadores de índice ausentes o duplicados`);
    return;
  }
  const expected = `${content.slice(0, a + start.length)}\n${index}\n${content.slice(b)}`;
  if (expected !== content) {
    if (check) errors.push(`${file}: índice desactualizado; ejecuta pnpm run docs:sync`);
    else await writeFile(file, expected, 'utf8');
  }
}

await updateIndex(join(root, 'AGENTS.md'), indexFor('docs/', true));
await updateIndex(join(root, 'CLAUDE.md'), indexFor('docs/', true));
await updateIndex(join(docsDir, 'README.md'), indexFor('', false));

for (const file of [
  join(root, 'AGENTS.md'),
  join(root, 'CLAUDE.md'),
  join(docsDir, 'README.md'),
  ...docNames.map((name) => join(docsDir, name)),
]) {
  const content = await readFile(file, 'utf8');
  const withoutFences = content.replace(/^```[\s\S]*?^```/gm, '');
  for (const match of withoutFences.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!resolved.startsWith(root + sep) && resolved !== root) {
      errors.push(`${file}: enlace fuera del proyecto: ${target}`);
    } else if (!existsSync(resolved)) {
      errors.push(`${file}: enlace roto: ${target}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(
  check ? 'Documentación e índices correctos.' : 'Índices actualizados y enlaces correctos.',
);
