import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blank, type Domain } from '../service/domain';
import { Vault, migrateSubprojects } from '../service/vault';
import { Workspaces } from '../service/workspaces';
import {
  applicable,
  type Practice,
  type Provider,
  type Snapshot,
  type Task,
} from '../shared/model';
import { grantSees, inSelection, scopePath } from '../shared/subprojects';

const password = 'contraseña larga del cuaderno';
let dir: string;
let workspaces: Workspaces;
let domain: Domain;
let projectId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-subprojects-'));
  workspaces = new Workspaces(dir);
  const created = await workspaces.create('Plataforma', password);
  projectId = created.records.find((record) => record.kind === 'project')!.id;
  domain = workspaces.domain!;
});

afterEach(() => {
  workspaces.lock();
  rmSync(dir, { recursive: true, force: true });
});

function child(title: string) {
  return domain.saveSubproject({ title, description: `Ámbito ${title}` });
}
function task(extra: Record<string, unknown> = {}) {
  return domain.save('task', { ...blank('task'), title: 'Tarea', ...extra }) as Task;
}
function sessionFor(scopes: string[], canCompleteTasks = false, provider: Provider = 'claude') {
  domain.settings({ companyAuthorized: true, universityStructure: '' });
  const g = domain.grant(provider, [], 'projects', [projectId], 60, canCompleteTasks, scopes);
  return domain.authorize(g.token);
}

