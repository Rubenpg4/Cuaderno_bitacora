import { z } from 'zod';
import { MCP_TOOLS, type McpToolSpec } from '../mcpTools.js';
import { shapeToTs, zodToTs } from './zodToTs.js';

/** Per-run limits of `ejecutar_codigo`; documented in docs/modo-codigo.md. */
export const CODE_LIMITS = {
  codeChars: 20000,
  calls: 50,
  writes: 10,
  inFlight: 4,
  timeoutMs: 30000,
  resultChars: 12000,
  logChars: 4000,
};
export type ServiceRequest = (
  action: string,
  input: unknown,
) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/** ASVS functions follow the notebook; an unknown state keeps them and the service decides. */
export function codeTools(asvsEnabled: boolean | undefined) {
  return MCP_TOOLS.filter((tool) => !tool.asvs || asvsEnabled !== false);
}

const firstSentence = (text: string) => text.match(/^.*?[.;](?=\s|$)/)?.[0] ?? text;

/** Short list for progressive disclosure; signatures come from `apiDeclarations`. */
export function apiIndex(tools: McpToolSpec[]) {
  return [
    'Funciones de `bitacora` en ejecutar_codigo (mismos nombres y argumentos que las herramientas; devuelven el objeto ya parseado). Pide sus tipos con consultar_api({ funciones: [...] }).',
    ...tools.map(
      (tool) =>
        `- ${tool.name} [${tool.write ? 'escritura' : 'lectura'}]: ${firstSentence(tool.description)}`,
    ),
  ].join('\n');
}

export function apiDeclarations(tools: McpToolSpec[], names: string[]) {
  const unknown = names.filter((name) => !tools.some((tool) => tool.name === name));
  if (unknown.length)
    throw Error(
      `Funciones no disponibles: ${unknown.join(', ')}. Consulta la lista con consultar_api sin argumentos.`,
    );
  const declarations = tools
    .filter((tool) => names.includes(tool.name))
    .map((tool) => {
      const args = shapeToTs(tool.input, '  ');
      const optional = Object.values(tool.input).every((field) => field.isOptional()) ? '?' : '';
      return `  /** ${tool.description} */\n  function ${tool.name}(args${optional}: ${args}): Promise<${zodToTs(tool.output, '  ')}>;`;
    });
  return `declare namespace bitacora {\n${declarations.join('\n')}\n}`;
}

const fieldsError = (error: z.ZodError) =>
  `Revisa los campos: ${error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'entrada'}: ${issue.message}`)
    .join('; ')}`;

interface Write {
  herramienta: string;
  id: string;
  status: string;
}

/**
 * Runs `code` with one sandbox function per available tool. Each call goes through the same
 * service request as the direct tool, so the session is authorized again on every call.
 */
export async function runCode(
  code: string,
  options: {
    request: ServiceRequest;
    asvsEnabled: boolean | undefined;
    onSession?: (session: unknown) => void;
  },
) {
  const tools = codeTools(options.asvsEnabled);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const writes: Write[] = [];
  let calls = 0;
  let writeCalls = 0;
  const { runSandboxed } = await import('./sandbox.js');
  const run = await runSandboxed(code, {
    names: tools.map((tool) => tool.name),
    timeoutMs: CODE_LIMITS.timeoutMs,
    maxInFlight: CODE_LIMITS.inFlight,
    maxLogChars: CODE_LIMITS.logChars,
    call: async (name, input) => {
      const tool = byName.get(name)!;
      if (++calls > CODE_LIMITS.calls)
        throw Error(
          `Límite de ${CODE_LIMITS.calls} llamadas por ejecución: filtra antes o continúa en otra ejecución.`,
        );
      const parsed = z
        .object(tool.input)
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) throw Error(`${name}: ${fieldsError(parsed.error)}`);
      if (tool.write && ++writeCalls > CODE_LIMITS.writes)
        throw Error(
          `Límite de ${CODE_LIMITS.writes} propuestas por ejecución: revisa estas antes de proponer más.`,
        );
      const args = tool.mapInput ? tool.mapInput(parsed.data) : parsed.data;
      const response = await options.request(tool.action, args);
      if (!response.ok) throw Error(`${name}: ${response.error}`);
      if (tool.name === 'estado_sesion') options.onSession?.(response.data);
      if (tool.name === 'completar_tarea')
        writes.push({ herramienta: name, id: String(args.taskId), status: 'accepted' });
      else if (tool.write) {
        const { id, status } = response.data as { id: string; status: string };
        writes.push({ herramienta: name, id, status });
      }
      return response.data;
    },
  });
  const common = {
    llamadas: Math.min(calls, CODE_LIMITS.calls),
    ...(writes.length && { propuestas: writes }),
    ...(run.logs.length && { registros: run.logs }),
  };
  if (!run.ok)
    return {
      isError: true,
      text: JSON.stringify({
        error: run.error.message,
        ...(run.error.line && { linea: run.error.line }),
        ...common,
      }),
    };
  if (run.result === undefined)
    return {
      isError: false,
      text: JSON.stringify({
        resultado: null,
        aviso: 'El código no devolvió nada: termina con return y solo los datos necesarios.',
        ...common,
      }),
    };
  if (run.result.length > CODE_LIMITS.resultChars)
    return {
      isError: false,
      text: JSON.stringify({
        resultado: run.result.slice(0, CODE_LIMITS.resultChars),
        recortado: true,
        aviso: `Resultado recortado a ${CODE_LIMITS.resultChars} caracteres de JSON: devuelve menos campos o agrega en el código.`,
        ...common,
      }),
    };
  return {
    isError: false,
    text: `{"resultado":${run.result},${JSON.stringify(common).slice(1)}`,
  };
}
