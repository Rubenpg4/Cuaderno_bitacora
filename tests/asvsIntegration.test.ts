import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspaces } from '../service/workspaces';
import { blank, type Domain } from '../service/domain';
import { validateAsvsState } from '../service/asvs/tracking';
import { asvsCatalog } from '../shared/asvsCatalog';
import { asvsDisplayRequirements } from '../shared/asvsCatalogEs';
import { mcpGuideText } from '../shared/mcpGuide';
import { ASVS_VERSION } from '../shared/asvs';
import type { Task } from '../shared/model';
const password = 'contraseña sintética integración ASVS';
const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
const link = {
  catalogVersion: ASVS_VERSION,
  reqId: requirement.reqId,
  reason: 'Control pertinente para el módulo de prueba',
  scope: 'Módulo de prueba',
  criterion: 'El caso observable rechaza la entrada inválida',
  method: 'Prueba automatizada',
};
let directory: string, workspaces: Workspaces, domain: Domain, projectId: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-integration-'));
  workspaces = new Workspaces(directory);
  const state = await workspaces.create('Integración sintética', password);
  projectId = state.records.find((r) => r.kind === 'project')!.id;
  domain = workspaces.domain!;
  domain.asvsConfigure({
    projectId,
    expectedConfigVersion: 0,
    catalogVersion: ASVS_VERSION,
    level: 1,
  });
  domain.settings({ companyAuthorized: true, universityStructure: '' });
});
afterEach(() => {
  workspaces.lock();
  rmSync(directory, { recursive: true, force: true });
});
function grant(provider: 'codex' | 'claude' = 'codex') {
  return domain.authorize(domain.grant(provider, [], 'projects', [projectId], 60, true).token);
}
function task(extra: Record<string, unknown> = {}) {
  return domain.save('task', {
    ...blank('task'),
    project: projectId,
    title: 'Tarea ASVS sintética',
    asvsLinks: [link],
    ...extra,
  }) as Task;
}
function request(extra: Record<string, unknown> = {}, index = 0) {
  const current = domain.asvsList({ projectId });
  const a = current.items[index].assessment;
  const r = asvsCatalog.requirements.find((r) => r.reqId === a.reqId)!;
  return {
    projectId,
    reference: r.canonicalRef,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: current.config!.version,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Prueba satisfactoria en el proyecto sintético',
    method: 'Pruebas automatizadas',
    responsible: 'Revisor sintético',
    evidence: [{ reference: 'tests/security.test.ts', revision: 'revisión sintética 1' }],
    rationale: 'Evidencia contrastada',
    ...extra,
  };
}

function taskReview(work: Task, extra: Record<string, unknown> = {}) {
  return {
    projectId,
    taskId: work.id,
    reqId: requirement.reqId,
    expectedTaskVersion: work.version,
    expectedVersion: 0,
    expectedConfigVersion: domain.require().asvs!.config.version,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scopeDetail: link.scope,
    pendingScope: 'Resto del proyecto pendiente',
    note: 'Control observado en prueba sintética',
    method: link.method,
    responsible: 'Revisor sintético',
    evidence: [{ reference: 'tests/security.test.ts', revision: 'revisión sintética 1' }],
    rationale: 'Resultado comprobado',
    ...extra,
  };
}
function closure(work: Task, g = grant()) {
  return domain.propose(g, {
    operation: 'update',
    kind: 'task',
    targetId: work.id,
    expectedVersion: work.version,
    patch: { state: 'Completada', solution: 'Control implementado y probado' },
    rationale: 'Cierre con evidencia',
  });
}

