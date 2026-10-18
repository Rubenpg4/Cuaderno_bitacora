import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../service/workspaces';
import { blank, type Domain } from '../service/domain';
import { csvCell, markdownData } from '../service/asvs/report';
import { asvsCatalog } from '../shared/asvsCatalog';
import { asvsHelpLinks } from '../shared/asvsHelp';
import type { AsvsReportSelection } from '../shared/asvsReport';
import type { Task } from '../shared/model';

let dir: string, workspaces: Workspaces, domain: Domain, projectId: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-asvs-report-'));
  workspaces = new Workspaces(dir);
  const state = await workspaces.create('Cuaderno sintético de informe', 'contraseña sintética');
  domain = workspaces.domain!;
  projectId = state.records.find((r) => r.kind === 'project')!.id;
  domain.asvsConfigure({
    projectId,
    catalogVersion: asvsCatalog.version,
    level: 1,
    expectedConfigVersion: 0,
  });
});
afterEach(() => {
  workspaces.lock();
  rmSync(dir, { recursive: true, force: true });
});
function selection(patch: Partial<AsvsReportSelection> = {}): AsvsReportSelection {
  return {
    projectId,
    requirementIds: domain.asvsList({ projectId }).items.map((i) => i.assessment.reqId),
    taskIds: [],
    evidenceIds: [],
    includeOriginal: true,
    ...patch,
  };
}
function review(index: number, patch: Record<string, unknown> = {}) {
  const overview = domain.asvsList({ projectId });
  const a = overview.items[index].assessment;
  domain.asvsReview({
    projectId,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: overview.config!.version,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Nota privada sintética que se omite',
    method: 'Prueba',
    responsible: 'Responsable privado sintético',
    evidence: [{ reference: 'fuente sintética', revision: 'revision-1' }],
    ...patch,
  });
  return domain.asvsList({ projectId }).items[index].assessment;
}
// Small RFC 4180 reader to verify exported cells after quotes and newlines are decoded.
export function readCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
function reportRows(input = selection()) {
  const result = domain.asvsReportPreview(input);
  const [headers, ...rows] = readCsv(result.csv);
  return {
    result,
    rows: rows.map((row) => Object.fromEntries(headers.map((key, i) => [key, row[i]]))),
  };
}

