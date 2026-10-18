import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../service/workspaces';
import { blank, type Domain } from '../service/domain';
import { asvsRecordFingerprint, validateAsvsState, reviewAsvs } from '../service/asvs/tracking';
import { encrypt } from '../service/vault';
import { ASVS_VERSION } from '../shared/asvs';
import type { Task, Entry, Incident, Decision } from '../shared/model';

const password = 'contraseña sintética de prueba ASVS';
let directory: string, workspaces: Workspaces, domain: Domain, projectId: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-'));
  workspaces = new Workspaces(directory);
  const snapshot = await workspaces.create('Pruebas ASVS', password);
  projectId = snapshot.records.find((r) => r.kind === 'project')!.id;
  domain = workspaces.domain!;
});
afterEach(() => {
  workspaces.lock();
  rmSync(directory, { recursive: true, force: true });
});
function overview() {
  return domain.asvsList({ projectId });
}
function configure(level: 1 | 2 | 3 | null, extra: Record<string, unknown> = {}) {
  return domain.asvsConfigure({
    projectId,
    expectedConfigVersion: overview().config?.version ?? 0,
    catalogVersion: ASVS_VERSION,
    level,
    ...extra,
  });
}
function review(extra: Record<string, unknown> = {}, index = 0) {
  const current = overview();
  const assessment = current.items[index].assessment;
  return domain.asvsReview({
    projectId,
    targetId: assessment.id,
    expectedVersion: assessment.version,
    expectedConfigVersion: current.config!.version,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'La prueba verifica el requisito en todo el sistema de prueba.',
    method: 'Prueba automatizada',
    responsible: 'Revisor de prueba',
    evidence: [
      { reference: 'tests/security.test.ts — caso de prueba', revision: 'commit de prueba 1' },
    ],
    ...extra,
  });
}