describe('ciclo proactivo y cierre ASVS de tareas', () => {
  it('devuelve contexto vigente al crear una tarea y al reenviar una propuesta pendiente', () => {
    const g = grant();
    const input = {
      kind: 'task',
      operation: 'create',
      patch: {
        project: projectId,
        title: 'Agenda sintética sin impacto técnico',
        phase: 'Implementación',
        priority: 'Media',
        due: '2026-11-01',
        nextStep: 'Ordenar agenda',
        description: 'Criterio observable de organización',
      },
      rationale: 'Sin controles técnicos pertinentes',
    };
    const first = domain.propose(g, input);
    expect(first).toMatchObject({ asvs: { enabled: true, candidates: { level: 1 } } });
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: ASVS_VERSION,
      level: null,
    });
    // Disabled ASVS disappears for assistants: no context, no links, no ASVS guide section.
    const again = domain.propose(g, input);
    expect(again.id).toBe(first.id);
    expect(again).not.toHaveProperty('asvs');
    expect(domain.sessionInfo(g).asvs).toMatchObject({ enabled: false });
    expect(() =>
      domain.propose(g, {
        ...input,
        patch: { ...input.patch, title: 'Con enlace', asvsLinks: [link] },
      }),
    ).toThrow('ASVS está desactivado');
    expect(mcpGuideText(false)).not.toContain('consultar_asvs');
    expect(mcpGuideText(true)).toContain('consultar_asvs');
  });
  it('pagina todos los criterios manuales y exige también los informativos para cierre autónomo', () => {
    const links = asvsCatalog.requirements
      .filter((r) => r.minLevel === 1)
      .slice(0, 11)
      .map((r) => ({ ...link, reqId: r.reqId }));
    const work = task({ asvsLinks: links });
    const g = grant();
    const first = domain.asvsTaskCriteria(g, { taskId: work.id });
    expect(first.items).toHaveLength(10);
    expect(first.nextOffset).toBe(10);
    expect(domain.asvsTaskCriteria(g, { taskId: work.id, offset: 10 }).items).toHaveLength(1);
    const close = closure(work, g);
    expect(() =>
      domain.completeTask(g, { taskId: work.id, closureId: close.id, checkIds: [] }),
    ).toThrow('Verifica ASVS');
    domain.reviewBatch([close.id], true);
    expect((domain.require().records.find((r) => r.id === work.id) as Task).state).toBe(
      'Completada',
    );
  });

  it('revierte una primera verificación si la evidencia de la segunda cambió y acepta el lote humano sin permiso autónomo', () => {
    const second = asvsCatalog.requirements.filter((r) => r.minLevel === 1)[1];
    const work = task({
      asvsLinks: [
        { ...link, mandatory: true },
        { ...link, reqId: second.reqId, mandatory: true },
      ],
    });
    const g = grant();
    const source = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Fuente sintética',
      result: 'Resultado inicial',
    });
    const first = domain.asvsTaskPropose(g, taskReview(work));
    const last = domain.asvsTaskPropose(
      g,
      taskReview(work, {
        reqId: second.reqId,
        evidence: [{ recordId: source.id, reference: 'Fuente sintética', revision: 'v1' }],
      }),
    );
    const close = closure(work, g);
    domain.save('entry', { ...source, result: 'Resultado modificado' }, source.id, source.version);
    const before = structuredClone(domain.require());
    expect(() => domain.reviewBatch([close.id], true, [first.id, last.id])).toThrow('evidencia');
    expect(domain.require()).toEqual(before);
    domain.asvsReviewProposals({ ids: [last.id], accept: false });
    const reviewing = domain.require().records.find((r) => r.id === work.id) as Task;
    const replacement = domain.asvsTaskPropose(g, taskReview(reviewing, { reqId: second.reqId }));
    domain.reviewBatch([close.id], true, [first.id, replacement.id]);
    expect(domain.asvsTaskStatuses({ projectId, taskId: work.id })).toHaveLength(2);
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(0);
  });
  it('expone activación/candidatos y criterios manuales sin seleccionar por el título', () => {
    const g = grant();
    const auth = task({
      title: 'Autenticación sintética',
      asvsLinks: [{ ...link, mandatory: true }],
    });
    const administrative = task({ title: 'Ordenar agenda sintética', asvsLinks: [] });
    const read = domain.context(g, { recordIds: [auth.id] });
    expect(read).toMatchObject({
      asvs: {
        enabled: true,
        candidates: { level: 1, tool: 'consultar_asvs' },
        criteria: { taskId: auth.id },
      },
    });
    expect(read.items[0]).not.toHaveProperty('asvs');
    // Several tasks share one context; the criteria hint no longer names a single task.
    const both = domain.context(g, { recordIds: [auth.id, administrative.id] });
    expect(both.items).toHaveLength(2);
    expect(both).toMatchObject({ asvs: { enabled: true, criteria: { taskId: null } } });
    expect(JSON.stringify(both).match(/"candidates"/g)).toHaveLength(1);
    expect(domain.context(g, { taskId: auth.id })).toMatchObject({ asvs: { enabled: true } });
    const criteria = domain.asvsTaskCriteria(g, { taskId: auth.id });
    expect(criteria).toMatchObject({
      taskVersion: auth.version,
      items: [{ link: { mandatory: true }, assessment: null, expectedVersion: 0 }],
      nextOffset: null,
    });
    expect(domain.asvsTaskCriteria(g, { taskId: administrative.id }).items).toEqual([]);
    expect(() =>
      domain.asvsTaskCriteria({ ...g, scope: 'selected', projectIds: [] }, { taskId: auth.id }),
    ).toThrow('sesión de proyecto');
    expect(() =>
      domain.asvsTaskCriteria(g, { taskId: '00000000-0000-4000-8000-000000000000' }),
    ).toThrow('no autorizada');
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: ASVS_VERSION,
      level: null,
    });
    expect(domain.asvsTaskCriteria(g, { taskId: auth.id })).toMatchObject({
      enabled: false,
      candidates: null,
    });
    const done = domain.save(
      'task',
      { ...auth, state: 'Completada', solution: 'Sin cumplimiento ASVS activo' },
      auth.id,
      auth.version,
    ) as Task;
    expect(done.state).toBe('Completada');
  });

  it('solo la persona decide obligatoriedad y MCP no retira ni rebaja criterios obligatorios', () => {
    const work = task({ asvsLinks: [{ ...link, mandatory: true }] });
    const g = grant();
    const update = (asvsLinks: unknown) =>
      domain.propose(g, {
        operation: 'update',
        kind: 'task',
        targetId: work.id,
        expectedVersion: work.version,
        patch: { asvsLinks },
        rationale: 'Cambio sintético',
      });
    expect(() => update([])).toThrow('retirar');
    expect(() => update([{ ...link, mandatory: false }])).toThrow('persona');
    const p = update([{ ...link, reason: 'Motivo afinado' }]);
    domain.review(p.id, true);
    expect(
      (domain.require().records.find((r) => r.id === work.id) as Task).asvsLinks![0].mandatory,
    ).toBe(true);
  });

  it('bloquea el cierre obligatorio con estados pendientes, negativos o evidencia desactualizada', () => {
    const work = task({ asvsLinks: [{ ...link, mandatory: true }] });
    const save = () =>
      domain.save(
        'task',
        { ...work, state: 'Completada', solution: 'Probado' },
        work.id,
        work.version,
      );
    expect(save).toThrow('Verifica ASVS');
    const { rationale, ...review } = taskReview(work);
    domain.asvsTaskReview({ ...review, state: 'No cumplido' });
    expect(save).toThrow('Verifica ASVS');
    domain.asvsTaskReview({ ...review, expectedVersion: 1 });
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: ASVS_VERSION,
      level: 1,
      contextReason: 'Cambio sintético',
    });
    expect(save).toThrow('Verifica ASVS');
  });

  it('acepta prácticas, verificaciones ASVS y cierre atómicamente conservando requisito y evaluación global', async () => {
    const practice = domain.save('practice', {
      ...blank('practice'),
      project: projectId,
      title: 'Prueba obligatoria sintética',
      mandatory: true,
      status: 'Recomendación personal',
    });
    const work = task({
      description: 'Requisito original sintético',
      asvsLinks: [{ ...link, mandatory: true }],
    });
    const g = grant();
    const check = domain.propose(g, {
      operation: 'check',
      kind: 'task',
      targetId: work.id,
      expectedVersion: work.version,
      patch: { practiceId: practice.id, state: 'Cumplido', note: 'Caso de prueba ejecutado' },
      rationale: 'Verificado',
    });
    const input = taskReview(work);
    const asvs = domain.asvsTaskPropose(g, input);
    expect(domain.asvsTaskPropose(g, input).id).toBe(asvs.id);
    const close = closure(work, g);
    const before = structuredClone(domain.require());
    expect(() =>
      domain.completeTask(g, {
        taskId: work.id,
        closureId: close.id,
        checkIds: [],
        asvsIds: [asvs.id],
      }),
    ).toThrow('Faltan evidencias');
    expect(domain.require()).toEqual(before);
    domain.completeTask(g, {
      taskId: work.id,
      closureId: close.id,
      checkIds: [check.id],
      asvsIds: [asvs.id],
    });
    const done = domain.require().records.find((r) => r.id === work.id) as Task;
    expect(done).toMatchObject({
      state: 'Completada',
      description: work.description,
      solution: 'Control implementado y probado',
      checks: [{ state: 'Cumplido' }],
    });
    expect(domain.asvsTaskStatuses({ projectId, taskId: work.id })[0]).toMatchObject({
      assessment: { state: 'Cumplido' },
      status: { stale: false },
    });
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(0);
    expect(() =>
      domain.completeTask(g, {
        taskId: work.id,
        closureId: close.id,
        checkIds: [check.id],
        asvsIds: [asvs.id],
      }),
    ).toThrow('ya completada');
    workspaces.lock();
    await workspaces.unlock(projectId, password);
    expect((workspaces.domain!.require().records.find((r) => r.id === work.id) as Task).state).toBe(
      'Completada',
    );
  });

  it('revierte todo al fallar persistencia después de preparar el cierre', () => {
    const work = task({ asvsLinks: [{ ...link, mandatory: true }] });
    const g = grant();
    const asvs = domain.asvsTaskPropose(g, taskReview(work));
    const close = closure(work, g);
    const before = structuredClone(domain.require());
    const save = vi.spyOn(domain.vault, 'save').mockImplementationOnce(() => {
      throw Error('Fallo sintético de persistencia');
    });
    expect(() =>
      domain.completeTask(g, {
        taskId: work.id,
        closureId: close.id,
        checkIds: [],
        asvsIds: [asvs.id],
      }),
    ).toThrow('persistencia');
    expect(domain.require()).toEqual(before);
    save.mockRestore();
  });

  it('no acepta mezcla de proveedores, evaluaciones globales, omisiones manuales ni falta de permiso', () => {
    const g = grant();
    const work = task({ asvsLinks: [{ ...link, mandatory: true }] });
    const asvs = domain.asvsTaskPropose(grant('claude'), taskReview(work));
    const close = closure(work, g);
    const input = { taskId: work.id, closureId: close.id, checkIds: [], asvsIds: [asvs.id] };
    expect(() => domain.completeTask({ ...g, canCompleteTasks: false }, input)).toThrow(
      'no permite',
    );
    expect(() => domain.completeTask(g, input)).toThrow('no apta');
    expect(() => domain.completeTask(g, { ...input, asvsIds: [] })).toThrow('Verifica ASVS');
    const global = domain.asvsPropose(g, request());
    expect(() => domain.completeTask(g, { ...input, asvsIds: [global.id] })).toThrow('no apta');
    expect(domain.require().proposals.find((p) => p.id === close.id)!.status).toBe('pending');
  });

  it('valida versión de tarea/configuración y evidencia contra la solución final', () => {
    const g = grant();
    const work = task({ asvsLinks: [{ ...link, mandatory: true }], solution: 'Solución antigua' });
    const asvs = domain.asvsTaskPropose(
      g,
      taskReview(work, {
        evidence: [{ recordId: work.id, reference: 'Solución local', revision: 'v1' }],
      }),
    );
    const close = closure(work, g);
    const input = { taskId: work.id, closureId: close.id, checkIds: [], asvsIds: [asvs.id] };
    const before = structuredClone(domain.require());
    expect(() => domain.completeTask(g, input)).toThrow('evidencia de la propuesta cambió');
    expect(domain.require()).toEqual(before);
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: ASVS_VERSION,
      level: 2,
    });
    expect(() => domain.completeTask(g, input)).toThrow();
    const current = domain.require().records.find((r) => r.id === work.id) as Task;
    domain.save('task', { ...current, nextStep: 'Cambio externo' }, current.id, current.version);
    expect(() => domain.completeTask(g, input)).toThrow('registro cambió');
  });
});
describe('asociaciones y propuestas ASVS', () => {
  it('valida asociaciones, conserva tareas antiguas y relación bidireccional sin prácticas automáticas', () => {
    const old = task({ asvsLinks: undefined });
    expect(old.asvsLinks).toBeUndefined();
    for (const asvsLinks of [
      [link, link],
      [{ ...link, reqId: 'V999.1.1' }],
      [{ ...link, catalogVersion: '4.0.3' }],
      [{ ...link, reason: ' ' }],
      [{ ...link, mandatory: 'true' }],
    ])
      expect(() => task({ asvsLinks })).toThrow();
    expect(() => task({ project: 'otro' })).toThrow();
    const first = task();
    const second = task();
    expect(first.checks.length).toBe(old.checks.length);
    const read = domain.asvsRead(grant(), {
      projectId,
      references: [requirement.canonicalRef],
      limit: 1,
    });
    expect(read.items[0].relatedTasks.map((t) => t.id)).toEqual([first.id]);
    expect(read.items[0].relatedTaskCount).toBe(2);
    expect(read.items[0].next.action).toBe('continue-task');
    expect(read.items[0].next.guidance).toContain('proponer_verificacion_asvs');
    if (read.items[0].es) {
      expect(read.items[0].es.description).toBe(
        asvsDisplayRequirements.find((r) => r.reqId === requirement.reqId)!.description,
      );
      expect(read.items[0].description).toBe(requirement.description);
    }
    expect(read.items[0].nextTaskOffset).toBe(1);
    const next = domain.asvsRead(grant(), {
      projectId,
      references: [requirement.canonicalRef],
      taskOffset: 1,
      limit: 1,
    });
    expect(next.items[0].relatedTasks[0].id).toBe(second.id);
    const edited = domain.save(
      'task',
      { ...first, asvsLinks: [] },
      first.id,
      first.version,
    ) as Task;
    expect(edited.asvsLinks).toEqual([]);
    expect(domain.require().history.find((h) => h.recordId === first.id)!.before).toMatchObject({
      asvsLinks: [link],
    });
  });
  it('verifica tareas por separado e invalida evidencia y asociaciones conservando historia y restauración', async () => {
    const work = task();
    const evidence = domain.save('entry', {
      ...blank('entry'),
      title: 'Evidencia sintética',
      project: projectId,
      result: 'Resultado probado',
    });
    const review = {
      projectId,
      taskId: work.id,
      reqId: link.reqId,
      expectedTaskVersion: work.version,
      expectedVersion: 0,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: link.scope,
      pendingScope: 'Resto del proyecto pendiente',
      note: 'Caso sintético comprobado',
      method: link.method,
      responsible: 'Revisor sintético',
      evidence: [{ recordId: evidence.id, reference: 'Resultado local', revision: 'v1' }],
    };
    expect(domain.asvsTaskReview(review).status).toMatchObject({
      partial: true,
      stale: false,
      tick: false,
    });
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(0);
    expect(() => domain.asvsTaskReview(review)).toThrow('ha cambiado');
    domain.save('entry', { ...evidence, result: 'Nuevo resultado' }, evidence.id, evidence.version);
    expect(domain.asvsTaskStatuses({ projectId, taskId: work.id })[0].status.stale).toBe(true);
    const changed = domain.save('task', { ...work, asvsLinks: [] }, work.id, work.version) as Task;
    expect(domain.asvsTaskStatuses({ projectId, taskId: work.id })[0].status.reasons).toContain(
      'Asociación retirada',
    );
    const bytes = domain.vault.backup(password);
    const restored = await domain.vault.restore(bytes, password);
    workspaces.validateState(restored);
    domain.vault.save(restored);
    domain.state = restored;
    expect((domain.require().records.find((r) => r.id === changed.id) as Task).asvsLinks).toEqual(
      [],
    );
    expect(
      domain.require().asvs!.history.filter((h) => h.kind === 'task-verification'),
    ).toHaveLength(1);
    const broken = structuredClone(domain.require());
    (broken.records.find((r) => r.id === changed.id) as Task).asvsLinks = [
      { ...link, reqId: 'V999.1.1' },
    ];
    expect(() => validateAsvsState(broken, projectId)).toThrow();
  });
  it('consulta metadatos con filtros y resuelve referencias solo en la versión fijada', () => {
    const g = grant();
    const page = domain.asvsQuery(g, { projectId, level: 1, limit: 2 });
    expect(page.total).toBe(70);
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBe(2);
    expect(JSON.stringify(page.items)).not.toContain('description');
    expect(JSON.stringify(page.items)).not.toContain('evidence');
    expect(page.items[0]).not.toHaveProperty('catalogVersion');
    expect(page).toMatchObject({ catalogVersion: ASVS_VERSION, coverage: {} });
    expect(page.chapters?.length).toBeGreaterThan(0);
    const second = domain.asvsQuery(g, { projectId, level: 1, limit: 2, offset: 2 });
    expect(second).not.toHaveProperty('coverage');
    expect(second).not.toHaveProperty('chapters');
    expect(second.config).toEqual(page.config);
    expect(second.items[0].reqId).not.toBe(page.items[0].reqId);
    const read = domain.asvsRead(g, { projectId, references: [requirement.reqId.slice(1)] });
    expect(read.items[0]).toMatchObject({
      canonicalRef: requirement.canonicalRef,
      description: requirement.description,
      resolvedAgainst: ASVS_VERSION,
    });
    expect(
      domain.asvsQuery(g, {
        projectId,
        level: 1,
        chapterId: requirement.chapterId,
        sectionId: requirement.sectionId,
      }).total,
    ).toBeGreaterThan(0);
    for (const reference of ['v4.0.3-1.2.5', '1.2', 'V999.1.1'])
      expect(() => domain.asvsRead(g, { projectId, references: [reference] })).toThrow('Aclara');
    expect(() =>
      domain.asvsQuery({ ...g, scope: 'selected', projectIds: [] }, { projectId }),
    ).toThrow('sesión');
    expect(() =>
      domain.asvsQuery({ ...g, expiresAt: '2000-01-01T00:00:00.000Z' }, { projectId }),
    ).toThrow('caducada');
    expect(() => domain.asvsQuery(g, { projectId: 'otro' })).toThrow();
    expect(() => domain.asvsQuery(g, { projectId, enforcement: 'obligatoria' })).toThrow();
  });
  it('lee varias referencias por página dentro del límite de tamaño', () => {
    const g = grant();
    const refs = asvsCatalog.requirements
      .filter((r) => r.minLevel === 1)
      .slice(0, 10)
      .map((r) => r.reqId);
    const paged = domain.asvsRead(g, { projectId, references: refs.slice(0, 6), limit: 2 });
    expect(paged.items.map((item) => item.reqId)).toEqual(refs.slice(0, 2));
    expect(paged.nextOffset).toBe(2);
    expect(
      domain.asvsRead(g, { projectId, references: refs.slice(0, 6), offset: 4, limit: 2 })
        .nextOffset,
    ).toBeNull();
    // Following nextOffset reads every reference once, several per page and within budget.
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page = domain.asvsRead(g, { projectId, references: refs, offset });
      expect(page.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(12000);
      seen.push(...page.items.map((item) => item.reqId));
      offset = page.nextOffset;
      pages++;
    }
    expect(seen).toEqual(refs);
    expect(pages).toBeLessThan(refs.length);
    // Related-task cursors continue only the reference at offset.
    expect(
      domain
        .asvsRead(g, { projectId, references: refs, offset: 1, taskOffset: 1 })
        .items.map((item) => item.reqId),
    ).toEqual([refs[1]]);
  });
  it('crea tareas con asociaciones solo al aceptar y hace idempotentes los reenvíos', () => {
    const g = grant();
    const patch = {
      project: projectId,
      title: 'Tarea propuesta ASVS',
      phase: 'Implementación',
      priority: 'Alta',
      due: '2026-11-01',
      description: 'Objetivo, contexto y aceptación numerada de prueba',
      nextStep: 'Implementar caso sintético',
      asvsLinks: [link],
    };
    const input = { operation: 'create', kind: 'task', patch, rationale: 'Control pertinente' };
    const p = domain.propose(g, input);
    expect(domain.propose(g, input).id).toBe(p.id);
    expect(domain.require().records.some((r) => r.title === patch.title)).toBe(false);
    domain.review(p.id, true);
    expect(domain.require().records.find((r) => r.title === patch.title)).toMatchObject({
      asvsLinks: [link],
    });
    const rejected = domain.propose(g, {
      ...input,
      patch: { ...patch, title: 'Propuesta rechazada' },
    });
    domain.review(rejected.id, false);
    expect(domain.require().records.some((r) => r.title === 'Propuesta rechazada')).toBe(false);
  });
  it('mantiene propuestas separadas del estado aceptado y exige evidencia, versión y aceptación humana', () => {
    const g = grant();
    for (const extra of [
      { evidence: [] },
      { method: '' },
      { state: 'No cumplido', evidence: [] },
      { expectedVersion: 0 },
      { expectedConfigVersion: 0 },
      { decision: { approved: true } },
      { reference: 'v4.0.3-1.1.1' },
    ])
      expect(() => domain.asvsPropose(g, request(extra))).toThrow();
    const p = domain.asvsPropose(g, request());
    expect(domain.asvsPropose(g, request()).id).toBe(p.id);
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(0);
    expect(domain.asvsQuery(g, { projectId, state: 'Cumplido' }).total).toBe(0);
    expect(domain.asvsQuery(g, { projectId, level: 1 }).counts.pendingProposals).toBe(1);
    expect(domain.asvsQuery(grant('claude'), { projectId }).counts.pendingProposals).toBe(0);
    expect(() =>
      domain.completeTask(g, { taskId: 'otro', closureId: p.id, checkIds: [] }),
    ).toThrow();
    domain.asvsReviewProposals({ ids: [p.id], accept: true });
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(1);
    expect(domain.proposalStatus(g).items).toContainEqual(
      expect.objectContaining({ id: p.id, status: 'accepted' }),
    );
  });
  it('acepta lotes compatibles atómicamente y rechaza versiones o evidencias modificadas', () => {
    const g = grant();
    const p1 = domain.asvsPropose(g, request());
    const p2 = domain.asvsPropose(g, request({}, 1));
    domain.asvsReviewProposals({ ids: [p1.id, p2.id], accept: true });
    expect(domain.asvsList({ projectId }).summary.fulfilled).toBe(2);
    const local = domain.save('entry', {
      ...blank('entry'),
      title: 'Fuente local',
      project: projectId,
      result: 'Verificado',
    });
    const p3 = domain.asvsPropose(
      g,
      request({ evidence: [{ recordId: local.id, reference: 'Fuente local', revision: 'v1' }] }, 2),
    );
    const p4 = domain.asvsPropose(g, request({}, 3));
    domain.save('entry', { ...local, result: 'Contenido distinto' }, local.id, local.version);
    const before = structuredClone(domain.require());
    expect(() => domain.asvsReviewProposals({ ids: [p4.id, p3.id], accept: true })).toThrow(
      'evidencia',
    );
    expect(domain.require()).toEqual(before);
    domain.asvsReviewProposals({ ids: [p3.id], accept: false });
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: ASVS_VERSION,
      level: 2,
    });
    expect(() => domain.asvsReviewProposals({ ids: [p4.id], accept: true })).toThrow(
      'configuración',
    );
  });
  it('No aplicable exige autorización explícita al revisar, sin excluir por propuesta o permiso de cierre', () => {
    const g = grant();
    const p = domain.asvsPropose(
      g,
      request({
        state: 'No aplicable',
        applicability: 'No aplicable',
        evidence: [],
        note: 'No se usa este mecanismo en el proyecto sintético',
      }),
    );
    expect(domain.asvsList({ projectId }).summary.excluded).toBe(0);
    expect(() => domain.asvsReviewProposals({ ids: [p.id], accept: true })).toThrow(
      'decisión humana',
    );
    expect(() =>
      domain.asvsReviewProposals({
        ids: [p.id],
        accept: true,
        decisions: {
          [p.id]: {
            approved: false,
            reason: 'Motivo',
            reference: 'ADR sintético',
            responsible: 'Revisor',
          },
        },
      }),
    ).toThrow();
    domain.asvsReviewProposals({
      ids: [p.id],
      accept: true,
      decisions: {
        [p.id]: {
          approved: true,
          reason: 'No se usa el mecanismo, revisado por persona',
          reference: 'ADR sintético 1',
          responsible: 'Revisor sintético',
        },
      },
    });
    expect(domain.asvsList({ projectId }).summary.excluded).toBe(1);
  });
  it('conserva cobertura parcial y rechaza un lote incompatible sin cambiar el tick', () => {
    const g = grant();
    const work = task();
    const partial = request({
      scope: 'task',
      taskId: work.id,
      expectedTaskVersion: work.version,
      scopeDetail: link.scope,
      pendingScope: 'Resto del proyecto sin verificar',
    });
    const p = domain.asvsPropose(g, partial);
    const other = domain.asvsPropose(
      g,
      request({ state: 'Requiere consulta', evidence: [], note: 'Necesita otra revisión' }),
    );
    const before = structuredClone(domain.require());
    expect(() => domain.asvsReviewProposals({ ids: [p.id, other.id], accept: true })).toThrow(
      'incompatible',
    );
    expect(domain.require()).toEqual(before);
    domain.asvsReviewProposals({ ids: [p.id], accept: true });
    expect(domain.asvsList({ projectId }).summary).toMatchObject({ partial: 1, fulfilled: 0 });
    expect(
      domain.asvsQuery(g, { projectId, state: 'Cumplido', freshness: 'current' }).items[0].status,
    ).toMatchObject({ partial: true, tick: false });
    const latest = domain.require().records.find((r) => r.id === work.id) as Task;
    domain.save(
      'task',
      { ...latest, description: 'Alcance modificado' },
      latest.id,
      latest.version,
    );
    expect(domain.asvsQuery(g, { projectId, freshness: 'stale' }).items[0].status?.stale).toBe(
      true,
    );
  });
});
