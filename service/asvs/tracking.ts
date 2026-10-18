import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asvsReviewInput as reviewInput } from './requests.js';
import { validateTaskLinks } from './links.js';
import {
  ASVS_VERSION,
  ASVS_SOURCE_SHA256,
  parseAsvsReference,
  selectAsvsRequirements,
} from '../../shared/asvs.js';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import {
  ASVS_STATES,
  type AsvsAssessment,
  type AsvsAssessmentStatus,
  type AsvsConfig,
  type AsvsData,
  type AsvsOverview,
} from '../../shared/asvsTracking.js';
import type { RecordItem, Snapshot } from '../../shared/model.js';
import { asvsCoverage } from '../../shared/asvsCoverage.js';

const short = z.string().max(240);
const text = z.string().max(16000);
const nonempty = short.trim().min(1);
const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const version = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime();
export const asvsEvidenceReference = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    // References are text only; credentials must not be saved in URLs.
    if (!/^[a-z]+:\/\//i.test(value)) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, 'Referencia externa no válida o con credenciales.');
const evidenceInput = z
  .object({ recordId: nonempty.optional(), reference: asvsEvidenceReference, revision: nonempty })
  .strict();
const evidenceSchema = evidenceInput
  .extend({ id: z.string().uuid(), projectId: nonempty, fingerprint: hash.optional() })
  .strict();
const configSchema = z
  .object({
    projectId: nonempty,
    version: version.refine((v) => v > 0),
    catalogVersion: nonempty,
    catalogSha256: hash,
    level: level.nullable(),
    contextRevision: version.refine((v) => v > 0),
    contextReason: text,
    catalogBaseline: z
      .array(z.object({ reqId: nonempty, contentSha256: hash, minLevel: level }).strict())
      .max(5000)
      .optional(),
  })
  .strict();
const decisionSchema = z
  .object({
    reason: text.trim().min(1),
    reference: asvsEvidenceReference,
    responsible: nonempty,
    at: date,
  })
  .strict();
const assessmentSchema = z
  .object({
    id: z.string().uuid(),
    version: version.refine((v) => v > 0),
    projectId: nonempty,
    catalogVersion: nonempty,
    reqId: nonempty,
    requirementSha256: hash,
    state: z.enum(ASVS_STATES),
    applicability: z.enum(['Por determinar', 'Aplicable', 'No aplicable']),
    scope: z.enum(['project', 'component', 'task']),
    scopeDetail: text,
    pendingScope: text,
    taskId: nonempty.optional(),
    taskFingerprint: hash.optional(),
    note: text,
    method: short,
    responsible: short,
    reviewedAt: date.nullable(),
    actor: z.literal('Tú'),
    evaluatedLevel: level,
    contextRevision: version.refine((v) => v > 0),
    evidence: z.array(evidenceSchema).max(30),
    decision: decisionSchema.nullable(),
  })
  .strict();
const historyBase = {
  id: z.string().uuid(),
  projectId: nonempty,
  at: date,
  actor: z.literal('Tú'),
};
export const sourceRevisionSchema = z
  .object({
    projectId: nonempty,
    catalogVersion: nonempty,
    reference: asvsEvidenceReference,
    revision: nonempty,
    version: version.refine((v) => v > 0),
    reason: text.trim().min(1),
    at: date,
  })
  .strict();
export const sourceRevisionInput = projectRevisionInput();
function projectRevisionInput() {
  return z
    .object({
      projectId: nonempty,
      expectedConfigVersion: version,
      expectedVersion: version,
      reference: asvsEvidenceReference,
      revision: nonempty,
      reason: text.trim().min(1),
    })
    .strict();
}
export const revisionProposalSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['claude', 'codex', 'antigravity']),
    request: sourceRevisionInput,
    status: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: date,
  })
  .strict();
export const catalogMappingSchema = z
  .object({ from: nonempty, to: nonempty, reason: text.trim().min(1) })
  .strict();
export const asvsProposalSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['claude', 'codex', 'antigravity']),
    destination: z.literal('task').optional(),
    reference: nonempty,
    requirementSha256: hash,
    request: reviewInput.omit({ decision: true }).strict(),
    before: assessmentSchema.extend({ version }),
    sourceFingerprints: z
      .array(z.object({ recordId: nonempty, fingerprint: hash }).strict())
      .max(30),
    rationale: z.string().trim().min(1).max(2000),
    status: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: date,
  })
  .strict();
