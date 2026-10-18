import { createHash } from 'node:crypto';
import { z } from 'zod';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import { asvsCoverage } from '../../shared/asvsCoverage.js';
import type { AsvsReportPreview } from '../../shared/asvsReport.js';
import type { AsvsAssessmentStatus } from '../../shared/asvsTracking.js';
import { madridDate, type Snapshot, type Task } from '../../shared/model.js';
import { assessmentStatus, asvsOverview } from './tracking.js';

const ids = (max: number) =>
  z
    .array(z.string().min(1).max(240))
    .max(max)
    .refine((a) => new Set(a).size === a.length);
export const asvsReportSelection = z
  .object({
    projectId: z.string().min(1).max(240),
    requirementIds: ids(345).refine((a) => a.length > 0, 'Selecciona al menos un requisito.'),
    taskIds: ids(5000),
    evidenceIds: ids(15000),
    includeOriginal: z.boolean(),
  })
  .strict();
export const asvsReportExport = z
  .object({
    selection: asvsReportSelection,
    format: z.enum(['md', 'csv']),
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reviewed: z.literal(true),
  })
  .strict();

// Encode punctuation before Markdown parsing: data cannot create HTML, links or headings.
export function markdownData(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[!-/:-@[-`{-~]/g, (character) => `&#${character.charCodeAt(0)};`);
}
export function csvCell(value: string) {
  const clean = value.replace(/\u0000/g, '');
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(clean) || /^[\t\r\n]/.test(clean) ? `'${clean}` : clean;
  return `"${safe.replace(/"/g, '""')}"`;
}
function publicStatus(status: AsvsAssessmentStatus) {
  const { freshnessKey, ...visible } = status;
  // An unselected external reference may explain staleness, but must not leak into the report.
  return {
    ...visible,
    reasons: status.reasons.map((reason) =>
      reason.startsWith('Revisión externa modificada') ? 'Revisión externa modificada' : reason,
    ),
  };
}

export function previewAsvsReport(
  state: Snapshot,
  input: unknown,
  activeProjectId?: string,
): AsvsReportPreview {
  const selection = asvsReportSelection.parse(input);
  const overview = asvsOverview(state, { projectId: selection.projectId }, activeProjectId);
  const config = overview.config;
  if (!config || config.catalogVersion !== asvsCatalog.version)
    throw Error('Configura un catálogo ASVS disponible antes de exportar.');
  const requirements = asvsCatalog.requirements.filter((r) =>
    selection.requirementIds.includes(r.reqId),
  );
  if (requirements.length !== selection.requirementIds.length)
    throw Error('Requisito ASVS no disponible.');
  const linked = (task: Task) =>
    task.asvsLinks?.some(
      (l) =>
        l.catalogVersion === config.catalogVersion && selection.requirementIds.includes(l.reqId),
    );
  const tasks = state.records.filter(
    (r): r is Task =>
      r.kind === 'task' &&
      r.project === selection.projectId &&
      selection.taskIds.includes(r.id) &&
      !!linked(r),
  );
  if (tasks.length !== selection.taskIds.length) throw Error('Tarea fuera de la selección ASVS.');
  const verifications = (state.asvs?.taskVerifications ?? []).filter(
    (a) =>
      a.catalogVersion === config.catalogVersion &&
      selection.requirementIds.includes(a.reqId) &&
      tasks.some((t) => t.id === a.taskId),
  );
  const selectedItems = overview.items.filter(
    (i) =>
      i.assessment.catalogVersion === config.catalogVersion &&
      selection.requirementIds.includes(i.assessment.reqId),
  );
  const evidence = [...selectedItems.map((i) => i.assessment), ...verifications].flatMap(
    (a) => a.evidence,
  );
  const availableIds = new Set(evidence.map((e) => e.id));
  if (selection.evidenceIds.some((id) => !availableIds.has(id)))
    throw Error('Evidencia fuera de la selección ASVS.');
  const selectedEvidence = (a: { evidence: typeof evidence }) =>
    a.evidence
      .filter((e) => selection.evidenceIds.includes(e.id))
      .map(({ id, reference, revision, recordId }) => ({
        id,
        reference,
        revision,
        ...(recordId ? { recordId } : {}),
      }));
  const selectedCounts = asvsCoverage({ ...asvsCatalog, requirements }, overview, []).summary;
  const date = madridDate();
  const metadata = {
    date,
    projectId: selection.projectId,
    catalogVersion: config.catalogVersion,
    catalogSha256: config.catalogSha256,
    configVersion: config.version,
    contextRevision: config.contextRevision,
    targetLevel: config.level,
    scope: 'Selección de requisitos del cuaderno; evaluaciones globales y tareas separadas',
    exported: requirements.length,
    selectedCounts,
    projectCounts: overview.summary,
    source: asvsCatalog.source,
    attribution: asvsCatalog.attribution,
    license: asvsCatalog.license,
    licenseUrl: asvsCatalog.licenseUrl,
    limits:
      'Estados aceptados; parciales y desactualizados no acreditan cumplimiento global. No hay excepciones ASVS implementadas. No equivale a certificación OWASP. Evidencia exportada como referencia, sin contenido de fuentes ni adjuntos. Sin notas privadas, responsables, autorizaciones, historial ni propuestas.',
  };
  const rows = requirements.map((r) => {
    const item = selectedItems.find((i) => i.assessment.reqId === r.reqId);
    const a = item?.assessment;
    const associatedTasks = tasks
      .filter((t) =>
        t.asvsLinks?.some((l) => l.catalogVersion === config.catalogVersion && l.reqId === r.reqId),
      )
      .map((t) => {
        const verification = verifications.find((v) => v.taskId === t.id && v.reqId === r.reqId);
        return {
          id: t.id,
          title: t.title,
          version: t.version,
          state: t.state,
          links: t.asvsLinks?.filter(
            (l) => l.catalogVersion === config.catalogVersion && l.reqId === r.reqId,
          ),
          verification: verification
            ? {
                version: verification.version,
                state: verification.state,
                applicability: verification.applicability,
                scopeDetail: verification.scopeDetail,
                pendingScope: verification.pendingScope,
                method: verification.method,
                reviewedAt: verification.reviewedAt,
                status: publicStatus(assessmentStatus(state, config, verification)),
                evidence: selectedEvidence(verification),
              }
            : null,
        };
      });
    return {
      reference: r.canonicalRef,
      requirementSha256: r.contentSha256,
      minLevel: r.minLevel,
      original: selection.includeOriginal ? r.description : '',
      state: a?.state ?? 'Pendiente',
      applicability: a?.applicability ?? 'Por determinar',
      assessmentVersion: a?.version ?? 0,
      scope: a?.scope ?? 'project',
      scopeDetail: a?.scopeDetail ?? '',
      pendingScope: a?.pendingScope ?? '',
      reviewedAt: a?.reviewedAt ?? null,
      evaluatedLevel: a?.evaluatedLevel ?? null,
      method: a?.method ?? '',
      active: !!config.level && r.minLevel <= config.level,
      fulfilled: item?.status.tick ?? false,
      stale: item?.status.stale ?? false,
      partial: item?.status.partial ?? false,
      excluded: item?.status.excluded ?? false,
      reasons: item ? publicStatus(item.status).reasons : [],
      decision: a?.decision
        ? { reason: a.decision.reason, reference: a.decision.reference, at: a.decision.at }
        : null,
      evidence: a ? selectedEvidence(a) : [],
      tasks: associatedTasks,
    };
  });
  const display = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
  const md = [
    '# Informe de trazabilidad ASVS',
    '',
    ...Object.entries(metadata).map(([key, value]) => `- ${key}: ${markdownData(display(value))}`),
    '',
    `Fuente: ${asvsCatalog.source}`,
    `Licencia: ${asvsCatalog.license} · ${asvsCatalog.licenseUrl}`,
    `Atribución: ${asvsCatalog.attribution}`,
    '',
    ...rows.flatMap((row) => [
      `## ${row.reference}`,
      '',
      ...Object.entries(row)
        .filter(([key]) => key !== 'reference')
        .map(([key, value]) => `- ${key}: ${markdownData(display(value))}`),
      '',
    ]),
  ].join('\n');
  const columns = Object.keys(rows[0]) as (keyof (typeof rows)[number])[];
  const metadataColumns = Object.keys(metadata) as (keyof typeof metadata)[];
  const csv = [
    [...metadataColumns, ...columns].map(csvCell).join(','),
    ...rows.map((row) =>
      [
        ...metadataColumns.map((key) => display(metadata[key])),
        ...columns.map((key) => display(row[key])),
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');
  if (Buffer.byteLength(md) + Buffer.byteLength(csv) > 4000000)
    throw Error(
      'El informe es demasiado grande. Reduce la selección de requisitos, tareas o evidencias.',
    );
  const freshness = [
    ...selectedItems.map((i) => i.status.freshnessKey),
    ...verifications.map((v) => assessmentStatus(state, config, v).freshnessKey),
  ];
  const digest = createHash('sha256')
    .update(JSON.stringify([selection, md, csv, freshness]))
    .digest('hex');
  return { date, digest, md, csv };
}