describe('modelo y gestión de subproyectos', () => {
  it('crea subproyectos con padre, versión e historial asignados por el servicio', () => {
    const api = child('API');
    expect(api).toMatchObject({
      kind: 'subproject',
      project: projectId,
      version: 1,
      status: 'Activo',
      title: 'API',
    });
    expect(api).not.toHaveProperty('subprojectId');
    expect(domain.require().history[0]).toMatchObject({ recordId: api.id, before: null });
    expect(() => child(' api ')).toThrow('Ya existe un subproyecto');
    expect(() => domain.saveSubproject({ title: '   ' })).toThrow();
    expect(() => domain.saveSubproject({ title: 'Otro', project: 'ajeno' })).toThrow();
    expect(() =>
      domain.save('subproject', { ...blank('subproject'), title: 'Directo', project: projectId }),
    ).toThrow('panel');
    const renamed = domain.saveSubproject(
      { title: 'API pública', description: 'REST' },
      api.id,
      api.version,
    );
    expect(renamed).toMatchObject({ id: api.id, version: 2, title: 'API pública' });
    expect(() => domain.saveSubproject({ title: 'Viejo' }, api.id, 1)).toThrow('Conflicto');
  });

  it('valida la pertenencia de los registros y no permite trasladarlos', () => {
    const api = child('API');
    const general = task({ title: 'General' });
    const scoped = task({ title: 'En API', subprojectId: api.id });
    expect(general).not.toHaveProperty('subprojectId');
    expect(scoped.subprojectId).toBe(api.id);
    expect(() => task({ subprojectId: 'inexistente' })).toThrow('no existe');
    expect(() => task({ subprojectId: projectId })).toThrow('no existe');
    expect(() =>
      domain.saveDraft('new:task', { ...blank('task'), subprojectId: 'inexistente' }),
    ).toThrow('no existe');
    expect(() => domain.save('task', { ...general, subprojectId: api.id }, general.id, 1)).toThrow(
      'trasladar',
    );
    expect(() => domain.save('task', { ...scoped, subprojectId: '' }, scoped.id, 1)).toThrow(
      'trasladar',
    );
    // Omitting the scope keeps the stored owner.
    const { subprojectId: _omitted, ...withoutScope } = scoped;
    expect(domain.save('task', withoutScope, scoped.id, 1)).toMatchObject({
      subprojectId: api.id,
      version: 2,
    });
    expect(() =>
      domain.save('project', {
        ...domain.require().records.find((r) => r.kind === 'project'),
        subprojectId: api.id,
      }),
    ).toThrow();
  });

  it('rechaza referencias entre ámbitos distintos', () => {
    const api = child('API');
    const web = child('Web');
    const apiTask = task({ title: 'API', subprojectId: api.id });
    const webTask = task({ title: 'Web', subprojectId: web.id });
    const generalTask = task({ title: 'General' });
    expect(() => task({ subprojectId: web.id, dependencyIds: [apiTask.id] })).toThrow('ámbito');
    expect(() => task({ dependencyIds: [apiTask.id] })).toThrow('ámbito');
    expect(task({ subprojectId: web.id, dependencyIds: [webTask.id] }).dependencyIds).toEqual([
      webTask.id,
    ]);
    expect(() =>
      domain.save('entry', {
        ...blank('entry'),
        title: 'Diario',
        subprojectId: api.id,
        taskIds: [generalTask.id],
      }),
    ).toThrow('ámbito');
    expect(() =>
      domain.save('objective', {
        ...blank('objective'),
        title: 'Objetivo',
        links: [{ sourceKind: 'task', sourceId: apiTask.id, role: 'trabajo', reference: '' }],
      }),
    ).toThrow('ámbito');
    expect(() =>
      domain.save('meeting', {
        ...blank('meeting'),
        title: 'Reunión',
        subprojectId: web.id,
        sourceIds: [apiTask.id],
      }),
    ).toThrow('ámbito');
  });

  it('aplica criterios generales a todo el proyecto y los propios solo a su subproyecto', () => {
    const api = child('API');
    const web = child('Web');
    const base = { status: 'Recomendación personal', title: 'Criterio' };
    const general = domain.save('practice', {
      ...blank('practice'),
      ...base,
      title: 'General',
    }) as Practice;
    const own = domain.save('practice', {
      ...blank('practice'),
      ...base,
      title: 'Propio',
      subprojectId: api.id,
    }) as Practice;
    const apiTask = task({ subprojectId: api.id });
    const webTask = task({ subprojectId: web.id });
    const generalTask = task();
    const ids = (t: Task) => t.checks.map((check) => check.practiceId);
    expect(ids(apiTask)).toEqual(expect.arrayContaining([general.id, own.id]));
    expect(ids(webTask)).toContain(general.id);
    expect(ids(webTask)).not.toContain(own.id);
    expect(ids(generalTask)).not.toContain(own.id);
    expect(applicable(own, generalTask)).toBe(false);
    expect(() =>
      domain.save(
        'task',
        {
          ...webTask,
          checks: [...webTask.checks, { ...apiTask.checks.find((c) => c.practiceId === own.id)! }],
        },
        webTask.id,
        webTask.version,
      ),
    ).toThrow('ámbito');
  });

  it('archiva en solo lectura, rechaza propuestas y restaura sin recuperar sesiones', () => {
    const api = child('API');
    const scoped = task({ subprojectId: api.id, due: '2020-01-01' });
    const session = sessionFor(['general', api.id]);
    const closure = domain.propose(session, {
      operation: 'update',
      kind: 'task',
      targetId: scoped.id,
      expectedVersion: scoped.version,
      patch: { state: 'Completada', solution: 'Hecho' },
      rationale: 'Terminada',
    });
    const created = domain.propose(session, {
      operation: 'create',
      kind: 'idea',
      patch: {
        title: 'Idea',
        project: projectId,
        subprojectId: api.id,
        date: '2026-10-19',
        description: 'Probar',
      },
      rationale: 'Idea',
    });
    const childOnly = sessionFor([api.id], false, 'codex');
    const archived = domain.setSubprojectStatus(api.id, api.version, 'Archivado');
    expect(archived).toMatchObject({ status: 'Archivado', version: 2 });
    expect(archived.archivedAt).toBeTruthy();
    const proposals = domain.require().proposals;
    expect(proposals.find((p) => p.id === closure.id)?.status).toBe('rejected');
    expect(proposals.find((p) => p.id === created.id)?.status).toBe('rejected');
    const current = domain.require().records.find((r) => r.id === scoped.id) as Task;
    expect(current.state).toBe('Por hacer');
    // The mixed session keeps «General»; the child-only session is revoked.
    expect(domain.grants.get(session.id)?.scopes).toEqual(['general']);
    expect(domain.grants.has(childOnly.id)).toBe(false);
    expect(() => domain.save('task', { ...current }, current.id, current.version)).toThrow(
      'solo lectura',
    );
    expect(() => task({ subprojectId: api.id })).toThrow('solo lectura');
    expect(() => domain.deleteTask(current.id, current.version)).toThrow('solo lectura');
    expect(() => domain.saveSubproject({ title: 'Nuevo' }, api.id, archived.version)).toThrow(
      'solo lectura',
    );
    expect(domain.startOverdueTasks('2026-10-19')).toEqual([]);
    expect(() => domain.setSubprojectStatus(api.id, archived.version, 'Archivado')).toThrow(
      'ya está archivado',
    );
    const restored = domain.setSubprojectStatus(api.id, archived.version, 'Activo');
    expect(restored).not.toHaveProperty('archivedAt');
    expect(domain.grants.has(childOnly.id)).toBe(false);
    expect(domain.grants.get(session.id)?.scopes).toEqual(['general']);
    expect(task({ subprojectId: api.id }).subprojectId).toBe(api.id);
  });

  it('solo elimina subproyectos vacíos y sugiere archivar los que tienen contenido', () => {
    const api = child('API');
    const empty = child('Vacío');
    const scoped = task({ subprojectId: api.id });
    expect(() => domain.deleteSubproject(api.id, api.version)).toThrow('Archívalo');
    domain.saveDraft('new:task', { ...blank('task'), subprojectId: empty.id });
    expect(() => domain.deleteSubproject(empty.id, empty.version)).toThrow('Archívalo');
    domain.deleteDraft('new:task');
    expect(() => domain.deleteSubproject(empty.id, 99)).toThrow('Conflicto');
    expect(domain.deleteSubproject(empty.id, empty.version)).toEqual({ ok: true });
    expect(domain.require().records.some((r) => r.id === empty.id)).toBe(false);
    expect(domain.require().history.some((h) => h.recordId === empty.id)).toBe(false);
    domain.deleteTask(scoped.id, scoped.version);
    expect(domain.deleteSubproject(api.id, api.version)).toEqual({ ok: true });
  });
});

