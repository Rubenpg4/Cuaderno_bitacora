import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Vault } from './vault.js';
import { Domain } from './domain.js';
import { Workspaces } from './workspaces.js';
import { exportDocument } from './export.js';
import { asvsReportExport } from './asvs/report.js';
import type { Kind, McpProfile, Provider } from '../shared/model.js';
export function defaultDataDir() {
  return (
    process.env.BITACORA_DATA_DIR ||
    join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'Bitacora')
  );
}
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 25 * 1024 * 1024) throw Error('Contenido demasiado grande.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw Error('Contenido JSON inválido.');
  }
}
export async function startServer(
  options: {
    dir?: string;
    port?: number;
    uiDir?: string;
    idleMs?: number;
    token?: string;
    exclusive?: boolean;
  } = {},
) {
  const dir = options.dir || defaultDataDir(),
    workspaces = new Workspaces(dir);
  let domain = new Domain(new Vault(dir));
  const fileGrantProviders: Provider[] = ['claude', 'codex', 'antigravity'];
  const providerGrantPath = (provider: Provider) => join(dir, `mcp-grant-${provider}.json`);
  const clearFileGrant = (provider?: Provider, id?: string) => {
    const targets = provider ? [provider] : fileGrantProviders;
    for (const p of targets) {
      try {
        const path = providerGrantPath(p);
        if (id && JSON.parse(readFileSync(path, 'utf8')).id !== id) continue;
        unlinkSync(path);
      } catch {}
    }
  };
  const lockPath = join(dir, 'service.lock');
  if (options.exclusive !== false) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    } catch {
      const pid = Number(readFileSync(lockPath, 'utf8'));
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {}
      if (alive) throw Error('Bitácora ya está abierta.');
      unlinkSync(lockPath);
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    }
  }
  clearFileGrant();
  const token = options.token || randomBytes(32).toString('base64url');
  let port = 0;
  let lifecycleBusy = false;
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const origin = req.headers.origin;
    const allowed = [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      `http://127.0.0.1:${port}`,
    ];
    if (process.env.BITACORA_DEV === '1') allowed.push('http://127.0.0.1:1420');
    if (origin && !allowed.includes(origin)) {
      send(res, 403, { error: 'Origen no permitido.' });
      return;
    }
    if (req.headers.host !== `127.0.0.1:${port}`) {
      send(res, 403, { error: 'Host no permitido.' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url || '/', `http://127.0.0.1:${port}`).pathname;
    try {
      if (path.startsWith('/api/') || path === '/mcp') {
        const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
        if (path === '/mcp') {
          if (req.method !== 'POST') {
            send(res, 405, { error: 'Método no permitido.' });
            return;
          }
          let grant;
          try {
            grant = domain.authorize(bearer);
          } catch {
            send(res, 401, { error: 'Sesión MCP revocada, caducada o no autorizada.' });
            return;
          }
          if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
          const d = await body(req);
          if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
          try {
            grant = domain.authorize(bearer);
          } catch {
            send(res, 401, { error: 'Sesión MCP revocada, caducada o no autorizada.' });
            return;
          }
          let result;
          if (d.action === 'session') result = domain.sessionInfo(grant);
          else if (d.action === 'context') result = domain.context(grant, d.input, true);
          else if (d.action === 'read') {
            if (!Array.isArray(d.input?.recordIds) || !d.input.recordIds.length)
              throw Error('Selecciona los identificadores que quieres leer.');
            result = domain.context(grant, {
              recordIds: d.input.recordIds,
              offset: d.input.offset,
              excerptOffset: d.input.excerptOffset,
              limit: 10,
            });
          } else if (d.action === 'criteria') {
            if (typeof d.input?.taskId !== 'string' || !d.input.taskId)
              throw Error('Indica una tarea autorizada.');
            result = domain.context(grant, {
              taskId: d.input.taskId,
              kind: 'practice',
              offset: d.input.offset,
              limit: 5,
            });
          } else if (d.action === 'propose') result = domain.propose(grant, d.input);
          else if (d.action === 'asvs-query') result = domain.asvsQuery(grant, d.input);
          else if (d.action === 'asvs-read') result = domain.asvsRead(grant, d.input);
          else if (d.action === 'asvs-propose') result = domain.asvsPropose(grant, d.input);
          else if (d.action === 'asvs-task-criteria')
            result = domain.asvsTaskCriteria(grant, d.input);
          else if (d.action === 'asvs-task-propose')
            result = domain.asvsTaskPropose(grant, d.input);
          else if (d.action === 'asvs-remediation') result = domain.asvsRemediation(grant, d.input);
          else if (d.action === 'asvs-revision-propose')
            result = domain.asvsRevisionPropose(grant, d.input);
          else if (d.action === 'complete-task') result = domain.completeTask(grant, d.input);
          else if (d.action === 'filter') result = domain.filterRecords(grant, d.input);
          else if (d.action === 'summary') result = domain.projectSummary(grant, d.input);
          else if (d.action === 'task-quality') result = domain.taskQuality(grant, d.input);
          else if (d.action === 'relations') result = domain.relatedRecords(grant, d.input);
          else if (d.action === 'proposals') result = domain.proposalStatus(grant);
          else throw Error('Operación no permitida.');
          send(res, 200, result);
          return;
        }
        if (!safeEqual(bearer, token)) {
          send(res, 401, { error: 'Sesión de aplicación no válida.' });
          return;
        }
        if (path === '/api/status' && req.method === 'GET') {
          send(res, 200, workspaces.status());
          return;
        }
        if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
        if (req.method !== 'POST') throw Error('Método no permitido.');
        const d = await body(req);
        if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
        if (path === '/api/unlock') {
          if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
          lifecycleBusy = true;
          try {
            const result = await workspaces.unlock(
              String(d.projectId || ''),
              String(d.password || ''),
            );
            domain = workspaces.domain!;
            send(res, 200, result);
          } finally {
            lifecycleBusy = false;
          }
          return;
        }
        if (path === '/api/lock') {
          workspaces.lock();
          clearFileGrant();
          send(res, 200, { ok: true });
          return;
        }
        if (path === '/api/create-project') {
          if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
          lifecycleBusy = true;
          try {
            const result = await workspaces.create(
              String(d.title || ''),
              String(d.password || ''),
              d.profile === undefined ? 'personal' : (d.profile as McpProfile),
            );
            domain = workspaces.domain!;
            send(res, 200, result);
          } finally {
            lifecycleBusy = false;
          }
          return;
        }
        if (path === '/api/remove-project') {
          if (d.confirm !== 'ELIMINAR') throw Error('Escribe ELIMINAR para confirmar.');
          if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
          lifecycleBusy = true;
          try {
            send(
              res,
              200,
              await workspaces.delete(String(d.projectId || ''), String(d.password || '')),
            );
          } finally {
            lifecycleBusy = false;
          }
          return;
        }
        domain.require();
        if (path !== '/api/snapshot') domain.lastActivity = Date.now();
        switch (path) {
          case '/api/snapshot': {
            let recurrenceWarning: string | undefined;
            try {
              domain.reconcileTaskSeries();
            } catch (error) {
              recurrenceWarning = `No se pudieron actualizar las tareas recurrentes: ${(error as Error).message}`;
            }
            domain.startOverdueTasks();
            send(res, 200, { ...domain.snapshot(), recurrenceWarning });
            break;
          }
          case '/api/activity':
            domain.lastActivity = Date.now();
            send(res, 200, { ok: true });
            break;
          case '/api/asvs-list':
            send(res, 200, domain.asvsList(d));
            break;
          case '/api/asvs-report-preview':
            send(res, 200, domain.asvsReportPreview(d));
            break;
          case '/api/asvs-report-export': {
            const request = asvsReportExport.parse(d);
            const preview = domain.asvsReportPreview(request.selection);
            if (preview.digest !== request.expectedDigest)
              throw Error('El contenido ASVS ha cambiado. Previsualiza y revisa de nuevo.');
            const out = await exportDocument(request.format, preview[request.format]);
            send(res, 200, {
              data: out.bytes.toString('base64'),
              type: out.type,
              extension: out.extension,
            });
            break;
          }
          case '/api/asvs-catalog-preview':
            send(res, 200, domain.asvsCatalogPreview(d));
            break;
          case '/api/asvs-catalog-update':
            send(res, 200, domain.asvsCatalogUpdate(d));
            break;
          case '/api/asvs-source-revision':
            send(res, 200, domain.asvsSourceRevision(d));
            break;
          case '/api/asvs-revision-review':
            send(res, 200, domain.asvsRevisionReview(d));
            break;
          case '/api/weekly-signals':
            send(res, 200, domain.weeklySignals());
            break;
          case '/api/asvs-task-review':
            send(res, 200, domain.asvsTaskReview(d));
            break;
          case '/api/asvs-task-status':
            send(res, 200, domain.asvsTaskStatuses(d));
            break;
          case '/api/asvs-review-proposals':
            send(res, 200, domain.asvsReviewProposals(d));
            break;
          case '/api/asvs-configure':
            send(res, 200, domain.asvsConfigure(d));
            break;
          case '/api/asvs-review':
            send(res, 200, domain.asvsReview(d));
            break;
          case '/api/asvs-history':
            send(res, 200, domain.asvsHistory(d));
            break;
          case '/api/change-password':
            send(
              res,
              200,
              workspaces.changePassword(String(d.current || ''), String(d.next || '')),
            );
            break;
          case '/api/save': {
            const saved = domain.save(d.kind as Kind, d.data, d.id, d.expectedVersion, d.draftKey);
            if (saved.kind === 'project') workspaces.syncTitle(saved);
            send(res, 200, saved);
            break;
          }
          case '/api/subproject-save':
            send(res, 200, domain.saveSubproject(d.data, d.id, d.expectedVersion));
            break;
          case '/api/subproject-status':
            send(res, 200, domain.setSubprojectStatus(d.id, d.expectedVersion, d.status));
            break;
          case '/api/subproject-delete':
            if (d.confirm !== 'ELIMINAR') throw Error('Confirma la eliminación del subproyecto.');
            send(res, 200, domain.deleteSubproject(d.id, d.expectedVersion));
            break;
          case '/api/finish-weekly-review':
            send(res, 200, domain.finishWeeklyReview(d.expectedVersion));
            break;
          case '/api/decide-weekly-signal':
            send(res, 200, domain.decideWeeklySignal(d));
            break;
          case '/api/save-follow-up-task':
            send(
              res,
              200,
              domain.saveFollowUpTask(
                d.data,
                d.meetingId,
                d.agreementId,
                d.expectedMeetingVersion,
                d.draftKey,
              ),
            );
            break;
          case '/api/save-task-series':
            send(
              res,
              200,
              domain.saveTaskSeries(d.data, d.rule, d.id, d.expectedVersion, d.draftKey),
            );
            break;
          case '/api/stop-task-series':
            send(res, 200, domain.stopTaskSeries(d.id, d.expectedVersion));
            break;
          case '/api/save-draft':
            send(res, 200, domain.saveDraft(d.key, d.data));
            break;
          case '/api/delete-draft':
            send(res, 200, domain.deleteDraft(d.key));
            break;
          case '/api/capture-create':
            send(res, 200, domain.createCapture(d.text));
            break;
          case '/api/capture-update':
            send(res, 200, domain.updateCapture(d.id, d.expectedVersion, d.text));
            break;
          case '/api/capture-link':
            send(res, 200, domain.linkCapture(d.id, d.expectedVersion, d.recordId));
            break;
          case '/api/capture-discard':
            send(res, 200, domain.discardCapture(d.id, d.expectedVersion));
            break;
          case '/api/capture-convert':
            send(
              res,
              200,
              domain.convertCapture(d.id, d.expectedVersion, d.kind, d.data, d.draftKey),
            );
            break;
          case '/api/delete-task':
            send(res, 200, domain.deleteTask(d.id, d.expectedVersion));
            break;
          case '/api/delete-incident':
            send(res, 200, domain.deleteIncident(d.id, d.expectedVersion));
            break;
          case '/api/delete-entry':
            send(res, 200, domain.deleteEntry(d.id, d.expectedVersion));
            break;
          case '/api/delete-decision':
            send(res, 200, domain.deleteDecision(d.id, d.expectedVersion));
            break;
          case '/api/delete-idea':
            send(res, 200, domain.deleteIdea(d.id, d.expectedVersion));
            break;
          case '/api/delete-meeting':
            send(res, 200, domain.deleteMeeting(d.id, d.expectedVersion));
            break;
          case '/api/delete-project':
            send(res, 200, domain.deleteProject(d.id, d.expectedVersion));
            break;
          case '/api/delete-practice':
            send(res, 200, domain.deletePractice(d.id, d.expectedVersion));
            break;
          case '/api/delete-objective':
            send(res, 200, domain.deleteObjective(d.id, d.expectedVersion));
            break;
          case '/api/sync-criteria':
            send(res, 200, domain.syncCriteria(d.id, d.version));
            break;
          case '/api/undo':
            send(res, 200, domain.undo(d.id));
            break;
          case '/api/restore-task-version':
            send(res, 200, domain.restoreTask(d.historyId, d.taskId, d.expectedVersion));
            break;
          case '/api/settings':
            send(res, 200, domain.settings(d));
            if (!d.companyAuthorized) clearFileGrant();
            break;
          case '/api/mcp-profile': {
            const profile = domain.setMcpProfile(d.profile);
            clearFileGrant();
            send(res, 200, { profile });
            break;
          }
          case '/api/grant': {
            if (d.scope !== 'projects' || !Array.isArray(d.projectIds) || d.shareIds?.length)
              throw Error('Selecciona proyectos para abrir una sesión MCP.');
            const durationMinutes =
              d.durationMinutes === undefined ? undefined : Number(d.durationMinutes);
            const grant = domain.grant(
              d.provider as Provider,
              [],
              'projects',
              d.projectIds,
              durationMinutes,
              d.canCompleteTasks,
              d.scopes,
            );
            if (fileGrantProviders.includes(d.provider as Provider)) {
              try {
                writeFileSync(
                  providerGrantPath(d.provider as Provider),
                  JSON.stringify({ id: grant.id, token: grant.token }),
                  {
                    mode: 0o600,
                  },
                );
              } catch {
                domain.revokeGrant(grant.id);
                const clientName =
                  d.provider === 'claude'
                    ? 'Claude'
                    : d.provider === 'antigravity'
                      ? 'Antigravity'
                      : 'Codex';
                throw Error(`No se pudo preparar la conexión local de ${clientName}.`);
              }
            }
            send(res, 200, {
              ...grant,
              dataDir: dir,
              nodePath: process.execPath,
              mcpPath:
                process.env.BITACORA_MCP_PATH ||
                resolve(dirname(fileURLToPath(import.meta.url)), 'mcp.cjs'),
            });
            break;
          }
          case '/api/renew-grant': {
            const durationMinutes =
              d.durationMinutes === undefined ? undefined : Number(d.durationMinutes);
            send(res, 200, domain.renewGrant(d.id, durationMinutes));
            break;
          }
          case '/api/revoke-grant':
            domain.revokeGrant(d.id);
            clearFileGrant(undefined, d.id);
            send(res, 200, { ok: true });
            break;
          case '/api/update-grant-projects':
            send(res, 200, domain.updateGrantProjects(d.id, d.projectIds, d.scopes));
            break;
          case '/api/review': {
            const reviewed = Array.isArray(d.ids)
              ? domain.reviewBatch(d.ids, d.accept === true, d.asvsIds)
              : domain.review(d.id, d.accept === true);
            const project = domain.require().records.find((record) => record.kind === 'project');
            if (project?.kind === 'project') workspaces.syncTitle(project);
            send(res, 200, reviewed);
            break;
          }
          case '/api/start-today-tasks':
            send(res, 200, domain.startTodayTasks(d.day, d.ids));
            break;
          case '/api/stop-today-tasks':
            send(res, 200, domain.stopTodayTasks(d.ids));
            break;
          case '/api/backup': {
            const bytes = domain.vault.backup(String(d.password || ''));
            send(res, 200, { data: bytes.toString('base64') });
            break;
          }
          case '/api/restore': {
            if (d.confirm !== 'RESTAURAR') throw Error('Escribe RESTAURAR para confirmar.');
            if (lifecycleBusy) throw Error('Operación de cuaderno en curso.');
            lifecycleBusy = true;
            try {
              const restored = await domain.vault.restore(
                Buffer.from(String(d.data || ''), 'base64'),
                String(d.password || ''),
              );
              workspaces.validateState(restored);
              domain.vault.save(restored);
              domain.state = restored;
              domain.grants.clear();
              clearFileGrant();
              const project = restored.records.find((record) => record.kind === 'project');
              if (project?.kind === 'project') workspaces.syncTitle(project);
              send(res, 200, domain.snapshot());
            } finally {
              lifecycleBusy = false;
            }
            break;
          }
          case '/api/export': {
            if (d.reviewed !== true || typeof d.body !== 'string' || d.body.length > 200000)
              throw Error('Revisa primero el contenido que vas a exportar.');
            if (d.format === 'csv') throw Error('Usa el informe ASVS para exportar CSV.');
            const out = await exportDocument(d.format, d.body);
            send(res, 200, {
              data: out.bytes.toString('base64'),
              type: out.type,
              extension: out.extension,
            });
            break;
          }
          default:
            send(res, 404, { error: 'Operación desconocida.' });
        }
        return;
      }
      if (req.method !== 'GET') {
        send(res, 405, { error: 'Método no permitido.' });
        return;
      }
      const uiDir = options.uiDir || process.env.BITACORA_UI_DIR || resolve(process.cwd(), 'dist');
      let file = resolve(uiDir, '.' + decodeURIComponent(path === '/ ' ? '' : path));
      if (path === '/') file = join(uiDir, 'index.html');
      if (!file.startsWith(resolve(uiDir) + requireSeparator()) || !existsSync(file)) {
        send(res, 404, { error: 'Archivo no encontrado.' });
        return;
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar la operación.';
      const unsafeMcpError =
        req.url?.startsWith('/mcp') &&
        (Boolean((error as NodeJS.ErrnoException)?.code) || /[\\/]|[a-f0-9]{64}/i.test(message));
      send(res, 400, {
        error: unsafeMcpError
          ? 'No se pudo completar la operación MCP.'
          : message.startsWith('[\n')
            ? 'Revisa los campos: hay valores no válidos.'
            : message.slice(0, 500),
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port || 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as { port: number }).port;
  writeFileSync(
    join(dir, 'connection.json'),
    JSON.stringify({ port, protocol: 1, pid: process.pid }),
    { mode: 0o600 },
  );
  const timer = setInterval(() => {
    for (const p of fileGrantProviders) {
      try {
        const { id } = JSON.parse(readFileSync(providerGrantPath(p), 'utf8'));
        const grant = domain.grants.get(id);
        if (!grant || Date.parse(grant.expiresAt) <= Date.now()) clearFileGrant(p, id);
      } catch {}
    }
    if (
      !lifecycleBusy &&
      domain.unlocked &&
      Date.now() - domain.lastActivity > (options.idleMs || 15 * 60000)
    ) {
      workspaces.lock();
      clearFileGrant();
    }
  }, 1000);
  timer.unref();
  return {
    server,
    get domain() {
      return domain;
    },
    port,
    token,
    close: async () => {
      clearInterval(timer);
      workspaces.lock();
      clearFileGrant();
      await new Promise<void>((r) => server.close(() => r()));
      for (const path of [
        join(dir, 'connection.json'),
        ...(options.exclusive === false ? [] : [lockPath]),
      ]) {
        try {
          unlinkSync(path);
        } catch {}
      }
    },
  };
}
function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}
if (process.env.BITACORA_NO_AUTOSTART !== '1' && !process.env.VITEST) {
  startServer()
    .then((app) => {
      const connection = { port: app.port, token: app.token };
      if (process.argv.includes('--browser')) {
        const url = `http://127.0.0.1:${app.port}/#session=${app.token}`;
        const cmd =
          process.platform === 'win32'
            ? 'explorer.exe'
            : process.platform === 'darwin'
              ? 'open'
              : 'xdg-open';
        spawn(cmd, [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        process.stdout.write('Bitácora abierta en tu navegador local.\n');
      } else process.stdout.write(JSON.stringify(connection) + '\n');
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        void app.close().then(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      if (process.env.BITACORA_PARENT_PID) {
        const pid = Number(process.env.BITACORA_PARENT_PID);
        setInterval(() => {
          try {
            process.kill(pid, 0);
          } catch {
            stop();
          }
        }, 2000).unref();
      }
    })
    .catch(() => {
      process.stderr.write(
        'No se pudo iniciar Bitácora. Comprueba que no esté ya abierta y que la carpeta de datos sea accesible.\n',
      );
      process.exit(1);
    });
}