describe('configuración, evaluación y vigencia ASVS', () => {
  it('permanece ausente por defecto, añade niveles acumulativos y preserva historial al apagar', () => {
    expect(domain.require().asvs).toBeUndefined();
    expect(overview().summary.selected).toBe(0);
    expect(configure(1).items).toHaveLength(70);
    expect(configure(2).summary.selected).toBe(253);
    expect(configure(3).summary.selected).toBe(345);
    const history = structuredClone(domain.require().asvs!.history);
    const disabled = configure(null);
    expect(disabled.summary.fulfilled).toBe(0);
    expect(disabled.summary.selected).toBe(0);
    expect(domain.require().asvs!.history.slice(0, history.length)).toEqual(history);
    expect(configure(1).summary.selected).toBe(70);
    expect(overview().items).toHaveLength(345);
  });
  it('solo cuenta una revisión humana Cumplido vigente, global y con evidencia', () => {
    configure(1);
    expect(() => review({ evidence: [] })).toThrow('evidencia');
    expect(() => review({ evidence: [{ reference: ' ', revision: 'v1' }] })).toThrow();
    expect(() => review({ evidence: [{ reference: 'informe', revision: '' }] })).toThrow();
    expect(() => review({ responsible: '' })).toThrow('responsable');
    expect(() => review({ applicability: 'Por determinar' })).toThrow('aplicabilidad');
    expect(() => review({ state: 'Certificado' })).toThrow();
    expect(() => review({ actor: 'MCP', evaluatedLevel: 3 })).toThrow();
    expect(review().summary.fulfilled).toBe(1);
    expect(configure(2).items[0].status).toMatchObject({ stale: true, tick: false });
    expect(configure(1).items[0].status.tick).toBe(true);
    expect(
      configure(1, { contextReason: 'Nuevo componente de pruebas' }).items[0].status,
    ).toMatchObject({ stale: true, tick: false });
    expect(review().items[0].status.tick).toBe(true);
    expect(configure(null).items[0].status.tick).toBe(false);
    expect(configure(1).items[0].status.tick).toBe(true);
  });
  it('registra los estados y rechaza conflictos sin escribir parcialmente', () => {
    configure(1);
    for (const state of ['No cumplido', 'Requiere consulta', 'Pendiente']) {
      expect(review({ state }).summary.fulfilled).toBe(0);
    }
    const before = structuredClone(domain.require());
    expect(() => review({ expectedVersion: 1 })).toThrow('evaluación ASVS ha cambiado');
    expect(() => review({ expectedConfigVersion: 0 })).toThrow('configuración ASVS ha cambiado');
    expect(() => review({ targetId: '00000000-0000-4000-8000-000000000000' })).toThrow('fuera');
    expect(() => configure(1, { catalogVersion: '4.0.3' })).toThrow();
    expect(() => configure(1, { expectedConfigVersion: 0 })).toThrow('configuración');
    expect(domain.require()).toEqual(before);
    const history = domain.asvsHistory({ projectId, targetId: overview().items[0].assessment.id });
    expect(history.items).toHaveLength(4);
    expect(history.items[0].kind === 'assessment' && history.items[0].before?.state).toBe(
      'Requiere consulta',
    );
  });
  it('exige decisión aprobada para excluir y reinicia Pendiente al volver a Aplicable', () => {
    configure(1);
    const excluded = { state: 'No aplicable', applicability: 'No aplicable' };
    expect(() => review(excluded)).toThrow('decisión humana');
    expect(() =>
      review({
        ...excluded,
        decision: {
          approved: false,
          reason: 'No hay ese componente',
          reference: 'ADR-1',
          responsible: 'Revisor',
        },
      }),
    ).toThrow();
    const decision = {
      approved: true,
      reason: 'Componente ausente en el alcance',
      reference: 'ADR de prueba 1',
      responsible: 'Revisor de prueba',
    };
    const result = review({ ...excluded, decision });
    expect(result.summary).toMatchObject({ fulfilled: 0, excluded: 1, denominator: 69 });
    expect(result.items[0].status).toMatchObject({ excluded: true, tick: false });
    expect(() => review()).toThrow('Pendiente');
    expect(review({ state: 'Pendiente', evidence: [] }).items[0].assessment.decision).toBeNull();
    review({ ...excluded, decision });
    expect(configure(2).items[0].status.excluded).toBe(false);
    expect(overview().summary.denominator).toBe(253);
  });
  it('muestra cobertura parcial sin validar el requisito global ni cerrar tareas por atajo', () => {
    configure(1);
    expect(() => review({ scope: 'component' })).toThrow('alcance pendiente');
    const result = review({
      scope: 'component',
      scopeDetail: 'API de prueba',
      pendingScope: 'Interfaz de prueba',
    });
    expect(result.items[0].status).toMatchObject({ partial: true, tick: false, stale: false });
    const task = domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Tarea de prueba',
      description: 'Componente aislado',
    }) as Task;
    expect(() =>
      review({
        scope: 'task',
        taskId: task.id,
        expectedTaskVersion: 0,
        scopeDetail: 'Tarea',
        pendingScope: 'Otros componentes',
      }),
    ).toThrow('tarea ha cambiado');
    const partial = review({
      scope: 'task',
      taskId: task.id,
      expectedTaskVersion: task.version,
      scopeDetail: 'Tarea',
      pendingScope: 'Otros componentes',
    });
    expect(partial.summary.fulfilled).toBe(0);
    domain.save('task', { ...task, description: 'Nuevo alcance' }, task.id, task.version);
    expect(overview().items[0].status.reasons).toContain('Alcance de tarea modificado');
    expect((domain.require().records.find((r) => r.id === task.id) as Task).checks).toEqual([]);
  });
  it('invalida evidencia local al editar solución o eliminar fuente, sin invalidar prioridad/día/estado', () => {
    configure(1);
    const task = domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Fuente de prueba',
      description: 'Alcance',
      solution: 'Resultado 1',
    }) as Task;
    review({
      evidence: [{ recordId: task.id, reference: 'Prueba en la solución', revision: 'v1' }],
    });
    const updated = domain.save(
      'task',
      { ...task, priority: 'Baja', state: 'En curso', due: '2026-11-01' },
      task.id,
      task.version,
    ) as Task;
    expect(overview().items[0].status.tick).toBe(true);
    const changed = domain.save(
      'task',
      { ...updated, solution: 'Resultado 2' },
      updated.id,
      updated.version,
    ) as Task;
    expect(overview().items[0].status.reasons).toContain('Evidencia local modificada');
    review({ evidence: [{ recordId: task.id, reference: 'Nueva revisión', revision: 'v3' }] });
    expect(overview().items[0].status.tick).toBe(true);
    domain.deleteTask(changed.id, changed.version);
    expect(overview().items[0].status.reasons).toContain('Fuente eliminada');
    expect(overview().items[0].assessment.state).toBe('Cumplido');
  });
  it('fija huellas sustantivas por tipo y no deduce evidencia del título', () => {
    const entry = domain.save('entry', {
      ...blank('entry'),
      title: 'Entrada de prueba',
      project: projectId,
      result: 'Resultado 1',
    }) as Entry;
    const incident = domain.save('incident', {
      ...blank('incident'),
      title: 'Incidencia de prueba',
      project: projectId,
    }) as Incident;
    const decision = domain.save('decision', {
      ...blank('decision'),
      title: 'Decisión de prueba',
      project: projectId,
    }) as Decision;
    for (const record of [entry, incident, decision]) {
      expect(
        asvsRecordFingerprint({ ...record, title: 'Otro título', version: 3, date: '2026-10-15' }),
      ).toBe(asvsRecordFingerprint(record));
    }
    for (const field of ['activity', 'result', 'evidence'] as const)
      expect(asvsRecordFingerprint({ ...entry, [field]: 'Contenido distinto' })).not.toBe(
        asvsRecordFingerprint(entry),
      );
    for (const field of ['description', 'solution'] as const)
      expect(asvsRecordFingerprint({ ...incident, [field]: 'Contenido distinto' })).not.toBe(
        asvsRecordFingerprint(incident),
      );
    for (const field of ['decision', 'reason', 'evidence'] as const)
      expect(asvsRecordFingerprint({ ...decision, [field]: 'Contenido distinto' })).not.toBe(
        asvsRecordFingerprint(decision),
      );
    const task = domain.save('task', {
      ...blank('task'),
      title: 'Tarea',
      project: projectId,
    }) as Task;
    for (const field of ['description', 'type', 'tags', 'attachments'] as const) {
      const value =
        field === 'tags'
          ? ['nuevo']
          : field === 'attachments'
            ? [{ id: 'a', name: 'a.md', mime: 'text/markdown', size: 1, data: 'YQ==' }]
            : 'Nuevo';
      expect(asvsRecordFingerprint({ ...task, [field]: value }, true)).not.toBe(
        asvsRecordFingerprint(task, true),
      );
    }
  });
});

