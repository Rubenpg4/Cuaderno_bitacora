import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import {
  ASVS_LICENSE_URL,
  ASVS_SOURCE_SHA256,
  ASVS_SOURCE_URL,
  ASVS_VERSION,
  compareAsvsRequirements,
  parseAsvsReference,
  type AsvsCatalog,
  type AsvsLevel,
  type AsvsRequirement,
} from '../../shared/asvs.js';

export const MAX_ASVS_CSV_BYTES = 1024 * 1024;
const MAX_FIELD_LENGTH = 16000;
const MAX_ROWS = 400;
const COLUMNS = [
  'chapter_id',
  'chapter_name',
  'section_id',
  'section_name',
  'req_id',
  'req_description',
  'L',
] as const;

// RFC 4180 quoting, with LF/CRLF records and an optional UTF-8 BOM.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const blankRows: boolean[] = [];
  let row: string[] = [];
  let field = '';
  let rowStarted = false;
  let mode: 'unquoted' | 'quoted' | 'closed' = 'unquoted';
  const endField = () => {
    row.push(field);
    if (row.length > COLUMNS.length) throw Error('Demasiadas columnas en el CSV ASVS.');
    field = '';
    mode = 'unquoted';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    blankRows.push(!rowStarted);
    if (rows.length > MAX_ROWS) throw Error('Demasiadas filas en el CSV ASVS.');
    row = [];
    rowStarted = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character !== '\r' && character !== '\n') rowStarted = true;
    if (mode === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else mode = 'closed';
      } else field += character;
    } else if (character === ',') endField();
    else if (character === '\r' || character === '\n') {
      endRow();
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else if (character === '"' && mode === 'unquoted' && !field) mode = 'quoted';
    else if (mode === 'closed' || character === '"')
      throw Error('Comillas malformadas en el CSV ASVS.');
    else field += character;
    if (field.length > MAX_FIELD_LENGTH) throw Error('Campo ASVS demasiado largo.');
  }
  if (mode === 'quoted') throw Error('Campo entrecomillado sin cerrar en el CSV ASVS.');
  if (field || row.length || mode === 'closed') endRow();
  // The pinned official file ends with blank lines. Interior blank rows stay invalid.
  while (blankRows.at(-1)) {
    rows.pop();
    blankRows.pop();
  }
  return rows;
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

export function importAsvsCatalog(input: Uint8Array): AsvsCatalog {
  if (!input.byteLength || input.byteLength > MAX_ASVS_CSV_BYTES)
    throw Error('Tamaño del CSV ASVS no válido (máximo 1 MiB).');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw Error('El CSV ASVS debe ser UTF-8 válido.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw Error('El CSV ASVS contiene caracteres de control no admitidos.');
  const [header, ...rows] = parseCsv(text);
  if (
    !header ||
    header.length !== COLUMNS.length ||
    new Set(header).size !== COLUMNS.length ||
    COLUMNS.some((column) => !header.includes(column))
  )
    throw Error('Las columnas del CSV ASVS no corresponden con el contrato.');
  if (!rows.length) throw Error('El CSV ASVS no contiene requisitos.');
  const requirements: AsvsRequirement[] = [];
  const ids = new Set<string>();
  const chapterNames = new Map<string, string>();
  const sectionNames = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length || row.some((field) => !field.trim()))
      throw Error(`Fila ${index + 2} incompleta en el CSV ASVS.`);
    const values = Object.fromEntries(
      header.map((column, columnIndex) => [column, row[columnIndex]]),
    );
    const reference = parseAsvsReference(values.req_id, ASVS_VERSION);
    if (
      !reference ||
      values.req_id !== reference.reqId ||
      values.chapter_id !== `V${reference.segments[0]}` ||
      values.section_id !== `V${reference.segments[0]}.${reference.segments[1]}`
    )
      throw Error(`Jerarquía o identificador no válido en la fila ${index + 2}.`);
    if (ids.has(reference.reqId)) throw Error(`Requisito ASVS duplicado: ${reference.reqId}.`);
    if (!/^[123]$/.test(values.L)) throw Error(`Nivel ASVS no válido en la fila ${index + 2}.`);
    for (const [names, id, name] of [
      [chapterNames, values.chapter_id, values.chapter_name],
      [sectionNames, values.section_id, values.section_name],
    ] as const) {
      if (names.has(id) && names.get(id) !== name)
        throw Error(`Nombres incoherentes para ${id} en el CSV ASVS.`);
      names.set(id, name);
    }
    ids.add(reference.reqId);
    const content = {
      catalogVersion: ASVS_VERSION,
      ...reference,
      chapterId: values.chapter_id,
      chapterName: values.chapter_name,
      sectionId: values.section_id,
      sectionName: values.section_name,
      description: values.req_description,
      minLevel: Number(values.L) as AsvsLevel,
    };
    requirements.push({ ...content, contentSha256: sha256(JSON.stringify(content)) });
  }
  return {
    formatVersion: 1,
    version: ASVS_VERSION,
    language: 'en',
    source: ASVS_SOURCE_URL,
    sourceSha256: sha256(input),
    attribution: 'OWASP Foundation and ASVS contributors',
    license: 'CC-BY-SA-4.0',
    licenseUrl: ASVS_LICENSE_URL,
    requirements: requirements.sort(compareAsvsRequirements),
  };
}

export function serializeAsvsCatalog(catalog: AsvsCatalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}

export function generateOfficialAsvsCatalog(input: Uint8Array) {
  const catalog = importAsvsCatalog(input);
  if (catalog.sourceSha256 !== ASVS_SOURCE_SHA256)
    throw Error('La huella del CSV no corresponde con OWASP ASVS 5.0.0.');
  return serializeAsvsCatalog(catalog);
}
