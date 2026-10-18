import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../service/workspaces';
import { blank, type Domain } from '../service/domain';
import { asvsCatalog } from '../shared/asvsCatalog';
import { compareAsvsCatalogs } from '../shared/asvsCoverage';
import { validateAsvsState } from '../service/asvs/tracking';
import type { Snapshot, Task } from '../shared/model';

const password = 'contraseña sintética de seguimiento';
const reference = 'repositorio sintético / módulo de acceso';
let directory: string, workspaces: Workspaces, domain: Domain, projectId: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-follow-up-'));
  workspaces = new Workspaces(directory);
  const state = await workspaces.create('Seguimiento sintético', password);
  projectId = state.records.find((r) => r.kind === 'project')!.id;
  domain = workspaces.domain!;
  configure(1);
  domain.settings({ companyAuthorized: true, universityStructure: '' });
});
afterEach(() => {
  vi.restoreAllMocks();
  workspaces.lock();
  rmSync(directory, { recursive: true, force: true });
});
function overview() {
  return domain.asvsList({ projectId });
}
function configure(level: 1 | 2 | 3 | null) {
  return domain.asvsConfigure({
    projectId,
    expectedConfigVersion: domain.require().asvs?.config.version ?? 0,
    catalogVersion: asvsCatalog.version,
    level,
  });
}
function grant() {
  return domain.authorize(domain.grant('codex', [], 'projects', [projectId], 60, true).token);
}
function review(index = 0, extra: Record<string, unknown> = {}) {
  const current = overview();
  const a = current.items.filter(
    (i) => i.assessment.catalogVersion === current.config?.catalogVersion,
  )[index].assessment;
  return domain.asvsReview({
    projectId,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: current.config!.version,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Nota privada sintética de evaluación',
    method: 'Prueba sintética',
    responsible: 'Revisor sintético',
    evidence: [{ reference, revision: 'commit-sintético-1' }],
    ...extra,
  });
}
function revision(extra: Record<string, unknown> = {}) {
  return {
    projectId,
    expectedConfigVersion: overview().config!.version,
    expectedVersion: 0,
    reference,
    revision: 'commit-sintético-2',
    reason: 'Cambio declarado del módulo',
    ...extra,
  };
}
function olderCatalog(state: Snapshot) {
  const data = state.asvs!;
  data.config.catalogVersion = '4.0.3';
  data.config.catalogSha256 = 'a'.repeat(64);
  // A synthetic installed predecessor supplies its full comparison baseline.
  data.config.catalogBaseline![0].contentSha256 = 'b'.repeat(64);
  data.config.catalogBaseline!.push({
    reqId: 'V99.1.1',
    contentSha256: 'c'.repeat(64),
    minLevel: 1,
  });
  data.config.catalogBaseline = data.config.catalogBaseline!.filter(
    (r) => r.reqId !== asvsCatalog.requirements[1].reqId,
  );
  for (const a of data.assessments) a.catalogVersion = '4.0.3';
  for (const h of data.history) {
    h.after.catalogVersion = '4.0.3';
    if (h.before) h.before.catalogVersion = '4.0.3';
  }
}

