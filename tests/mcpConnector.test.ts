import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import { ASVS_VERSION } from '../shared/asvs';
import { MCP_PROTOCOL_HEADER, MCP_PROTOCOL_MISMATCH } from '../shared/mcpProtocol';

// Runs the real stdio connector against a synthetic local service; no user data is involved.
let dir: string, app: Awaited<ReturnType<typeof startServer>>, client: Client;
let projectId: string;
const password = 'contraseña sintética del conector';
function post(path: string, data: unknown = {}, bearer = app.token) {
  return fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
async function grant() {
  return (
    await post('/api/grant', { provider: 'codex', scope: 'projects', projectIds: [projectId] })
  ).json();
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { isError: !!result.isError, text: result.content[0].text };
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-mcp-connector-'));
  app = await startServer({ dir });
  const created = await (await post('/api/create-project', { title: 'Conector', password })).json();
  projectId = created.records.find((r: { kind: string }) => r.kind === 'project').id;
  await post('/api/asvs-configure', {
    projectId,
    expectedConfigVersion: 0,
    catalogVersion: ASVS_VERSION,
    level: 1,
  });
  await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
  await grant();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'BITACORA_GRANT_TOKEN',
    ),
  );
  client = new Client({ name: 'prueba', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'service/mcp.ts'],
      env: { ...env, BITACORA_DATA_DIR: dir, BITACORA_PROVIDER: 'codex' },
      stderr: 'ignore',
    }),
  );
}, 30000);
afterAll(async () => {
  await client?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('conector MCP por stdio', () => {
  it('publica esquemas autocontenidos sin desplazamientos ni versiones negativos', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('leer_referencias_asvs');
    for (const t of tools) {
      // Some clients do not resolve JSON Schema references.
      expect(JSON.stringify(t.inputSchema), t.name).not.toContain('$ref');
      const properties = (t.inputSchema.properties ?? {}) as Record<string, { minimum?: number }>;
      for (const [name, schema] of Object.entries(properties))
        if (/offset$/i.test(name) || /^expected\w*Version$/.test(name))
          expect(schema.minimum ?? 0, `${t.name}.${name}`).toBeGreaterThanOrEqual(0);
    }
  });
  it('mantiene las definiciones dentro de su presupuesto, con títulos y avisos de idempotencia', async () => {
    const { tools } = await client.listTools();
    // Measured with every ASVS tool enabled; it was 19,485 characters before trimming.
    expect(JSON.stringify(tools).length).toBeLessThanOrEqual(16500);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description!.length, t.name).toBeLessThanOrEqual(400);
    }
    for (const name of ['proponer_cambios', 'proponer_eliminacion'])
      expect(tools.find((t) => t.name === name)!.annotations).toMatchObject({
        idempotentHint: true,
      });
  });
  it('consulta la sesión vigente', async () => {
    const session = await tool('estado_sesion');
    expect(session.isError).toBe(false);
    expect(JSON.parse(session.text)).toMatchObject({ connected: true, provider: 'codex' });
  });
  it('avisa de caducidad y bloqueo sin contar la llamada MCP como actividad', async () => {
    const before = app.domain.lastActivity;
    const session = JSON.parse((await tool('estado_sesion')).text);
    expect(app.domain.lastActivity).toBe(before);
    expect(session.expiresInMinutes).toBeGreaterThan(0);
    expect(session.idleLockAt).toBe(new Date(before + 15 * 60000).toISOString());
    expect(session.idleLockInMinutes).toBeLessThanOrEqual(15);
  });
  it('registra el último uso de la sesión sin guardar parámetros', async () => {
    const work = await (
      await post('/api/save', {
        kind: 'task',
        data: { ...blank('task'), project: projectId, title: 'Tarea leída' },
      })
    ).json();
    expect((await tool('leer_elementos', { recordIds: [work.id] })).isError).toBe(false);
    const snapshot = await (await post('/api/snapshot')).json();
    const used = snapshot.grants.find((g: { provider: string }) => g.provider === 'codex');
    expect(used).toMatchObject({ lastTool: 'leer_elementos' });
    expect(Date.parse(used.lastUsedAt)).toBeGreaterThan(Date.now() - 60000);
    expect(JSON.stringify(used)).not.toContain(work.id);
  });
  it('rechaza un conector o un servicio de otra versión de protocolo', async () => {
    const { token } = await grant();
    const stale = await fetch(`http://127.0.0.1:${app.port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        [MCP_PROTOCOL_HEADER]: '1',
      },
      body: JSON.stringify({ action: 'session', input: {} }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe(MCP_PROTOCOL_MISMATCH);
    const path = join(dir, 'connection.json');
    const connection = readFileSync(path, 'utf8');
    try {
      writeFileSync(path, JSON.stringify({ ...JSON.parse(connection), protocol: 1 }));
      expect(await tool('estado_sesion')).toMatchObject({
        isError: true,
        text: MCP_PROTOCOL_MISMATCH,
      });
    } finally {
      writeFileSync(path, connection);
    }
    expect((await tool('estado_sesion')).isError).toBe(false);
  });
  it('nombra el campo que falla en los errores de validación', async () => {
    const { token } = await grant();
    const read = await post('/mcp', { action: 'read', input: { recordIds: [], limit: 3 } }, token);
    expect(read.status).toBe(400);
    const { error } = await read.json();
    expect(error).toContain('recordIds: Selecciona los identificadores');
    expect(error).toContain('limit');
    // The connector relays it as a tool error the assistant can act on.
    expect(await tool('consultar_propuestas', { status: 'otro' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('status'),
    });
  });
  it('explica la causa del rechazo y el siguiente paso', async () => {
    const current = await grant();
    const mcp = async (token: string) =>
      (await post('/mcp', { action: 'session', input: {} }, token)).json();
    expect((await mcp('token-desconocido')).error).toBe(
      'Sesión revocada o no reconocida. Crea o renueva la sesión en Asistentes.',
    );
    const stored = app.domain.grants.get(current.id)!;
    const expiresAt = stored.expiresAt;
    stored.expiresAt = '2000-01-01T00:00:00.000Z';
    expect((await mcp(current.token)).error).toContain('Sesión caducada');
    stored.expiresAt = expiresAt;
    expect((await mcp(current.token)).connected).toBe(true);

    // Locking clears the connector's session file and revokes the token.
    await post('/api/lock');
    expect(await tool('estado_sesion')).toMatchObject({
      isError: true,
      text: expect.stringContaining('No hay una sesión MCP para este cliente'),
    });
    expect((await mcp(current.token)).error).toBe(
      'Bitácora está bloqueada. Desbloquea el cuaderno y crea o renueva la sesión en Asistentes.',
    );

    // A stale port means the app closed without cleaning up; a missing file, that it is closed.
    // Closing here also stops the timer that removes session files of revoked tokens.
    await app.close();
    writeFileSync(join(dir, 'connection.json'), JSON.stringify({ port: app.port }));
    writeFileSync(
      join(dir, 'mcp-grant-codex.json'),
      JSON.stringify({ id: current.id, token: current.token }),
    );
    expect(await tool('estado_sesion')).toMatchObject({
      isError: true,
      text: expect.stringContaining('Bitácora no responde'),
    });
    rmSync(join(dir, 'connection.json'));
    expect(await tool('estado_sesion')).toMatchObject({
      isError: true,
      text: 'Bitácora no está abierta. Ábrela y desbloquea el cuaderno.',
    });
  }, 30000);
});
