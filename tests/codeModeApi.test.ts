import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_ACTION_TOOLS } from '../shared/mcpProtocol';
import { MCP_TOOLS } from '../service/mcpTools';
import { zodToTs } from '../service/codeMode/zodToTs';
import {
  CODE_LIMITS,
  apiDeclarations,
  apiIndex,
  codeTools,
  runCode,
  type ServiceRequest,
} from '../service/codeMode/api';

// A synthetic service: no notebook, vault or user data is involved.
const calls: { action: string; input: unknown }[] = [];
const service: ServiceRequest = async (action, input) => {
  calls.push({ action, input });
  if (action === 'propose')
    return { ok: true, data: { id: `p${calls.length}`, status: 'pending' } };
  if (action === 'summary') return { ok: false, error: 'Proyecto no autorizado.' };
  return { ok: true, data: { items: [{ id: 't1', title: 'Tarea' }], nextOffset: null } };
};
const exec = async (code: string, asvsEnabled: boolean | undefined = true) => {
  calls.length = 0;
  const run = await runCode(code, { request: service, asvsEnabled });
  return { isError: run.isError, body: JSON.parse(run.text) };
};

describe('API del modo código', () => {
  it('cubre exactamente las acciones del servicio con los nombres de las herramientas', () => {
    const published = new Set(Object.values(MCP_ACTION_TOOLS));
    expect(new Set(MCP_TOOLS.map((tool) => tool.name))).toEqual(published);
    for (const tool of MCP_TOOLS)
      expect(
        MCP_ACTION_TOOLS[tool.mapInput ? `${tool.action}-delete` : tool.action],
        tool.name,
      ).toBe(tool.name);
  });
  it('imprime tipos TypeScript a partir de los esquemas Zod', () => {
    const schema = z.object({
      kind: z.enum(['task', 'entry']),
      ids: z.array(z.string()).max(10),
      level: z.union([z.literal(1), z.literal(2)]).optional(),
      offset: z.number().int().default(0),
      ref: z
        .string()
        .refine((v) => v.length > 0)
        .nullable(),
      patch: z.record(z.unknown()),
    });
    expect(zodToTs(schema)).toBe(
      [
        '{',
        '  kind: "task" | "entry";',
        '  ids: string[];',
        '  level?: 1 | 2;',
        '  offset?: number;',
        '  ref: string | null;',
        '  patch: Record<string, unknown>;',
        '}',
      ].join('\n'),
    );
  });
  it('lista las funciones y da sus firmas bajo demanda', () => {
    const index = apiIndex(codeTools(false));
    expect(index).toContain('- filtrar_registros [lectura]: Filtra metadatos');
    expect(index).toContain('- proponer_cambios [escritura]');
    expect(index).not.toContain('consultar_asvs');
    const types = apiDeclarations(codeTools(true), ['resumir_proyecto', 'leer_referencias_asvs']);
    expect(types).toContain('function resumir_proyecto(args: {\n    projectId: string;\n  }');
    expect(types).toContain('overdueTasks: number;');
    expect(types).toContain('references: string[];');
    expect(types).not.toContain('unknown;\n  }>;\n  /** Filtra');
    expect(() => apiDeclarations(codeTools(false), ['consultar_asvs'])).toThrow(
      'Funciones no disponibles: consultar_asvs',
    );
    // Every published signature can be printed.
    expect(
      apiDeclarations(
        codeTools(true),
        MCP_TOOLS.map((tool) => tool.name),
      ).length,
    ).toBeLessThan(40000);
  });
  it('ejecuta el código contra el servicio y devuelve solo el resultado', async () => {
    const run =
      await exec(`const page = await bitacora.filtrar_registros({ kind: 'task', limit: 10 });
return page.items.map((item) => item.title);`);
    expect(run).toEqual({ isError: false, body: { resultado: ['Tarea'], llamadas: 1 } });
    expect(calls).toEqual([{ action: 'filter', input: { kind: 'task', limit: 10 } }]);
  });
  it('valida la entrada antes de llamar al servicio', async () => {
    const run = await exec(
      'try { await bitacora.filtrar_registros({ limite: 3 }); } catch (e) { return e.message; }',
    );
    expect(run.body.resultado).toBe(
      "filtrar_registros: Revisa los campos: entrada: Unrecognized key(s) in object: 'limite'",
    );
    expect(calls).toEqual([]);
  });
  it('propaga los errores del servicio como excepciones con la herramienta', async () => {
    const run = await exec(`await bitacora.resumir_proyecto({ projectId: 'p' });`);
    expect(run).toEqual({
      isError: true,
      body: { error: 'Error: resumir_proyecto: Proyecto no autorizado.', linea: 1, llamadas: 1 },
    });
  });
  it('informa siempre de las propuestas y aplica su tope', async () => {
    const run = await exec(`for (let i = 0; i < ${CODE_LIMITS.writes + 1}; i++)
  await bitacora.proponer_eliminacion({ kind: 'idea', targetId: 'i' + i, expectedVersion: 1, rationale: 'Duplicada' });`);
    expect(run.isError).toBe(true);
    expect(run.body.error).toContain(`Límite de ${CODE_LIMITS.writes} propuestas`);
    expect(run.body.propuestas).toHaveLength(CODE_LIMITS.writes);
    expect(run.body.propuestas[0]).toEqual({
      herramienta: 'proponer_eliminacion',
      id: 'p1',
      status: 'pending',
    });
    expect(calls[0].input).toMatchObject({ operation: 'delete', patch: {}, targetId: 'i0' });
  });
  it('aplica el tope de llamadas por ejecución', async () => {
    const run = await exec(`for (;;) await bitacora.buscar_contexto({ query: 'x' });`);
    expect(run.body.error).toContain(`Límite de ${CODE_LIMITS.calls} llamadas`);
    expect(run.body.llamadas).toBe(CODE_LIMITS.calls);
    expect(calls).toHaveLength(CODE_LIMITS.calls);
  });
  it('avisa si el código no devuelve nada y recorta un resultado demasiado largo', async () => {
    expect((await exec('await bitacora.buscar_contexto({});')).body.aviso).toContain('return');
    const long = await exec(`return 'x'.repeat(${CODE_LIMITS.resultChars * 2});`);
    expect(long.body).toMatchObject({ recortado: true });
    expect(long.body.resultado).toHaveLength(CODE_LIMITS.resultChars);
  });
  it('no ofrece funciones ASVS con ASVS desactivado', async () => {
    const run = await exec('return typeof bitacora.consultar_asvs;', false);
    expect(run.body.resultado).toBe('undefined');
  });
});
