import { z } from 'zod';
import type { GrantInfo, Snapshot, Task } from '../../shared/model.js';
import { grantSees } from '../../shared/subprojects.js';
import { asvsOverview } from './tracking.js';
import { authorizeAsvsProject } from './revalidation.js';

export const asvsRemediationInput = z
  .object({
    projectId: z.string().trim().min(1).max(240),
    category: z
      .enum(['revalidation', 'failed', 'consultation', 'partial', 'pending', 'unassigned'])
      .optional(),
    offset: z.number().int().nonnegative().safe().default(0),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export function planAsvsRemediation(state: Snapshot, grant: GrantInfo, input: unknown) {
  const request = asvsRemediationInput.parse(input);
  authorizeAsvsProject(state, grant, request.projectId);
  const overview = asvsOverview(state, { projectId: request.projectId });
  const openTasks = state.records.filter(
    (r): r is Task =>
      r.kind === 'task' &&
      r.project === request.projectId &&
      r.state !== 'Completada' &&
      !r.recurrence?.canceledAt &&
      grantSees(grant, r, state.records),
  );
  // Tasks of children outside the session are omitted, including their titles and counts.
  const visibleIds = new Set(
    state.records.filter((r) => grantSees(grant, r, state.records)).map((r) => r.id),
  );
  const gaps = overview.gaps.filter(
    (g) =>
      !request.category ||
      (request.category === 'unassigned'
        ? !g.tasks.some((t) => visibleIds.has(t.id) && t.state !== 'Completada')
        : g.category === request.category),
  );
  const rank = { failed: 0, revalidation: 1, consultation: 2, partial: 3, pending: 4 };
  gaps.sort((a, b) => rank[a.category] - rank[b.category]);
  return {
    config: overview.config
      ? {
          version: overview.config.version,
          catalogVersion: overview.config.catalogVersion,
          level: overview.config.level,
        }
      : null,
    summary: overview.summary,
    chapters: overview.chapters,
    total: gaps.length,
    guidance:
      'Seguimiento del alcance evaluado, sin certificación. El nivel mínimo ASVS no es severidad. Confirmar impacto, exposición, evidencia y dependencias antes de fijar prioridad. Proponer como máximo los elementos de esta página; no crear una tarea por requisito por defecto.',
    items: gaps.slice(request.offset, request.offset + request.limit).map((gap) => {
      const gapTasks = gap.tasks.filter((t) => visibleIds.has(t.id));
      const similar = openTasks.filter(
        (t) =>
          !gapTasks.some((related) => related.id === t.id) &&
          new RegExp(`(?:^|[^\\d.])${gap.reqId.replace(/\./g, '\\.')}($|[^\\d.])`, 'i').test(
            `${t.title} ${t.description}`,
          ),
      );
      const relatedOpen = gapTasks.filter((t) => t.state !== 'Completada');
      const existing = [
        ...relatedOpen,
        ...similar.map(({ id, title, state, version }) => ({ id, title, state, version })),
      ];
      // Only accepted tasks supply dependency IDs. Pending creations remain proposals.
      const pendingCreations = state.proposals.filter(
        (p) =>
          p.kind === 'task' &&
          p.operation === 'create' &&
          p.status === 'pending' &&
          p.provider === grant.provider &&
          p.projectId === request.projectId &&
          Array.isArray(p.patch.asvsLinks) &&
          p.patch.asvsLinks.some(
            (l) => l && typeof l === 'object' && (l as { reqId?: string }).reqId === gap.reqId,
          ),
      ).length;
      return {
        reference: gap.reference,
        reqId: gap.reqId,
        category: gap.category,
        nextStep: gap.nextStep,
        relatedTaskCount: gapTasks.length,
        openTaskCount: relatedOpen.length,
        existingTasks: existing.slice(0, 10),
        existingTaskCount: existing.length,
        pendingCreationCount: pendingCreations,
        action: existing.length
          ? 'reuse-task'
          : pendingCreations
            ? 'review-pending-proposal'
            : gap.category === 'revalidation'
              ? 'revalidate'
              : 'consider-task',
        priority: 'Por determinar',
        priorityReason:
          gap.category === 'failed'
            ? 'Hay un incumplimiento declarado; confirmar impacto y exposición antes de priorizar la corrección.'
            : 'La falta de evaluación o de vigencia no acredita severidad; revisar alcance y evidencia.',
        evidencePlan:
          'Indicar método, referencia y revisión fija; verificar el alcance pendiente y someter la evaluación del proyecto a revisión humana.',
        dependencyCandidates: existing.slice(0, 10).map((t) => t.id),
      };
    }),
    nextOffset:
      request.offset + request.limit < gaps.length ? request.offset + request.limit : null,
  };
}