describe('revalidación y cobertura ASVS', () => {
  it('cuenta el catálogo aunque falten evaluaciones; separa parciales, exclusiones, estados y capítulos', () => {
    review();
    review(1, { state: 'No cumplido' });
    review(2, { state: 'Requiere consulta' });
    review(3, { scope: 'component', scopeDetail: 'Módulo A', pendingScope: 'Módulo B' });
    review(4, {
      state: 'No aplicable',
      applicability: 'No aplicable',
      evidence: [],
      decision: {
        approved: true,
        reason: 'Componente ausente',
        reference: 'ADR sintético',
        responsible: 'Revisor',
      },
    });
    expect(overview().summary).toMatchObject({
      selected: 70,
      fulfilled: 1,
      failed: 1,
      consultation: 1,
      partial: 1,
      excluded: 1,
      denominator: 69,
      pending: 65,
    });
    domain.transaction(() => {
      domain.require().asvs!.assessments.pop();
    });
    expect(overview().summary.selected).toBe(70);
    expect(overview().summary.pending).toBe(65);
    for (const key of Object.keys(overview().summary) as (keyof ReturnType<
      typeof overview
    >['summary'])[])
      expect(overview().chapters.reduce((sum, chapter) => sum + chapter.counts[key], 0)).toBe(
        overview().summary[key],
      );
  });
  it('una revisión señalada solo desactualiza su fuente, conserva revisiones y revalida global/tarea', async () => {
    review();
    review(1, { evidence: [{ reference: 'Otro módulo', revision: 'v1' }] });
    const reqId = overview().items[0].assessment.reqId;
    const work = domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Trabajo sintético',
      asvsLinks: [
        {
          catalogVersion: asvsCatalog.version,
          reqId,
          reason: 'Control',
          scope: 'Módulo',
          criterion: 'Caso probado',
          method: 'Prueba',
        },
      ],
    }) as Task;
    domain.asvsTaskReview({
      projectId,
      expectedConfigVersion: overview().config!.version,
      expectedVersion: 0,
      taskId: work.id,
      reqId,
      expectedTaskVersion: work.version,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: 'Módulo',
      pendingScope: 'Resto del proyecto',
      note: 'Caso observado',
      method: 'Prueba',
      responsible: 'Revisor',
      evidence: [{ reference, revision: 'commit-sintético-1' }],
    });
    const old = structuredClone(domain.require().asvs!.assessments[0]);
    const history = structuredClone(domain.require().asvs!.history);
    domain.asvsSourceRevision(revision());
    expect(overview().summary.fulfilled).toBe(1);
    expect(overview().summary.stale).toBe(1);
    expect(domain.require().asvs!.assessments[0]).toEqual(old);
    expect(domain.require().asvs!.history.slice(0, history.length)).toEqual(history);
    expect(domain.asvsTaskStatuses({ projectId, taskId: work.id })[0].status.stale).toBe(true);
    expect(() => review()).toThrow('otra revisión');
    review(0, { evidence: [{ reference, revision: 'commit-sintético-2' }] });
    expect(overview().summary.fulfilled).toBe(2);
    const backup = domain.vault.backup(password);
    domain.asvsSourceRevision(revision({ expectedVersion: 1, revision: 'commit-sintético-3' }));
    const restored = await domain.vault.restore(backup, password);
    workspaces.validateState(restored);
    domain.vault.save(restored);
    domain.state = restored;
    expect(overview().summary.fulfilled).toBe(2);
    const invalid = structuredClone(restored);
    invalid.asvs!.sourceRevisions![0].projectId = 'ajeno';
    expect(() => validateAsvsState(invalid, projectId)).toThrow();
  });
  it('conserva evidencia local e historial al perder la fuente y recalcula nivel y activación', () => {
    const source = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Fuente',
      result: 'Resultado',
    });
    review(0, {
      evidence: [{ recordId: source.id, reference: 'Resultado registrado', revision: 'v1' }],
    });
    const accepted = structuredClone(overview().items[0].assessment);
    configure(2);
    expect(overview().summary.denominator).toBe(253);
    expect(overview().summary.fulfilled).toBe(0);
    configure(1);
    expect(overview().summary.fulfilled).toBe(1);
    configure(null);
    expect(overview().summary.selected).toBe(0);
    configure(1);
    expect(overview().summary.fulfilled).toBe(1);
    domain.transaction(() => {
      domain.require().records = domain.require().records.filter((r) => r.id !== source.id);
    });
    expect(overview().items[0].status.reasons).toContain('Fuente eliminada');
    expect(overview().items[0].assessment).toEqual(accepted);
  });
  it('una nueva modificación sustantiva cambia la causa de revalidación, sin confundir metadatos con evidencia', () => {
    let source = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Fuente',
      result: 'Resultado 1',
    });
    review(0, {
      evidence: [{ recordId: source.id, reference: 'Resultado registrado', revision: 'v1' }],
    });
    source = domain.save('entry', { ...source, result: 'Resultado 2' }, source.id, source.version);
    const changed = overview().gaps[0].cause;
    source = domain.save('entry', { ...source, title: 'Título nuevo' }, source.id, source.version);
    expect(overview().gaps[0].cause).toBe(changed);
    domain.save('entry', { ...source, result: 'Resultado 3' }, source.id, source.version);
    expect(overview().gaps[0].cause).not.toBe(changed);
  });
  it('solo acepta propuestas de revisión en sesión humana y revoca las pendientes al cambiar perfil', () => {
    review();
    const g = grant();
    const before = structuredClone(domain.require());
    expect(() => domain.asvsRevisionPropose({ ...g, scope: 'selected' }, revision())).toThrow(
      'sesión de proyecto',
    );
    expect(() =>
      domain.asvsRevisionPropose({ ...g, expiresAt: '2020-01-01T00:00:00Z' }, revision()),
    ).toThrow('caducada');
    expect(() => domain.asvsRevisionPropose(g, revision({ projectId: 'ajeno' }))).toThrow();
    expect(domain.require()).toEqual(before);
    const p = domain.asvsRevisionPropose(g, revision());
    expect(domain.asvsRevisionPropose(g, revision()).id).toBe(p.id);
    expect(overview().summary.fulfilled).toBe(1);
    expect(domain.proposalStatus(g).some((s) => s.id === p.id && s.status === 'pending')).toBe(
      true,
    );
    domain.asvsRevisionReview({ id: p.id, accept: true });
    expect(overview().summary.fulfilled).toBe(0);
    const conflict = domain.asvsRevisionPropose(
      g,
      revision({ expectedVersion: 1, revision: 'commit-sintético-3' }),
    );
    configure(2);
    expect(() => domain.asvsRevisionReview({ id: conflict.id, accept: true })).toThrow(
      'configuración',
    );
    domain.setMcpProfile('corporativo');
    expect(
      domain.require().asvs!.revisionProposals!.find((p) => p.id === conflict.id)?.status,
    ).toBe('rejected');
  });
  it('resume lagunas sin notas privadas y distingue tareas similares de creaciones pendientes', () => {
    review(0, { state: 'No cumplido' });
    const g = grant();
    const reqId = overview().items[0].assessment.reqId;
    const similar = domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: `Revisar ${reqId}`,
      description: 'Contexto sintético',
    }) as Task;
    const plan = domain.asvsRemediation(g, { projectId, limit: 1 });
    expect(plan.items).toHaveLength(1);
    expect(plan.nextOffset).toBe(1);
    expect(plan.items[0]).toMatchObject({
      category: 'failed',
      action: 'reuse-task',
      priority: 'Por determinar',
      dependencyCandidates: [similar.id],
    });
    expect(JSON.stringify(plan)).not.toContain('Nota privada sintética');
    expect(() => domain.asvsRemediation(g, { projectId, limit: 100 })).toThrow();
    expect(() => domain.asvsRemediation({ ...g, scope: 'selected' }, { projectId })).toThrow();
    const second = domain.asvsRemediation(g, { projectId, offset: 1, limit: 1 }).items[0];
    domain.propose(g, {
      operation: 'create',
      kind: 'task',
      patch: {
        project: projectId,
        title: 'Propuesta de remediación',
        description: 'Objetivo y caso sintético',
        phase: 'Implementación',
        priority: 'Media',
        due: '2026-12-01',
        nextStep: 'Verificar el módulo',
        asvsLinks: [
          {
            catalogVersion: asvsCatalog.version,
            reqId: second.reqId,
            reason: 'Control',
            scope: 'Módulo',
            criterion: 'Caso',
            method: 'Prueba',
          },
        ],
      },
      rationale: 'Remediación acotada',
    });
    const pending = domain.asvsRemediation(g, { projectId, offset: 1, limit: 1 }).items[0];
    expect(pending).toMatchObject({
      pendingCreationCount: 1,
      action: 'review-pending-proposal',
      existingTasks: [],
      dependencyCandidates: [],
    });
    expect(overview().summary.fulfilled).toBe(0);
  });
  it('agrupa señales ASVS y conserva el descarte hasta que cambia la causa, incluso al terminar revisión', () => {
    review();
    domain.asvsSourceRevision(revision());
    const signals = domain.weeklySignals().filter((s) => s.kind === 'asvs');
    expect(signals.length).toBeLessThan(70);
    const signal = signals.find((s) => s.title.includes('revalidaciones'))!;
    domain.decideWeeklySignal({
      expectedVersion: 0,
      key: signal.key,
      cause: signal.cause,
      mode: 'dismissed',
    });
    domain.finishWeeklyReview(1);
    expect(domain.require().weeklyReview!.decisions).toHaveLength(1);
    expect(domain.weeklySignals().find((s) => s.key === signal.key)?.cause).toBe(signal.cause);
    domain.asvsSourceRevision(revision({ expectedVersion: 1, revision: 'commit-sintético-3' }));
    expect(domain.weeklySignals().find((s) => s.key === signal.key)?.cause).not.toBe(signal.cause);
    expect(() =>
      domain.decideWeeklySignal({
        expectedVersion: 2,
        key: `asvs:ajeno:${signal.itemId}`,
        cause: signal.cause,
        mode: 'dismissed',
      }),
    ).toThrow('señal');
    workspaces.validateState(domain.require());
  });
});