const dataSchema = z
  .object({
    dataVersion: z.literal(1),
    config: configSchema,
    assessments: z.array(assessmentSchema).max(5000),
    taskVerifications: z.array(assessmentSchema).max(5000).optional(),
    proposals: z.array(asvsProposalSchema).max(5000).optional(),
    sourceRevisions: z.array(sourceRevisionSchema).max(5000).optional(),
    revisionProposals: z.array(revisionProposalSchema).max(5000).optional(),
    history: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...historyBase,
              kind: z.literal('source-revision'),
              before: sourceRevisionSchema.nullable(),
              after: sourceRevisionSchema,
            })
            .strict(),
          z
            .object({
              ...historyBase,
              kind: z.literal('catalog'),
              before: configSchema,
              after: configSchema,
              diff: z
                .object({
                  added: z.array(nonempty),
                  removed: z.array(nonempty),
                  changed: z.array(nonempty),
                  unchanged: z.array(nonempty),
                })
                .strict(),
              mappings: z.array(catalogMappingSchema).max(50),
            })
            .strict(),
          z
            .object({
              ...historyBase,
              kind: z.literal('config'),
              before: configSchema.nullable(),
              after: configSchema,
            })
            .strict(),
          z
            .object({
              ...historyBase,
              kind: z.literal('assessment'),
              before: assessmentSchema.nullable(),
              after: assessmentSchema,
            })
            .strict(),
          z
            .object({
              ...historyBase,
              kind: z.literal('task-verification'),
              before: assessmentSchema.nullable(),
              after: assessmentSchema,
            })
            .strict(),
        ]),
      )
      .max(50000),
  })
  .strict();
const projectInput = z.object({ projectId: nonempty }).strict();
const configureInput = projectInput
  .extend({
    expectedConfigVersion: version,
    catalogVersion: z.literal(ASVS_VERSION),
    level: level.nullable(),
    contextReason: text.trim().min(1).optional(),
  })
  .strict();

/** Fingerprint v1: stable named fields, excluding scheduling and completion metadata. */
export function asvsRecordFingerprint(record: RecordItem, taskScope = false) {
  let fields: unknown;
  const attachments =
    'attachments' in record
      ? (record.attachments ?? []).map((a) => [a.id, a.name, a.mime, a.size, a.data])
      : [];
  switch (record.kind) {
    case 'task':
      fields = taskScope
        ? [
            record.description,
            record.type,
            record.tags,
            attachments,
            ...(record.asvsLinks?.length ? [record.asvsLinks] : []),
          ]
        : [record.description, record.solution, attachments];
      break;
    case 'incident':
      fields = [record.description, record.solution, attachments];
      break;
    case 'entry':
      fields = [record.activity, record.result, record.evidence];
      break;
    case 'decision':
      fields = [record.decision, record.reason, record.evidence, attachments];
      break;
    default:
      throw Error('La evidencia debe ser tarea, entrada, incidencia o decisión.');
  }
  return createHash('sha256')
    .update(JSON.stringify(['asvs-evidence-v1', record.kind, fields]))
    .digest('hex');
}

export function assertAsvsProject(state: Snapshot, projectId: string, activeProjectId?: string) {
  const projects = state.records.filter((record) => record.kind === 'project');
  if (
    projects.length !== 1 ||
    projects[0].id !== projectId ||
    (activeProjectId && projectId !== activeProjectId)
  )
    throw Error('Proyecto fuera del cuaderno activo.');
}

function knownRequirement(catalogVersion: string, reqId: string) {
  return catalogVersion === ASVS_VERSION
    ? asvsCatalog.requirements.find((r) => r.reqId === reqId)
    : undefined;
}

