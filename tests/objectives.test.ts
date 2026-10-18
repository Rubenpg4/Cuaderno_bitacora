import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Domain, blank } from '../service/domain';
import { Vault } from '../service/vault';
import { objectiveCoverage } from '../shared/objectiveCoverage';
import { memoryReport, type Entry, type Objective, type Project, type Task } from '../shared/model';

const password = 'contraseña larga para pruebas';
let dir: string;
let domain: Domain;
let project: Project;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-objectives-'));
  domain = new Domain(new Vault(dir));
  await domain.unlock(password);
  project = domain.save('project', {
    ...blank('project'),
    title: 'Cuaderno de prueba',
    objective: 'Texto anterior sin relaciones',
  }) as Project;
});

afterEach(() => {
  domain.lock();
  rmSync(dir, { recursive: true, force: true });
});

function task() {
  return domain.save('task', {
    ...blank('task'),
    project: project.id,
    title: 'Preparar prototipo',
  }) as Task;
}

function entry(result = 'Prototipo revisado') {
  return domain.save('entry', {
    ...blank('entry'),
    project: project.id,
    title: 'Revisión',
    result,
  }) as Entry;
}

function objective(links: Record<string, unknown>[] = []) {
  return domain.save('objective', {
    ...blank('objective'),
    project: project.id,
    title: 'Evaluar prototipo',
    description: 'Comprobar el resultado con una referencia.',
    links,
  }) as Objective;
}

describe('trazabilidad de objetivos', () => {
  it('separa trabajo, resultado, evidencia y validación humana', () => {
    const work = task();
    const result = entry();
    const onlyWork = objective([
      {
        id: 'id-del-cliente',
        sourceKind: 'task',
        sourceId: work.id,
        role: 'trabajo',
        reference: '',
      },
    ]);
    expect(onlyWork.links[0].id).not.toBe('id-del-cliente');
    expect(objectiveCoverage(onlyWork, domain.snapshot().records).gaps).toEqual([
      'sin resultado',
      'sin evidencia',
      'pendiente de validación',
    ]);
    domain.save('task', { ...work, state: 'Completada' }, work.id, work.version);
    expect(objectiveCoverage(onlyWork, domain.snapshot().records).gaps).toContain('sin evidencia');

    const supported = domain.save(
      'objective',
      {
        ...onlyWork,
        links: [
          ...onlyWork.links,
          { sourceKind: 'entry', sourceId: result.id, role: 'resultado', reference: '' },
          {
            sourceKind: 'entry',
            sourceId: result.id,
            role: 'evidencia',
            reference: 'Informe interno',
          },
        ],
      },
      onlyWork.id,
      onlyWork.version,
    ) as Objective;
    expect(objectiveCoverage(supported, domain.snapshot().records).gaps).toEqual([
      'pendiente de validación',
    ]);
    const validated = domain.save(
      'objective',
      {
        ...supported,
        validation: {
          ...supported.validation,
          state: 'Validado',
          date: '2026-09-28',
          reference: 'Acta de revisión',
          responsible: 'Responsable',
          linkIds: ['id-falso'],
        },
      },
      supported.id,
      supported.version,
    ) as Objective;
    expect(validated.validation.linkIds).toEqual(validated.links.map((link) => link.id));
    expect(objectiveCoverage(validated, domain.snapshot().records).gaps).toEqual([]);
    expect(memoryReport(domain.snapshot().records)).toContain('### Objetivo: Evaluar prototipo');
    expect(memoryReport(domain.snapshot().records)).toContain('Informe interno');
    expect(domain.snapshot().records.find((record) => record.id === project.id)).toMatchObject({
      objective: 'Texto anterior sin relaciones',
    });
  });

  it('rechaza vínculos inválidos y propuestas MCP que intenten editar objetivos', () => {
    const work = task();
    const result = entry('');
    expect(() =>
      objective([{ sourceKind: 'task', sourceId: work.id, role: 'evidencia', reference: 'x' }]),
    ).toThrow('tarea');
    expect(() =>
      objective([{ sourceKind: 'entry', sourceId: result.id, role: 'resultado', reference: '' }]),
    ).toThrow('entrada');
    expect(() =>
      objective([
        { sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' },
        { sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' },
      ]),
    ).toThrow('repitas');
    const other = domain.save('project', {
      ...blank('project'),
      title: 'Otro cuaderno',
    }) as Project;
    expect(() =>
      domain.save('objective', {
        ...blank('objective'),
        title: 'Ajeno',
        project: other.id,
        links: [{ sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' }],
      }),
    ).toThrow('mismo cuaderno');

    domain.settings({ companyAuthorized: true, universityStructure: '' });
    const session = domain.grant('codex', [], 'projects', [project.id]);
    const auth = domain.authorize(session.token);
    const item = objective();
    expect(domain.context(auth, { recordIds: [item.id] }).items[0]).toMatchObject({
      id: item.id,
      kind: 'objective',
    });
    const related = objective([
      { sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' },
    ]);
    expect(domain.relatedRecords(auth, { recordId: related.id }).items[0]).toMatchObject({
      id: work.id,
      direction: 'outgoing',
    });
    expect(domain.projectSummary(auth, { projectId: project.id }).counts.objective).toBe(2);
    expect(() =>
      domain.propose(auth, {
        operation: 'update',
        kind: 'objective',
        targetId: item.id,
        expectedVersion: item.version,
        patch: { validation: { state: 'Validado' } },
        rationale: 'Prueba de campo reservado',
      }),
    ).toThrow();
  });

  it('invalida la validación al cambiar el resultado y al eliminar una fuente', () => {
    const work = task();
    const result = entry();
    const created = objective([
      { sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' },
      { sourceKind: 'entry', sourceId: result.id, role: 'resultado', reference: '' },
      { sourceKind: 'entry', sourceId: result.id, role: 'evidencia', reference: 'Informe' },
    ]);
    const validated = domain.save(
      'objective',
      {
        ...created,
        validation: {
          state: 'Validado',
          date: '2026-09-28',
          reference: 'Acta',
          responsible: 'Responsable',
          linkIds: [],
        },
      },
      created.id,
      created.version,
    ) as Objective;
    const validatedVersion = validated.version;
    domain.save('entry', { ...result, result: 'Resultado corregido' }, result.id, result.version);
    const invalidated = domain
      .require()
      .records.find((item) => item.id === created.id) as Objective;
    expect(invalidated.validation.state).toBe('Pendiente');
    expect(invalidated.version).toBe(validatedVersion + 1);
    domain.deleteEntry(result.id, result.version + 1);
    const afterDelete = domain
      .require()
      .records.find((item) => item.id === created.id) as Objective;
    expect(afterDelete.links).toHaveLength(1);
    expect(objectiveCoverage(afterDelete, domain.snapshot().records).gaps).toContain(
      'sin evidencia',
    );
    expect(domain.require().history.some((item) => item.recordId === created.id)).toBe(true);
  });

  it('restaura una copia anterior sin inventar objetivos y conserva los nuevos al reabrir', async () => {
    const oldBackup = domain.vault.backup('contraseña de copia de prueba');
    const created = objective();
    domain.lock();
    await domain.unlock(password);
    expect(domain.require().records.find((record) => record.id === created.id)).toMatchObject({
      kind: 'objective',
      title: 'Evaluar prototipo',
    });
    const restored = await domain.vault.restore(oldBackup, 'contraseña de copia de prueba');
    expect(restored.records.some((record) => record.kind === 'objective')).toBe(false);
    expect(restored.records.find((record) => record.id === project.id)).toMatchObject({
      objective: 'Texto anterior sin relaciones',
    });
  });
});
