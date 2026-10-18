import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASVS_SOURCE_SHA256,
  ASVS_SOURCE_URL,
  compareAsvsRequirements,
  parseAsvsReference,
  resolveAsvsReference,
  selectAsvsRequirements,
} from '../shared/asvs';
import { asvsCatalog } from '../shared/asvsCatalog';
import {
  generateOfficialAsvsCatalog,
  importAsvsCatalog,
  MAX_ASVS_CSV_BYTES,
} from '../service/asvs/importCatalog';
import { generateAsvsCatalogFile } from '../scripts/asvs-catalog';
import { blank, initialState } from '../service/records/defaults';

const header = 'chapter_id,chapter_name,section_id,section_name,req_id,req_description,L';
const row = 'V1,Encoding,V1.2,Injection,V1.2.5,Verify safe input.,1';
const encode = (text: string) => Buffer.from(text, 'utf8');
const fixture = (record = row) => encode(`${header}\n${record}\n`);
const official = readFileSync('resources/asvs/5.0.0.en.csv');

describe('importación CSV ASVS', () => {
  it('conserva comas, comillas, BOM, UTF-8 y saltos dentro de campos entrecomillados', () => {
    const description = 'Verificar "comillas", café\r\nsegunda línea <script>alert(1)</script>';
    const input = encode(
      `\ufeff${header}\r\nV1,Encoding,V1.2,Injection,V1.2.5,"${description.replaceAll('"', '""')}",1\r\n\r\n`,
    );
    const catalog = importAsvsCatalog(input);
    expect(catalog.requirements).toHaveLength(1);
    expect(catalog.requirements[0].description).toBe(description);
    expect(catalog.requirements[0].canonicalRef).toBe('v5.0.0-1.2.5');
    expect(catalog.sourceSha256).toBe(createHash('sha256').update(input).digest('hex'));
  });

  it('admite columnas reordenadas, LF y una última fila sin salto de línea', () => {
    const catalog = importAsvsCatalog(
      encode(
        'L,req_id,req_description,section_id,section_name,chapter_id,chapter_name\n1,V1.2.5,Text,V1.2,Injection,V1,Encoding',
      ),
    );
    expect(catalog.requirements[0].reqId).toBe('V1.2.5');
  });

  it.each([
    ['cabecera ausente', row],
    ['columna ausente', `${header.replace(',L', '')}\n${row}`],
    ['columna duplicada', `${header.replace('chapter_name', 'chapter_id')}\n${row}`],
    ['columna extra', `${header},extra\n${row},extra`],
    ['solo cabecera', header],
    ['campo vacío', `${header}\n${row.replace('Verify safe input.', '   ')}`],
    ['fila incompleta', `${header}\n${row.slice(0, -2)}`],
    ['fila final con campo vacío entrecomillado', `${header}\n${row}\n""`],
    ['fila interior vacía', `${header}\n${row}\n\n${row.replace('V1.2.5', 'V1.2.6')}`],
    ['nivel cero', `${header}\n${row.slice(0, -1)}0`],
    ['nivel cuatro', `${header}\n${row.slice(0, -1)}4`],
    ['nivel decimal', `${header}\n${row.slice(0, -1)}1.0`],
    [
      'comillas sin cerrar',
      `${header}\n${row.replace('Verify safe input.', '"Verify safe input.')}`,
    ],
    ['comillas sin escape', `${header}\n${row.replace('Verify safe input.', 'Verify "input".')}`],
    ['texto tras comillas', `${header}\n${row.replace('Verify safe input.', '"Verify" extra')}`],
    ['ID duplicado', `${header}\n${row}\n${row}`],
    ['ID malformado', `${header}\n${row.replace('V1.2.5', 'V01.2.5')}`],
    ['capítulo ajeno', `${header}\n${row.replace('V1,', 'V2,')}`],
    ['sección ajena', `${header}\n${row.replace('V1.2,', 'V1.3,')}`],
    [
      'nombre de capítulo incoherente',
      `${header}\n${row}\n${row.replace('V1.2.5', 'V1.2.6').replace('Encoding', 'Other')}`,
    ],
    [
      'nombre de sección incoherente',
      `${header}\n${row}\n${row.replace('V1.2.5', 'V1.2.6').replace('Injection', 'Other')}`,
    ],
    ['carácter de control', `${header}\n${row.replace('Verify', '\u0000Verify')}`],
  ])('rechaza %s', (_, text) => {
    expect(() => importAsvsCatalog(encode(text))).toThrow();
  });

  it('rechaza UTF-8 inválido, tamaños fuera de límite y campos demasiado largos', () => {
    expect(() => importAsvsCatalog(Buffer.from([0xc3, 0x28]))).toThrow('UTF-8');
    expect(() => importAsvsCatalog(Buffer.alloc(0))).toThrow('Tamaño');
    expect(() => importAsvsCatalog(Buffer.alloc(MAX_ASVS_CSV_BYTES + 1))).toThrow('Tamaño');
    expect(() =>
      importAsvsCatalog(fixture(row.replace('Verify safe input.', 'x'.repeat(16001)))),
    ).toThrow('largo');
    expect(() =>
      importAsvsCatalog(encode(`${header}\n${Array(400).fill(row).join('\n')}`)),
    ).toThrow('filas');
  });
});

