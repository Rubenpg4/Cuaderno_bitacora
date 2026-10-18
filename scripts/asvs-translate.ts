import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { generateOfficialAsvsCatalog } from '../service/asvs/importCatalog.js';
import { asvsCatalog } from '../shared/asvsCatalog.js';
import { reviewAsvsSpanishTerminology } from './asvs-spanish-terminology.js';
import {
  asvsTechnicalText,
  validateAsvsTranslation,
  type AsvsTranslation,
} from '../shared/asvsTranslation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'shared/catalogs/asvs-5.0.0.es.json');

function escapeXml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function prepareText(text: string) {
  const fragments: string[] = [];
  let position = 0;
  let xml = '<text>';
  for (const match of text.matchAll(asvsTechnicalText)) {
    xml += escapeXml(text.slice(position, match.index));
    xml += `<keep>${escapeXml(match[0])}</keep>`;
    fragments.push(match[0]);
    position = match.index + match[0].length;
  }
  return { xml: `${xml}${escapeXml(text.slice(position))}</text>`, fragments };
}

function decodeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff)
        throw Error('Entidad XML no válida en la traducción.');
      return String.fromCodePoint(code);
    }
    return (
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name] ??
      entity
    );
  });
}

function restoreText(xml: string, fragments: string[]) {
  if (!xml.startsWith('<text>') || !xml.endsWith('</text>'))
    throw Error('DeepL devolvió un documento XML no válido.');
  const body = xml.slice(6, -7);
  const kept = [...body.matchAll(/<keep>([^<>]*)<\/keep>/g)].map((match) => decodeXml(match[1]));
  if (JSON.stringify(kept) !== JSON.stringify(fragments))
    throw Error('La traducción ha alterado números, referencias o términos técnicos protegidos.');
  // XML translation can join a protected number to a translated unit ("32bits").
  // Restore its word boundaries as well as its value before validating the plain text.
  const plain = body.replace(
    /<keep>([^<>]*)<\/keep>/g,
    (match, encoded: string, offset: number) => {
      const value = decodeXml(encoded);
      if (!/^\d+(?:[.,]\d+)*$/.test(value)) return encoded;
      const before = /[\p{L}\p{N}]/u.test(body[offset - 1] ?? '') ? ' ' : '';
      const after = /[\p{L}\p{N}]/u.test(body[offset + match.length] ?? '') ? ' ' : '';
      return `${before}${encoded}${after}`;
    },
  );
  if (/[<>]/.test(plain)) throw Error('Etiquetas inesperadas en la traducción.');
  return decodeXml(plain);
}

export async function translateAsvsWithDeepL(apiKey: string, request: typeof fetch = fetch) {
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw Error('Configura DEEPL_API_KEY localmente.');
  // Fixed endpoints: never send credentials to a configurable host or follow redirects.
  const endpoint = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const originals = [
    ...new Set(
      asvsCatalog.requirements.flatMap((r) => [r.chapterName, r.sectionName, r.description]),
    ),
  ];
  const translated = new Map<string, string>();
  for (let start = 0; start < originals.length; start += 50) {
    const texts = originals.slice(start, start + 50);
    const prepared = texts.map(prepareText);
    const body = JSON.stringify({
      text: prepared.map((text) => text.xml),
      source_lang: 'EN',
      target_lang: 'ES',
      model_type: 'prefer_quality_optimized',
      formality: 'prefer_more',
      preserve_formatting: true,
      tag_handling: 'xml',
      ignore_tags: ['keep'],
      context:
        'OWASP ASVS 5.0.0 application security verification requirements. Technical cybersecurity terminology. Preserve normative meaning and verification levels.',
    });
    if (Buffer.byteLength(body) > 128 * 1024) throw Error('Lote de traducción demasiado grande.');
    let response: Response;
    try {
      response = await request(`${endpoint}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw Error('No se pudo conectar con DeepL. El catálogo anterior se conserva.');
    }
    // Do not log provider bodies: errors may echo request headers or credentials.
    if (!response.ok)
      throw Error(`DeepL devolvió HTTP ${response.status}. El catálogo anterior se conserva.`);
    let data: { translations?: { text: string }[] };
    try {
      data = await response.json();
    } catch {
      throw Error('Respuesta JSON no válida de DeepL.');
    }
    if (!Array.isArray(data?.translations) || data.translations.length !== texts.length)
      throw Error('DeepL devolvió un lote incompleto.');
    data.translations.forEach((result, index) => {
      if (typeof result?.text !== 'string') throw Error('Texto de traducción no válido.');
      translated.set(texts[index], restoreText(result.text, prepared[index].fragments));
    });
  }
  const translatedText = (source: string) => {
    const text = translated.get(source);
    if (text === undefined) throw Error('La traducción ASVS no cubre todos los textos.');
    return text;
  };
  return validateAsvsTranslation(
    reviewAsvsSpanishTerminology({
      formatVersion: 1,
      catalogVersion: asvsCatalog.version,
      sourceSha256: asvsCatalog.sourceSha256,
      language: 'es',
      provider: 'DeepL',
      terminologyRevision: 1,
      requirements: asvsCatalog.requirements.map((r) => ({
        reqId: r.reqId,
        sourceContentSha256: r.contentSha256,
        chapterName: translatedText(r.chapterName),
        sectionName: translatedText(r.sectionName),
        description: translatedText(r.description),
      })),
    }),
    asvsCatalog,
  );
}

export async function writeAsvsTranslation(path: string, data: AsvsTranslation) {
  validateAsvsTranslation(data, asvsCatalog);
  const content = await format(JSON.stringify(data), {
    ...(await resolveConfig(resolve(root, '.prettierrc.json'))),
    parser: 'json',
  });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3 || !['--check', '--write'].includes(mode))
      throw Error('Uso: tsx scripts/asvs-translate.ts --check | --write');
    // Revalidate the pinned source before any external request.
    const official = JSON.parse(
      generateOfficialAsvsCatalog(await readFile(resolve(root, 'resources/asvs/5.0.0.en.csv'))),
    );
    if (JSON.stringify(official) !== JSON.stringify(asvsCatalog))
      throw Error('Catálogo inglés desactualizado.');
    const existing: unknown = JSON.parse(await readFile(output, 'utf8'));
    if (existing !== null) validateAsvsTranslation(existing, asvsCatalog);
    if (mode === '--check') {
      console.log(
        existing === null
          ? 'Traducción ASVS pendiente de generar con DeepL.'
          : 'Traducción ASVS completa y vinculada a la fuente oficial.',
      );
    } else if (existing !== null) {
      console.log('La traducción ASVS ya está generada; no se realizan llamadas a DeepL.');
    } else {
      await writeAsvsTranslation(
        output,
        await translateAsvsWithDeepL(process.env.DEEPL_API_KEY ?? ''),
      );
      console.log(
        'Traducción DeepL generada: 345 requisitos, capítulos y secciones. Revisa la terminología antes de distribuir.',
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'No se pudo generar la traducción ASVS.',
    );
    process.exitCode = 1;
  }
}