describe('persistencia y aislamiento de subproyectos', () => {
  it('conserva subproyectos al reabrir y rechaza estados con referencias cruzadas', async () => {
    const api = child('API');
    const scoped = task({ subprojectId: api.id });
    const general = task({ title: 'General' });
    expect(() =>
      domain.transaction(() => {
        const stored = domain.require().records.find((r) => r.id === general.id) as Task;
        stored.dependencyIds = [scoped.id];
      }),
    ).toThrow('identificador');
    expect(() =>
      domain.transaction(() => {
        const stored = domain.require().records.find((r) => r.id === general.id) as Task;
        stored.subprojectId = 'otro-vault';
      }),
    ).toThrow('identificador');
    workspaces.lock();
    const reopened = await workspaces.unlock(projectId, password);
    expect(reopened.records.find((r) => r.id === scoped.id)).toMatchObject({
      subprojectId: api.id,
    });
    expect(reopened.records.filter((r) => r.kind === 'subproject')).toHaveLength(1);
  });

  it('migra vaults anteriores a «General» y revoca extractos MCP', async () => {
    const generalTask = task({ title: 'Anterior' });
    domain.settings({ companyAuthorized: true, universityStructure: '' });
    domain.share({ recordId: generalTask.id, provider: 'claude', title: 'T', excerpt: 'E' });
    // Write the previous format directly: the domain would reject empty scope values.
    const state = domain.require();
    delete state.subprojectModel;
    (state.records.find((r) => r.id === generalTask.id) as Task).subprojectId = '';
    (state.drafts ??= {})['new:idea'] = { ...blank('idea'), subprojectId: '' };
    domain.vault.save(state);
    workspaces.lock();
    const reopened = await workspaces.unlock(projectId, password);
    expect(reopened.subprojectModel).toBe(1);
    expect(reopened.shares).toEqual([]);
    expect(reopened.records.find((r) => r.id === generalTask.id)).not.toHaveProperty(
      'subprojectId',
    );
    expect(reopened.drafts?.['new:idea']).not.toHaveProperty('subprojectId');
    expect(migrateSubprojects(reopened as Snapshot)).toBe(false);
  });

  it('valida copias restauradas con la misma regla de ámbito', async () => {
    const api = child('API');
    task({ subprojectId: api.id });
    const backupPassword = 'contraseña de la copia';
    const bytes = domain.vault.backup(backupPassword);
    const restored = await domain.vault.restore(bytes, backupPassword);
    expect(() => workspaces.validateState(restored)).not.toThrow();
    (restored.records.find((r) => r.kind === 'subproject') as { project: string }).project = 'otro';
    expect(() => workspaces.validateState(restored)).toThrow('identificador');
  });
});

