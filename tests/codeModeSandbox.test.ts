import { describe, expect, it } from 'vitest';
import { runSandboxed, type SandboxOptions } from '../service/codeMode/sandbox';

// Synthetic host functions only; the sandbox knows nothing about Bitácora.
const echo: SandboxOptions = {
  names: ['eco', 'falla'],
  call: async (name, input) => {
    if (name === 'falla') throw Error('Sin acceso: renueva la sesión.');
    return { name, input };
  },
};
const run = (code: string, options: Partial<SandboxOptions> = {}) =>
  runSandboxed(code, { ...echo, ...options });

describe('sandbox del modo código', () => {
  it('devuelve el valor de return como JSON y captura la consola', async () => {
    const result = await run(`console.log('hola', { a: 1 }); console.warn('ojo');
const r = await bitacora.eco({ x: 1 });
return { nombre: r.name, x: r.input.x };`);
    expect(result).toEqual({
      ok: true,
      result: JSON.stringify({ nombre: 'eco', x: 1 }),
      logs: ['hola {"a":1}', '[warn] ojo'],
    });
  });
  it('distingue el código sin return', async () => {
    expect(await run('await bitacora.eco();')).toMatchObject({ ok: true, result: undefined });
  });
  it('entrega los errores del host como excepciones capturables', async () => {
    const caught = await run(`try { await bitacora.falla({}); } catch (e) { return e.message; }`);
    expect(caught).toMatchObject({ ok: true, result: '"Sin acceso: renueva la sesión."' });
    const uncaught = await run(`await bitacora.falla({});`);
    expect(uncaught).toMatchObject({
      ok: false,
      error: { message: 'Error: Sin acceso: renueva la sesión.' },
    });
  });
  it('indica la línea del código en errores de sintaxis y de ejecución', async () => {
    expect(await run('const a = 1;\nconst b = ;')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('SyntaxError'), line: 2 },
    });
    expect(await run('const a = 1;\n\nnull.campo;')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('TypeError'), line: 3 },
    });
  });
  it('admite anotaciones de tipo TypeScript', async () => {
    const result = await run(
      'const total: number = [1, 2].reduce((a: number, b) => a + b, 0);\nreturn total as number;',
    );
    expect(result).toMatchObject({ ok: true, result: '3' });
  });
  it('corta bucles infinitos, exceso de memoria y recursión sin fin', async () => {
    const loop = await run('while (true) {}', { timeoutMs: 300 });
    expect(loop).toMatchObject({ ok: false, error: { message: 'InternalError: interrupted' } });
    const memory = await run('const a = []; while (true) a.push(new Array(1000).fill(1));');
    expect(memory).toMatchObject({ ok: false, error: { message: 'InternalError: out of memory' } });
    const stack = await run('function f() { return f(); }\nf();');
    expect(stack).toMatchObject({ ok: false, error: { message: 'InternalError: stack overflow' } });
    expect(await run('return 1;')).toMatchObject({ ok: true, result: '1' });
  });
  it('agota el tiempo aunque espere al host y no envía las llamadas en cola', async () => {
    const sent: string[] = [];
    const result = await run(
      `await Promise.all([1, 2].map((n) => bitacora.eco({ n })));
await bitacora.eco({ n: 3 });`,
      {
        maxInFlight: 1,
        timeoutMs: 100,
        call: async (_name, input) => {
          sent.push(JSON.stringify(input));
          await new Promise((resolve) => setTimeout(resolve, 150));
          return {};
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/^Tiempo/) },
    });
    expect(sent).toEqual(['{"n":1}']);
  });
  it('no expone el entorno del host', async () => {
    const result = await run(`return [
  typeof process, typeof require, typeof fetch, typeof setTimeout, typeof __llamar,
  typeof (function () {}).constructor('return this')().process,
];`);
    expect(JSON.parse((result as { result: string }).result)).toEqual(Array(6).fill('undefined'));
  });
  it('limita las llamadas simultáneas al host', async () => {
    let active = 0;
    let peak = 0;
    const result = await run(
      'return (await Promise.all([1, 2, 3, 4, 5, 6].map((n) => bitacora.eco({ n })))).length;',
      {
        maxInFlight: 2,
        call: async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
          return {};
        },
      },
    );
    expect(result).toMatchObject({ ok: true, result: '6' });
    expect(peak).toBe(2);
  });
  it('espera a las llamadas iniciadas sin await antes de terminar', async () => {
    const done: number[] = [];
    const result = await run('bitacora.eco({ n: 1 }); return "fin";', {
      call: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done.push(1);
        return {};
      },
    });
    expect(result).toMatchObject({ ok: true, result: '"fin"' });
    expect(done).toEqual([1]);
  });
  it('recorta la consola', async () => {
    const result = await run('for (let i = 0; i < 100; i++) console.log("x".repeat(50));', {
      maxLogChars: 120,
    });
    expect(result.logs.at(-1)).toBe('… registro recortado');
    expect(result.logs.slice(0, -1).join('').length).toBe(120);
  });
});
