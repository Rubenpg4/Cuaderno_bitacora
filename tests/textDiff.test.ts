import { describe, expect, it } from 'vitest';
import { diffWords, inlineTextDiff } from '../shared/textDiff';

describe('diferencias por palabras', () => {
  it('marca solo la palabra insertada', () => {
    expect(diffWords('Revisar el informe', 'Revisar el informe final')).toEqual([
      { kind: 'same', text: 'Revisar el informe' },
      { kind: 'added', text: ' final' },
    ]);
  });

  it('marca solo la palabra borrada', () => {
    expect(diffWords('Revisar el informe final', 'Revisar el informe')).toEqual([
      { kind: 'same', text: 'Revisar el informe' },
      { kind: 'removed', text: ' final' },
    ]);
  });

  it('muestra una sustitución como borrado seguido de inserción', () => {
    expect(diffWords('Enviar el lunes por la mañana', 'Enviar el martes por la mañana')).toEqual([
      { kind: 'same', text: 'Enviar el ' },
      { kind: 'removed', text: 'lunes' },
      { kind: 'added', text: 'martes' },
      { kind: 'same', text: ' por la mañana' },
    ]);
  });

  it('agrupa cambios contiguos separados solo por espacios', () => {
    expect(diffWords('uno dos tres cuatro', 'uno seis siete cuatro')).toEqual([
      { kind: 'same', text: 'uno ' },
      { kind: 'removed', text: 'dos tres' },
      { kind: 'added', text: 'seis siete' },
      { kind: 'same', text: ' cuatro' },
    ]);
  });

  it('separa la puntuación de las palabras', () => {
    expect(diffWords('Hecho.', 'Hecho, revisado.')).toEqual([
      { kind: 'same', text: 'Hecho' },
      { kind: 'added', text: ', revisado' },
      { kind: 'same', text: '.' },
    ]);
  });

  it('devuelve un único segmento para textos idénticos', () => {
    expect(diffWords('Sin cambios', 'Sin cambios')).toEqual([
      { kind: 'same', text: 'Sin cambios' },
    ]);
  });

  it('trata los textos vacíos como inserción o borrado completos', () => {
    expect(diffWords('', 'Nuevo texto')).toEqual([{ kind: 'added', text: 'Nuevo texto' }]);
    expect(diffWords('Texto anterior', '')).toEqual([{ kind: 'removed', text: 'Texto anterior' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('conserva los saltos de línea y detecta líneas nuevas', () => {
    const segments = diffWords(
      'Primera línea\nTercera línea',
      'Primera línea\nSegunda\nTercera línea',
    );
    expect(segments).toEqual([
      { kind: 'same', text: 'Primera línea\n' },
      { kind: 'added', text: 'Segunda\n' },
      { kind: 'same', text: 'Tercera línea' },
    ]);
    expect(segments?.map((segment) => segment.text).join('')).toContain('\n');
  });

  it('reconstruye ambos textos a partir de los segmentos', () => {
    const before = 'La tarea queda bloqueada por el proveedor.\nSe revisará el jueves.';
    const after = 'La tarea queda pendiente del proveedor externo.\nSe revisará el viernes.';
    const segments = diffWords(before, after) ?? [];
    const join = (skip: string) =>
      segments
        .filter((segment) => segment.kind !== skip)
        .map((segment) => segment.text)
        .join('');
    expect(join('added')).toBe(before);
    expect(join('removed')).toBe(after);
  });
});

describe('diferencias en línea', () => {
  const long = Array.from({ length: 80 }, (_, index) => `palabra${index}`).join(' ');

  it('resalta un cambio de una palabra en un texto largo', () => {
    const segments = inlineTextDiff(long, long.replace('palabra40', 'cambio'));
    expect(segments?.filter((segment) => segment.kind !== 'same')).toEqual([
      { kind: 'removed', text: 'palabra40' },
      { kind: 'added', text: 'cambio' },
    ]);
  });

  it('recurre a la vista completa si no hay texto común suficiente', () => {
    expect(inlineTextDiff('Comprar material de oficina', 'Llamar al cliente mañana')).toBe(
      undefined,
    );
    expect(inlineTextDiff('', 'Nuevo')).toBe(undefined);
    expect(inlineTextDiff('Igual', 'Igual')).toBe(undefined);
  });

  it('recurre a la vista completa si los textos son demasiado largos para comparar', () => {
    const before = Array.from({ length: 1200 }, (_, index) => `a${index}`).join(' ');
    const after = Array.from({ length: 1200 }, (_, index) => `b${index}`).join(' ');
    expect(diffWords(`x ${before} y`, `x ${after} y`)).toBe(undefined);
    expect(inlineTextDiff(`x ${before} y`, `x ${after} y`)).toBe(undefined);
  });
});
