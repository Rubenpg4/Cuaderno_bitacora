import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspaces } from '../service/workspaces';
import { blank, type Domain } from '../service/domain';
import type { Entry, Task } from '../shared/model';

// MCP read and proposal contracts on a synthetic notebook.
const password = 'contraseña sintética de contratos MCP';
let directory: string, workspaces: Workspaces, domain: Domain, projectId: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'bitacora-mcp-contracts-'));
  workspaces = new Workspaces(directory);
  const state = await workspaces.create('Contratos MCP', password);
  projectId = state.records.find((r) => r.kind === 'project')!.id;
  domain = workspaces.domain!;
  domain.settings({ companyAuthorized: true, universityStructure: '' });
});
afterEach(() => {
  workspaces.lock();
  rmSync(directory, { recursive: true, force: true });
});
function session(provider: 'codex' | 'claude' = 'codex') {
  return domain.authorize(domain.grant(provider, [], 'projects', [projectId], 60).token);
}
function task(extra: Record<string, unknown> = {}) {
  return domain.save('task', {
    ...blank('task'),
    project: projectId,
    title: 'Tarea sintética',
    ...extra,
  }) as Task;
}
function proposeTask(g: ReturnType<typeof session>, title: string, extra = {}) {
  return domain.propose(g, {
    operation: 'create',
    kind: 'task',
    patch: {
      project: projectId,
      title,
      phase: 'Diseño',
      priority: 'Media',
      due: '2026-12-01',
      description: 'Descripción sintética',
      nextStep: 'Paso sintético',
      ...extra,
    },
    rationale: 'Prueba de contrato',
  });
}

describe('lecturas MCP', () => {
  it('entrega como objeto el registro que cabe y como texto paginado el que no', () => {
    const g = session();
    const small = task({ description: 'Texto con "comillas"\ny saltos' });
    const read = domain.readRecords(g, { recordIds: [small.id] });
    expect(read.items[0]).not.toHaveProperty('excerpt');
    expect(read.items[0].fields).toMatchObject({ description: small.description });
    expect(read.nextExcerptOffset).toBeUndefined();

    const large = task({ title: 'Tarea extensa', description: 'detalle '.repeat(2000) });
    const first = domain.readRecords(g, { recordIds: [large.id] });
    expect(first.items[0]).not.toHaveProperty('fields');
    expect(first.nextExcerptOffset).toBeGreaterThan(0);
    let text = first.items[0].excerpt!;
    let offset = first.nextExcerptOffset;
    while (offset !== undefined) {
      const next = domain.readRecords(g, { recordIds: [large.id], excerptOffset: offset });
      text += next.items[0].excerpt;
      offset = next.nextExcerptOffset;
    }
    expect(JSON.parse(text).description).toBe(large.description);
  });
  it('rechaza parámetros desconocidos o vacíos en lugar de ignorarlos', () => {
    const g = session();
    const work = task();
    expect(() => domain.readRecords(g, { recordIds: [] })).toThrow('Selecciona');
    expect(() => domain.readRecords(g, { recordIds: [work.id], limit: 3 })).toThrow();
    expect(() => domain.taskCriteria(g, { taskId: '' })).toThrow('Indica una tarea');
    expect(() => domain.taskCriteria(g, { taskId: work.id, kind: 'task' })).toThrow();
    expect(
      domain.taskCriteria(g, { taskId: work.id }).items.every((i) => i.kind === 'practice'),
    ).toBe(true);
  });
  it('indica el tipo de cada relación en ambos sentidos', () => {
    const g = session();
    const before = task({ title: 'Tarea previa' });
    const after = task({ title: 'Tarea dependiente', dependencyIds: [before.id] });
    const entry = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Entrada sintética',
      taskIds: [before.id],
    }) as Entry;
    const relations = domain.relatedRecords(g, { recordId: before.id }).items;
    expect(relations).toContainEqual(
      expect.objectContaining({ id: after.id, direction: 'incoming', relation: 'dependency' }),
    );
    expect(relations).toContainEqual(
      expect.objectContaining({ id: entry.id, direction: 'incoming', relation: 'link' }),
    );
    const outgoing = domain.relatedRecords(g, { recordId: after.id }).items;
    expect(outgoing).toContainEqual(
      expect.objectContaining({ id: before.id, direction: 'outgoing', relation: 'dependency' }),
    );
    for (const check of after.checks)
      expect(outgoing).toContainEqual(
        expect.objectContaining({ id: check.practiceId, relation: 'criterion' }),
      );
  });
});