function assertAssessment(state: Snapshot, item: AsvsAssessment, projectId: string) {
  if (item.projectId !== projectId || !parseAsvsReference(item.reqId, item.catalogVersion))
    throw Error('Evaluación ASVS de otro cuaderno o referencia inválida.');
  const requirement = knownRequirement(item.catalogVersion, item.reqId);
  if (
    item.catalogVersion === ASVS_VERSION &&
    (!requirement || requirement.contentSha256 !== item.requirementSha256)
  )
    throw Error('Referencia o huella ASVS inválida.');
  if (item.state === 'No aplicable' || item.applicability === 'No aplicable') {
    if (
      item.state !== 'No aplicable' ||
      item.applicability !== 'No aplicable' ||
      !item.decision ||
      item.scope !== 'project'
    )
      throw Error('No aplicable exige decisión humana para el proyecto.');
  } else if (item.decision) throw Error('Decisión de aplicabilidad inconsistente.');
  if (['Cumplido', 'No cumplido'].includes(item.state) && item.applicability !== 'Aplicable')
    throw Error('Determina la aplicabilidad antes de evaluar.');
  if (
    item.state !== 'Pendiente' &&
    (!item.note.trim() || !item.method.trim() || !item.responsible.trim() || !item.reviewedAt)
  )
    throw Error('La revisión necesita nota, método y responsable.');
  if (item.state === 'Cumplido' && !item.evidence.length)
    throw Error('Cumplido exige evidencia concreta.');
  if (item.scope !== 'project' && (!item.scopeDetail.trim() || !item.pendingScope.trim()))
    throw Error('Describe la cobertura parcial y el alcance pendiente.');
  if (
    item.scope === 'project' &&
    (item.scopeDetail || item.pendingScope || item.taskId || item.taskFingerprint)
  )
    throw Error('Alcance de proyecto inconsistente.');
  if (item.scope === 'task') {
    if (!item.taskId || !item.taskFingerprint) throw Error('Falta la tarea evaluada.');
    const task = state.records.find((r) => r.id === item.taskId);
    if (task && (task.kind !== 'task' || task.project !== projectId))
      throw Error('Tarea de otro cuaderno.');
  } else if (item.taskId || item.taskFingerprint)
    throw Error('Referencia de tarea fuera de alcance.');
  if (new Set(item.evidence.map((e) => e.id)).size !== item.evidence.length)
    throw Error('Evidencia duplicada.');
  for (const evidence of item.evidence) {
    if (
      evidence.projectId !== projectId ||
      Boolean(evidence.recordId) !== Boolean(evidence.fingerprint)
    )
      throw Error('Evidencia de otro cuaderno o huella ausente.');
    const source = evidence.recordId && state.records.find((r) => r.id === evidence.recordId);
    if (
      source &&
      (source.project !== projectId ||
        !['task', 'entry', 'incident', 'decision'].includes(source.kind))
    )
      throw Error('Fuente de evidencia no autorizada.');
    // Deleted sources remain in the encrypted audit trail and become stale.
  }
}