describe('referencias ASVS y catálogo público sin red', () => {
  it('normaliza referencias originales y canónicas solo en la versión seleccionada', () => {
    expect(parseAsvsReference('V1.2.5', '5.0.0')).toEqual({
      reqId: 'V1.2.5',
      canonicalRef: 'v5.0.0-1.2.5',
      segments: [1, 2, 5],
    });
    expect(resolveAsvsReference(asvsCatalog, 'v5.0.0-1.2.5')?.reqId).toBe('V1.2.5');
    expect(resolveAsvsReference(asvsCatalog, 'v4.0.3-1.2.5')).toBeUndefined();
    expect(resolveAsvsReference(asvsCatalog, 'V999.2.5')).toBeUndefined();
    for (const reference of ['V01.2.5', 'V1.0.5', 'V1.2', 'v5.0.0-V1.2.5', 'V9007199254740992.2.5'])
      expect(parseAsvsReference(reference, '5.0.0')).toBeNull();
    expect(parseAsvsReference('V1.2.5', '5.0')).toBeNull();
  });

  it('ordena segmentos numéricos, incluyendo capítulos, secciones y requisitos', () => {
    const rows = [
      'V10,Ten,V10.1,One,V10.1.1,Text,1',
      'V1,One,V1.10,Ten,V1.10.1,Text,1',
      'V1,One,V1.2,Two,V1.2.10,Text,1',
      'V1,One,V1.2,Two,V1.2.2,Text,1',
    ];
    const catalog = importAsvsCatalog(encode(`${header}\n${rows.join('\n')}`));
    expect(catalog.requirements.map((requirement) => requirement.reqId)).toEqual([
      'V1.2.2',
      'V1.2.10',
      'V1.10.1',
      'V10.1.1',
    ]);
  });

  it('verifica íntegramente el recurso oficial, su distribución y los filtros acumulativos', () => {
    const catalog = importAsvsCatalog(official);
    expect(catalog).toEqual(asvsCatalog);
    expect(catalog.sourceSha256).toBe(ASVS_SOURCE_SHA256);
    expect(catalog.source).toBe(ASVS_SOURCE_URL);
    expect(catalog.version).toBe('5.0.0');
    expect(catalog.language).toBe('en');
    expect(catalog.license).toBe('CC-BY-SA-4.0');
    expect(catalog.attribution).toContain('OWASP');
    expect(catalog.requirements).toHaveLength(345);
    expect(new Set(catalog.requirements.map((r) => r.reqId)).size).toBe(345);
    expect(new Set(catalog.requirements.map((r) => r.chapterId)).size).toBe(17);
    expect(new Set(catalog.requirements.map((r) => r.sectionId)).size).toBe(80);
    for (const [level, minimum, cumulative] of [
      [1, 70, 70],
      [2, 183, 253],
      [3, 92, 345],
    ] as const) {
      expect(catalog.requirements.filter((r) => r.minLevel === level)).toHaveLength(minimum);
      expect(selectAsvsRequirements(catalog, level)).toHaveLength(cumulative);
    }
    for (let index = 1; index < catalog.requirements.length; index++)
      expect(
        compareAsvsRequirements(catalog.requirements[index - 1], catalog.requirements[index]),
      ).toBeLessThan(0);
    expect(resolveAsvsReference(catalog, 'V2.2.1')?.description).toContain('For L2 and up');
    expect(() => selectAsvsRequirements(catalog, 4 as 1)).toThrow('Nivel');
    expect(Object.isFrozen(asvsCatalog.requirements[0])).toBe(true);
  });

  it('no activa configuración ASVS ni genera prácticas al cargar el catálogo', () => {
    const state = initialState();
    expect(state).not.toHaveProperty('asvs');
    expect(state.records.filter((r) => r.kind === 'practice').length).toBeLessThan(10);
    expect(blank('task').checks).toEqual([]);
  });
});

describe('generación reproducible y rechazo sin cambios', () => {
  it('regenera exactamente el mismo artefacto y detecta alteraciones sin sustituirlo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-catalog-'));
    try {
      const source = join(directory, 'source.csv');
      const output = join(directory, 'catalog.json');
      writeFileSync(source, official);
      await generateAsvsCatalogFile(source, output);
      const valid = readFileSync(output, 'utf8');
      expect(valid).toBe(readFileSync('shared/catalogs/asvs-5.0.0.en.json', 'utf8'));
      await generateAsvsCatalogFile(source, output);
      expect(readFileSync(output, 'utf8')).toBe(valid);
      await generateAsvsCatalogFile(source, output, true);
      writeFileSync(source, fixture(row.replace('Verify', 'Changed')));
      await expect(generateAsvsCatalogFile(source, output)).rejects.toThrow('huella');
      expect(readFileSync(output, 'utf8')).toBe(valid);
      writeFileSync(source, fixture(row.slice(0, -1) + '4'));
      await expect(generateAsvsCatalogFile(source, output)).rejects.toThrow('Nivel');
      expect(readFileSync(output, 'utf8')).toBe(valid);
      truncateSync(source, MAX_ASVS_CSV_BYTES + 1);
      await expect(generateAsvsCatalogFile(source, output)).rejects.toThrow('grande');
      expect(readFileSync(output, 'utf8')).toBe(valid);
      expect(readdirSync(directory).sort()).toEqual(['catalog.json', 'source.csv']);
      writeFileSync(source, official);
      writeFileSync(output, '{}');
      await expect(generateAsvsCatalogFile(source, output, true)).rejects.toThrow('desactualizado');
      expect(readFileSync(output, 'utf8')).toBe('{}');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('la fuente y el texto normalizado son deterministas y rechazan cambios de bytes', () => {
    expect(generateOfficialAsvsCatalog(official)).toBe(generateOfficialAsvsCatalog(official));
    expect(() => generateOfficialAsvsCatalog(Buffer.concat([official, encode('\n')]))).toThrow(
      'huella',
    );
  });
});
