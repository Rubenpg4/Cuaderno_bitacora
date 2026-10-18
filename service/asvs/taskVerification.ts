import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import type { Snapshot, Task } from '../../shared/model.js';
import type { AsvsAssessment } from '../../shared/asvsTracking.js';
import { asvsReviewInput } from './requests.js';
import { assessmentStatus, reviewAsvs } from './tracking.js';

export const asvsTaskReviewInput = asvsReviewInput
  .omit({ targetId: true, scope: true, decision: true })
  .extend({
    taskId: z.string().uuid(),
    reqId: z.string().min(1),
    expectedTaskVersion: z.number().int().positive(),
  })
  .strict();

export function assertTaskAsvsClosure(state: Snapshot, task: Task, all = false) {
  const config = state.asvs?.config;
  if (!config?.level) return;
  const projected = { ...state, records: state.records.map((r) => (r.id === task.id ? task : r)) };
  for (const link of task.asvsLinks ?? []) {
    if (!all && !link.mandatory) continue;
    const requirement = asvsCatalog.requirements.find((r) => r.reqId === link.reqId);
    if (requirement && requirement.minLevel > config.level) continue;
    const item = state.asvs?.taskVerifications?.find(
      (a) =>
        a.taskId === task.id && a.reqId === link.reqId && a.catalogVersion === link.catalogVersion,
    );
    const status = item && taskVerificationStatus(projected, item);
    if (
      !item ||
      !status?.active ||
      status.stale ||
      item.state !== 'Cumplido' ||
      item.applicability !== 'Aplicable' ||
      !item.evidence.length
    )
      throw Error(`Verifica ASVS ${link.reqId} con evidencia vigente antes de cerrar la tarea.`);
  }
}

export function taskVerificationStatus(state: Snapshot, item: AsvsAssessment) {
  const status = assessmentStatus(state, state.asvs!.config, item);
  const task = state.records.find((r): r is Task => r.kind === 'task' && r.id === item.taskId);
  if (
    !task?.asvsLinks?.some(
      (l) => l.reqId === item.reqId && l.catalogVersion === item.catalogVersion,
    )
  ) {
    status.stale = true;
    status.reasons.push('Asociación retirada');
  }
  return status;
}
export function asvsTaskStatuses(state: Snapshot, input: unknown, activeProjectId?: string) {
  const { projectId, taskId } = z
    .object({ projectId: z.string(), taskId: z.string() })
    .strict()
    .parse(input);
  const task = state.records.find((r): r is Task => r.kind === 'task' && r.id === taskId);
  if (!task || task.project !== projectId || (activeProjectId && projectId !== activeProjectId))
    throw Error('Tarea fuera del cuaderno activo.');
  return (state.asvs?.taskVerifications ?? [])
    .filter((a) => a.taskId === taskId)
    .map((assessment) => ({ assessment, status: taskVerificationStatus(state, assessment) }));
}
export function reviewAsvsTask(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = asvsTaskReviewInput.parse(input);
  const data = state.asvs;
  const task = state.records.find((r): r is Task => r.kind === 'task' && r.id === request.taskId);
  const link = task?.asvsLinks?.find(
    (l) => l.reqId === request.reqId && l.catalogVersion === data?.config.catalogVersion,
  );
  if (!data || !task || task.project !== request.projectId || !link)
    throw Error('Asociación ASVS fuera de la tarea o del cuaderno.');
  if (request.state === 'No aplicable' || request.applicability === 'No aplicable')
    throw Error('La verificación de tarea no excluye requisitos del proyecto.');
  const before = data.taskVerifications?.find(
    (a) => a.taskId === task.id && a.reqId === link.reqId,
  );
  if ((before?.version ?? 0) !== request.expectedVersion)
    throw Error('La verificación de tarea ha cambiado.');
  const requirement = asvsCatalog.requirements.find((r) => r.reqId === link.reqId)!;
  const base: AsvsAssessment = before ?? {
    id: randomUUID(),
    version: 0,
    projectId: request.projectId,
    catalogVersion: link.catalogVersion,
    reqId: link.reqId,
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
    evaluatedLevel: data.config.level ?? 1,
    contextRevision: data.config.contextRevision,
    evidence: [],
    decision: null,
  };
  // Reuse the human review rules on a temporary destination, keeping project assessments untouched.
  const temporary = structuredClone(state);
  temporary.asvs!.assessments = [base];
  const { reqId, ...review } = request;
  reviewAsvs(temporary, { ...review, targetId: base.id, scope: 'task' }, activeProjectId);
  const after = temporary.asvs!.assessments[0];
  const items = (data.taskVerifications ??= []);
  if (before) items[items.indexOf(before)] = after;
  else items.push(after);
  data.history.push({
    id: randomUUID(),
    projectId: request.projectId,
    actor: 'Tú',
    at: new Date().toISOString(),
    kind: 'task-verification',
    before: before ?? null,
    after: structuredClone(after),
  });
  return { assessment: after, status: taskVerificationStatus(state, after) };
}