export function validateAsvsState(state: Snapshot, projectId?: string) {
  for (const record of state.records)
    if (record.kind === 'task' && record.asvsLinks !== undefined)
      validateTaskLinks(state, record, true);
  if (state.asvs === undefined) return;
  const data = dataSchema.parse(state.asvs);
  const id = projectId ?? state.records.find((r) => r.kind === 'project')?.id;
  if (!id) throw Error('Falta proyecto ASVS.');
  assertAsvsProject(state, id);
  if (data.config.projectId !== id) throw Error('Configuración ASVS de otro cuaderno.');
  if (data.config.catalogBaseline) {
    const baseline = data.config.catalogBaseline;
    if (
      new Set(baseline.map((r) => r.reqId)).size !== baseline.length ||
      baseline.some((r) => !parseAsvsReference(r.reqId, data.config.catalogVersion))
    )
      throw Error('Base de catálogo ASVS inválida.');
    if (
      data.config.catalogVersion === ASVS_VERSION &&
      JSON.stringify(baseline) !== JSON.stringify(asvsCatalogBaseline())
    )
      throw Error('Base de catálogo ASVS distinta de la versión empaquetada.');
  }
  if (
    data.sourceRevisions?.some((r) => r.projectId !== id) ||
    new Set(data.sourceRevisions?.map((r) => r.reference)).size !==
      (data.sourceRevisions?.length ?? 0)
  )
    throw Error('Revisión de fuente duplicada.');
  const revisionIds = new Set<string>();
  for (const proposal of data.revisionProposals ?? []) {
    if (proposal.request.projectId !== id || revisionIds.has(proposal.id))
      throw Error('Propuesta de revisión de otro cuaderno o duplicada.');
    revisionIds.add(proposal.id);
  }
  if (
    data.config.catalogVersion === ASVS_VERSION &&
    data.config.catalogSha256 !== ASVS_SOURCE_SHA256
  )
    throw Error('Huella de catálogo ASVS inválida.');
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const item of data.assessments) {
    assertAssessment(state, item, id);
    const key = `${item.catalogVersion}:${item.reqId}`;
    if (keys.has(key) || ids.has(item.id)) throw Error('Evaluación ASVS duplicada.');
    keys.add(key);
    ids.add(item.id);
  }
  const verificationKeys = new Set<string>();
  for (const item of data.taskVerifications ?? []) {
    assertAssessment(state, item, id);
    const key = `${item.taskId}:${item.catalogVersion}:${item.reqId}`;
    if (item.scope !== 'task' || verificationKeys.has(key) || ids.has(item.id))
      throw Error('Verificación ASVS de tarea inválida o duplicada.');
    verificationKeys.add(key);
    ids.add(item.id);
  }
  const proposalIds = new Set<string>();
  for (const proposal of data.proposals ?? []) {
    const ref = parseAsvsReference(proposal.reference, data.config.catalogVersion);
    if (
      proposal.request.projectId !== id ||
      proposal.before.projectId !== id ||
      proposalIds.has(proposal.id) ||
      !ref ||
      ref.reqId !== proposal.before.reqId ||
      (proposal.destination === 'task'
        ? proposal.request.scope !== 'task' || proposal.request.targetId !== proposal.request.taskId
        : proposal.before.id !== proposal.request.targetId) ||
      proposal.before.version !== proposal.request.expectedVersion ||
      (proposal.before.version === 0 && proposal.destination !== 'task') ||
      (proposal.destination === 'task' &&
        (proposal.before.scope !== 'task' || proposal.before.taskId !== proposal.request.taskId)) ||
      proposal.requirementSha256 !== proposal.before.requirementSha256
    )
      throw Error('Propuesta ASVS fuera del cuaderno o referencia inválida.');
    assertAssessment(state, proposal.before, id);
    proposalIds.add(proposal.id);
  }
  const historyIds = new Set<string>();
  for (const entry of data.history) {
    if (entry.projectId !== id || historyIds.has(entry.id)) throw Error('Historial ASVS inválido.');
    historyIds.add(entry.id);
    for (const value of [entry.before, entry.after]) {
      if (!value) continue;
      if (value.projectId !== id) throw Error('Historial ASVS de otro cuaderno.');
      if (entry.kind === 'assessment' || entry.kind === 'task-verification')
        assertAssessment(state, value as AsvsAssessment, id);
    }
    if (
      entry.before &&
      (entry.after.version !== entry.before.version + 1 ||
        ('id' in entry.after &&
          'id' in entry.before &&
          (entry.after.id !== entry.before.id ||
            entry.after.reqId !== entry.before.reqId ||
            entry.after.catalogVersion !== entry.before.catalogVersion)))
    )
      throw Error('Versiones de historial ASVS inválidas.');
  }
}

export function assessmentStatus(
  state: Snapshot,
  config: AsvsConfig,
  item: AsvsAssessment,
): AsvsAssessmentStatus {
  const requirement = knownRequirement(item.catalogVersion, item.reqId);
  const reasons: string[] = [];
  const sourceBasis: unknown[] = [];
  if (
    !requirement ||
    config.catalogVersion !== item.catalogVersion ||
    config.catalogSha256 !== ASVS_SOURCE_SHA256
  )
    reasons.push('Catálogo no disponible');
  else if (item.requirementSha256 !== requirement.contentSha256)
    reasons.push('Requisito modificado');
  if (item.contextRevision !== config.contextRevision) reasons.push('Contexto modificado');
  if (config.level && item.evaluatedLevel < config.level)
    reasons.push('Nivel evaluado insuficiente');
  for (const evidence of item.evidence) {
    if (!evidence.recordId) {
      const revision = state.asvs?.sourceRevisions?.find((r) => r.reference === evidence.reference);
      sourceBasis.push([evidence.id, revision?.revision ?? evidence.revision]);
      if (revision && revision.revision !== evidence.revision)
        reasons.push(
          `Revisión externa modificada (aviso ${revision.version}): ${evidence.reference}`,
        );
      continue;
    }
    const source = state.records.find((r) => r.id === evidence.recordId);
    const fingerprint = source ? asvsRecordFingerprint(source) : null;
    sourceBasis.push([evidence.id, fingerprint]);
    if (!source) reasons.push('Fuente eliminada');
    else if (fingerprint !== evidence.fingerprint) reasons.push('Evidencia local modificada');
  }
  if (item.taskId) {
    const task = state.records.find((r) => r.id === item.taskId);
    const fingerprint = task ? asvsRecordFingerprint(task, true) : null;
    sourceBasis.push(['task', fingerprint]);
    if (!task) reasons.push('Tarea eliminada');
    else if (fingerprint !== item.taskFingerprint) reasons.push('Alcance de tarea modificado');
  }
  const active =
    !!config.level &&
    !!requirement &&
    requirement.minLevel <= config.level &&
    config.catalogVersion === item.catalogVersion;
  const partial = item.scope !== 'project';
  const stale = reasons.length > 0;
  return {
    active,
    stale,
    reasons: [...new Set(reasons)],
    freshnessKey: createHash('sha256').update(JSON.stringify(sourceBasis)).digest('hex'),
    partial,
    tick: active && !stale && !partial && item.state === 'Cumplido',
    excluded: active && !stale && item.state === 'No aplicable' && !!item.decision,
  };
}