describe('actualización humana de catálogo ASVS', () => {
  it('compara altas, bajas, contenido y nivel sin inferir correspondencias', () => {
    const original = [
      { reqId: 'V1.1.1', contentSha256: 'a', minLevel: 1 as const },
      { reqId: 'V2.1.1', contentSha256: 'b', minLevel: 1 as const },
    ];
    const current = [
      { ...original[0], minLevel: 2 as const },
      { reqId: 'V3.1.1', contentSha256: 'c', minLevel: 1 as const },
    ];
    expect(compareAsvsCatalogs(original, current)).toEqual({
      added: ['V3.1.1'],
      removed: ['V2.1.1'],
      changed: ['V1.1.1'],
      unchanged: [],
    });
  });
  it('previsualiza, exige confirmación vigente y nunca copia ticks de la versión anterior', async () => {
    review();
    domain.transaction(() => olderCatalog(domain.require()));
    const before = structuredClone(domain.require().asvs!);
    const request = {
      projectId,
      expectedConfigVersion: before.config.version,
      catalogVersion: asvsCatalog.version,
    };
    const preview = domain.asvsCatalogPreview(request);
    expect(preview.diff).toMatchObject({
      added: [asvsCatalog.requirements[1].reqId],
      removed: ['V99.1.1'],
      changed: [asvsCatalog.requirements[0].reqId],
    });
    expect(domain.require().asvs).toEqual(before);
    const input = {
      ...request,
      previewToken: preview.previewToken,
      confirmed: true,
      mappings: [
        {
          from: asvsCatalog.requirements[0].reqId,
          to: asvsCatalog.requirements[0].reqId,
          reason: 'Correspondencia revisada por contenido',
        },
      ],
    };
    expect(() => domain.asvsCatalogUpdate({ ...input, confirmed: false })).toThrow();
    expect(() =>
      domain.asvsCatalogUpdate({
        ...input,
        mappings: [{ from: 'V999.1.1', to: 'V1.1.1', reason: 'Sin respaldo' }],
      }),
    ).toThrow('Correspondencia');
    const changed = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Registro nuevo',
    });
    expect(() => domain.asvsCatalogUpdate(input)).toThrow('vista previa');
    const fresh = domain.asvsCatalogPreview(request);
    const result = domain.asvsCatalogUpdate({ ...input, previewToken: fresh.previewToken });
    expect(result.summary).toMatchObject({ selected: 70, pending: 70, fulfilled: 0 });
    expect(domain.require().asvs!.assessments.slice(0, before.assessments.length)).toEqual(
      before.assessments,
    );
    expect(domain.require().asvs!.history.slice(0, before.history.length)).toEqual(before.history);
    expect(
      domain.require().asvs!.history.some((h) => h.kind === 'catalog' && h.mappings.length === 1),
    ).toBe(true);
    const backup = domain.vault.backup(password);
    configure(3);
    const restored = await domain.vault.restore(backup, password);
    workspaces.validateState(restored);
    domain.vault.save(restored);
    domain.state = restored;
    expect(overview().summary.pending).toBe(70);
    expect(domain.require().records.some((r) => r.id === changed.id)).toBe(true);
  });
  it('bloquea catálogo ajeno, base ausente y fallos de persistencia sin pérdida de historial', () => {
    domain.transaction(() => olderCatalog(domain.require()));
    const base = {
      projectId,
      expectedConfigVersion: overview().config!.version,
      catalogVersion: asvsCatalog.version,
    };
    expect(() => domain.asvsCatalogPreview({ ...base, projectId: 'ajeno' })).toThrow();
    expect(() => domain.asvsCatalogPreview({ ...base, catalogVersion: '6.0.0' })).toThrow();
    const preview = domain.asvsCatalogPreview(base);
    const before = structuredClone(domain.require());
    const spy = vi.spyOn(domain.vault, 'save').mockImplementation(() => {
      throw Error('Fallo sintético');
    });
    expect(() =>
      domain.asvsCatalogUpdate({
        ...base,
        previewToken: preview.previewToken,
        confirmed: true,
        mappings: [],
      }),
    ).toThrow('Fallo sintético');
    expect(domain.require()).toEqual(before);
    spy.mockRestore();
    domain.transaction(() => {
      delete domain.require().asvs!.config.catalogBaseline;
    });
    expect(() => domain.asvsCatalogPreview(base)).toThrow('base del catálogo');
  });
});