describe('informe ASVS', () => {
  it('reproduce cobertura global y de selección, separa parciales, exclusiones y desactualización', () => {
    review(0);
    review(1, {
      scope: 'component',
      scopeDetail: 'API sintética',
      pendingScope: 'Cliente pendiente',
    });
    review(2, {
      state: 'No aplicable',
      applicability: 'No aplicable',
      evidence: [],
      decision: {
        approved: true,
        reason: 'No se usa el mecanismo',
        reference: 'ADR sintético',
        responsible: 'Persona',
      },
    });
    const a = review(3, { evidence: [{ reference: 'fuente a revalidar', revision: 'r1' }] });
    domain.asvsSourceRevision({
      projectId,
      expectedConfigVersion: 1,
      expectedVersion: 0,
      reference: 'fuente a revalidar',
      revision: 'r2',
      reason: 'Cambio sintético',
    });
    const { rows, result } = reportRows();
    expect(rows).toHaveLength(70);
    expect(JSON.parse(rows[0].projectCounts)).toMatchObject({
      selected: 70,
      fulfilled: 1,
      partial: 1,
      stale: 1,
      excluded: 1,
      denominator: 69,
    });
    expect(rows[1]).toMatchObject({
      partial: 'true',
      fulfilled: 'false',
      pendingScope: 'Cliente pendiente',
    });
    expect(rows[2]).toMatchObject({ excluded: 'true', state: 'No aplicable' });
    expect(JSON.parse(rows[2].decision).reference).toBe('ADR sintético');
    expect(rows[3]).toMatchObject({ stale: 'true', fulfilled: 'false' });
    expect(result.csv).not.toContain('fuente a revalidar');
    const subset = reportRows(selection({ requirementIds: [a.reqId] }));
    expect(JSON.parse(subset.rows[0].selectedCounts)).toMatchObject({ selected: 1, stale: 1 });
    expect(subset.rows[0].catalogSha256).toBe(asvsCatalog.sourceSha256);
    expect(subset.rows[0].reference).toMatch(/^v5\.0\.0-\d+\.\d+\.\d+$/);
    expect(result.digest).toBe(domain.asvsReportPreview(selection()).digest);
  });

  it('incluye solo tareas y evidencias elegidas sin fuentes, notas, propuestas ni autorizaciones', () => {
    const source = domain.save('entry', {
      ...blank('entry'),
      project: projectId,
      title: 'Fuente privada',
      activity: 'Contenido privado sintético del registro',
    });
    const a = review(0, {
      evidence: [{ recordId: source.id, reference: 'Referencia elegida', revision: 'v1' }],
    });
    const task = domain.save('task', {
      ...blank('task'),
      project: projectId,
      title: 'Tarea seleccionable',
      description: 'Descripción privada',
      solution: 'Solución privada',
      asvsLinks: [
        {
          catalogVersion: asvsCatalog.version,
          reqId: a.reqId,
          reason: 'Trabajo de seguridad',
          scope: 'Servicio',
          criterion: 'Caso probado',
          method: 'Prueba',
        },
      ],
    }) as Task;
    domain.asvsTaskReview({
      projectId,
      taskId: task.id,
      reqId: a.reqId,
      expectedTaskVersion: task.version,
      expectedConfigVersion: 1,
      expectedVersion: 0,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: 'Módulo sintético',
      pendingScope: 'Proyecto pendiente',
      note: 'Nota privada de tarea',
      responsible: 'Responsable privado de tarea',
      method: 'Prueba de tarea',
      evidence: [{ reference: 'Evidencia de tarea', revision: 'r1' }],
    });
    const v = domain.require().asvs!.taskVerifications![0];
    domain.require().proposals.push({ rationale: 'Propuesta privada de otro proveedor' } as never);
    const omitted = reportRows(selection({ requirementIds: [a.reqId], includeOriginal: false }));
    expect(omitted.rows[0].tasks).toBe('[]');
    expect(omitted.rows[0].evidence).toBe('[]');
    const chosen = selection({
      requirementIds: [a.reqId],
      taskIds: [task.id],
      evidenceIds: [a.evidence[0].id, v.evidence[0].id],
    });
    const { rows, result } = reportRows(chosen);
    expect(JSON.parse(rows[0].tasks)[0]).toMatchObject({
      id: task.id,
      verification: { state: 'Cumplido', status: { partial: true, tick: false } },
    });
    expect(JSON.parse(rows[0].tasks)[0].verification.evidence[0].reference).toBe(
      'Evidencia de tarea',
    );
    expect(JSON.parse(rows[0].evidence)[0]).toMatchObject({
      reference: 'Referencia elegida',
      recordId: source.id,
    });
    for (const privateText of [
      'Contenido privado',
      'Descripción privada',
      'Solución privada',
      'Nota privada',
      'Responsable privado',
      'Propuesta privada',
      'fingerprint',
      'freshnessKey',
      'authorization',
    ]) {
      expect(result.md + result.csv).not.toContain(privateText);
    }
    const old = result.digest;
    domain.save('entry', { ...source, activity: 'Fuente cambiada' }, source.id, source.version);
    expect(domain.asvsReportPreview(chosen).digest).not.toBe(old);
  });

  it('exporta desactivación y requisitos sin evaluar sin inventar cobertura activa', () => {
    domain.asvsConfigure({
      projectId,
      expectedConfigVersion: 1,
      catalogVersion: asvsCatalog.version,
      level: null,
    });
    const { rows } = reportRows(
      selection({ requirementIds: asvsCatalog.requirements.map((r) => r.reqId) }),
    );
    expect(rows).toHaveLength(345);
    expect(JSON.parse(rows[0].projectCounts)).toMatchObject({ selected: 0, fulfilled: 0 });
    expect(rows.every((r) => r.active === 'false' && r.fulfilled === 'false')).toBe(true);
    expect(rows.at(-1)?.assessmentVersion).toBe('0');
  });

  it('rechaza IDs ajenos, duplicados, campos reservados y catálogo no disponible', () => {
    for (const patch of [
      { projectId: 'ajeno' },
      { requirementIds: ['V99.9.9'] },
      { requirementIds: [] },
      { taskIds: ['ajena'] },
      { evidenceIds: ['ajena'] },
      { requirementIds: ['V1.2.1', 'V1.2.1'] },
      { body: 'cuerpo no autorizado' },
    ]) {
      expect(() => domain.asvsReportPreview({ ...selection(), ...patch })).toThrow();
    }
    domain.require().asvs!.config.catalogVersion = '4.0.3';
    expect(() => domain.asvsReportPreview(selection())).toThrow(/catálogo/);
  });

  it('trata Markdown como datos y neutraliza fórmulas CSV con comillas, espacios y saltos', () => {
    const active =
      '<img src=x onerror=alert(1)>\n# encabezado\n[x](javascript:alert(1)) ` ``` ![x](https://example.org)';
    const a = review(0, {
      scope: 'component',
      scopeDetail: `=HYPERLINK("https://example.org","x")\r\n${active}`,
      pendingScope: 'Pendiente',
    });
    const { rows, result } = reportRows(selection({ requirementIds: [a.reqId] }));
    expect(rows[0].scopeDetail).toBe(`'=HYPERLINK("https://example.org","x")\r\n${active}`);
    expect(result.md).not.toContain('<img');
    expect(result.md).not.toContain('[x](');
    expect(result.md).not.toContain('\n# encabezado');
    expect(result.md).toContain('&#60;img');
    expect(markdownData(active)).not.toMatch(/[<>`\[\]\n]/);
    for (const formula of ['=1+1', '+1', '-1', '@SUM(A1)', '  =1', '\t=1', '\r\n=1', '\u0000=1'])
      expect(readCsv(csvCell(formula))[0][0]).toMatch(/^'/);
    expect(readCsv(csvCell('texto, "citado"\r\nsegunda línea'))[0][0]).toBe(
      'texto, "citado"\r\nsegunda línea',
    );
  });

  it('ofrece fuentes fijadas y guía oficial para todos los capítulos sin inventar versiones', () => {
    for (const r of asvsCatalog.requirements) {
      expect(asvsHelpLinks(r)?.source).toMatch(
        /^https:\/\/github\.com\/OWASP\/ASVS\/blob\/v5\.0\.0\/5\.0\/en\/0x\d+-V\d+-/,
      );
      expect(asvsHelpLinks(r)?.guide).toBe('https://cheatsheetseries.owasp.org/IndexASVS.html');
    }
    expect(asvsHelpLinks({ ...asvsCatalog.requirements[0], catalogVersion: '4.0.3' })).toBeNull();
  });
});