export function asvsOverview(
  state: Snapshot,
  input: unknown,
  activeProjectId?: string,
): AsvsOverview {
  const { projectId } = projectInput.parse(input);
  assertAsvsProject(state, projectId, activeProjectId);
  const config = state.asvs?.config ?? null;
  const items =
    state.asvs?.assessments.map((assessment) => ({
      assessment,
      status: assessmentStatus(state, config!, assessment),
    })) ?? [];
  return {
    config,
    items,
    ...asvsCoverage(asvsCatalog, { config, items }, state.records),
  };
}

type HistoryInput<T> = T extends unknown ? Omit<T, 'id' | 'projectId' | 'at' | 'actor'> : never;
export function appendAsvsHistory(
  data: AsvsData,
  entry: HistoryInput<import('../../shared/asvsTracking.js').AsvsHistory>,
) {
  data.history.push({
    ...structuredClone(entry),
    id: randomUUID(),
    projectId: data.config.projectId,
    at: new Date().toISOString(),
    actor: 'Tú',
  } as import('../../shared/asvsTracking.js').AsvsHistory);
}

export function configureAsvs(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = configureInput.parse(input);
  assertAsvsProject(state, request.projectId, activeProjectId);
  const before = state.asvs?.config ?? null;
  if (request.expectedConfigVersion !== (before?.version ?? 0))
    throw Error('La configuración ASVS ha cambiado. Actualiza la vista.');
  if (before && before.catalogVersion !== ASVS_VERSION)
    throw Error('Catálogo no disponible. Usa una versión compatible.');
  const config: AsvsConfig = {
    projectId: request.projectId,
    version: (before?.version ?? 0) + 1,
    catalogVersion: ASVS_VERSION,
    catalogSha256: ASVS_SOURCE_SHA256,
    level: request.level,
    contextRevision: (before?.contextRevision ?? 1) + (request.contextReason ? 1 : 0),
    contextReason: request.contextReason ?? before?.contextReason ?? '',
    catalogBaseline: asvsCatalogBaseline(),
  };
  const data = state.asvs ?? { dataVersion: 1, config, assessments: [], history: [] };
  data.config = config;
  state.asvs = data;
  appendAsvsHistory(data, { kind: 'config', before, after: config });
  if (config.level)
    for (const requirement of selectAsvsRequirements(asvsCatalog, config.level)) {
      if (
        data.assessments.some(
          (item) => item.catalogVersion === ASVS_VERSION && item.reqId === requirement.reqId,
        )
      )
        continue;
      const assessment: AsvsAssessment = {
        id: randomUUID(),
        version: 1,
        projectId: config.projectId,
        catalogVersion: ASVS_VERSION,
        reqId: requirement.reqId,
        requirementSha256: requirement.contentSha256,
        state: 'Pendiente',
        applicability: 'Por determinar',
        scope: 'project',
        scopeDetail: '',
        pendingScope: '',
        note: '',
        method: '',
        responsible: '',
        reviewedAt: null,
        actor: 'Tú',
        evaluatedLevel: config.level,
        contextRevision: config.contextRevision,
        evidence: [],
        decision: null,
      };
      data.assessments.push(assessment);
      appendAsvsHistory(data, { kind: 'assessment', before: null, after: assessment });
    }
  return asvsOverview(state, { projectId: config.projectId }, activeProjectId);
}

