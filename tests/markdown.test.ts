import { describe, expect, it } from 'vitest';
import {
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  splitMarkdownTables,
} from '../shared/markdown';

describe('Markdown de los registros', () => {
  it('reconoce títulos, párrafos con saltos de línea y separadores', () => {
    expect(parseMarkdown('## Objetivo\nPrimera línea\nsegunda línea\n\n---')).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', value: 'Objetivo' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Primera línea' },
          { type: 'break' },
          { type: 'text', value: 'segunda línea' },
        ],
      },
      { type: 'rule' },
    ]);
    expect(parseMarkdown('#etiqueta sin espacio')[0].type).toBe('paragraph');
  });

  it('anida listas, conserva el inicio numerado y detecta casillas', () => {
    const [list] = parseMarkdown('3. Uno\n   - Sub\n4. Dos\n\n- [x] Hecho\n- [ ] Pendiente');
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 3 });
    if (list.type !== 'list') throw new Error('lista esperada');
    expect(list.items).toHaveLength(2);
    expect(list.items[0].children[1]).toMatchObject({ type: 'list', ordered: false });
    const tasks = parseMarkdown('- [x] Hecho\n- [ ] Pendiente')[0];
    if (tasks.type !== 'list') throw new Error('lista esperada');
    expect(tasks.items.map((item) => item.checked)).toEqual([true, false]);
  });

  it('permite que una lista o una tabla sigan a un párrafo sin línea en blanco', () => {
    expect(parseMarkdown('Criterios:\n1. Primero\n2. Segundo').map((b) => b.type)).toEqual([
      'paragraph',
      'list',
    ]);
    const blocks = parseMarkdown('Resumen\n| Campo | Valor |\n| :-- | --: |\n| a \\| b | 2 |');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'table']);
    expect(blocks[1]).toMatchObject({
      align: ['left', 'right'],
      rows: [[[{ type: 'text', value: 'a | b' }], [{ type: 'text', value: '2' }]]],
    });
  });

  it('compila tablas con alineación, barras escapadas y filas irregulares', () => {
    const [table] = parseMarkdown(
      '| Campo | Estado | Total |\n| --- | :---: | ---: |\n| a \\| b | **ok** |\n| x | y | 3 | 4 |',
    );
    expect(table).toMatchObject({ type: 'table', align: [null, 'center', 'right'] });
    if (table.type !== 'table') throw new Error('tabla esperada');
    expect(table.rows[0]).toEqual([
      [{ type: 'text', value: 'a | b' }],
      [{ type: 'strong', children: [{ type: 'text', value: 'ok' }] }],
      [],
    ]);
    // Las celdas sobrantes se conservan en la última columna.
    expect(table.rows[1][2]).toEqual([{ type: 'text', value: '3 | 4' }]);
  });

  it('muestra como texto las tablas mal formadas', () => {
    for (const source of [
      '| Uno | Dos |\n| --- |\n| a | b |',
      '| Uno | Dos |\n| a | b |',
      '| Uno | Dos |\n| --- | -x- |',
    ]) {
      const blocks = parseMarkdown(source);
      expect(blocks.map((b) => b.type)).toEqual(['paragraph']);
      expect(markdownToPlainText(source)).toContain('Uno | Dos');
    }
  });

  it('separa las tablas para exportar sin tocar el resto del texto', () => {
    const source =
      '## Datos\nIntro\n| Campo | Valor |\n| :-- | --: |\n| `ruta` | a \\| b |\n\n```md\n| x | y |\n| - | - |\n```';
    expect(splitMarkdownTables(source)).toEqual([
      { type: 'lines', lines: ['## Datos', 'Intro'] },
      {
        type: 'table',
        align: ['left', 'right'],
        head: ['Campo', 'Valor'],
        rows: [['ruta', 'a | b']],
      },
      { type: 'lines', lines: ['', '```md', '| x | y |', '| - | - |', '```'] },
    ]);
  });

  it('conserva literalmente el código y las citas', () => {
    expect(parseMarkdown('```ts\nconst a = **1**;\n```\n> Nota\n> **importante**')).toEqual([
      { type: 'code', lang: 'ts', value: 'const a = **1**;' },
      {
        type: 'quote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Nota' },
              { type: 'break' },
              { type: 'strong', children: [{ type: 'text', value: 'importante' }] },
            ],
          },
        ],
      },
    ]);
  });

  it('interpreta énfasis sin romper identificadores con guion bajo', () => {
    expect(parseInline('**negrita** *cursiva* ~~tachado~~ `a*b` snake_case_name')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'negrita' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'cursiva' }] },
      { type: 'text', value: ' ' },
      { type: 'del', children: [{ type: 'text', value: 'tachado' }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'a*b' },
      { type: 'text', value: ' snake_case_name' },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }]);
    expect(parseInline('\\*literal\\*')).toEqual([{ type: 'text', value: '*literal*' }]);
  });

  it('solo enlaza destinos seguros', () => {
    expect(parseInline('[guía](https://owasp.org) y https://example.com/a.')).toEqual([
      { type: 'link', href: 'https://owasp.org', children: [{ type: 'text', value: 'guía' }] },
      { type: 'text', value: ' y ' },
      {
        type: 'link',
        href: 'https://example.com/a',
        children: [{ type: 'text', value: 'https://example.com/a' }],
      },
      { type: 'text', value: '.' },
    ]);
    expect(parseInline('[clic](javascript:alert(1))')).not.toContainEqual(
      expect.objectContaining({ type: 'link' }),
    );
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', value: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('reconoce menciones de registros y genera texto plano', () => {
    expect(parseInline('Ver @[task:abc-1]')).toEqual([
      { type: 'text', value: 'Ver ' },
      { type: 'mention', kind: 'task', id: 'abc-1' },
    ]);
    expect(markdownToPlainText('## Objetivo\n- **Uno**\n- `dos`')).toBe('Objetivo Uno · dos');
  });
});
