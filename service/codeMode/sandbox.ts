import * as nodeModule from 'node:module';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSSyncVariant,
} from 'quickjs-emscripten-core';
import quickjsVariant from '@jitl/quickjs-singlefile-cjs-release-sync';

/**
 * Runs model-written JavaScript in QuickJS compiled to WebAssembly: a separate engine with no
 * file system, network, timers, environment or `require`. The guest only reaches the host
 * through `call`, and only JSON strings cross the boundary. Knows nothing about Bitácora.
 */
export interface SandboxOptions {
  /** Function names exposed as `async` methods of the global `bitacora`. */
  names: string[];
  /** Host implementation; a thrown `Error` reaches the guest as a catchable error. */
  call: (name: string, input: unknown) => Promise<unknown>;
  timeoutMs?: number;
  maxInFlight?: number;
  maxLogChars?: number;
}
export type SandboxResult =
  | { ok: true; result?: string; logs: string[] }
  | { ok: false; error: { message: string; line?: number }; logs: string[] };

const WASM_PAGE = 64 * 1024;
/** Hard memory cap: QuickJS's own limit does not count many small allocations in this build. */
const MAX_MEMORY = 64 * 1024 * 1024;
/** Below the host's native stack, so QuickJS reports a stack overflow instead of crashing. */
const MAX_STACK = 256 * 1024;
const FILE = 'codigo.js';
// The model's code starts on the second line of the wrapper.
const LINE_OFFSET = 1;

// Node's loader hands over `module.exports`; esbuild already resolves the default export.
const baseVariant = (
  'default' in quickjsVariant ? quickjsVariant.default : quickjsVariant
) as QuickJSSyncVariant;

/** Removes TypeScript annotations keeping positions; the guest reports a syntax error if not. */
function stripTypes(code: string) {
  const strip = (nodeModule as { stripTypeScriptTypes?: (code: string) => string })
    .stripTypeScriptTypes;
  if (!strip) return code;
  try {
    return strip(code);
  } catch {
    return code;
  }
}

function prelude(names: string[]) {
  return `(() => {
  const call = globalThis.__llamar, log = globalThis.__registrar;
  delete globalThis.__llamar;
  delete globalThis.__registrar;
  const text = (value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  const writer = (level) => (...args) => log(level, args.map(text).join(' '));
  globalThis.console = Object.freeze({
    log: writer('log'), info: writer('info'), warn: writer('warn'), error: writer('error'),
  });
  const api = {};
  for (const name of ${JSON.stringify(names)})
    api[name] = async (input = {}) => {
      // Taken before the first await, while the caller's line is still on the stack.
      const site = new Error().stack;
      let json;
      try {
        json = await call(name, JSON.stringify(input));
      } catch (cause) {
        const error = new Error(cause.message);
        error.stack = site;
        throw error;
      }
      return JSON.parse(json);
    };
  globalThis.bitacora = Object.freeze(api);
})();`;
}

function errorLine(stack: unknown) {
  const match = typeof stack === 'string' ? stack.match(/codigo\.js:(\d+)/) : null;
  const line = match ? Number(match[1]) - LINE_OFFSET : 0;
  return line > 0 ? line : undefined;
}

function describe(error: unknown) {
  if (error && typeof error === 'object') {
    const { name, message, stack } = error as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    const text = `${typeof name === 'string' ? name : 'Error'}: ${String(message ?? '')}`;
    return { message: text.slice(0, 1000), line: errorLine(stack) };
  }
  return { message: String(error).slice(0, 1000) };
}