export function reviewAsvs(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = reviewInput.parse(input);
  assertAsvsProject(state, request.projectId, activeProjectId);
  const data = state.asvs;
  if (!data || !data.config.level) throw Error('Activa ASVS antes de revisar.');
  if (request.expectedConfigVersion !== data.config.version)
    throw Error('La configuración ASVS ha cambiado.');
  const before = data.assessments.find((item) => item.id === request.targetId);
  if (!before || before.projectId !== request.projectId)
    throw Error('Evaluación fuera del cuaderno activo.');
  if (before.version !== request.expectedVersion)
    throw Error('La evaluación ASVS ha cambiado. Actualiza la vista.');
  const requirement = knownRequirement(before.catalogVersion, before.reqId);
  if (
    !requirement ||
    requirement.minLevel > data.config.level ||
    data.config.catalogVersion !== ASVS_VERSION
  )
    throw Error('Requisito fuera del nivel activo o catálogo no disponible.');
  // Returning from an exclusion restarts review rather than silently validating it.
  if (
    before.applicability === 'No aplicable' &&
    request.applicability !== 'No aplicable' &&
    request.state !== 'Pendiente'
  )
    throw Error('Volver a Aplicable exige reiniciar en Pendiente.');
  if (request.decision && request.state !== 'No aplicable')
    throw Error('Decisión fuera de una exclusión de aplicabilidad.');
  const evidence = request.evidence.map((source) => {
    assertAsvsEvidenceRevision(state, source);
    const record = source.recordId && state.records.find((record) => record.id === source.recordId);
    if (source.recordId && (!record || record.project !== request.projectId))
      throw Error('Fuente de evidencia fuera del cuaderno activo.');
    return {
      ...source,
      id: randomUUID(),
      projectId: request.projectId,
      ...(record ? { fingerprint: asvsRecordFingerprint(record) } : {}),
    };
  });
  let taskFingerprint: string | undefined;
  if (request.scope === 'task') {
    const task = state.records.find((r) => r.id === request.taskId);
    if (!task || task.kind !== 'task' || task.project !== request.projectId)
      throw Error('Tarea fuera del cuaderno activo.');
    if (request.expectedTaskVersion !== task.version) throw Error('La tarea ha cambiado.');
    taskFingerprint = asvsRecordFingerprint(task, true);
  } else if (request.taskId || request.expectedTaskVersion !== undefined)
    throw Error('Tarea fuera del alcance evaluado.');
  const at = new Date().toISOString();
  const after: AsvsAssessment = {
    ...before,
    version: before.version + 1,
    state: request.state,
    applicability: request.applicability,
    scope: request.scope,
    scopeDetail: request.scopeDetail.trim(),
    pendingScope: request.pendingScope.trim(),
    taskId: request.taskId,
    taskFingerprint,
    note: request.note.trim(),
    method: request.method.trim(),
    responsible: request.responsible.trim(),
    reviewedAt: at,
    evaluatedLevel: data.config.level,
    contextRevision: data.config.contextRevision,
    evidence,
    decision: request.decision
      ? {
          reason: request.decision.reason,
          reference: request.decision.reference,
          responsible: request.decision.responsible,
          at,
        }
      : null,
  };
  assertAssessment(state, after, request.projectId);
  data.assessments[data.assessments.indexOf(before)] = after;
  appendAsvsHistory(data, { kind: 'assessment', before, after });
  return asvsOverview(state, { projectId: request.projectId }, activeProjectId);
}

export function asvsHistory(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = projectInput
    .extend({ targetId: z.string().uuid(), offset: version.default(0) })
    .strict()
    .parse(input);
  assertAsvsProject(state, request.projectId, activeProjectId);
  if (!state.asvs?.assessments.some((item) => item.id === request.targetId))
    throw Error('Evaluación fuera del cuaderno activo.');
  const history = state.asvs.history
    .filter((entry) => entry.kind === 'assessment' && entry.after.id === request.targetId)
    .reverse();
  return {
    items: history.slice(request.offset, request.offset + 10),
    nextOffset: request.offset + 10 < history.length ? request.offset + 10 : null,
  };
}

export function asvsCatalogBaseline() {
  return asvsCatalog.requirements.map(({ reqId, contentSha256, minLevel }) => ({
    reqId,
    contentSha256,
    minLevel,
  }));
}

export function assertAsvsEvidenceRevision(
  state: Snapshot,
  source: { recordId?: string; reference: string; revision: string },
) {
  const current =
    !source.recordId && state.asvs?.sourceRevisions?.find((r) => r.reference === source.reference);
  if (current && current.revision !== source.revision)
    throw Error('La fuente externa tiene otra revisión registrada. Actualiza la evidencia.');
}
