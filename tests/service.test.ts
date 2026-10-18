import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import { exportDocument } from '../service/export';
import { parseClaudeIdentity } from '../service/claudeIdentity';
let app: Awaited<ReturnType<typeof startServer>>, dir: string, projectId: string;
const teamOrg = '11111111-aaaa-4bbb-8ccc-000000000001';
const teamStatus = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  orgId: teamOrg,
  orgName: 'Empresa de prueba',
  subscriptionType: 'team',
};
// Doble de «claude auth status»; la identidad real no se consulta en las pruebas.
let claudeStatus: unknown = { loggedIn: false };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-http-'));
  app = await startServer({ dir, claudeAuthStatus: async () => claudeStatus });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
function request(path: string, data: unknown = {}, token = app.token, origin?: string) {
  return fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(data),
  });
}
describe('servicio local', () => {
  it('rechaza orígenes web arbitrarios y tokens incorrectos', async () => {
    expect((await request('/api/snapshot', {}, app.token, 'https://evil.example')).status).toBe(
      403,
    );
    expect((await request('/api/snapshot', {}, 'incorrecto')).status).toBe(401);
  });
  it('desbloquea y no permite usar el token de UI como permiso MCP', async () => {
    const r = await request('/api/create-project', {
      title: 'Proyecto conectado',
      password: 'una contraseña de prueba',
    });
    expect(r.status).toBe(200);
    const snapshot = await r.json();
    expect(snapshot.records.length).toBe(5);
    projectId = snapshot.records.find((record: { kind: string }) => record.kind === 'project').id;
    expect((await request('/mcp', { action: 'context', input: {} })).status).toBe(401);
  });
  it('revoca el permiso local al cambiar a perfil corporativo', async () => {
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const response = await request('/api/grant', {
      provider: 'claude',
      scope: 'projects',
      projectIds: [projectId],
    });
    expect(response.status).toBe(200);
    const grant = await response.json();
    const grantPath = join(dir, 'mcp-grant-claude.json');
    expect(existsSync(grantPath)).toBe(true);
    try {
      expect((await request('/api/mcp-profile', { profile: 'corporativo' })).status).toBe(200);
      expect(existsSync(grantPath)).toBe(false);
      expect((await request('/mcp', { action: 'session' }, grant.token)).status).toBe(401);
      expect(
        (
          await request('/api/grant', {
            provider: 'claude',
            scope: 'projects',
            projectIds: [projectId],
          })
        ).status,
      ).toBe(400);
    } finally {
      await request('/api/mcp-profile', { profile: 'personal' });
    }
  });
  it('valida la cuenta de Claude Code antes de aceptarla como corporativa', () => {
    expect(parseClaudeIdentity(teamStatus)).toEqual({
      orgId: teamOrg,
      orgName: 'Empresa de prueba',
      subscriptionType: 'team',
    });
    for (const status of [
      { ...teamStatus, subscriptionType: 'pro' },
      { ...teamStatus, authMethod: 'console' },
      { ...teamStatus, apiProvider: 'bedrock' },
      { ...teamStatus, loggedIn: false },
      { ...teamStatus, orgId: undefined },
      'texto',
    ])
      expect(() => parseClaudeIdentity(status)).toThrow();
  });
  it('admite en corporativo solo Claude Code de una organización permitida', async () => {
    const policyPath = join(dir, 'corporate-policy.json');
    const corporateGrant = (provider = 'claude') =>
      request('/api/grant', { provider, scope: 'projects', projectIds: [projectId] });
    const mcp = (token: string, orgId?: string) =>
      fetch(`http://127.0.0.1:${app.port}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(orgId && { 'X-Bitacora-Claude-Org': orgId }),
        },
        body: JSON.stringify({ action: 'session', input: {} }),
      });
    expect((await request('/api/mcp-profile', { profile: 'corporativo' })).status).toBe(200);
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    try {
      claudeStatus = teamStatus;
      expect((await corporateGrant()).status).toBe(400);
      const missingPolicy = await (await request('/api/claude-identity')).json();
      expect(missingPolicy).toMatchObject({ verified: false, policyPath });

      writeFileSync(policyPath, JSON.stringify({ claudeOrgIds: [teamOrg] }));
      expect(await (await request('/api/claude-identity')).json()).toMatchObject({
        verified: true,
        orgId: teamOrg,
      });
      expect((await corporateGrant('codex')).status).toBe(400);
      const response = await corporateGrant();
      expect(response.status).toBe(200);
      const grant = await response.json();
      expect((await mcp(grant.token)).status).toBe(401);
      expect((await mcp(grant.token, 'otra-organizacion-0001')).status).toBe(401);
      expect((await mcp(grant.token, teamOrg)).status).toBe(200);
      expect(
        (await request('/api/renew-grant', { id: grant.id, durationMinutes: 30 })).status,
      ).toBe(200);

      claudeStatus = { ...teamStatus, subscriptionType: 'pro', orgId: 'personal-0000001' };
      expect(
        (await request('/api/renew-grant', { id: grant.id, durationMinutes: 30 })).status,
      ).toBe(400);
      expect((await corporateGrant()).status).toBe(400);
      claudeStatus = { ...teamStatus, orgId: 'otra-organizacion-0001' };
      expect((await corporateGrant()).status).toBe(400);
      claudeStatus = { loggedIn: false };
      expect((await corporateGrant()).status).toBe(400);
    } finally {
      claudeStatus = { loggedIn: false };
      if (existsSync(policyPath)) unlinkSync(policyPath);
      await request('/api/mcp-profile', { profile: 'personal' });
    }
  });
  it('inicia mediante la API solo tareas del día visible', async () => {
    const due = '2026-09-26';
    const task = app.domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Tarea de hoy',
      due,
    });
    expect(
      (await request('/api/start-today-tasks', { day: '2026-09-27', ids: [task.id] })).status,
    ).toBe(400);
    expect((await request('/api/start-today-tasks', { day: due, ids: [task.id] })).status).toBe(
      200,
    );
    expect(app.domain.require().records.find((record) => record.id === task.id)).toMatchObject({
      state: 'En curso',
      version: task.version + 1,
    });
    app.domain.deleteTask(task.id, task.version + 1);
  });
  it('devuelve tareas a Por hacer mediante la API cuando salen de Hoy', async () => {
    const due = '2999-01-01';
    const task = app.domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Tarea de salida',
      due,
    });
    expect((await request('/api/start-today-tasks', { day: due, ids: [task.id] })).status).toBe(
      200,
    );
    expect(app.domain.require().records.find((record) => record.id === task.id)).toMatchObject({
      state: 'En curso',
      version: task.version + 1,
    });
    expect((await request('/api/stop-today-tasks', { ids: [task.id] })).status).toBe(200);
    expect(app.domain.require().records.find((record) => record.id === task.id)).toMatchObject({
      state: 'Por hacer',
      version: task.version + 2,
    });
    app.domain.deleteTask(task.id, task.version + 2);
  });
  it('sincroniza tareas vencidas al consultar el cuaderno y no las revierte al salir de Hoy', async () => {
    const task = app.domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Tarea vencida',
      due: '2020-01-01',
    });
    expect((await request('/api/snapshot')).status).toBe(200);
    expect(app.domain.require().records.find((record) => record.id === task.id)).toMatchObject({
      state: 'En curso',
      version: task.version + 1,
    });
    expect((await request('/api/stop-today-tasks', { ids: [task.id] })).status).toBe(200);
    expect(app.domain.require().records.find((record) => record.id === task.id)).toMatchObject({
      state: 'En curso',
      version: task.version + 1,
    });
    app.domain.deleteTask(task.id, task.version + 1);
  });
  it('la API ya no permite abrir sesiones de extractos ni compartir registros individuales', async () => {
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    expect((await request('/api/share', { recordId: 'x' })).status).toBe(404);
    expect((await request('/api/revoke-share', { id: 'x' })).status).toBe(404);
    expect(
      (await request('/api/grant', { provider: 'codex', scope: 'selected', shareIds: ['x'] }))
        .status,
    ).toBe(400);
  });
  it('el transporte MCP limita lectura y actualización de sesión a proyectos marcados', async () => {
    const current = app.domain.require().records.find((record) => record.id === projectId)!;
    const selected = app.domain.save(
      'project',
      {
        ...current,
        specifications: 'Docs conectadas',
      },
      current.id,
      current.version,
    );
    const hidden = { id: 'proyecto-ajeno' };
    const record = app.domain.save('task', {
      ...blank('task'),
      project: selected.id,
      title: 'Tarea conectada',
      description: `Detalle del proyecto ${'x'.repeat(15000)}`,
    });
    const privateRecord = { id: 'registro-ajeno' };
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const response = await request('/api/grant', {
      provider: 'codex',
      shareIds: [],
      scope: 'projects',
      projectIds: [selected.id],
    });
    expect(response.status).toBe(200);
    const grant = await response.json();
    const grantPath = join(dir, 'mcp-grant-codex.json');
    expect(JSON.parse(readFileSync(grantPath, 'utf8')).token).toBe(grant.token);
    const session = await (
      await request('/mcp', { action: 'session', input: {} }, grant.token)
    ).json();
    expect(session).toMatchObject({
      connected: true,
      provider: 'codex',
      projects: [{ id: selected.id, title: 'Proyecto conectado' }],
    });
    const malformed = await fetch(`http://127.0.0.1:${app.port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
      body: '{"secret":"PRIVATE_MARKER"',
    });
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(await malformed.json())).not.toContain('PRIVATE_MARKER');
    expect(
      (
        await fetch(`http://127.0.0.1:${app.port}/mcp`, {
          headers: { Authorization: `Bearer ${grant.token}` },
        })
      ).status,
    ).toBe(405);
    const search = await (
      await request('/mcp', { action: 'context', input: { query: 'conectada' } }, grant.token)
    ).json();
    expect(search.items).toContainEqual({
      id: record.id,
      kind: 'task',
      version: record.version,
      title: 'Tarea conectada',
    });
    expect(JSON.stringify(search)).not.toContain('Detalle del proyecto');
    const read = await (
      await request(
        '/mcp',
        { action: 'read', input: { recordIds: [record.id, privateRecord.id] } },
        grant.token,
      )
    ).json();
    expect(JSON.stringify(read)).toContain('Detalle del proyecto');
    expect(JSON.stringify(read)).not.toContain(privateRecord.id);
    expect(read.nextExcerptOffset).toBeGreaterThan(0);
    const continued = await (
      await request(
        '/mcp',
        {
          action: 'read',
          input: { recordIds: [record.id], excerptOffset: read.nextExcerptOffset },
        },
        grant.token,
      )
    ).json();
    expect(continued.items[0].excerpt).toContain('x'.repeat(1000));
    const readProject = await (
      await request('/mcp', { action: 'read', input: { recordIds: [selected.id] } }, grant.token)
    ).json();
    expect(JSON.stringify(readProject)).toContain('Docs conectadas');
    const projectProposal = await (
      await request(
        '/mcp',
        {
          action: 'propose',
          input: {
            operation: 'update',
            kind: 'project',
            targetId: selected.id,
            expectedVersion: selected.version,
            patch: { specifications: 'Nuevas especificaciones' },
            rationale: 'Docs del repo',
          },
        },
        grant.token,
      )
    ).json();
    expect(projectProposal).toMatchObject({ status: 'pending' });
    const filtered = await (
      await request('/mcp', { action: 'filter', input: { kind: 'task' } }, grant.token)
    ).json();
    expect(filtered.items.map((item: { id: string }) => item.id)).toContain(record.id);
    expect(JSON.stringify(filtered)).not.toContain(privateRecord.id);
    const summary = await (
      await request('/mcp', { action: 'summary', input: { projectId: selected.id } }, grant.token)
    ).json();
    expect(summary.counts.task).toBe(1);
    expect(
      (await request('/mcp', { action: 'summary', input: { projectId: hidden.id } }, grant.token))
        .status,
    ).toBe(400);
    expect(
      (
        await request('/api/update-grant-projects', {
          id: grant.id,
          projectIds: [hidden.id],
        })
      ).status,
    ).toBe(400);
    const changed = await (
      await request('/mcp', { action: 'context', input: { query: 'conectada' } }, grant.token)
    ).json();
    expect(JSON.stringify(changed)).toContain('Tarea conectada');
    expect(JSON.stringify(changed)).not.toContain('Tarea privada');
    app.domain.revokeGrant(grant.id);
    await request('/api/revoke-grant', { id: grant.id });
    expect(existsSync(grantPath)).toBe(false);
  });
  it('diagnostica con metadatos mínimos, paginación y permiso vigente sin escribir', async () => {
    const selected = app.domain.require().records.find((record) => record.id === projectId)!;
    const hidden = { id: 'proyecto-ajeno' };
    const own = app.domain.save('task', {
      ...blank('task'),
      project: selected.id,
      title: 'Diagnóstico visible',
      description: 'DETALLE_PRIVADO',
      nextStep: '',
      due: '2020-01-01',
    });
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = app.domain.grant('codex', [], 'projects', [selected.id]);
    const before = JSON.stringify(app.domain.require());
    const firstResponse = await request(
      '/mcp',
      { action: 'task-quality', input: { limit: 1 } },
      grant.token,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.counts.sin_siguiente_paso).toBeGreaterThan(0);
    expect(first.nextOffset).toBe(1);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toEqual({
      id: own.id,
      title: own.title,
      version: own.version,
      category: 'sin_siguiente_paso',
      reason: 'No tiene siguiente paso.',
    });
    const second = await (
      await request(
        '/mcp',
        { action: 'task-quality', input: { category: 'vencimiento', offset: 0, limit: 10 } },
        grant.token,
      )
    ).json();
    expect(second.items.map((item: { id: string }) => item.id)).toContain(own.id);
    expect(JSON.stringify({ first, second })).not.toContain('DETALLE_PRIVADO');
    expect(JSON.stringify(app.domain.require())).toBe(before);
    expect(
      (
        await request(
          '/mcp',
          { action: 'task-quality', input: { projectId: hidden.id } },
          grant.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (await request('/mcp', { action: 'task-quality', input: { limit: 11 } }, grant.token)).status,
    ).toBe(400);
    app.domain.revokeGrant(grant.id);
    expect((await request('/mcp', { action: 'task-quality', input: {} }, grant.token)).status).toBe(
      401,
    );
    const expired = app.domain.grant('codex', [], 'projects', [selected.id]);
    app.domain.grants.get(expired.id)!.expiresAt = new Date(0).toISOString();
    expect(
      (await request('/mcp', { action: 'task-quality', input: {} }, expired.token)).status,
    ).toBe(401);
  });
  it('retira el permiso local de Codex al caducar', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = await (
      await request('/api/grant', {
        provider: 'codex',
        scope: 'projects',
        projectIds: [project.id],
      })
    ).json();
    const grantPath = join(dir, 'mcp-grant-codex.json');
    expect(existsSync(grantPath)).toBe(true);
    app.domain.grants.get(grant.id)!.expiresAt = new Date(0).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(existsSync(grantPath)).toBe(false);
  });
  it('guarda y retira el permiso local de Antigravity al crear, revocar y caducar la sesión', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const response = await request('/api/grant', {
      provider: 'antigravity',
      scope: 'projects',
      projectIds: [project.id],
    });
    expect(response.status).toBe(200);
    const grant = await response.json();
    const grantPath = join(dir, 'mcp-grant-antigravity.json');
    expect(existsSync(grantPath)).toBe(true);
    expect(JSON.parse(readFileSync(grantPath, 'utf8')).token).toBe(grant.token);
    app.domain.grants.get(grant.id)!.expiresAt = new Date(0).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(existsSync(grantPath)).toBe(false);

    const grant2 = await (
      await request('/api/grant', {
        provider: 'antigravity',
        scope: 'projects',
        projectIds: [project.id],
      })
    ).json();
    expect(existsSync(grantPath)).toBe(true);
    await request('/api/revoke-grant', { id: grant2.id });
    expect(existsSync(grantPath)).toBe(false);
  });
  it('mantiene el permiso local de Claude al renovar y lo retira al revocar o caducar', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = await (
      await request('/api/grant', {
        provider: 'claude',
        scope: 'projects',
        projectIds: [project.id],
      })
    ).json();
    const grantPath = join(dir, 'mcp-grant-claude.json');
    expect(JSON.parse(readFileSync(grantPath, 'utf8'))).toEqual({
      id: grant.id,
      token: grant.token,
    });
    expect((await request('/api/renew-grant', { id: grant.id })).status).toBe(200);
    expect(JSON.parse(readFileSync(grantPath, 'utf8')).token).toBe(grant.token);
    expect((await request('/mcp', { action: 'session', input: {} }, grant.token)).status).toBe(200);
    await request('/api/revoke-grant', { id: grant.id });
    expect(existsSync(grantPath)).toBe(false);

    const expiring = await (
      await request('/api/grant', {
        provider: 'claude',
        scope: 'projects',
        projectIds: [project.id],
      })
    ).json();
    app.domain.grants.get(expiring.id)!.expiresAt = new Date(0).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(existsSync(grantPath)).toBe(false);
  });
  it('conserva borradores incompletos cifrados al bloquear y permite eliminarlos', async () => {
    const key = 'new:task';
    const data = { title: '', description: 'Idea todavía sin título' };
    expect((await request('/api/save-draft', { key, data }, 'incorrecto')).status).toBe(401);
    expect((await request('/api/save-draft', { key, data })).status).toBe(200);
    expect((await request('/api/snapshot')).json()).resolves.toMatchObject({
      drafts: { [key]: data },
    });
    expect((await request('/api/save-draft', { key: 'bad:key', data })).status).toBe(400);
    expect((await request('/api/lock')).status).toBe(200);
    expect((await request('/api/snapshot')).status).toBe(400);
    expect(
      (await request('/api/unlock', { projectId, password: 'una contraseña de prueba' })).json(),
    ).resolves.toMatchObject({ drafts: { [key]: data } });
    expect(
      (
        await request('/api/save', {
          kind: 'task',
          data: { ...blank('task'), title: '' },
          draftKey: key,
        })
      ).status,
    ).toBe(400);
    expect((await request('/api/snapshot')).json()).resolves.toMatchObject({
      drafts: { [key]: data },
    });
    expect(
      (
        await request('/api/save', {
          kind: 'task',
          data: { ...blank('task'), title: 'Tarea completa' },
          draftKey: key,
        })
      ).status,
    ).toBe(200);
    expect((await request('/api/snapshot')).json()).resolves.toMatchObject({ drafts: {} });
    expect((await request('/api/save-draft', { key, data })).status).toBe(200);
    expect((await request('/api/delete-draft', { key })).status).toBe(200);
    expect((await request('/api/snapshot')).json()).resolves.toMatchObject({ drafts: {} });
  });
  it('guarda capturas cifradas, valida vínculos y convierte una sola vez', async () => {
    expect((await request('/api/capture-create', { text: '   ' })).status).toBe(400);
    expect(
      (await request('/api/capture-create', { text: 'Apunte privado' }, 'incorrecto')).status,
    ).toBe(401);
    const capture = await (await request('/api/capture-create', { text: 'Apunte privado' })).json();
    expect(capture).toMatchObject({ project: projectId, text: 'Apunte privado', version: 1 });
    expect(readFileSync(app.domain.vault.path).includes(Buffer.from('Apunte privado'))).toBe(false);
    expect(
      (
        await request('/api/capture-link', {
          id: capture.id,
          expectedVersion: 1,
          recordId: 'otro-cuaderno',
        })
      ).status,
    ).toBe(400);
    const linked = await (
      await request('/api/capture-link', {
        id: capture.id,
        expectedVersion: 1,
        recordId: projectId,
      })
    ).json();
    expect(linked).toMatchObject({ linkedRecordId: projectId, version: 2 });
    expect(
      (
        await request('/api/capture-update', {
          id: capture.id,
          expectedVersion: 1,
          text: 'Obsoleto',
        })
      ).status,
    ).toBe(400);
    const updated = await (
      await request('/api/capture-update', {
        id: capture.id,
        expectedVersion: 2,
        text: 'Apunte revisado',
      })
    ).json();
    expect(updated.version).toBe(3);
    const invalid = await request('/api/capture-convert', {
      id: capture.id,
      expectedVersion: 3,
      kind: 'idea',
      data: { ...blank('idea'), title: '' },
    });
    expect(invalid.status).toBe(400);
    expect((await (await request('/api/snapshot')).json()).captures).toContainEqual(
      expect.objectContaining({ id: capture.id, text: 'Apunte revisado' }),
    );
    const conversion = {
      id: capture.id,
      expectedVersion: 3,
      kind: 'idea',
      data: { ...blank('idea'), title: 'Idea clasificada', description: 'Apunte revisado' },
    };
    const idea = await (await request('/api/capture-convert', conversion)).json();
    expect(idea).toMatchObject({ kind: 'idea', project: projectId, title: 'Idea clasificada' });
    expect((await (await request('/api/capture-convert', conversion)).json()).id).toBe(idea.id);
    expect((await (await request('/api/snapshot')).json()).captures).toContainEqual(
      expect.objectContaining({ id: capture.id, text: '', convertedRecordId: idea.id }),
    );
    expect((await request('/api/lock')).status).toBe(200);
    expect((await request('/api/capture-create', { text: 'Bloqueado' })).status).toBe(400);
    const reopened = await (
      await request('/api/unlock', {
        projectId,
        password: 'una contraseña de prueba',
      })
    ).json();
    expect(reopened.captures).toContainEqual(
      expect.objectContaining({ id: capture.id, convertedRecordId: idea.id }),
    );
    const disposable = await (await request('/api/capture-create', { text: 'Descartable' })).json();
    expect(
      (await request('/api/capture-discard', { id: disposable.id, expectedVersion: 1 })).status,
    ).toBe(200);
    expect((await (await request('/api/snapshot')).json()).captures).not.toContainEqual(
      expect.objectContaining({ id: disposable.id }),
    );
  });
  it('restaura una versión de tarea solo con sesión válida y versión vigente', async () => {
    const created = await (
      await request('/api/save', {
        kind: 'task',
        data: { ...blank('task'), title: 'Revisar plan', description: 'Primera versión' },
      })
    ).json();
    const updated = await (
      await request('/api/save', {
        kind: 'task',
        data: { ...created, description: 'Segunda versión' },
        id: created.id,
        expectedVersion: created.version,
      })
    ).json();
    const history = app.domain
      .require()
      .history.find((entry) => entry.recordId === created.id && entry.after.version === 1)!;
    const input = {
      historyId: history.id,
      taskId: created.id,
      expectedVersion: updated.version,
    };
    expect((await request('/api/restore-task-version', input, 'incorrecto')).status).toBe(401);
    expect(
      (await request('/api/restore-task-version', { ...input, expectedVersion: 1 })).status,
    ).toBe(400);
    const response = await request('/api/restore-task-version', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: 3,
      description: 'Primera versión',
    });
    expect((await request('/api/restore-task-version', input)).status).toBe(400);
  });
  it('borra una incidencia solo con sesión válida y versión vigente', async () => {
    const incident = await (
      await request('/api/save', {
        kind: 'incident',
        data: { ...blank('incident'), title: 'Incidencia para borrar' },
      })
    ).json();
    const input = { id: incident.id, expectedVersion: incident.version };
    const draftKey = `record:${incident.id}`;
    expect(
      (await request('/api/save-draft', { key: draftKey, data: { title: 'Sin terminar' } })).status,
    ).toBe(200);
    expect((await request('/api/delete-incident', input, 'incorrecto')).status).toBe(401);
    expect((await request('/api/delete-incident', { ...input, expectedVersion: 0 })).status).toBe(
      400,
    );
    expect((await request('/api/delete-incident', input)).status).toBe(200);
    expect((await request('/api/delete-incident', input)).status).toBe(400);
    expect(app.domain.require().records.some((record) => record.id === incident.id)).toBe(false);
    expect(app.domain.require().drafts?.[draftKey]).toBeUndefined();
  });
  it('solo permite borrar el cuaderno desde su pantalla de inicio', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    const input = { id: project.id, expectedVersion: project.version };
    expect((await request('/api/delete-project', input, 'incorrecto')).status).toBe(401);
    expect((await request('/api/delete-project', input)).status).toBe(400);
    expect(
      (
        await request('/api/remove-project', {
          projectId,
          password: 'una contraseña de prueba',
          confirm: 'ELIMINAR',
        })
      ).status,
    ).toBe(400);
  });
  it.each(['entry', 'decision', 'idea', 'meeting'] as const)(
    'borra %s solo con sesión válida y versión vigente',
    async (kind) => {
      const record = await (
        await request('/api/save', {
          kind,
          data: { ...blank(kind), title: `Registro ${kind} para borrar` },
        })
      ).json();
      const path = `/api/delete-${kind}`;
      const input = { id: record.id, expectedVersion: record.version };
      expect((await request(path, input, 'incorrecto')).status).toBe(401);
      expect((await request(path, { ...input, expectedVersion: 0 })).status).toBe(400);
      expect((await request(path, input)).status).toBe(200);
      expect((await request(path, input)).status).toBe(400);
      expect(app.domain.require().records.some((item) => item.id === record.id)).toBe(false);
    },
  );
  it('exige revisión explícita para exportar', async () => {
    expect(
      (await request('/api/export', { body: 'Informe', format: 'md', reviewed: false })).status,
    ).toBe(400);
  });
  it.each(['md', 'docx', 'pdf'])('produce un archivo %s válido con acentos', async (format) => {
    const result = await exportDocument(
      format,
      '# Memoria de prácticas\n\nDecisión y validación. Evidencia: [referencia-1]',
    );
    if (format === 'pdf') expect(result.bytes.subarray(0, 4).toString()).toBe('%PDF');
    if (format === 'docx') expect(result.bytes.subarray(0, 2).toString()).toBe('PK');
    if (format === 'md') expect(result.bytes.toString()).toContain('prácticas');
  });
  it('gestiona sesiones con duración configurable y renovación mediante API', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });

    // Crear sesión con 30 minutos
    const resCreate = await request('/api/grant', {
      provider: 'antigravity',
      scope: 'projects',
      projectIds: [project.id],
      durationMinutes: 30,
    });
    expect(resCreate.status).toBe(200);
    const grant = await resCreate.json();
    const exp = Date.parse(grant.expiresAt);
    expect(exp - Date.now()).toBeGreaterThan(28 * 60000);
    expect(exp - Date.now()).toBeLessThanOrEqual(30 * 60000);

    // Renovar a 120 minutos
    const resRenew = await request('/api/renew-grant', {
      id: grant.id,
      durationMinutes: 120,
    });
    expect(resRenew.status).toBe(200);
    const renewed = await resRenew.json();
    const expRenewed = Date.parse(renewed.expiresAt);
    expect(expRenewed - Date.now()).toBeGreaterThan(118 * 60000);
    expect(expRenewed - Date.now()).toBeLessThanOrEqual(120 * 60000);

    // Rechazar duración no válida
    const resBad = await request('/api/renew-grant', {
      id: grant.id,
      durationMinutes: 10,
    });
    expect(resBad.status).toBe(400);
  });
  it('permite revisar propuestas en lote mediante /api/review con ids', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const g = app.domain.grant('codex', [], 'projects', [project.id]);
    const auth = app.domain.authorize(g.token);

    const taskRecord = app.domain.save('task', {
      ...blank('task'),
      project: project.id,
      title: 'Tarea Batch',
    });

    const p1 = app.domain.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: taskRecord.id,
      expectedVersion: taskRecord.version,
      patch: { title: 'Tarea Batch Aceptada' },
      rationale: 'Aceptación por lote',
    });

    const resReview = await request('/api/review', {
      ids: [p1.id],
      accept: true,
    });
    expect(resReview.status).toBe(200);
    const reviewed = await resReview.json();
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].status).toBe('accepted');
    expect(app.domain.require().records.find((r) => r.id === taskRecord.id)?.title).toBe(
      'Tarea Batch Aceptada',
    );
  });
  it('limita el cierre MCP al permiso explícito de la sesión', async () => {
    const project = app.domain.require().records.find((record) => record.id === projectId)!;
    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const t = app.domain.save('task', {
      ...blank('task'),
      project: project.id,
      title: 'Cierre MCP',
    });
    const ordinary = app.domain.grant('codex', [], 'projects', [project.id]);
    const allowed = app.domain.grant('claude', [], 'projects', [project.id], 60, true);
    const auth = app.domain.authorize(allowed.token);
    const close = app.domain.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Comprobado.' },
      rationale: 'Cierre',
    });
    const payload = {
      action: 'complete-task',
      input: { taskId: t.id, closureId: close.id, checkIds: [] },
    };
    expect((await request('/mcp', payload, ordinary.token)).status).toBe(400);
    expect((await request('/mcp', payload, allowed.token)).status).toBe(200);
    expect(
      app.domain.require().records.find((record) => record.id === t.id && record.kind === 'task'),
    ).toMatchObject({ state: 'Completada' });
  });
  it('rechaza restaurar en un cuaderno la copia cifrada de otro', async () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'bitacora-restore-isolated-'));
    const isolated = await startServer({ dir: isolatedDir });
    const post = (path: string, data: unknown) =>
      fetch(`http://127.0.0.1:${isolated.port}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${isolated.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    try {
      const first = await (
        await post('/api/create-project', {
          title: 'Primero',
          password: 'contraseña del primero',
        })
      ).json();
      const firstId = first.records.find(
        (record: { kind: string }) => record.kind === 'project',
      ).id;
      const backup = await (
        await post('/api/backup', { password: 'contraseña de copia aislada' })
      ).json();
      await post('/api/lock', {});
      const second = await (
        await post('/api/create-project', {
          title: 'Segundo',
          password: 'contraseña del segundo',
        })
      ).json();
      expect(second.records.some((record: { id: string }) => record.id === firstId)).toBe(false);
      expect(
        (
          await post('/api/restore', {
            data: backup.data,
            password: 'contraseña de copia aislada',
            confirm: 'RESTAURAR',
          })
        ).status,
      ).toBe(400);
      expect(isolated.domain.require().records.some((record) => record.id === firstId)).toBe(false);
    } finally {
      await isolated.close();
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
  it('serializa las operaciones de creación de cuadernos', async () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'bitacora-create-isolated-'));
    const isolated = await startServer({ dir: isolatedDir });
    const create = (title: string) =>
      fetch(`http://127.0.0.1:${isolated.port}/api/create-project`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${isolated.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, password: 'contraseña independiente' }),
      });
    try {
      const results = await Promise.all([create('Primero'), create('Segundo')]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
      const status = await fetch(`http://127.0.0.1:${isolated.port}/api/status`, {
        headers: { Authorization: `Bearer ${isolated.token}` },
      });
      expect((await status.json()).projects).toHaveLength(1);
    } finally {
      await isolated.close();
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