export async function runSandboxed(code: string, options: SandboxOptions): Promise<SandboxResult> {
  const { names, call, timeoutMs = 30000, maxInFlight = 4, maxLogChars = 4000 } = options;
  const logs: string[] = [];
  let logChars = 0;
  let logCut = false;
  // A fresh module per run: its bounded memory is released with it, whatever the guest did.
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(baseVariant, {
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: MAX_MEMORY / WASM_PAGE }),
    }),
  );
  const runtime = module.newRuntime();
  runtime.setMaxStackSize(MAX_STACK);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const context = runtime.newContext();
  let closed = false;
  const deferreds = new Set<QuickJSDeferredPromise>();
  const pending = new Set<Promise<void>>();
  const queue: (() => void)[] = [];
  let inFlight = 0;

  const pump = () => {
    if (closed) return;
    const jobs = runtime.executePendingJobs();
    if (jobs.error) jobs.error.dispose();
  };
  const release = () => {
    inFlight--;
    queue.shift()?.();
  };
  const slot = () =>
    inFlight < maxInFlight
      ? (inFlight++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(() => (inFlight++, resolve())));

  const callHandle = context.newFunction('__llamar', (nameHandle, inputHandle) => {
    const name = context.getString(nameHandle);
    const input = context.getString(inputHandle);
    const deferred = context.newPromise();
    deferreds.add(deferred);
    const settle = (value: { ok: true; json: string } | { ok: false; message: string }) => {
      if (closed || !deferred.alive) return;
      const handle: QuickJSHandle = value.ok
        ? context.newString(value.json)
        : context.newError(value.message);
      if (value.ok) deferred.resolve(handle);
      else deferred.reject(handle);
      handle.dispose();
    };
    const task = slot()
      .then(() => {
        // Calls still queued when the run ends are never sent.
        if (closed) throw Error('La ejecución ya terminó.');
        return call(name, JSON.parse(input));
      })
      .then(
        (result) => settle({ ok: true, json: JSON.stringify(result ?? null) }),
        (error: unknown) =>
          settle({ ok: false, message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(release);
    pending.add(task);
    void task.then(() => pending.delete(task));
    void deferred.settled.then(pump);
    return deferred.handle;
  });
  const logHandle = context.newFunction('__registrar', (levelHandle, textHandle) => {
    const level = context.getString(levelHandle);
    const text = context.getString(textHandle);
    if (logCut) return;
    const line = level === 'log' ? text : `[${level}] ${text}`;
    if (logChars + line.length > maxLogChars) {
      logs.push(line.slice(0, Math.max(0, maxLogChars - logChars)), '… registro recortado');
      logCut = true;
      return;
    }
    logs.push(line);
    logChars += line.length;
  });
  context.setProp(context.global, '__llamar', callHandle);
  context.setProp(context.global, '__registrar', logHandle);
  callHandle.dispose();
  logHandle.dispose();

  const finish = (result: SandboxResult) => {
    closed = true;
    try {
      for (const deferred of deferreds) if (deferred.alive) deferred.dispose();
      context.dispose();
      runtime.dispose();
    } catch {
      // The module is discarded anyway; a leaked handle must not hide the result.
    }
    return result;
  };

  try {
    const setup = context.evalCode(prelude(names), 'preludio.js');
    if (setup.error) {
      const error = describe(context.dump(setup.error));
      setup.error.dispose();
      return finish({ ok: false, error, logs });
    }
    setup.value.dispose();
    const wrapped = stripTypes(
      `(async () => {\n${code}\n})().then((value) => value === undefined ? undefined : JSON.stringify(value))`,
    );
    const evaluated = context.evalCode(wrapped, FILE);
    if (evaluated.error) {
      const error = describe(context.dump(evaluated.error));
      evaluated.error.dispose();
      return finish({ ok: false, error, logs });
    }
    const settled = context.resolvePromise(evaluated.value);
    evaluated.value.dispose();
    pump();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
    });
    const outcome = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      closed = true;
      await Promise.allSettled([...pending]);
      return finish({
        ok: false,
        error: { message: `Tiempo agotado: el código superó ${timeoutMs / 1000} s.` },
        logs,
      });
    }
    // Calls started but not awaited still run: wait for them so their effects are reported.
    await Promise.allSettled([...pending]);
    if (outcome.error) {
      const error = describe(context.dump(outcome.error));
      outcome.error.dispose();
      return finish({ ok: false, error, logs });
    }
    const value = context.dump(outcome.value);
    outcome.value.dispose();
    return finish({ ok: true, result: typeof value === 'string' ? value : undefined, logs });
  } catch (error) {
    // The host's own stack or memory gave out inside WebAssembly; the module is discarded.
    return finish({ ok: false, error: describe(error), logs });
  }
}