describe('permisos MCP por ámbito', () => {
  it('rechaza ámbitos inexistentes, archivados o vacíos al abrir la sesión', () => {
    const api = child('API');
    domain.settings({ companyAuthorized: true, universityStructure: '' });
    expect(() => domain.grant('claude', [], 'projects', [projectId], 60, false, [])).toThrow(
      'General',
    );
    expect(() =>
      domain.grant('claude', [], 'projects', [projectId], 60, false, ['inexistente']),
    ).toThrow('General');
    domain.setSubprojectStatus(api.id, api.version, 'Archivado');
    expect(() => domain.grant('claude', [], 'projects', [projectId], 60, false, [api.id])).toThrow(
      'General',
    );
  });

  it('limita lectura, búsqueda, recuentos y relaciones de una sesión al subproyecto', () => {
    const api = child('API');
    const web = child('Web');
    const generalPractice = domain.save('practice', {
      ...blank('practice'),
      title: 'Política general',
      status: 'Recomendación personal',
    });
    const apiTask = task({ title: 'Tarea API', subprojectId: api.id });
    const apiDependent = task({
      title: 'Dependiente API',
      subprojectId: api.id,
      dependencyIds: [apiTask.id],
    });
    const webTask = task({ title: 'Tarea Web', subprojectId: web.id });
    const generalTask = task({ title: 'Tarea general' });
    const session = sessionFor([api.id]);
    expect(domain.sessionInfo(session).scopes).toEqual([{ id: api.id, title: 'API' }]);
    const visible = domain.grantRecords(session).map((r) => r.id);
    expect(visible).toEqual(
      expect.arrayContaining([api.id, apiTask.id, apiDependent.id, generalPractice.id]),
    );
    for (const hidden of [projectId, web.id, webTask.id, generalTask.id])
      expect(visible).not.toContain(hidden);
    expect(() => domain.context(session, { recordIds: [webTask.id] })).not.toThrow();
    expect(domain.context(session, { recordIds: [webTask.id] }).items).toEqual([]);
    expect(domain.context(session, { query: 'Tarea' }, true).items.map((i) => i.id)).toEqual([
      apiTask.id,
    ]);
    expect(
      domain.filterRecords(session, { kind: 'task', limit: 10 }).items.map((i) => i.id),
    ).toEqual(expect.arrayContaining([apiTask.id, apiDependent.id]));
    expect(domain.filterRecords(session, { kind: 'task', subprojectId: 'general' }).items).toEqual(
      [],
    );
    expect(domain.projectSummary(session, { projectId }).counts.task).toBe(2);
    expect(() => domain.relatedRecords(session, { recordId: webTask.id })).toThrow('no autorizado');
    const related = domain.relatedRecords(session, { recordId: apiTask.id }).items;
    expect(related.map((item) => item.id).sort()).toEqual(
      [apiDependent.id, generalPractice.id].sort(),
    );
    expect(domain.taskQuality(session, { limit: 10 }).items.map((i) => i.id)).not.toContain(
      generalTask.id,
    );
    expect(() =>
      domain.asvsQuery(session, { projectId, limit: 1 } as unknown as Record<string, unknown>),
    ).toThrow('General');
  });

  it('impide proponer fuera de los ámbitos autorizados o cambiar el ámbito al actualizar', () => {
    const api = child('API');
    const web = child('Web');
    const apiTask = task({ subprojectId: api.id });
    const webTask = task({ subprojectId: web.id });
    const session = sessionFor([api.id]);
    const create = (subprojectId?: string) =>
      domain.propose(session, {
        operation: 'create',
        kind: 'idea',
        patch: {
          title: 'Idea',
          project: projectId,
          date: '2026-10-19',
          description: 'Texto',
          ...(subprojectId === undefined ? {} : { subprojectId }),
        },
        rationale: 'Probar',
      });
    expect(() => create()).toThrow('ámbito de destino');
    expect(() => create(web.id)).toThrow('ámbito de destino');
    expect(create(api.id).status).toBe('pending');
    expect(() =>
      domain.propose(session, {
        operation: 'update',
        kind: 'task',
        targetId: apiTask.id,
        expectedVersion: apiTask.version,
        patch: { subprojectId: web.id },
        rationale: 'Mover',
      }),
    ).toThrow('reservados');
    expect(() =>
      domain.propose(session, {
        operation: 'update',
        kind: 'task',
        targetId: webTask.id,
        expectedVersion: webTask.version,
        patch: { nextStep: 'Otro' },
        rationale: 'Ajeno',
      }),
    ).toThrow('no autorizados');
    expect(() =>
      domain.propose(session, {
        operation: 'create',
        kind: 'task',
        patch: {
          title: 'Dependiente',
          project: projectId,
          subprojectId: api.id,
          phase: 'Diseño',
          priority: 'Media',
          due: '2026-10-20',
          description: 'D',
          nextStep: 'N',
          dependencyIds: [webTask.id],
        },
        rationale: 'Dependencia ajena',
      }),
    ).toThrow('no está autorizada');
    expect(domain.proposalStatus(session)).toHaveLength(1);
  });

  it('actualiza los ámbitos al renovar y limita las eliminaciones al ámbito del registro', () => {
    const api = child('API');
    const web = child('Web');
    const general = domain.save('practice', {
      ...blank('practice'),
      title: 'Práctica general',
      project: projectId,
      status: 'Recomendación personal',
    }) as Practice;
    const apiTask = task({ subprojectId: api.id });
    const session = sessionFor([api.id]);
    const remove = (target: { id: string; version: number; kind: string }) =>
      domain.propose(session, {
        operation: 'delete',
        kind: target.kind,
        targetId: target.id,
        expectedVersion: target.version,
        patch: {},
        rationale: 'Obsoleto',
      });
    expect(() => remove(general)).toThrow('ámbito del registro');
    expect(remove(apiTask).status).toBe('pending');

    expect(domain.renewGrant(session.id, 60, undefined, ['general', web.id]).scopes).toEqual([
      'general',
      web.id,
    ]);
    expect(domain.grants.get(session.id)?.scopes).toEqual(['general', web.id]);
    expect(() => domain.renewGrant(session.id, 60, undefined, [])).toThrow('Selecciona');
    expect(domain.grants.get(session.id)?.scopes).toEqual(['general', web.id]);
    expect(sessionFor(['general']).id).toBe(session.id);
    expect(domain.grants.get(session.id)?.scopes).toEqual(['general']);
  });

  it('exige la verificación corporativa también en subproyectos', () => {
    const api = child('API');
    domain.setMcpProfile('corporativo');
    domain.settings({ companyAuthorized: true, universityStructure: '' });
    expect(() => domain.grant('claude', [], 'projects', [projectId], 60, false, [api.id])).toThrow(
      'corporativo',
    );
    const verified = domain.grant(
      'claude',
      [],
      'projects',
      [projectId],
      60,
      false,
      [api.id],
      'org-empresa',
    );
    expect(domain.authorize(verified.token, 'org-empresa').orgId).toBe('org-empresa');
    expect(() => domain.authorize(verified.token, 'otra-org')).toThrow();
  });

  it('comparte el predicado de visibilidad con la interfaz', () => {
    const api = child('API');
    const records = domain.require().records;
    const scoped = task({ subprojectId: api.id });
    const all = domain.require().records;
    expect(inSelection(scoped, 'general')).toBe(false);
    expect(inSelection(scoped, api.id)).toBe(true);
    expect(inSelection(scoped, 'all')).toBe(true);
    expect(scopePath(all, scoped)).toBe('Plataforma / API');
    expect(scopePath(records, {})).toBe('Plataforma / General');
    expect(grantSees({ projectIds: [projectId], scopes: ['general'] }, scoped, all)).toBe(false);
  });
});

describe('vault directo sin cuaderno indexado', () => {
  it('crea estados nuevos ya migrados', async () => {
    const raw = mkdtempSync(join(tmpdir(), 'bitacora-raw-'));
    try {
      const vault = new Vault(raw);
      const { initialState } = await import('../service/domain');
      const state = await vault.open(password, initialState());
      expect(state.subprojectModel).toBe(1);
      vault.lock();
    } finally {
      rmSync(raw, { recursive: true, force: true });
    }
  });
});
