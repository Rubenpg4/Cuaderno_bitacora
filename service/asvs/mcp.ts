import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ASVS_VERSION, resolveAsvsReference } from '../../shared/asvs.js';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import type { AsvsProposal } from '../../shared/asvsTracking.js';
import type { GrantInfo, Snapshot, Task } from '../../shared/model.js';
import { sameProposalValue } from '../../shared/proposalReview.js';
import { GENERAL_SCOPE, effectiveGrantScopes, grantSees } from '../../shared/subprojects.js';
import { linkedAsvsTasks } from './links.js';
import { asvsReviewInput } from './requests.js';
import { assessmentStatus, asvsOverview, asvsRecordFingerprint, reviewAsvs } from './tracking.js';
import { asvsTaskReviewInput, reviewAsvsTask, taskVerificationStatus } from './taskVerification.js';

const project = z.string().trim().min(1).max(240);
const offset = z.number().int().nonnegative().safe().default(0);
const limit = z.number().int().min(1).max(10).default(10);
export const asvsQueryInput = z
  .object({
    projectId: project,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    chapterId: z.string().max(30).optional(),
    sectionId: z.string().max(30).optional(),
    state: z
      .enum(['Pendiente', 'Cumplido', 'No cumplido', 'No aplicable', 'Requiere consulta'])
      .optional(),
    applicability: z.enum(['Por determinar', 'Aplicable', 'No aplicable']).optional(),
    freshness: z.enum(['current', 'stale']).optional(),
    query: z.string().max(200).optional(),
    offset,
    limit,
  })
  .strict();
export const asvsReadInput = z
  .object({
    projectId: project,
    references: z.array(z.string().min(1).max(240)).min(1).max(10),
    offset,
    taskOffset: offset,
    proposalOffset: offset,
    limit,
  })
  .strict();