describe('propuestas MCP', () => {
  it('lista las propias con su destino, filtra y pagina sin mostrar las de otros', () => {
    const g = session();
    const created = proposeTask(g, 'Tarea propuesta');
    const work = task({ title: 'Tarea existente' });
    const update = domain.propose(g, {
      operation: 'update',
      kind: 'task',
      targetId: work.id,
      expectedVersion: work.version,
      patch: { nextStep: 'Nuevo paso' },
      rationale: 'Prueba de contrato',
    });
    const other = proposeTask(session('claude'), 'Propuesta de otro proveedor');
    const all = domain.proposalStatus(g);
    expect(all.items.map((p) => p.id)).not.toContain(other.id);
    expect(all.items).toContainEqual(
      expect.objectContaining({
        id: created.id,
        kind: 'task',
        operation: 'create',
        title: 'Tarea propuesta',
        status: 'pending',
      }),
    );
    expect(domain.proposalStatus(g, { targetId: work.id }).items).toEqual([
      expect.objectContaining({ id: update.id, operation: 'update', title: 'Tarea existente' }),
    ]);
    domain.review(created.id, false);
    expect(domain.proposalStatus(g, { status: 'rejected' }).items.map((p) => p.id)).toEqual([
      created.id,
    ]);
    const page = domain.proposalStatus(g, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
    expect(domain.proposalStatus(g, { offset: 1, limit: 1 }).nextOffset).toBeNull();
    expect(() => domain.proposalStatus(g, { status: 'otro' })).toThrow();
  });
  it('enlaza las fuentes que la reunión menciona solo dentro de su ámbito autorizado', () => {
    const g = session();
    const work = task({ title: 'Tarea revisada' });
    const entry = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Entrada revisada',
    }) as Entry;
    const meeting = (body: string) =>
      domain.propose(g, {
        operation: 'create',
        kind: 'meeting',
        patch: { project: projectId, title: 'Reunión sintética', body },
        rationale: 'Prueba de fuentes',
      });
    const proposal = meeting(`Avance en @[task:${work.id}] y en @Entrada revisada.`);
    const stored = domain.require().proposals.find((p) => p.id === proposal.id)!;
    expect(stored.meetingSourceIds).toEqual([work.id, entry.id]);
    expect(stored.patch.body).toBe('Avance en @Tarea revisada y en @Entrada revisada.');
    domain.review(proposal.id, true);
    const created = domain
      .require()
      .records.find((r) => r.kind === 'meeting' && r.title === 'Reunión sintética');
    expect(created).toMatchObject({ sourceIds: [work.id, entry.id] });

    expect(() => meeting('Ver @[task:inexistente]')).toThrow('no está autorizada');
    const api = domain.saveSubproject({ title: 'API sintética' });
    const scoped = task({ title: 'Tarea de otro ámbito', subprojectId: api.id });
    expect(() => meeting(`Ver @[task:${scoped.id}]`)).toThrow('no está autorizada');
    // An unknown title is plain text, not a source.
    const plain = meeting('Sin @Fuente conocida');
    expect(
      domain.require().proposals.find((p) => p.id === plain.id)!.meetingSourceIds,
    ).toBeUndefined();
  });
  it('interpreta un subproyecto vacío o «general» como el ámbito General', () => {
    const g = session();
    for (const subprojectId of ['', 'general']) {
      const proposal = proposeTask(g, `Tarea en General (${subprojectId || 'vacío'})`, {
        subprojectId,
      });
      domain.review(proposal.id, true);
    }
    const created = domain
      .require()
      .records.filter((r) => r.kind === 'task' && r.title.startsWith('Tarea en General'));
    expect(created).toHaveLength(2);
    for (const record of created) expect(record).not.toHaveProperty('subprojectId');
  });
});