describe('vault, recuperación y aislamiento ASVS', () => {
  it('eleva el esquema a 2 y rechaza copias con esquema futuro o ASVS en esquema 1', async () => {
    configure(1);
    const envelope = JSON.parse(domain.vault.backup(password).toString());
    const salt = Buffer.from(envelope.salt, 'base64');
    const key = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from('BITACORA-VAULT-1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const bytes = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    const SQL = await initSqlJs({
      locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'),
    });
    const database = new SQL.Database(bytes);
    try {
      expect(database.exec('SELECT schema_version FROM app_state')[0].values[0][0]).toBe(2);
      for (const schemaVersion of [1, 3]) {
        database.run('UPDATE app_state SET schema_version=?', [schemaVersion]);
        const exported = database.export();
        const candidate = encrypt(exported, key, salt);
        exported.fill(0);
        await expect(domain.vault.restore(candidate, password)).rejects.toThrow('incompatible');
      }
      expect(domain.require().asvs!.config.level).toBe(1);
    } finally {
      database.close();
      bytes.fill(0);
      key.fill(0);
    }
  });
  it('un denominador cero conserva exclusiones sin mostrar cumplimiento y pagina historial', () => {
    configure(1);
    domain.transaction(() => {
      const state = domain.require();
      for (const assessment of state.asvs!.assessments)
        reviewAsvs(
          state,
          {
            projectId,
            targetId: assessment.id,
            expectedVersion: assessment.version,
            expectedConfigVersion: 1,
            state: 'No aplicable',
            applicability: 'No aplicable',
            scope: 'project',
            scopeDetail: '',
            pendingScope: '',
            note: 'Requisito ajeno al sistema sintético evaluado',
            method: 'Revisión de alcance',
            responsible: 'Revisor',
            evidence: [],
            decision: {
              approved: true,
              reason: 'Componente ausente en pruebas',
              reference: 'ADR de prueba',
              responsible: 'Revisor',
            },
          },
          projectId,
        );
    });
    expect(overview().summary).toMatchObject({ denominator: 0, fulfilled: 0, excluded: 70 });
    review({ state: 'Pendiente', evidence: [] });
    for (let index = 0; index < 10; index++) review({ state: 'Pendiente', evidence: [] });
    const first = domain.asvsHistory({ projectId, targetId: overview().items[0].assessment.id });
    const second = domain.asvsHistory({
      projectId,
      targetId: overview().items[0].assessment.id,
      offset: first.nextOffset!,
    });
    expect(first.items).toHaveLength(10);
    expect(second.nextOffset).toBeNull();
    expect(second.items[second.items.length - 1].after.version).toBe(1);
  });
  it('migra una vez con copia cifrada, reabre y restaura datos e historia', async () => {
    const original = domain.vault.backup(password);
    const before = readFileSync(domain.vault.path);
    configure(1);
    review();
    const recovery = domain.vault.path + '.pre-asvs.backup';
    expect(readFileSync(recovery)).toEqual(before);
    expect(readFileSync(recovery, 'utf8')).not.toContain('Pruebas ASVS');
    const data = structuredClone(domain.require().asvs);
    const backup = domain.vault.backup(password);
    configure(3);
    expect(readFileSync(recovery)).toEqual(before);
    const restored = await domain.vault.restore(backup, password);
    workspaces.validateState(restored);
    domain.vault.save(restored);
    domain.state = restored;
    expect(domain.require().asvs).toEqual(data);
    workspaces.lock();
    const reopened = await workspaces.unlock(projectId, password);
    expect(reopened.asvs).toEqual(data);
    domain = workspaces.domain!;
    expect(overview().items[0].status.tick).toBe(true);
    const legacy = await domain.vault.restore(original, password);
    expect(legacy.asvs).toBeUndefined();
    workspaces.validateState(legacy);
    domain.vault.save(legacy);
    domain.state = legacy;
    expect(overview().summary.selected).toBe(0);
  });
  it('un fallo al preparar la recuperación o escribir conserva archivo y estado anterior', () => {
    const original = readFileSync(domain.vault.path);
    mkdirSync(domain.vault.path + '.pre-asvs.backup.tmp');
    expect(() => configure(1)).toThrow();
    expect(domain.require().asvs).toBeUndefined();
    expect(readFileSync(domain.vault.path)).toEqual(original);
    rmSync(domain.vault.path + '.pre-asvs.backup.tmp', { recursive: true });
    configure(1);
    const current = structuredClone(domain.require());
    const encrypted = readFileSync(domain.vault.path);
    mkdirSync(domain.vault.path + '.tmp');
    expect(() => review()).toThrow();
    expect(domain.require()).toEqual(current);
    expect(domain.vault.read()).toMatchObject({ asvs: current.asvs });
    expect(readFileSync(domain.vault.path)).toEqual(encrypted);
  });
  it('rechaza claves, duplicados, historial/evidencias de otro cuaderno y campos reservados', async () => {
    configure(1);
    review();
    const saved = structuredClone(domain.require());
    const invalid = (mutate: (state: typeof saved) => void) => {
      const candidate = structuredClone(saved);
      mutate(candidate);
      expect(() => validateAsvsState(candidate, projectId)).toThrow();
    };
    invalid((s) => {
      s.asvs!.assessments[0].reqId = 'V999.1.1';
    });
    invalid((s) => {
      s.asvs!.assessments.push(s.asvs!.assessments[0]);
    });
    invalid((s) => {
      s.asvs!.config.projectId = 'otro';
    });
    invalid((s) => {
      s.asvs!.assessments[0].evidence[0].projectId = 'otro';
    });
    invalid((s) => {
      s.asvs!.history[0].after.projectId = 'otro';
    });
    expect(() =>
      domain.save(
        'project',
        { ...domain.require().records[0], asvs: saved.asvs },
        projectId,
        domain.require().records[0].version,
      ),
    ).toThrow();
    const firstBackup = domain.vault.backup(password);
    workspaces.lock();
    const other = await workspaces.create('Segundo cuaderno sintético', password);
    const secondId = other.records.find((r) => r.kind === 'project')!.id;
    expect(other.asvs).toBeUndefined();
    domain = workspaces.domain!;
    expect(() => domain.asvsList({ projectId })).toThrow('fuera');
    expect(() =>
      domain.asvsConfigure({
        projectId,
        level: 1,
        catalogVersion: ASVS_VERSION,
        expectedConfigVersion: 0,
      }),
    ).toThrow('fuera');
    const restored = await domain.vault.restore(firstBackup, password);
    expect(() => workspaces.validateState(restored)).toThrow();
    expect(domain.require().records.find((r) => r.kind === 'project')!.id).toBe(secondId);
    projectId = secondId;
    configure(1);
    expect(() =>
      review({
        evidence: [{ recordId: saved.records[0].id, reference: 'Registro ajeno', revision: 'v1' }],
      }),
    ).toThrow('fuera');
  });
  it('conserva bases desconocidas como no disponibles y bloquea su reevaluación', () => {
    configure(1);
    review();
    domain.transaction(() => {
      const data = domain.require().asvs!;
      data.config.catalogVersion = '9.0.0';
      for (const item of data.assessments) item.catalogVersion = '9.0.0';
      for (const entry of data.history) {
        entry.after.catalogVersion = '9.0.0';
        if (entry.before) entry.before.catalogVersion = '9.0.0';
      }
    });
    expect(overview().items[0].status.reasons).toContain('Catálogo no disponible');
    expect(overview().items[0].status.tick).toBe(false);
    expect(() => configure(1)).toThrow('Catálogo no disponible');
    expect(() => review()).toThrow('catálogo no disponible');
  });
});