export const asvsProposeInput = asvsReviewInput
  .omit({ decision: true })
  .extend({
    reference: z.string().min(1).max(240),
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();
export const asvsTaskProposeInput = asvsTaskReviewInput
  .extend({
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();

export function taskAsvsContext(
  state: Snapshot,
  grant: GrantInfo,
  projectId: string,
  taskId?: string,
) {
  if (grant.scope !== 'projects' || !grant.projectIds.includes(projectId))
    return { available: false, reason: 'ASVS requiere una sesión de proyecto autorizada.' };
  if (Date.parse(grant.expiresAt) <= Date.now()) throw Error('Sesión MCP caducada.');
  const scopedTask = taskId ? state.records.find((r) => r.id === taskId) : undefined;
  if (scopedTask && !grantSees(grant, scopedTask, state.records))
    return { available: false, reason: 'La tarea no está en un ámbito autorizado.' };
  const selected = state.asvs?.config;
  const config =
    selected?.projectId === projectId
      ? {
          projectId: selected.projectId,
          version: selected.version,
          catalogVersion: selected.catalogVersion,
          level: selected.level,
          contextRevision: selected.contextRevision,
        }
      : null;
  const task = state.records.find(
    (r): r is Task => r.kind === 'task' && r.id === taskId && r.project === projectId,
  );
  return {
    available: true,
    enabled: !!config?.level,
    config,
    candidates: config?.level
      ? { tool: 'consultar_asvs', projectId, level: config.level, limit: 10 }
      : null,
    criteria: { tool: 'consultar_criterios_asvs', taskId: task?.id ?? null },
  };
}

export function taskAsvsCriteria(state: Snapshot, grant: GrantInfo, input: unknown) {
  const request = z.object({ taskId: z.string().uuid(), offset, limit }).strict().parse(input);
  const task = state.records.find((r): r is Task => r.kind === 'task' && r.id === request.taskId);
  if (!task) throw Error('Tarea no autorizada.');
  authorizeAsvs(state, grant, task.project, task);
  const links = task.asvsLinks ?? [];
  const items = links.slice(request.offset, request.offset + request.limit).map((link) => {
    const assessment = state.asvs?.taskVerifications?.find(
      (a) =>
        a.taskId === task.id && a.reqId === link.reqId && a.catalogVersion === link.catalogVersion,
    );
    return {
      link,
      assessment: assessment ?? null,
      expectedVersion: assessment?.version ?? 0,
      status: assessment ? taskVerificationStatus(state, assessment) : null,
      sourceRevisions: (state.asvs?.sourceRevisions ?? [])
        .filter((r) => assessment?.evidence.some((e) => !e.recordId && e.reference === r.reference))
        .map(({ reference, revision, version }) => ({ reference, revision, version })),
    };
  });
  return {
    taskId: task.id,
    taskVersion: task.version,
    ...taskAsvsContext(state, grant, task.project, task.id),
    items,
    nextOffset:
      request.offset + request.limit < links.length ? request.offset + request.limit : null,
  };
}

export function proposeTaskAsvs(state: Snapshot, grant: GrantInfo, input: unknown) {
  const { rationale, ...review } = asvsTaskProposeInput.parse(input);
  const task = state.records.find((r): r is Task => r.kind === 'task' && r.id === review.taskId);
  if (!task) throw Error('Tarea no autorizada.');
  authorizeAsvs(state, grant, review.projectId, task);
  const requirement = requirementFor(state, review.reqId);
  review.reqId = requirement.reqId;
  if (!review.note.trim() || !review.method.trim() || !review.responsible.trim())
    throw Error('La propuesta necesita nota, método y responsable.');
  if (['Cumplido', 'No cumplido'].includes(review.state) && !review.evidence.length)
    throw Error('El resultado exige evidencia concreta.');
  const candidate = reviewAsvsTask(structuredClone(state), review).assessment;
  const request = { ...review, targetId: review.taskId, scope: 'task' as const };
  const { reqId, ...storedRequest } = request;
  const duplicate = state.asvs!.proposals?.find(
    (p) =>
      p.destination === 'task' &&
      p.provider === grant.provider &&
      p.status === 'pending' &&
      p.reference === requirement.canonicalRef &&
      sameProposalValue(p.request, storedRequest),
  );
  if (duplicate) return { id: duplicate.id, status: duplicate.status };
  const current = state.asvs!.taskVerifications?.find(
    (a) => a.taskId === review.taskId && a.reqId === reqId,
  );
  const before = current ?? {
    ...candidate,
    version: 0,
    state: 'Pendiente' as const,
    applicability: 'Por determinar' as const,
    evidence: [],
    note: '',
    reviewedAt: null,
  };
  const proposal: AsvsProposal = {
    id: randomUUID(),
    destination: 'task',
    provider: grant.provider,
    reference: requirement.canonicalRef,
    requirementSha256: requirement.contentSha256,
    request: storedRequest,
    before: structuredClone(before),
    sourceFingerprints: candidate.evidence.flatMap((e) =>
      e.recordId ? [{ recordId: e.recordId, fingerprint: e.fingerprint! }] : [],
    ),
    rationale,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  (state.asvs!.proposals ??= []).unshift(proposal);
  return { id: proposal.id, status: proposal.status };
}

/** Project-level ASVS needs «General»; task-level ASVS needs the task's own scope. */
function authorizeAsvs(state: Snapshot, grant: GrantInfo, projectId: string, task?: Task) {
  if (Date.parse(grant.expiresAt) <= Date.now()) throw Error('Sesión MCP caducada.');
  if (grant.scope !== 'projects' || !grant.projectIds.includes(projectId))
    throw Error('ASVS requiere una sesión de proyecto autorizada.');
  if (
    task
      ? !grantSees(grant, task, state.records)
      : !effectiveGrantScopes(grant, state.records).includes(GENERAL_SCOPE)
  )
    throw Error('ASVS del proyecto requiere el ámbito «General» en esta sesión.');
  const roots = state.records.filter((r) => r.kind === 'project');
  if (roots.length !== 1 || roots[0].id !== projectId) throw Error('Cuaderno ASVS no autorizado.');
}
function requirementFor(state: Snapshot, reference: string) {
  const selected = state.asvs?.config.catalogVersion;
  if (!selected)
    throw Error('Configura la versión ASVS en el cuaderno antes de resolver referencias.');
  if (selected !== ASVS_VERSION) throw Error('Catálogo ASVS fijado no disponible.');
  const requirement = resolveAsvsReference(asvsCatalog, reference);
  if (!requirement)
    throw Error('Referencia ASVS ambigua, inexistente o de otra versión. Aclara la referencia.');
  return requirement;
}
function metadata(state: Snapshot, reqId: string, provider: GrantInfo['provider']) {
  const assessment = state.asvs?.assessments.find(
    (a) => a.reqId === reqId && a.catalogVersion === state.asvs?.config.catalogVersion,
  );
  const status = assessment ? assessmentStatus(state, state.asvs!.config, assessment) : null;
  return {
    assessmentId: assessment?.id ?? null,
    version: assessment?.version ?? 0,
    state: assessment?.state ?? 'Pendiente',
    applicability: assessment?.applicability ?? 'Por determinar',
    scope: assessment?.scope ?? 'project',
    status,
    pendingProposalCount: (state.asvs?.proposals ?? []).filter(
      (p) => p.status === 'pending' && p.provider === provider && p.before.reqId === reqId,
    ).length,
    relatedTaskCount: linkedAsvsTasks(state, reqId).length,
  };
}
export function queryAsvs(state: Snapshot, grant: GrantInfo, input: unknown) {
  const request = asvsQueryInput.parse(input);
  authorizeAsvs(state, grant, request.projectId);
  const catalogVersion = state.asvs?.config.catalogVersion ?? ASVS_VERSION;
  const coverage = asvsOverview(state, { projectId: request.projectId });
  const config = state.asvs?.config;
  if (catalogVersion !== ASVS_VERSION) throw Error('Catálogo ASVS fijado no disponible.');
  const items = asvsCatalog.requirements
    .filter((r) => {
      const m = metadata(state, r.reqId, grant.provider);
      return (
        (!request.level || r.minLevel <= request.level) &&
        (!request.chapterId || request.chapterId === r.chapterId) &&
        (!request.sectionId || request.sectionId === r.sectionId) &&
        (!request.state || request.state === m.state) &&
        (!request.applicability || request.applicability === m.applicability) &&
        (!request.freshness ||
          (request.freshness === 'stale' ? !!m.status?.stale : !!m.status && !m.status.stale)) &&
        (!request.query ||
          `${r.canonicalRef} ${r.description} ${r.chapterName} ${r.sectionName}`
            .toLocaleLowerCase()
            .includes(request.query.toLocaleLowerCase()))
      );
    })
    .map((r) => ({
      reference: r.canonicalRef,
      catalogVersion,
      reqId: r.reqId,
      minLevel: r.minLevel,
      chapterId: r.chapterId,
      sectionId: r.sectionId,
      ...metadata(state, r.reqId, grant.provider),
    }));
  return {
    config: config
      ? {
          projectId: config.projectId,
          version: config.version,
          catalogVersion: config.catalogVersion,
          catalogSha256: config.catalogSha256,
          level: config.level,
          contextRevision: config.contextRevision,
        }
      : null,
    coverage: coverage.summary,
    chapters: coverage.chapters,
    catalogVersion,
    total: items.length,
    counts: {
      fulfilled: items.filter((m) => m.status?.tick).length,
      stale: items.filter((m) => m.status?.stale).length,
      partial: items.filter((m) => m.status?.partial).length,
      pendingProposals: items.reduce((sum, m) => sum + m.pendingProposalCount, 0),
    },
    items: items.slice(request.offset, request.offset + request.limit),
    nextOffset:
      request.offset + request.limit < items.length ? request.offset + request.limit : null,
  };
}
export function readAsvs(state: Snapshot, grant: GrantInfo, input: unknown) {
  const request = asvsReadInput.parse(input);
  authorizeAsvs(state, grant, request.projectId);
  // Read one concrete requirement at a time and page related metadata separately.
  const requirements = request.references.map((ref) => requirementFor(state, ref));
  const requirement = requirements[request.offset];
  if (!requirement) return { items: [], nextOffset: null };
  const assessment = state.asvs?.assessments.find((a) => a.reqId === requirement.reqId);
  const tasks = linkedAsvsTasks(state, requirement.reqId).filter((task) =>
    grantSees(grant, task, state.records),
  );
  const proposals = (state.asvs?.proposals ?? []).filter(
    (p) =>
      p.status === 'pending' &&
      p.provider === grant.provider &&
      p.before.reqId === requirement.reqId,
  );
  return {
    items: [
      {
        ...requirement,
        resolvedAgainst: state.asvs!.config.catalogVersion,
        evaluation: assessment
          ? { assessment, status: assessmentStatus(state, state.asvs!.config, assessment) }
          : null,
        sourceRevisions: (state.asvs?.sourceRevisions ?? [])
          .filter((r) =>
            assessment?.evidence.some((e) => !e.recordId && e.reference === r.reference),
          )
          .map(({ reference, revision, version }) => ({ reference, revision, version })),
        pendingProposals: proposals
          .slice(request.proposalOffset, request.proposalOffset + request.limit)
          .map((p) => ({
            id: p.id,
            state: p.request.state,
            scope: p.request.scope,
            status: p.status,
          })),
        relatedTasks: tasks
          .slice(request.taskOffset, request.taskOffset + request.limit)
          .map((t) => ({ id: t.id, title: t.title, version: t.version, state: t.state })),
        relatedTaskCount: tasks.length,
        nextTaskOffset:
          request.taskOffset + request.limit < tasks.length
            ? request.taskOffset + request.limit
            : null,
        nextProposalOffset:
          request.proposalOffset + request.limit < proposals.length
            ? request.proposalOffset + request.limit
            : null,
      },
    ],
    nextOffset: request.offset + 1 < requirements.length ? request.offset + 1 : null,
  };
}
export function proposeAsvs(state: Snapshot, grant: GrantInfo, input: unknown) {
  const { reference, rationale, ...request } = asvsProposeInput.parse(input);
  authorizeAsvs(state, grant, request.projectId);
  const requirement = requirementFor(state, reference);
  const before = state.asvs!.assessments.find((a) => a.id === request.targetId);
  if (
    !before ||
    before.reqId !== requirement.reqId ||
    before.catalogVersion !== requirement.catalogVersion
  )
    throw Error('La evaluación no corresponde a la referencia fijada.');
  if (!request.note.trim() || !request.method.trim() || !request.responsible.trim())
    throw Error('La propuesta necesita nota o hallazgo, método y responsable.');
  if (['Cumplido', 'No cumplido'].includes(request.state) && !request.evidence.length)
    throw Error('Cumplido y No cumplido exigen evidencia concreta.');
  if (request.state === 'No aplicable') {
    if (
      request.applicability !== 'No aplicable' ||
      request.scope !== 'project' ||
      request.scopeDetail ||
      request.pendingScope ||
      request.taskId ||
      request.expectedTaskVersion !== undefined
    )
      throw Error('No aplicable solo puede solicitar una decisión humana de proyecto.');
    // Validate the candidate on a disposable snapshot; this never authorizes an exclusion.
    reviewAsvs(structuredClone(state), {
      ...request,
      decision: {
        approved: true,
        reason: request.note,
        reference: requirement.canonicalRef,
        responsible: request.responsible,
      },
    });
  } else reviewAsvs(structuredClone(state), request);
  const duplicate = state.asvs!.proposals?.find(
    (p) =>
      p.status === 'pending' &&
      p.provider === grant.provider &&
      p.reference === requirement.canonicalRef &&
      sameProposalValue(p.request, request),
  );
  if (duplicate) return { id: duplicate.id, status: duplicate.status };
  const proposal: AsvsProposal = {
    id: randomUUID(),
    provider: grant.provider,
    reference: requirement.canonicalRef,
    requirementSha256: requirement.contentSha256,
    request,
    before: structuredClone(before),
    sourceFingerprints: request.evidence.flatMap((e) =>
      e.recordId
        ? [
            {
              recordId: e.recordId,
              fingerprint: asvsRecordFingerprint(state.records.find((r) => r.id === e.recordId)!),
            },
          ]
        : [],
    ),
    rationale,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  (state.asvs!.proposals ??= []).unshift(proposal);
  return { id: proposal.id, status: proposal.status };
}
export function reviewAsvsProposals(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = z
    .object({
      ids: z.array(z.string().uuid()).min(1).max(100),
      accept: z.boolean(),
      decisions: z.record(asvsReviewInput.shape.decision.unwrap()).optional(),
    })
    .strict()
    .parse(input);
  if (new Set(request.ids).size !== request.ids.length) throw Error('Propuesta ASVS repetida.');
  const selected = request.ids.map((id) => {
    const p = state.asvs?.proposals?.find((p) => p.id === id && p.status === 'pending');
    if (!p) throw Error('Propuesta ASVS no disponible.');
    return p;
  });
  const targets = new Set<string>();
  for (const p of selected) {
    if (request.accept) {
      const key =
        p.destination === 'task'
          ? `task:${p.request.taskId}:${p.before.reqId}`
          : p.request.targetId;
      if (targets.has(key)) throw Error('Lote ASVS incompatible: misma evaluación.');
      targets.add(key);
      const requirement = requirementFor(state, p.reference);
      if (requirement.contentSha256 !== p.requirementSha256)
        throw Error('El requisito ASVS cambió.');
      for (const e of p.sourceFingerprints) {
        const source = state.records.find((r) => r.id === e.recordId);
        if (!source || asvsRecordFingerprint(source) !== e.fingerprint)
          throw Error('La evidencia de la propuesta cambió.');
      }
      const decision = request.decisions?.[p.id];
      if (p.request.state === 'No aplicable' && !decision)
        throw Error('La exclusión necesita una decisión humana explícita.');
      if (p.destination === 'task') {
        const { targetId, scope, ...review } = p.request;
        if (decision) throw Error('Las verificaciones de tarea no admiten excepciones.');
        reviewAsvsTask(state, { ...review, reqId: p.before.reqId }, activeProjectId);
      } else
        reviewAsvs(state, { ...p.request, ...(decision ? { decision } : {}) }, activeProjectId);
    }
    p.status = request.accept ? 'accepted' : 'rejected';
  }
  return selected;
}
