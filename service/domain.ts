import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { previewAsvsReport } from './asvs/report.js';
import { Vault } from './vault.js';
import { validateTaskLinks } from './asvs/links.js';
import {
  queryAsvs,
  readAsvs,
  proposeAsvs,
  reviewAsvsProposals,
  taskAsvsContext,
  taskAsvsCriteria,
  proposeTaskAsvs,
} from './asvs/mcp.js';
import {
  reviewAsvsTask,
  asvsTaskStatuses,
  assertTaskAsvsClosure,
} from './asvs/taskVerification.js';
import {
  asvsOverview,
  configureAsvs,
  reviewAsvs,
  asvsHistory,
  validateAsvsState,
} from './asvs/tracking.js';
import { blank, initialState } from './records/defaults.js';
import {
  previewAsvsCatalog,
  updateAsvsCatalog,
  signalAsvsRevision,
  proposeAsvsRevision,
  reviewAsvsRevision,
} from './asvs/revalidation.js';
import { planAsvsRemediation } from './asvs/remediation.js';
import { schemas, proposalSchema, short, text } from './records/schemas.js';
import { normalizeAttachments } from './records/attachments.js';
import { resolveEntryMentions, type EntryMentionIds } from '../shared/entryLinks.js';
import { planProposalReview, sameProposalValue } from '../shared/proposalReview.js';
import { diagnoseTaskQuality, TASK_QUALITY_CATEGORIES } from '../shared/taskQuality.js';
import { objectiveCoverage, validObjectiveLink } from '../shared/objectiveCoverage.js';
import { captureWeeklyBaseline, weeklySignals } from '../shared/weeklyReviewSignals.js';
import { addDays, occurrenceDays, type RecurrenceRule } from '../shared/recurrence.js';
import {
  GENERAL_SCOPE,
  effectiveGrantScopes,
  findSubproject,
  grantScopes,
  grantSees,
  isArchivedScope,
  practiceReaches,
  sameScope,
  scopeOf,
} from '../shared/subprojects.js';
import {
  applicable,
  snapshotCheck,
  unresolved,
  staleChecks,
  type Snapshot,
  type RecordItem,
  type QuickCapture,
  type Kind,
  type Task,
  type TaskSeries,
  type Practice,
  type Proposal,
  type Provider,
  type McpProfile,
  type Share,
  type GrantInfo,
  type Objective,
  type ObjectiveLink,
  type Subproject,
  type WeeklyReviewState,
  madridDate,
  PRIORITIES,
  validDay,
  taskCompletionDay,
  isTaskCompletedOnDay,
} from '../shared/model.js';
export { blank, initialState };
export const MIN_SESSION_DURATION_MINUTES = 15;
export const MAX_SESSION_DURATION_MINUTES = 480;
export const DEFAULT_SESSION_DURATION_MINUTES = 60;
const INHERITED_TASK_FIELDS = [
  'title',
  'phase',
  'type',
  'tags',
  'priority',
  'blocked',
  'nextStep',
  'description',
  'dependencyIds',
] as const;
const recurrenceRuleSchema = z.discriminatedUnion('frequency', [
  z
    .object({
      frequency: z.literal('weekly'),
      start: z.string().refine(validDay),
      end: z.string().refine(validDay).optional(),
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    })
    .strict(),
  z
    .object({
      frequency: z.literal('monthly'),
      start: z.string().refine(validDay),
      end: z.string().refine(validDay).optional(),
      monthDay: z.number().int().min(1).max(31),
    })
    .strict(),
]);

function includeEntryMentionIds(data: Record<string, unknown>, ids: EntryMentionIds) {
  return {
    ...data,
    taskIds: [...new Set([...(data.taskIds as string[]), ...ids.taskIds])],
    linkedIds: [
      ...new Set([...(Array.isArray(data.linkedIds) ? data.linkedIds : []), ...ids.linkedIds]),
    ],
  };
}

interface Grant extends GrantInfo {
  hash: string;
  profileVersion: number;
}
export class Domain {
  state?: Snapshot;
  activeProjectId?: string;
  grants = new Map<string, Grant>();
  lastActivity = Date.now();
  unlockAttempts = 0;
  nextUnlock = 0;
  constructor(
    readonly vault: Vault,
    private readonly validateBeforeSave?: (state: Snapshot) => void,
  ) {}
  get unlocked() {
    return this.vault.unlocked;
  }
  async unlock(pass: string) {
    if (Date.now() < this.nextUnlock)
      throw Error('Espera unos segundos antes de volver a intentar.');
    try {
      this.state = await this.vault.open(pass, initialState());
      if (this.syncTasksChecks(this.state)) {
        this.validateBeforeSave?.(this.state);
        this.vault.save(this.state);
      }
      this.unlockAttempts = 0;
      this.lastActivity = Date.now();
      return this.snapshot();
    } catch (e) {
      this.unlockAttempts++;
      this.nextUnlock = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this.unlockAttempts, 5));
      throw e;
    }
  }
  private syncTasksChecks(s: Snapshot): boolean {
    const practices = s.records.filter((r): r is Practice => r.kind === 'practice');
    let changed = false;
    for (const record of s.records) {
      if (record.kind === 'task' && record.state !== 'Completada') {
        const initialLength = record.checks.length;
        record.checks = record.checks.filter((c) => {
          const p = practices.find((p) => p.id === c.practiceId);
          return p && p.status !== 'Borrador' && p.status !== 'Retirada';
        });
        if (record.checks.length !== initialLength) changed = true;
        for (const p of practices.filter((p) => applicable(p, record))) {
          if (!record.checks.some((c) => c.practiceId === p.id)) {
            record.checks.push(snapshotCheck(p));
            changed = true;
          }
        }
      }
    }
    return changed;
  }
  lock() {
    this.grants.clear();
    this.state = undefined;
    this.vault.lock();
  }
  require() {
    if (!this.state || !this.unlocked) throw Error('Bitácora está bloqueada.');
    return this.state;
  }
  snapshot() {
    const s = this.require();
    return {
      ...s,
      grants: [...this.grants.values()]
        .filter((g) => Date.parse(g.expiresAt) > Date.now())
        .map(({ hash, profileVersion, ...g }) => g),
    };
  }
  asvsList(input: unknown) {
    return asvsOverview(this.require(), input, this.activeProjectId);
  }
  asvsReportPreview(input: unknown) {
    return previewAsvsReport(this.require(), input, this.activeProjectId);
  }
  asvsCatalogPreview(input: unknown) {
    return previewAsvsCatalog(this.require(), input, this.activeProjectId);
  }
  asvsCatalogUpdate(input: unknown) {
    return this.transaction(() => updateAsvsCatalog(this.require(), input, this.activeProjectId));
  }
  asvsSourceRevision(input: unknown) {
    return this.transaction(() => signalAsvsRevision(this.require(), input, this.activeProjectId));
  }
  asvsRevisionPropose(g: Grant, input: unknown) {
    return this.transaction(() => proposeAsvsRevision(this.require(), g, input));
  }
  asvsRevisionReview(input: unknown) {
    return this.transaction(() => reviewAsvsRevision(this.require(), input, this.activeProjectId));
  }
  asvsRemediation(g: Grant, input: unknown) {
    return planAsvsRemediation(this.require(), g, input);
  }
  weeklySignals() {
    const state = this.require();
    const projectId = this.activeProjectId ?? state.records.find((r) => r.kind === 'project')?.id;
    if (!projectId) throw Error('Cuaderno no disponible.');
    const gaps = asvsOverview(state, { projectId }, this.activeProjectId).gaps;
    return weeklySignals(state.records, projectId, state.weeklyReview, madridDate(), gaps);
  }
  asvsConfigure(input: unknown) {
    return this.transaction(() => configureAsvs(this.require(), input, this.activeProjectId));
  }
  asvsReview(input: unknown) {
    return this.transaction(() => reviewAsvs(this.require(), input, this.activeProjectId));
  }
  asvsHistory(input: unknown) {
    return asvsHistory(this.require(), input, this.activeProjectId);
  }
  asvsQuery(g: Grant, input: unknown) {
    return queryAsvs(this.require(), g, input);
  }
  asvsRead(g: Grant, input: unknown) {
    return readAsvs(this.require(), g, input);
  }
  asvsPropose(g: Grant, input: unknown) {
    return this.transaction(() => proposeAsvs(this.require(), g, input));
  }
  asvsTaskCriteria(g: Grant, input: unknown) {
    return taskAsvsCriteria(this.require(), g, input);
  }
  asvsTaskPropose(g: Grant, input: unknown) {
    return this.transaction(() => proposeTaskAsvs(this.require(), g, input));
  }
  asvsReviewProposals(input: unknown) {
    return this.transaction(() => reviewAsvsProposals(this.require(), input, this.activeProjectId));
  }
  asvsTaskReview(input: unknown) {
    return this.transaction(() => reviewAsvsTask(this.require(), input, this.activeProjectId));
  }
  asvsTaskStatuses(input: unknown) {
    return asvsTaskStatuses(this.require(), input, this.activeProjectId);
  }
  finishWeeklyReview(expectedVersion: unknown): WeeklyReviewState {
    return this.transaction(() => {
      const state = this.require();
      const current = state.weeklyReview ?? { version: 0, decisions: [] };
      if (expectedVersion !== current.version)
        throw Error('La revisión ha cambiado. Actualiza la vista antes de terminarla.');
      const projectId = this.activeProjectId ?? state.records.find((r) => r.kind === 'project')?.id;
      if (!projectId) throw Error('Cuaderno no disponible.');
      const at = new Date().toISOString();
      state.weeklyReview = {
        version: current.version + 1,
        baseline: captureWeeklyBaseline(state.records, projectId, at, madridDate()),
        decisions: current.decisions.filter(
          (decision) =>
            decision.key.startsWith('asvs:') &&
            this.weeklySignals().some(
              (signal) => signal.key === decision.key && signal.cause === decision.cause,
            ),
        ),
      };
      return state.weeklyReview;
    });
  }
  decideWeeklySignal(input: unknown): WeeklyReviewState {
    return this.transaction(() => {
      const data = z
        .object({
          expectedVersion: z.number().int().min(0),
          key: z.string().min(1).max(600),
          cause: z.string().max(100000),
          mode: z.enum(['dismissed', 'postponed']),
          until: z.string().optional(),
        })
        .strict()
        .parse(input);
      const state = this.require();
      const current = state.weeklyReview ?? { version: 0, decisions: [] };
      if (data.expectedVersion !== current.version)
        throw Error('La revisión ha cambiado. Actualiza la vista antes de continuar.');
      if (
        data.mode === 'postponed'
          ? !data.until || !validDay(data.until) || data.until <= madridDate()
          : !!data.until
      )
        throw Error('Indica una fecha futura válida para posponer la señal.');
      const projectId = this.activeProjectId ?? state.records.find((r) => r.kind === 'project')?.id;
      if (!projectId) throw Error('Cuaderno no disponible.');
      const signal = this.weeklySignals().find(
        (item) => item.key === data.key && item.cause === data.cause,
      );
      if (!signal) throw Error('La señal ya no está vigente. Actualiza la vista.');
      state.weeklyReview = {
        ...current,
        version: current.version + 1,
        decisions: [
          ...current.decisions.filter((item) => item.key !== data.key),
          { key: data.key, cause: data.cause, mode: data.mode, until: data.until },
        ],
      };
      return state.weeklyReview;
    });
  }
  saveFollowUpTask(
    data: Record<string, unknown>,
    meetingId: string,
    agreementId: string,
    expectedMeetingVersion: number,
    draftKey?: string,
  ): Task {
    if (data.recurrence !== undefined) throw Error('La serie se gestiona desde su editor.');
    if (draftKey) this.validateDraftKey(draftKey);
    return this.transaction(() => {
      const meeting = this.require().records.find((record) => record.id === meetingId);
      if (!meeting || meeting.kind !== 'meeting' || meeting.version !== expectedMeetingVersion)
        throw Error('La reunión ha cambiado. Vuelve a abrirla.');
      const agreement = meeting.agreementItems?.find((item) => item.id === agreementId);
      const linked = agreement?.followUpTaskId
        ? this.require().records.find((record) => record.id === agreement.followUpTaskId)
        : undefined;
      if (
        !agreement?.requiresFollowUp ||
        (linked?.kind === 'task' && !linked.recurrence?.canceledAt)
      )
        throw Error('El acuerdo ya no necesita una tarea de seguimiento.');
      const task = this.write('task', {
        ...data,
        project: meeting.project,
        subprojectId: meeting.subprojectId,
      }) as Task;
      this.write(
        'meeting',
        {
          ...meeting,
          agreementItems: meeting.agreementItems?.map((item) =>
            item.id === agreementId ? { ...item, followUpTaskId: task.id } : item,
          ),
        },
        meeting.id,
        meeting.version,
        'Seguimiento de acuerdo',
      );
      if (draftKey) delete (this.require().drafts ??= {})[draftKey];
      return task;
    });
  }
  saveTaskSeries(
    data: Record<string, unknown>,
    ruleInput: unknown,
    id?: string,
    version?: number,
    draftKey?: string,
  ) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw Error('Datos de serie inválidos.');
    if (draftKey) this.validateDraftKey(draftKey);
    const rule = recurrenceRuleSchema.parse(ruleInput) as RecurrenceRule;
    occurrenceDays(rule, rule.start, rule.start);
    const state = this.require();
    const before = id ? state.taskSeries?.find((series) => series.id === id) : undefined;
    if (id && !before) throw Error('Serie no encontrada.');
    if (before?.archivedAt) throw Error('La serie está detenida.');
    if (before && before.version !== version)
      throw Error('La serie ha cambiado. Vuelve a abrirla.');
    const {
      id: _id,
      version: _version,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...content
    } = data;
    const parsed = schemas.task.parse({
      ...blank('task'),
      ...content,
      kind: 'task',
      recurrence: undefined,
    });
    if (before && parsed.project && parsed.project !== before.project)
      throw Error('No se puede cambiar el proyecto de una serie.');
    if (before && 'subprojectId' in content && scopeOf(parsed) !== scopeOf(before))
      throw Error('No se puede trasladar una serie a otro ámbito del proyecto.');
    const subprojectId = before ? before.subprojectId : parsed.subprojectId || undefined;
    if (subprojectId) {
      const child = findSubproject(state.records, subprojectId);
      if (!child) throw Error('El subproyecto no existe en este cuaderno.');
      this.assertWritable({ subprojectId });
    }
    if (this.activeProjectId && parsed.project && parsed.project !== this.activeProjectId)
      throw Error('Proyecto fuera del cuaderno activo.');
    if (parsed.attachments?.length)
      throw Error('Añade adjuntos a cada aparición por separado; no se copian a la serie.');
    const project = before?.project || this.activeProjectId || parsed.project;
    if (
      !project ||
      !state.records.some((record) => record.kind === 'project' && record.id === project)
    )
      throw Error('El proyecto no existe.');
    if (this.activeProjectId && project !== this.activeProjectId)
      throw Error('Proyecto fuera del cuaderno activo.');
    const template = Object.fromEntries(
      INHERITED_TASK_FIELDS.map((field) => [field, structuredClone(parsed[field])]),
    ) as TaskSeries['template'];
    const practiceIds = Array.isArray(content.checks)
      ? parsed.checks.map((check) => check.practiceId)
      : (before?.practiceIds ?? []);
    if (
      new Set(practiceIds).size !== practiceIds.length ||
      practiceIds.some(
        (practiceId) =>
          !state.records.some(
            (record) =>
              record.kind === 'practice' &&
              record.id === practiceId &&
              (!record.project || record.project === project) &&
              practiceReaches(record, { subprojectId }) &&
              record.status !== 'Borrador' &&
              record.status !== 'Retirada',
          ),
      )
    )
      throw Error('La serie incluye un criterio no disponible.');
    if (
      template.dependencyIds.some(
        (dependencyId) =>
          !state.records.some(
            (record) =>
              record.kind === 'task' &&
              record.id === dependencyId &&
              record.project === project &&
              sameScope(record, { subprojectId }),
          ),
      )
    )
      throw Error('Una tarea de la que depende ya no existe.');
    const today = madridDate();
    return this.transaction(() => {
      const now = new Date().toISOString();
      const series: TaskSeries = {
        id: before?.id || randomUUID(),
        version: (before?.version || 0) + 1,
        createdAt: before?.createdAt || now,
        updatedAt: now,
        project,
        ...(subprojectId ? { subprojectId } : {}),
        title: template.title,
        rule,
        template,
        practiceIds,
        generatedThrough: before ? today : undefined,
        stoppedAt: before?.stoppedAt,
        archivedAt: before?.archivedAt,
      };
      const all = (state.taskSeries ??= []);
      if (before) all[all.indexOf(before)] = series;
      else all.push(series);
      (state.taskSeriesHistory ??= []).unshift({
        id: randomUUID(),
        seriesId: series.id,
        at: now,
        before: before ? structuredClone(before) : null,
        after: structuredClone(series),
      });
      if (draftKey) delete (state.drafts ??= {})[draftKey];
      if (before) {
        const horizon = addDays(today, 90);
        const scheduled = new Set(occurrenceDays(rule, addDays(today, 1), horizon));
        for (const task of state.records.filter(
          (record): record is Task =>
            record.kind === 'task' &&
            record.recurrence?.seriesId === series.id &&
            record.recurrence.occurrenceDate > today &&
            record.state !== 'Completada' &&
            record.state !== 'En revisión',
        )) {
          const recurrence = task.recurrence!;
          if (!scheduled.has(recurrence.occurrenceDate)) {
            if (!recurrence.canceledAt)
              this.write(
                'task',
                {
                  ...task,
                  recurrence: { ...recurrence, canceledAt: now, cancellationReason: 'rule' },
                },
                task.id,
                task.version,
                'Serie',
              );
            continue;
          }
          if (recurrence.cancellationReason === 'manual') continue;
          const updates: Record<string, unknown> = {
            ...task,
            recurrence: {
              ...recurrence,
              canceledAt: undefined,
              cancellationReason: undefined,
            },
          };
          for (const field of INHERITED_TASK_FIELDS)
            if (!recurrence.overriddenFields.includes(field))
              updates[field] = structuredClone(template[field]);
          const checks = task.checks.slice();
          for (const practiceId of practiceIds) {
            if (checks.some((check) => check.practiceId === practiceId)) continue;
            const practice = state.records.find(
              (record): record is Practice =>
                record.kind === 'practice' && record.id === practiceId,
            );
            if (practice) checks.push(snapshotCheck(practice));
          }
          updates.checks = checks;
          if (JSON.stringify(updates) !== JSON.stringify(task))
            this.write('task', updates, task.id, task.version, 'Serie');
        }
      }
      return series;
    });
  }
  stopTaskSeries(id: string, version: number) {
    const state = this.require();
    const before = state.taskSeries?.find((series) => series.id === id);
    if (!before || before.version !== version)
      throw Error('La serie ha cambiado. Vuelve a abrirla.');
    if (before.archivedAt) throw Error('La serie ya está detenida.');
    if (this.activeProjectId && before.project !== this.activeProjectId)
      throw Error('Serie fuera del cuaderno activo.');
    this.assertWritable(before);
    const today = madridDate();
    return this.transaction(() => {
      const now = new Date().toISOString();
      const after = {
        ...before,
        version: before.version + 1,
        updatedAt: now,
        stoppedAt: today,
        archivedAt: now,
      };
      state.taskSeries![state.taskSeries!.indexOf(before)] = after;
      (state.taskSeriesHistory ??= []).unshift({
        id: randomUUID(),
        seriesId: id,
        at: now,
        before: structuredClone(before),
        after: structuredClone(after),
      });
      for (const task of state.records.filter(
        (record): record is Task =>
          record.kind === 'task' &&
          record.recurrence?.seriesId === id &&
          record.recurrence.occurrenceDate > today &&
          record.state !== 'Completada' &&
          record.state !== 'En revisión' &&
          !record.recurrence.canceledAt,
      ))
        this.write(
          'task',
          {
            ...task,
            recurrence: { ...task.recurrence, canceledAt: now, cancellationReason: 'rule' },
          },
          task.id,
          task.version,
          'Serie',
        );
      return after;
    });
  }
  reconcileTaskSeries(today = madridDate()) {
    const state = this.require();
    const horizon = addDays(today, 90);
    for (const series of state.taskSeries ?? []) {
      if (
        series.archivedAt ||
        series.stoppedAt ||
        isArchivedScope(state.records, series) ||
        (series.generatedThrough && series.generatedThrough >= horizon)
      )
        continue;
      const from = series.generatedThrough
        ? addDays(series.generatedThrough, 1)
        : series.rule.start;
      const days = occurrenceDays(series.rule, from, horizon);
      if (days.length > 10000) throw Error('Demasiadas apariciones pendientes de generar.');
      for (let index = 0; index < days.length; index += 100) {
        const batch = days.slice(index, index + 100);
        this.transaction(() => {
          for (const day of batch) {
            if (
              state.records.some(
                (record) =>
                  record.kind === 'task' &&
                  record.recurrence?.seriesId === series.id &&
                  record.recurrence.occurrenceDate === day,
              )
            )
              continue;
            const item = this.write('task', {
              ...blank('task'),
              ...structuredClone(series.template),
              project: series.project,
              subprojectId: series.subprojectId,
              due: day,
              state: 'Por hacer',
              checks: series.practiceIds.map((practiceId) => {
                const practice = state.records.find(
                  (record): record is Practice =>
                    record.kind === 'practice' && record.id === practiceId,
                );
                if (!practice || practice.status === 'Borrador' || practice.status === 'Retirada')
                  throw Error('La serie incluye un criterio no disponible.');
                return snapshotCheck(practice);
              }),
              solution: '',
            }) as Task;
            item.recurrence = { seriesId: series.id, occurrenceDate: day, overriddenFields: [] };
            state.history[0].after = structuredClone(item);
          }
          series.generatedThrough = batch[batch.length - 1];
        });
      }
      if (series.generatedThrough !== horizon)
        this.transaction(() => {
          series.generatedThrough = horizon;
        });
    }
  }
  transaction<T>(fn: () => T): T {
    const state = this.require();
    const old = structuredClone(state);
    try {
      const r = fn();
      if (state.weeklyReview) {
        const ids = new Set(state.records.map((record) => record.id));
        const baseline = state.weeklyReview.baseline;
        if (baseline) {
          baseline.recordIds = baseline.recordIds.filter((id) => ids.has(id));
          baseline.tasks = baseline.tasks
            .filter((task) => ids.has(task.id))
            .map((task) => ({
              ...task,
              resultEntryIds: task.resultEntryIds.filter((id) => ids.has(id)),
            }));
        }
        const projectId =
          this.activeProjectId ?? state.records.find((record) => record.kind === 'project')?.id;
        const live = projectId
          ? new Set(this.weeklySignals().map((signal) => `${signal.key}\u0000${signal.cause}`))
          : new Set<string>();
        state.weeklyReview.decisions = state.weeklyReview.decisions.filter((decision) =>
          live.has(`${decision.key}\u0000${decision.cause}`),
        );
      }
      validateAsvsState(state, this.activeProjectId);
      this.validateBeforeSave?.(state);
      this.vault.save(state);
      return r;
    } catch (e) {
      this.state = old;
      throw e;
    }
  }
  private normalize(
    kind: Kind,
    data: Record<string, unknown>,
    before?: RecordItem,
    restoring = false,
  ): RecordItem {
    const { id, version, createdAt, updatedAt, ...content } = data;
    const parsed = schemas[kind].parse({ ...blank(kind), ...content, kind });
    const now = new Date().toISOString();
    const item = {
      ...parsed,
      id: before?.id || randomUUID(),
      version: (before?.version || 0) + 1,
      createdAt: before?.createdAt || now,
      updatedAt: now,
    } as RecordItem;
    if ('attachments' in item && item.attachments !== undefined)
      item.attachments = normalizeAttachments(item.attachments);
    const s = this.require();
    if (this.activeProjectId) {
      if (item.kind === 'project') {
        if (item.id !== this.activeProjectId) throw Error('Proyecto fuera del cuaderno activo.');
      } else if (item.project && item.project !== this.activeProjectId) {
        throw Error('Proyecto fuera del cuaderno activo.');
      } else item.project = this.activeProjectId;
    }
    if (item.project && !s.records.some((r) => r.kind === 'project' && r.id === item.project))
      throw Error('El proyecto no existe.');
    this.assignScope(item, content, before);
    if (
      item.kind === 'practice' &&
      item.status === 'Política de empresa confirmada' &&
      !item.source.trim()
    )
      throw Error('Una política confirmada necesita una fuente o referencia de validación.');
    if (
      item.kind === 'project' &&
      item.validationDate &&
      (!item.tutor.trim() || !item.validationReference.trim())
    )
      throw Error('Indica tutor y referencia de validación.');
    if (
      item.kind === 'entry' &&
      item.taskIds.some((id) => !s.records.some((r) => r.kind === 'task' && r.id === id))
    )
      throw Error('Una tarea vinculada ya no existe.');
    if (
      item.kind === 'entry' &&
      [...item.taskIds, ...(item.linkedIds ?? [])].some((id) => {
        const linked = s.records.find((r) => r.id === id);
        return linked && !sameScope(linked, item);
      })
    )
      throw Error('Un registro vinculado pertenece a otro ámbito del proyecto.');
    if (item.kind === 'entry') {
      const completedDayTaskIds = s.records
        .filter(
          (r): r is Task =>
            r.kind === 'task' &&
            isTaskCompletedOnDay(r, item.date) &&
            (!item.project || r.project === item.project) &&
            sameScope(r, item),
        )
        .map((t) => t.id);
      if (completedDayTaskIds.length) {
        item.taskIds = Array.from(new Set([...item.taskIds, ...completedDayTaskIds]));
      }
    }
    if (item.kind === 'entry' && item.linkedIds) {
      if (new Set(item.linkedIds).size !== item.linkedIds.length)
        throw Error('No repitas registros vinculados.');
      if (
        item.linkedIds.some(
          (id) =>
            !s.records.some(
              (record) =>
                record.id === id && ['incident', 'decision', 'idea'].includes(record.kind),
            ),
        )
      )
        throw Error('Un registro vinculado ya no existe.');
    }
    if (item.kind === 'objective') {
      const previous = before?.kind === 'objective' ? before : undefined;
      const keys = new Set<string>();
      item.links = item.links.map((link) => {
        const key = `${link.sourceKind}:${link.sourceId}:${link.role}`;
        if (keys.has(key)) throw Error('No repitas vínculos con el objetivo.');
        keys.add(key);
        if (link.sourceKind === 'task' && link.role !== 'trabajo')
          throw Error('Una tarea solo puede aportar trabajo.');
        if (link.role === 'evidencia' ? !link.reference.trim() : !!link.reference.trim())
          throw Error(
            'La referencia solo se indica en vínculos de evidencia y no puede estar vacía.',
          );
        const existing = previous?.links.find(
          (candidate) =>
            candidate.sourceKind === link.sourceKind &&
            candidate.sourceId === link.sourceId &&
            candidate.role === link.role,
        );
        const source = s.records.find((record) => record.id === link.sourceId);
        if (!source || source.kind !== link.sourceKind || source.project !== item.project)
          throw Error('El vínculo debe apuntar a un registro válido del mismo cuaderno.');
        if (!sameScope(source, item))
          throw Error('El vínculo debe apuntar a un registro del mismo ámbito del proyecto.');
        if (source.kind === 'task' && source.recurrence?.canceledAt && !existing)
          throw Error('Una aparición cancelada no puede aportar trabajo.');
        if (link.role === 'resultado' && !validObjectiveLink(item, link, s.records) && !existing)
          throw Error('La entrada necesita un resultado antes de vincularlo.');
        return { ...link, id: existing?.id || randomUUID() };
      });
      const linksChanged = JSON.stringify(previous?.links) !== JSON.stringify(item.links);
      if (previous?.validation.state === 'Validado' && linksChanged) {
        item.validation = this.pendingObjectiveValidation();
      } else if (item.validation.state === 'Validado') {
        const coverage = objectiveCoverage(item, s.records);
        if (coverage.gaps.some((gap) => gap !== 'pendiente de validación'))
          throw Error('El objetivo necesita trabajo, resultado y evidencia para validarse.');
        if (
          !item.validation.date ||
          !item.validation.reference.trim() ||
          !item.validation.responsible.trim()
        )
          throw Error('Indica fecha, responsable y referencia de la validación.');
        item.validation.linkIds = item.links.map((link) => link.id);
      } else {
        item.validation = this.pendingObjectiveValidation();
      }
    }
    if (item.kind === 'meeting') {
      if (item.from >= item.to) throw Error('El final del periodo debe ser posterior al inicio.');
      const previous = before?.kind === 'meeting' ? before : undefined;
      if (data.agreementItems === undefined && previous)
        item.agreementItems = previous.agreementItems;
      const ids = new Set<string>();
      item.agreementItems = (item.agreementItems ?? []).map((agreement) => {
        if (!agreement.text.trim()) throw Error('Escribe el texto del acuerdo.');
        const existing = previous?.agreementItems?.find(
          (candidate) => candidate.id === agreement.id,
        );
        if (agreement.id && !existing) throw Error('Identificador de acuerdo desconocido.');
        const agreementId = existing?.id ?? randomUUID();
        if (ids.has(agreementId)) throw Error('No repitas acuerdos.');
        ids.add(agreementId);
        const followUp = agreement.followUpTaskId
          ? s.records.find((record) => record.id === agreement.followUpTaskId)
          : undefined;
        if (
          (agreement.followUpTaskId &&
            (!followUp ||
              followUp.kind !== 'task' ||
              followUp.project !== item.project ||
              !sameScope(followUp, item))) ||
          (agreement.followUpTaskId && !agreement.requiresFollowUp) ||
          (followUp?.kind === 'task' &&
            !!followUp.recurrence?.canceledAt &&
            existing?.followUpTaskId !== followUp.id)
        )
          throw Error('El seguimiento debe apuntar a una tarea del mismo cuaderno.');
        return { ...agreement, id: agreementId, text: agreement.text.trim() };
      });
      if (
        item.sourceIds.some((id) => {
          const source = s.records.find((record) => record.id === id);
          return source && source.kind !== 'project' && !sameScope(source, item);
        })
      )
        throw Error('Las fuentes de la reunión deben pertenecer a su mismo ámbito.');
    }
    if (item.kind === 'incident') {
      if (!!item.solution.trim() !== !!item.resolvedDate)
        throw Error('La solución y su fecha de resolución deben registrarse juntas.');
      if (item.resolvedDate && item.resolvedDate < item.date)
        throw Error('La resolución no puede ser anterior a la incidencia.');
    }
    if (item.kind === 'task') {
      if (item.asvsLinks !== undefined) item.asvsLinks = validateTaskLinks(s, item);
      if (new Set(item.dependencyIds).size !== item.dependencyIds.length)
        throw Error('No repitas tareas de las que depende.');
      const dependencies = item.dependencyIds.map((id) => {
        const dependency = s.records.find((r): r is Task => r.kind === 'task' && r.id === id);
        if (!dependency) throw Error('Una tarea de la que depende ya no existe.');
        if (this.activeProjectId && dependency.project !== this.activeProjectId)
          throw Error('Una tarea de la que depende pertenece a otro proyecto.');
        if (!sameScope(dependency, item))
          throw Error('Una tarea de la que depende pertenece a otro ámbito del proyecto.');
        return dependency;
      });
      const reachesItem = (task: Task, seen = new Set<string>()): boolean => {
        if (task.id === item.id) return true;
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return task.dependencyIds.some((id) => {
          const next = s.records.find((r): r is Task => r.kind === 'task' && r.id === id);
          return next ? reachesItem(next, seen) : false;
        });
      };
      if (dependencies.some((dependency) => reachesItem(dependency)))
        throw Error('Las dependencias de tareas no pueden formar un ciclo.');
      if (
        item.state !== 'Por hacer' &&
        (restoring ||
          !before ||
          before.kind !== 'task' ||
          before.state === 'Por hacer' ||
          item.dependencyIds.some((id) => !before.dependencyIds.includes(id))) &&
        dependencies.some((dependency) => dependency.state !== 'Completada')
      )
        throw Error('Completa primero las tareas de las que depende.');
      const practices = s.records.filter((r): r is Practice => r.kind === 'practice');
      // Snapshot authoritative policy fields; clients can only edit verification fields.
      item.checks = item.checks.map((c) => {
        const old =
          before?.kind === 'task'
            ? before.checks.find((x) => x.practiceId === c.practiceId)
            : undefined;
        const p = practices.find((p) => p.id === c.practiceId);
        if (!p && !old) throw Error('Criterio desconocido.');
        if (!restoring && p?.project && p.project !== item.project)
          throw Error('El criterio pertenece a otro proyecto.');
        if (!restoring && !old && p && !practiceReaches(p, item))
          throw Error('El criterio pertenece a otro ámbito del proyecto.');
        // Only a snapshot already stored in the encrypted history may restore policy fields.
        const authoritative = restoring ? c : (old ?? snapshotCheck(p!));
        return {
          ...authoritative,
          state: c.state,
          note: c.note,
          authorization: c.authorization,
          exceptionReason: c.exceptionReason,
        };
      });
      if (new Set(item.checks.map((c) => c.practiceId)).size !== item.checks.length)
        throw Error('Criterio duplicado.');
      if (!restoring && item.state !== 'Completada') {
        item.checks = item.checks.filter((c) => {
          const p = practices.find((p) => p.id === c.practiceId);
          return p && p.status !== 'Borrador' && p.status !== 'Retirada';
        });
      }
      if (!restoring && before?.kind === 'task')
        for (const old of before.checks) {
          const p = practices.find((p) => p.id === old.practiceId);
          if (p && p.status !== 'Borrador' && p.status !== 'Retirada') {
            if (!item.checks.some((c) => c.practiceId === old.practiceId)) item.checks.push(old);
          }
        }
      // Completed historical versions retain the criteria reviewed at that time.
      if (!(restoring && item.state === 'Completada')) {
        if (before?.kind === 'task' && before.state === 'Completada' && item.state === 'Completada')
          item.checks = structuredClone(before.checks);
        else
          for (const p of practices.filter((p) => applicable(p, item)))
            if (!item.checks.some((c) => c.practiceId === p.id)) item.checks.push(snapshotCheck(p));
      }
      for (const c of item.checks) {
        if (!!c.authorization.trim() !== !!c.exceptionReason.trim())
          throw Error('Una excepción requiere motivo y referencia de autorización.');
      }
      if (item.state === 'Completada') {
        if (
          !(restoring && item.state === 'Completada') &&
          !(before?.kind === 'task' && before.state === 'Completada')
        )
          assertTaskAsvsClosure(s, item);
        if (
          staleChecks({ ...item, state: 'En revisión' }, practices) &&
          !restoring &&
          before?.kind === 'task' &&
          before.state !== 'Completada'
        )
          throw Error('Revisa primero las versiones actualizadas de los criterios.');
        if (item.checks.some((c) => c.mandatory && unresolved(c)))
          throw Error(
            'Hay requisitos obligatorios pendientes. Complétalos o registra una excepción autorizada.',
          );
        if (
          !restoring &&
          !(before?.kind === 'task' && before.state === 'Completada') &&
          item.checks.some((c) => c.mandatory && c.state === 'Cumplido' && !c.note.trim())
        )
          throw Error('Los criterios obligatorios cumplidos necesitan evidencia.');
        if (item.blocked.trim()) throw Error('Resuelve el bloqueo antes de completar la tarea.');
        const providedCompletedAt =
          typeof data.completedAt === 'string' && data.completedAt.trim()
            ? validDay(data.completedAt.trim())
              ? `${data.completedAt.trim()}T12:00:00.000Z`
              : !Number.isNaN(Date.parse(data.completedAt.trim()))
                ? new Date(data.completedAt.trim()).toISOString()
                : undefined
            : undefined;
        item.completedAt =
          providedCompletedAt ??
          (before?.kind === 'task' && before.completedAt ? before.completedAt : now);
      } else delete item.completedAt;
    }
    return item;
  }
  /** Validates the owning subproject; a record keeps its scope for its whole life. */
  private assignScope(item: RecordItem, content: Record<string, unknown>, before?: RecordItem) {
    const s = this.require();
    if (item.kind === 'project') return;
    if (item.kind === 'subproject') {
      if (before && before.project !== item.project)
        throw Error('No se puede cambiar el proyecto de un subproyecto.');
      const title = item.title.trim().toLocaleLowerCase('es');
      if (
        s.records.some(
          (record) =>
            record.kind === 'subproject' &&
            record.id !== item.id &&
            record.title.trim().toLocaleLowerCase('es') === title,
        )
      )
        throw Error('Ya existe un subproyecto con ese nombre.');
      return;
    }
    if (before) {
      if ('subprojectId' in content && scopeOf(content) !== scopeOf(before))
        throw Error('No se puede trasladar un registro a otro ámbito del proyecto.');
      item.subprojectId = before.subprojectId;
    }
    if (!item.subprojectId) {
      delete item.subprojectId;
      return;
    }
    const child = findSubproject(s.records, item.subprojectId);
    if (!child || child.project !== item.project)
      throw Error('El subproyecto no existe en este cuaderno.');
    this.assertWritable(item);
  }
  private assertWritable(record: { subprojectId?: string }) {
    const child = findSubproject(this.require().records, record.subprojectId);
    if (child?.status === 'Archivado')
      throw Error(
        `El subproyecto «${child.title}» está archivado y su contenido es de solo lectura. Restáuralo para editarlo.`,
      );
  }
  private subproject(id: unknown, expectedVersion: unknown) {
    const child = typeof id === 'string' ? findSubproject(this.require().records, id) : undefined;
    if (!child || (this.activeProjectId && child.project !== this.activeProjectId))
      throw Error('Subproyecto no encontrado.');
    if (child.version !== expectedVersion)
      throw Error('Conflicto: el subproyecto ha cambiado. Vuelve a abrirlo.');
    return child;
  }
  saveSubproject(input: unknown, id?: string, expectedVersion?: number) {
    const data = z
      .object({ title: short.trim().min(1, 'Indica un nombre.'), description: text.default('') })
      .strict()
      .parse(input);
    return this.transaction(() => {
      const before = id ? this.subproject(id, expectedVersion) : undefined;
      if (before?.status === 'Archivado') this.assertWritable({ subprojectId: before.id });
      const root = this.require().records.find((record) => record.kind === 'project');
      if (!root) throw Error('Cuaderno no disponible.');
      return this.write(
        'subproject',
        { ...(before ?? { status: 'Activo' }), ...data, project: root.id },
        before?.id,
        before?.version,
        'Gestión de subproyectos',
      ) as Subproject;
    });
  }
  setSubprojectStatus(id: unknown, expectedVersion: unknown, status: unknown) {
    const next = z.enum(['Activo', 'Archivado']).parse(status);
    return this.transaction(() => {
      const s = this.require();
      const before = this.subproject(id, expectedVersion);
      if (before.status === next)
        throw Error(
          next === 'Archivado'
            ? 'El subproyecto ya está archivado.'
            : 'El subproyecto ya está activo.',
        );
      if (next === 'Archivado') {
        // Reject while the child is still writable, so closures revert the task state normally.
        const inScope = new Set(
          s.records.filter((record) => record.subprojectId === before.id).map((r) => r.id),
        );
        for (const proposal of s.proposals)
          if (
            proposal.status === 'pending' &&
            ((proposal.targetId && inScope.has(proposal.targetId)) ||
              (proposal.operation === 'create' && proposal.patch.subprojectId === before.id))
          )
            this.applyReview(s, proposal, false);
        for (const proposal of s.asvs?.proposals ?? [])
          if (proposal.status === 'pending' && inScope.has(proposal.request.taskId ?? ''))
            proposal.status = 'rejected';
        this.dropGrantScope(before.id);
      }
      const now = new Date().toISOString();
      const after: Subproject = {
        ...structuredClone(before),
        status: next,
        version: before.version + 1,
        updatedAt: now,
      };
      if (next === 'Archivado') after.archivedAt = now;
      else delete after.archivedAt;
      s.records[s.records.indexOf(before)] = after;
      s.history.unshift({
        id: randomUUID(),
        recordId: after.id,
        at: now,
        actor: next === 'Archivado' ? 'Archivo de subproyecto' : 'Restauración de subproyecto',
        before: structuredClone(before),
        after: structuredClone(after),
      });
      return after;
    });
  }
  deleteSubproject(id: unknown, expectedVersion: unknown) {
    return this.transaction(() => {
      const s = this.require();
      const child = this.subproject(id, expectedVersion);
      const inScope = new Set(
        s.records.filter((record) => record.subprojectId === child.id).map((r) => r.id),
      );
      if (
        inScope.size ||
        (s.taskSeries ?? []).some((series) => series.subprojectId === child.id) ||
        Object.values(s.drafts ?? {}).some((draft) => draft.subprojectId === child.id) ||
        s.proposals.some(
          (proposal) => proposal.status === 'pending' && proposal.patch.subprojectId === child.id,
        ) ||
        s.shares.some((share) => share.recordId === child.id)
      )
        throw Error(
          'El subproyecto tiene registros, borradores o propuestas. Archívalo para conservar su contenido.',
        );
      s.records = s.records.filter((record) => record.id !== child.id);
      s.history = s.history.filter((entry) => entry.recordId !== child.id);
      for (const capture of s.captures ?? [])
        if (capture.linkedRecordId === child.id) {
          delete capture.linkedRecordId;
          capture.version++;
          capture.updatedAt = new Date().toISOString();
        }
      this.dropGrantScope(child.id);
      return { ok: true };
    });
  }
  /** Removes a child scope from MCP sessions; a session left without scopes is revoked. */
  private dropGrantScope(subprojectId: string) {
    for (const [grantId, grant] of this.grants) {
      const scopes = grantScopes(grant);
      if (!scopes.includes(subprojectId)) continue;
      const remaining = scopes.filter((scope) => scope !== subprojectId);
      if (remaining.length) grant.scopes = remaining;
      else this.grants.delete(grantId);
    }
  }
  private write(
    kind: Kind,
    data: Record<string, unknown>,
    id?: string,
    expectedVersion?: number,
    actor = 'Tú',
    restoring = false,
  ) {
    const s = this.require(),
      before = id ? s.records.find((r) => r.id === id) : undefined;
    if (id && (!before || before.kind !== kind)) throw Error('Registro no encontrado.');
    if (before && before.version !== expectedVersion)
      throw Error('Conflicto: el registro ha cambiado. Vuelve a abrirlo.');
    const item = this.normalize(kind, data, before, restoring);
    if (
      item.kind === 'task' &&
      before?.kind === 'task' &&
      before.recurrence &&
      !['Serie', 'Hoy', 'Vencimiento', 'Cancelación de aparición'].includes(actor)
    ) {
      const overriddenFields = new Set(before.recurrence.overriddenFields);
      for (const field of INHERITED_TASK_FIELDS)
        if (JSON.stringify(item[field]) !== JSON.stringify(before[field]))
          overriddenFields.add(field);
      item.recurrence = { ...before.recurrence, overriddenFields: [...overriddenFields] };
    }
    if (before) s.records[s.records.indexOf(before)] = item;
    else s.records.push(item);
    if (before?.kind === 'entry' && item.kind === 'entry' && before.result !== item.result) {
      for (const objective of s.records) {
        if (
          objective.kind === 'objective' &&
          objective.validation.state === 'Validado' &&
          objective.links.some((link) => link.sourceId === item.id && link.role === 'resultado')
        )
          this.reviseObjective(objective, objective.links, 'Cambio del resultado vinculado');
      }
    }
    if (
      before?.kind === 'task' &&
      item.kind === 'task' &&
      !before.recurrence?.canceledAt &&
      item.recurrence?.canceledAt
    ) {
      for (const objective of s.records) {
        if (
          objective.kind === 'objective' &&
          objective.validation.state === 'Validado' &&
          objective.links.some((link) => link.sourceId === item.id && link.role === 'trabajo')
        )
          this.reviseObjective(objective, objective.links, 'Cancelación de tarea vinculada');
      }
    }
    if (item.kind === 'practice') {
      this.syncTasksChecks(s);
    }
    s.history.unshift({
      id: randomUUID(),
      recordId: item.id,
      at: item.updatedAt,
      actor,
      before: before ? structuredClone(before) : null,
      after: structuredClone(item),
    });
    return item;
  }
  private pendingObjectiveValidation(): Objective['validation'] {
    return { state: 'Pendiente', date: '', reference: '', responsible: '', linkIds: [] };
  }
  private reviseObjective(objective: Objective, links: ObjectiveLink[], actor: string) {
    const before = structuredClone(objective);
    objective.links = links;
    if (objective.validation.state === 'Validado')
      objective.validation = this.pendingObjectiveValidation();
    objective.version++;
    objective.updatedAt = new Date().toISOString();
    this.require().history.unshift({
      id: randomUUID(),
      recordId: objective.id,
      at: objective.updatedAt,
      actor,
      before,
      after: structuredClone(objective),
    });
  }
  save(
    kind: Kind,
    data: Record<string, unknown>,
    id?: string,
    expectedVersion?: number,
    draftKey?: string,
  ) {
    if (!(kind in schemas)) throw Error('Tipo desconocido.');
    if (kind === 'subproject') throw Error('Gestiona los subproyectos desde su panel.');
    if (kind === 'task') {
      const before = id ? this.require().records.find((record) => record.id === id) : undefined;
      if (!before && data.recurrence !== undefined)
        throw Error('La serie se gestiona desde su editor.');
      if (
        before?.kind === 'task' &&
        JSON.stringify(data.recurrence) !== JSON.stringify(before.recurrence)
      )
        throw Error('El vínculo de repetición es un campo reservado.');
    }
    if (this.activeProjectId && kind === 'project' && !id)
      throw Error('Los cuadernos se crean desde la pantalla de inicio.');
    if (draftKey) this.validateDraftKey(draftKey);
    return this.transaction(() => {
      const item = this.write(kind, data, id, expectedVersion);
      if (draftKey) delete (this.require().drafts ??= {})[draftKey];
      return item;
    });
  }
  private capture(id: string, expectedVersion: number): QuickCapture {
    const capture = this.require().captures?.find((item) => item.id === id);
    if (!capture) throw Error('Apunte no encontrado.');
    if (capture.version !== expectedVersion)
      throw Error('El apunte ha cambiado. Vuelve a abrir la bandeja.');
    if (capture.convertedRecordId) throw Error('El apunte ya se convirtió en un registro.');
    return capture;
  }
  createCapture(text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000)
      throw Error('Escribe un apunte de hasta 8000 caracteres.');
    return this.transaction(() => {
      const project = this.activeProjectId;
      if (!project) throw Error('Abre un cuaderno antes de capturar.');
      const now = new Date().toISOString();
      const capture: QuickCapture = {
        id: randomUUID(),
        project,
        version: 1,
        text,
        createdAt: now,
        updatedAt: now,
      };
      (this.require().captures ??= []).unshift(capture);
      return capture;
    });
  }
  updateCapture(id: string, expectedVersion: number, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000)
      throw Error('Escribe un apunte de hasta 8000 caracteres.');
    return this.transaction(() => {
      const capture = this.capture(id, expectedVersion);
      capture.text = text;
      capture.version++;
      capture.updatedAt = new Date().toISOString();
      return capture;
    });
  }
  linkCapture(id: string, expectedVersion: number, recordId: string) {
    return this.transaction(() => {
      const capture = this.capture(id, expectedVersion);
      const record = this.require().records.find((item) => item.id === recordId);
      if (
        recordId &&
        (!record || (record.kind !== 'project' && record.project !== capture.project))
      )
        throw Error('El registro vinculado no pertenece al cuaderno.');
      if (recordId) capture.linkedRecordId = recordId;
      else delete capture.linkedRecordId;
      capture.version++;
      capture.updatedAt = new Date().toISOString();
      return capture;
    });
  }
  discardCapture(id: string, expectedVersion: number) {
    return this.transaction(() => {
      this.capture(id, expectedVersion);
      this.require().captures = this.require().captures!.filter((item) => item.id !== id);
      return { ok: true };
    });
  }
  convertCapture(
    id: string,
    expectedVersion: number,
    kind: Kind,
    data: Record<string, unknown>,
    draftKey?: string,
  ) {
    if (!['entry', 'incident', 'decision', 'idea'].includes(kind))
      throw Error('Tipo de clasificación no permitido.');
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw Error('Datos de registro inválidos.');
    if (draftKey) this.validateDraftKey(draftKey);
    return this.transaction(() => {
      const existing = this.require().captures?.find((item) => item.id === id);
      if (existing?.convertedRecordId) {
        if (existing.convertedKind !== kind) throw Error('El apunte ya se convirtió.');
        const record = this.require().records.find(
          (item) => item.id === existing.convertedRecordId,
        );
        if (!record) throw Error('El registro convertido ya no existe.');
        return record;
      }
      const capture = this.capture(id, expectedVersion);
      const record = this.write(kind, { ...data, project: capture.project });
      capture.convertedRecordId = record.id;
      capture.convertedKind = kind as QuickCapture['convertedKind'];
      capture.text = '';
      capture.version++;
      capture.updatedAt = new Date().toISOString();
      if (draftKey) delete (this.require().drafts ??= {})[draftKey];
      return record;
    });
  }
  startTodayTasks(day: string, ids: string[]) {
    if (
      !validDay(day) ||
      !Array.isArray(ids) ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length
    )
      throw Error('Selección de tareas inválida.');
    const s = this.require();
    const candidates = ids.map((id) => {
      const task = s.records.find(
        (record): record is Task => record.kind === 'task' && record.id === id,
      );
      if (
        !task ||
        task.due !== day ||
        (this.activeProjectId && task.project !== this.activeProjectId)
      )
        throw Error('Tarea fuera del día o cuaderno activo.');
      return task;
    });
    const ready = candidates.filter(
      (task) =>
        !isArchivedScope(s.records, task) &&
        task.state !== 'Completada' &&
        task.state !== 'En curso' &&
        task.state !== 'En revisión' &&
        !s.proposals.some(
          (proposal) =>
            proposal.status === 'pending' &&
            proposal.kind === 'task' &&
            proposal.targetId === task.id &&
            proposal.patch.state === 'Completada',
        ) &&
        task.dependencyIds.every((id) =>
          s.records.some(
            (record) => record.kind === 'task' && record.id === id && record.state === 'Completada',
          ),
        ),
    );
    if (!ready.length) return [];
    return this.transaction(() =>
      ready.map((task) =>
        this.write('task', { ...task, state: 'En curso' }, task.id, task.version, 'Hoy'),
      ),
    );
  }
  startOverdueTasks(today = madridDate()) {
    if (!validDay(today)) throw Error('Fecha inválida.');
    const s = this.require();
    const overdue = s.records.filter(
      (record): record is Task =>
        record.kind === 'task' &&
        !record.recurrence?.canceledAt &&
        record.state === 'Por hacer' &&
        record.due < today &&
        (!this.activeProjectId || record.project === this.activeProjectId) &&
        !isArchivedScope(s.records, record) &&
        record.dependencyIds.every((id) =>
          s.records.some(
            (dependency) =>
              dependency.kind === 'task' &&
              dependency.id === id &&
              dependency.state === 'Completada',
          ),
        ),
    );
    if (!overdue.length) return [];
    return this.transaction(() =>
      overdue.map((task) =>
        this.write('task', { ...task, state: 'En curso' }, task.id, task.version, 'Vencimiento'),
      ),
    );
  }
  stopTodayTasks(ids: string[]) {
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length)
      throw Error('Selección de tareas inválida.');
    if (!ids.length) return [];
    const s = this.require();
    const candidates = ids.map((id) => {
      const task = s.records.find(
        (record): record is Task => record.kind === 'task' && record.id === id,
      );
      if (!task || (this.activeProjectId && task.project !== this.activeProjectId))
        throw Error('Tarea fuera del cuaderno activo.');
      return task;
    });
    const today = madridDate();
    const leaving = candidates.filter(
      (task) => task.state === 'En curso' && task.due >= today && !isArchivedScope(s.records, task),
    );
    if (!leaving.length) return [];
    return this.transaction(() =>
      leaving.map((task) =>
        this.write('task', { ...task, state: 'Por hacer' }, task.id, task.version, 'Hoy'),
      ),
    );
  }
  private validateDraftKey(key: string) {
    if (typeof key !== 'string' || !/^(record|new|daily|extra):[a-z0-9:-]{1,150}$/i.test(key))
      throw Error('Identificador de borrador inválido.');
  }
  saveDraft(key: string, data: Record<string, unknown>) {
    this.validateDraftKey(key);
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      JSON.stringify(data).length > 12 * 1024 * 1024
    )
      throw Error('Borrador inválido o demasiado grande.');
    if (this.activeProjectId && data.project && data.project !== this.activeProjectId)
      throw Error('Proyecto fuera del cuaderno activo.');
    if (data.subprojectId && !findSubproject(this.require().records, String(data.subprojectId)))
      throw Error('El subproyecto no existe en este cuaderno.');
    return this.transaction(() => {
      const state = this.require();
      (state.drafts ??= {})[key] = structuredClone(data);
      return { ok: true };
    });
  }
  deleteDraft(key: string) {
    this.validateDraftKey(key);
    return this.transaction(() => {
      delete (this.require().drafts ??= {})[key];
      return { ok: true };
    });
  }
  deleteTask(id: string, expectedVersion: number) {
    const task = this.require().records.find((record) => record.id === id);
    if (task?.kind === 'task' && task.recurrence) {
      if (task.state === 'Completada')
        throw Error('Una aparición completada conserva su historial y no se cancela.');
      if (task.recurrence.canceledAt) throw Error('La aparición ya está cancelada.');
      if (task.version !== expectedVersion) throw Error('La tarea ha cambiado. Vuelve a abrirla.');
      if (this.activeProjectId && task.project !== this.activeProjectId)
        throw Error('Tarea fuera del cuaderno activo.');
      return this.transaction(() => {
        this.write(
          'task',
          {
            ...task,
            recurrence: {
              ...task.recurrence,
              canceledAt: new Date().toISOString(),
              cancellationReason: 'manual',
            },
          },
          id,
          expectedVersion,
          'Cancelación de aparición',
        );
        return { ok: true };
      });
    }
    return this.deleteRecord('task', id, expectedVersion);
  }
  deleteIncident(id: string, expectedVersion: number) {
    return this.deleteRecord('incident', id, expectedVersion);
  }
  deleteEntry(id: string, expectedVersion: number) {
    return this.deleteRecord('entry', id, expectedVersion);
  }
  deleteDecision(id: string, expectedVersion: number) {
    return this.deleteRecord('decision', id, expectedVersion);
  }
  deleteIdea(id: string, expectedVersion: number) {
    return this.deleteRecord('idea', id, expectedVersion);
  }
  deleteMeeting(id: string, expectedVersion: number) {
    return this.deleteRecord('meeting', id, expectedVersion);
  }
  deleteProject(id: string, expectedVersion: number) {
    if (this.activeProjectId) throw Error('El cuaderno se elimina desde su pantalla de inicio.');
    return this.deleteRecord('project', id, expectedVersion);
  }
  deletePractice(id: string, expectedVersion: number) {
    return this.deleteRecord('practice', id, expectedVersion);
  }
  deleteObjective(id: string, expectedVersion: number) {
    return this.deleteRecord('objective', id, expectedVersion);
  }
  private deleteRecord(kind: Kind, id: string, expectedVersion: number) {
    return this.transaction(() => {
      const s = this.require();
      const recordToDelete = s.records.find((r) => r.id === id);
      const labels = {
        task: 'tarea',
        incident: 'incidencia',
        entry: 'entrada',
        decision: 'decisión',
        idea: 'idea',
        meeting: 'reunión',
        project: 'proyecto',
        subproject: 'subproyecto',
        practice: 'política o criterio',
        objective: 'objetivo',
      };
      const label = labels[kind];
      if (!recordToDelete || recordToDelete.kind !== kind)
        throw Error(
          `${label[0].toUpperCase()}${label.slice(1)} no encontrad${kind === 'project' || kind === 'practice' ? 'o' : 'a'}.`,
        );
      if (recordToDelete.version !== expectedVersion)
        throw Error(
          `Conflicto: ${kind === 'project' || kind === 'practice' ? 'el' : 'la'} ${label} ha cambiado. Vuelve a abrirl${kind === 'project' || kind === 'practice' ? 'o' : 'a'}.`,
        );
      this.assertWritable(recordToDelete);
      s.records = s.records.filter((r) => r.id !== id);
      for (const capture of s.captures ?? []) {
        if (capture.linkedRecordId === id) {
          delete capture.linkedRecordId;
          capture.version++;
          capture.updatedAt = new Date().toISOString();
        }
      }
      delete (s.drafts ??= {})[`record:${id}`];
      if (recordToDelete.kind === 'entry') {
        const dailyKey = `daily:${recordToDelete.date}:${recordToDelete.project || 'none'}${recordToDelete.subprojectId ? `:${recordToDelete.subprojectId}` : ''}`;
        if (s.drafts?.[dailyKey]?.id === id) delete s.drafts[dailyKey];
      }
      for (const record of s.records) {
        if (kind === 'project' && record.project === id) {
          const before = structuredClone(record);
          record.project = '';
          record.version++;
          record.updatedAt = new Date().toISOString();
          s.history.unshift({
            id: randomUUID(),
            recordId: record.id,
            at: record.updatedAt,
            actor: 'Eliminación de proyecto',
            before,
            after: structuredClone(record),
          });
        }
        if (kind === 'task' && record.kind === 'entry')
          record.taskIds = record.taskIds.filter((taskId) => taskId !== id);
        if (record.kind === 'entry' && record.linkedIds)
          record.linkedIds = record.linkedIds.filter((linkedId) => linkedId !== id);
        if (kind === 'task' && record.kind === 'task' && record.dependencyIds.includes(id)) {
          const before = structuredClone(record);
          record.dependencyIds = record.dependencyIds.filter((dependencyId) => dependencyId !== id);
          record.version++;
          record.updatedAt = new Date().toISOString();
          s.history.unshift({
            id: randomUUID(),
            recordId: record.id,
            at: record.updatedAt,
            actor: 'Eliminación de dependencia',
            before,
            after: structuredClone(record),
          });
        }
        if (record.kind === 'meeting') {
          record.sourceIds = record.sourceIds.filter((sourceId) => sourceId !== id);
          if (
            kind === 'task' &&
            record.agreementItems?.some((item) => item.followUpTaskId === id)
          ) {
            const before = structuredClone(record);
            record.agreementItems = record.agreementItems.map((item) =>
              item.followUpTaskId === id ? { ...item, followUpTaskId: undefined } : item,
            );
            record.version++;
            record.updatedAt = new Date().toISOString();
            s.history.unshift({
              id: randomUUID(),
              recordId: record.id,
              at: record.updatedAt,
              actor: 'Eliminación de tarea de seguimiento',
              before,
              after: structuredClone(record),
            });
          }
        }
        if (record.kind === 'objective') {
          const links = record.links.filter((link) => link.sourceId !== id);
          if (links.length !== record.links.length)
            this.reviseObjective(record, links, 'Eliminación de registro vinculado');
        }
        if (
          kind === 'practice' &&
          record.kind === 'task' &&
          record.checks?.some((c) => c.practiceId === id)
        ) {
          const before = structuredClone(record);
          record.checks = record.checks.filter((c) => c.practiceId !== id);
          record.version++;
          record.updatedAt = new Date().toISOString();
          s.history.unshift({
            id: randomUUID(),
            recordId: record.id,
            at: record.updatedAt,
            actor: 'Eliminación de criterio',
            before,
            after: structuredClone(record),
          });
        }
      }
      if (kind === 'project') {
        for (const [key, draft] of Object.entries(s.drafts ?? {})) {
          if (draft.project !== id) continue;
          draft.project = '';
          if (key.startsWith('daily:') && key.endsWith(`:${id}`)) {
            const destination = `${key.slice(0, -id.length)}none`;
            if (!s.drafts?.[destination]) s.drafts![destination] = draft;
            delete s.drafts![key];
          }
        }
      }
      s.history = s.history.filter((h) => h.recordId !== id);
      const revoked = s.shares.filter((share) => share.recordId === id).map((share) => share.id);
      s.shares = s.shares.filter((share) => share.recordId !== id);
      for (const [grantId, grant] of this.grants)
        if (grant.shareIds.some((shareId) => revoked.includes(shareId)))
          this.grants.delete(grantId);
      for (const proposal of s.proposals)
        if (proposal.targetId === id && proposal.status === 'pending') proposal.status = 'rejected';
      return { ok: true };
    });
  }
  syncCriteria(id: string, version: number) {
    return this.transaction(() => {
      const s = this.require();
      const t = s.records.find((r): r is Task => r.id === id && r.kind === 'task');
      if (!t || t.version !== version || t.state === 'Completada')
        throw Error('La tarea no admite esta revisión.');
      this.assertWritable(t);
      const before = structuredClone(t);
      const ps = s.records.filter((r): r is Practice => r.kind === 'practice');
      t.checks = t.checks
        .filter((c) => {
          const p = ps.find((p) => p.id === c.practiceId);
          return p && p.status !== 'Borrador' && p.status !== 'Retirada';
        })
        .map((c) => {
          const p = ps.find((p) => p.id === c.practiceId);
          return p && p.version !== c.practiceVersion ? snapshotCheck(p) : c;
        });
      for (const p of ps.filter((p) => applicable(p, t)))
        if (!t.checks.some((c) => c.practiceId === p.id)) t.checks.push(snapshotCheck(p));
      t.version++;
      t.updatedAt = new Date().toISOString();
      s.history.unshift({
        id: randomUUID(),
        recordId: id,
        at: t.updatedAt,
        actor: 'Revisión de criterios',
        before,
        after: structuredClone(t),
      });
      return t;
    });
  }
  undo(historyId: string) {
    return this.transaction(() => {
      const s = this.require();
      const h = s.history.find((h) => h.id === historyId);
      if (!h) throw Error('Cambio no encontrado.');
      const current = s.records.find((r) => r.id === h.recordId);
      if (!current || current.version !== h.after.version)
        throw Error('Solo puedes deshacer la última versión del registro.');
      if (!h.before)
        throw Error(
          'La creación se conserva para mantener las referencias. Puedes editar el registro.',
        );
      if (h.before.kind === 'subproject')
        throw Error('Gestiona los cambios del subproyecto desde su panel.');
      return this.write(
        h.before.kind,
        h.before as unknown as Record<string, unknown>,
        current.id,
        current.version,
        'Deshacer',
      );
    });
  }
  restoreTask(historyId: string, taskId: string, expectedVersion: number) {
    return this.transaction(() => {
      const s = this.require();
      const current = s.records.find((r): r is Task => r.id === taskId && r.kind === 'task');
      if (!current) throw Error('Tarea no encontrada.');
      if (current.version !== expectedVersion)
        throw Error('Conflicto: la tarea ha cambiado. Vuelve a abrirla.');
      const history = s.history.find((h) => h.id === historyId && h.recordId === taskId);
      if (!history || history.after.kind !== 'task') throw Error('Versión no encontrada.');
      if (history.after.version === current.version)
        throw Error('La versión seleccionada ya es la actual.');
      return this.write(
        'task',
        history.after as unknown as Record<string, unknown>,
        taskId,
        expectedVersion,
        `Restauración de v${history.after.version}`,
        true,
      );
    });
  }
  settings(data: unknown) {
    const parsed = z
      .object({ companyAuthorized: z.boolean(), universityStructure: z.string().max(2000) })
      .strict()
      .parse(data);
    this.transaction(() => {
      this.require().settings = parsed;
    });
    if (!parsed.companyAuthorized) this.grants.clear();
    return parsed;
  }
  setMcpProfile(profile: unknown): McpProfile {
    const next = z.enum(['personal', 'corporativo']).parse(profile);
    if (this.require().mcpProfile === next) return next;
    this.transaction(() => {
      const state = this.require();
      state.mcpProfile = next;
      state.mcpProfileVersion++;
      state.settings.companyAuthorized = false;
      state.shares = [];
      for (const proposal of state.proposals) {
        if (proposal.status === 'pending') proposal.status = 'rejected';
      }
      for (const proposal of state.asvs?.proposals ?? [])
        if (proposal.status === 'pending') proposal.status = 'rejected';
      for (const proposal of state.asvs?.revisionProposals ?? [])
        if (proposal.status === 'pending') proposal.status = 'rejected';
    });
    this.grants.clear();
    return next;
  }
  share(data: unknown) {
    return this.transaction(() => {
      const d = z
        .object({
          recordId: short,
          provider: z.enum(['claude', 'codex', 'antigravity']),
          title: short.min(1),
          excerpt: z.string().min(1).max(4000),
        })
        .strict()
        .parse(data);
      const s = this.require();
      if (s.mcpProfile === 'corporativo')
        throw Error('El MCP corporativo requiere verificar la cuenta de Claude.');
      if (!s.settings.companyAuthorized)
        throw Error('Confirma primero la autorización de la empresa.');
      const r = s.records.find((r) => r.id === d.recordId);
      if (!r) throw Error('Registro no encontrado.');
      const share: Share = {
        ...d,
        id: randomUUID(),
        recordVersion: r.version,
        approvedAt: new Date().toISOString(),
      };
      s.shares.push(share);
      return share;
    });
  }
  revokeShare(id: string) {
    this.transaction(() => {
      this.require().shares = this.require().shares.filter((s) => s.id !== id);
    });
    for (const [key, g] of this.grants) if (g.shareIds.includes(id)) this.grants.delete(key);
  }
  grant(
    provider: Provider,
    ids: string[],
    scope: 'selected' | 'projects' = 'selected',
    projectIds: string[] = [],
    durationMinutes: number = DEFAULT_SESSION_DURATION_MINUTES,
    canCompleteTasks = false,
    scopes: string[] = [GENERAL_SCOPE],
  ) {
    const s = this.require();
    if (s.mcpProfile === 'corporativo')
      throw Error('El MCP corporativo requiere verificar la cuenta de Claude.');
    if (
      this.activeProjectId &&
      (scope !== 'projects' || projectIds.length !== 1 || projectIds[0] !== this.activeProjectId)
    )
      throw Error('La sesión MCP solo puede acceder al cuaderno activo.');
    if (!s.settings.companyAuthorized) throw Error('Falta autorización de empresa.');
    if (scope !== 'selected' && scope !== 'projects') throw Error('Alcance no permitido.');
    if (
      scope === 'projects' &&
      (ids.length ||
        !projectIds.length ||
        projectIds.length > 100 ||
        new Set(projectIds).size !== projectIds.length ||
        projectIds.some((id) => !s.records.some((r) => r.kind === 'project' && r.id === id)))
    )
      throw Error('Selecciona proyectos existentes para esta sesión.');
    if (scope === 'selected' && projectIds.length) throw Error('Alcance no permitido.');
    if (scope === 'projects') this.validateGrantScopes(scopes);
    if (typeof canCompleteTasks !== 'boolean' || (canCompleteTasks && scope !== 'projects'))
      throw Error('Permiso de cierre de tareas inválido.');
    if (
      !['claude', 'codex', 'antigravity'].includes(provider) ||
      (scope === 'selected' && !ids.length) ||
      ids.length > 100 ||
      ids.some((id) => !s.shares.some((sh) => sh.id === id && sh.provider === provider))
    )
      throw Error('Selecciona extractos revisados para este proveedor.');
    if (
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < MIN_SESSION_DURATION_MINUTES ||
      durationMinutes > MAX_SESSION_DURATION_MINUTES
    )
      throw Error(
        'La duración de la sesión debe ser un número entero entre 15 minutos y 8 horas (480 minutos).',
      );
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const g: Grant = {
      id,
      provider,
      shareIds: ids,
      projectIds,
      ...(scope === 'projects' ? { scopes: [...scopes] } : {}),
      canCompleteTasks,
      scope,
      expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
      hash: createHash('sha256').update(token).digest('hex'),
      profileVersion: s.mcpProfileVersion,
    };
    this.grants.set(id, g);
    return { id, token, expiresAt: g.expiresAt };
  }
  renewGrant(id: string, durationMinutes: number = DEFAULT_SESSION_DURATION_MINUTES) {
    const state = this.require();
    const grant = this.grants.get(id);
    if (
      !grant ||
      state.mcpProfile === 'corporativo' ||
      grant.profileVersion !== state.mcpProfileVersion ||
      grant.scope !== 'projects' ||
      Date.parse(grant.expiresAt) <= Date.now()
    )
      throw Error('Sesión de proyectos no disponible.');
    if (
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < MIN_SESSION_DURATION_MINUTES ||
      durationMinutes > MAX_SESSION_DURATION_MINUTES
    )
      throw Error(
        'La duración de la sesión debe ser un número entero entre 15 minutos y 8 horas (480 minutos).',
      );
    grant.expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
    return { id: grant.id, expiresAt: grant.expiresAt };
  }
  revokeGrant(id: string) {
    this.grants.delete(id);
  }
  private validateGrantScopes(scopes: unknown): asserts scopes is string[] {
    const records = this.require().records;
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      scopes.length > 101 ||
      new Set(scopes).size !== scopes.length ||
      scopes.some(
        (scope) =>
          typeof scope !== 'string' ||
          (scope !== GENERAL_SCOPE && findSubproject(records, scope)?.status !== 'Activo'),
      )
    )
      throw Error('Selecciona «General» o subproyectos activos para esta sesión.');
  }
  updateGrantProjects(id: string, projectIds: string[], scopes?: string[]) {
    const s = this.require();
    if (
      this.activeProjectId &&
      (!Array.isArray(projectIds) ||
        projectIds.length !== 1 ||
        projectIds[0] !== this.activeProjectId)
    )
      throw Error('La sesión MCP solo puede acceder al cuaderno activo.');
    const grant = this.grants.get(id);
    if (
      !grant ||
      s.mcpProfile === 'corporativo' ||
      grant.profileVersion !== s.mcpProfileVersion ||
      grant.scope !== 'projects' ||
      Date.parse(grant.expiresAt) <= Date.now()
    )
      throw Error('Sesión de proyectos no disponible.');
    if (
      !Array.isArray(projectIds) ||
      !projectIds.length ||
      projectIds.length > 100 ||
      new Set(projectIds).size !== projectIds.length ||
      projectIds.some(
        (projectId) =>
          !s.records.some((record) => record.kind === 'project' && record.id === projectId),
      )
    )
      throw Error('Selecciona proyectos existentes para esta sesión.');
    if (scopes !== undefined) this.validateGrantScopes(scopes);
    grant.projectIds = [...projectIds];
    if (scopes !== undefined) grant.scopes = [...scopes];
    return { id: grant.id, projectIds: grant.projectIds, scopes: grantScopes(grant) };
  }
  authorize(token: string) {
    const state = this.require();
    const hash = createHash('sha256').update(token).digest('hex');
    const g = [...this.grants.values()].find(
      (g) => g.hash === hash && Date.parse(g.expiresAt) > Date.now(),
    );
    if (
      !g ||
      state.mcpProfile === 'corporativo' ||
      g.profileVersion !== state.mcpProfileVersion ||
      !state.settings.companyAuthorized
    )
      throw Error('Sesión revocada, caducada o no autorizada.');
    return g;
  }
  /** Records an MCP project session may see; every MCP query starts from this list. */
  grantRecords(g: Grant) {
    const records = this.require().records;
    return records.filter((record) => grantSees(g, record, records));
  }
  visible(g: Grant) {
    if (g.scope === 'projects') {
      const records = this.grantRecords(g);
      const visibleIds = new Set(records.map((r) => r.id));
      return records.map((r): Share => ({
        id: r.id,
        recordId: r.id,
        provider: g.provider,
        title: r.title,
        excerpt: JSON.stringify({
          ...this.projectContext(r, visibleIds),
          ...(r.subprojectId ? { subprojectId: r.subprojectId } : {}),
        }),
        recordVersion: r.version,
        approvedAt: g.expiresAt,
      }));
    }
    return this.require().shares.filter(
      (sh) =>
        g.shareIds.includes(sh.id) &&
        sh.provider === g.provider &&
        this.require().records.some((r) => r.id === sh.recordId && r.version === sh.recordVersion),
    );
  }
  private projectContext(r: RecordItem, visibleIds: Set<string>) {
    switch (r.kind) {
      case 'project':
        return {
          objective: r.objective,
          specifications: r.specifications,
          competency: r.competency,
        };
      case 'subproject':
        return { project: r.project, description: r.description, status: r.status };
      case 'objective':
        return {
          project: r.project,
          description: r.description,
          links: r.links
            .filter((link) => visibleIds.has(link.sourceId))
            .map(({ sourceKind, sourceId, role, reference }) => ({
              sourceKind,
              sourceId,
              role,
              reference,
            })),
          validation: r.validation,
        };
      case 'task':
        return {
          project: r.project,
          phase: r.phase,
          type: r.type,
          tags: r.tags,
          priority: r.priority,
          state: r.state,
          due: r.due,
          blocked: r.blocked,
          nextStep: r.nextStep,
          description: r.description,
          solution: r.solution,
          dependencyIds: r.dependencyIds.filter((id) => visibleIds.has(id)),
          asvsLinks: r.asvsLinks,
          checks: r.checks
            .filter((check) => visibleIds.has(check.practiceId))
            .map(({ practiceId, state, note }) => ({ practiceId, state, note })),
        };
      case 'entry':
        return {
          project: r.project,
          date: r.date,
          activity: r.activity,
          result: r.result,
          learning: r.learning,
          nextStep: r.nextStep,
          blocker: r.blocker,
          competency: r.competency,
          evidence: r.evidence,
          original: r.original,
          contribution: r.contribution,
          taskIds: r.taskIds.filter((id) => visibleIds.has(id)),
          linkedIds: r.linkedIds?.filter((id) => visibleIds.has(id)),
        };
      case 'incident':
        return {
          project: r.project,
          date: r.date,
          description: r.description,
          solution: r.solution,
          resolvedDate: r.resolvedDate,
        };
      case 'idea':
        return { project: r.project, date: r.date, description: r.description };
      case 'decision':
        return {
          project: r.project,
          date: r.date,
          problem: r.problem,
          alternatives: r.alternatives,
          decision: r.decision,
          reason: r.reason,
          consequences: r.consequences,
          evidence: r.evidence,
        };
      case 'meeting':
        return {
          project: r.project,
          from: r.from,
          to: r.to,
          body: r.body,
          agreements: r.agreements,
          sourceIds: r.sourceIds.filter((id) => visibleIds.has(id)),
        };
      case 'practice':
        return {
          project: r.project,
          category: r.category,
          explanation: r.explanation,
          source: r.source,
          owner: r.owner,
          status: r.status,
          mandatory: r.mandatory,
          pinned: r.pinned,
          phases: r.phases,
          tags: r.tags,
        };
    }
  }
  context(g: Grant, input: unknown, summary = false) {
    const q = z
      .object({
        query: z.string().max(200).default(''),
        kind: z
          .enum([
            'task',
            'entry',
            'incident',
            'idea',
            'practice',
            'decision',
            'meeting',
            'project',
            'subproject',
            'objective',
          ])
          .optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(10).default(5),
        recordIds: z.array(short).max(10).optional(),
        taskId: short.optional(),
        excerptOffset: z.number().int().min(0).optional(),
      })
      .strict()
      .parse(input);
    if (q.excerptOffset !== undefined && q.recordIds?.length !== 1)
      throw Error('Selecciona un solo registro para continuar su lectura.');
    const s = this.require();
    let shares = this.visible(g);
    if (q.taskId) {
      if (!shares.some((sh) => sh.recordId === q.taskId)) throw Error('Contexto no autorizado.');
      const t = s.records.find((r): r is Task => r.id === q.taskId && r.kind === 'task');
      const ids = t?.checks.map((c) => c.practiceId) || [];
      shares = shares.filter((sh) => ids.includes(sh.recordId));
    }
    const rows = shares
      .filter(
        (sh) =>
          (!q.recordIds || q.recordIds.includes(sh.recordId)) &&
          (!q.kind || s.records.find((r) => r.id === sh.recordId)?.kind === q.kind) &&
          `${sh.title} ${sh.excerpt}`.toLocaleLowerCase().includes(q.query.toLocaleLowerCase()),
      )
      .map((sh) => ({
        id: sh.recordId,
        kind: s.records.find((r) => r.id === sh.recordId)!.kind,
        version: sh.recordVersion,
        title: sh.title,
        ...(summary ? {} : { excerpt: sh.excerpt }),
        ...(!summary && s.records.find((r) => r.id === sh.recordId)?.kind === 'task'
          ? {
              asvs: taskAsvsContext(
                s,
                g,
                s.records.find((r) => r.id === sh.recordId)!.project,
                sh.recordId,
              ),
            }
          : {}),
      }));
    // Leave space for the response envelope and pagination cursors.
    let budget = 11800;
    const page: typeof rows = [];
    let nextExcerptOffset: number | null = null;
    for (const row of rows.slice(q.offset, q.offset + q.limit)) {
      if (summary) {
        page.push(row);
        continue;
      }
      const excerpt = (row.excerpt ?? '').slice(q.excerptOffset ?? 0);
      const item = { ...row, excerpt };
      if (JSON.stringify(item).length <= budget) {
        page.push(item);
        budget -= JSON.stringify(item).length;
        continue;
      }
      if (page.length) break;
      let low = 0;
      let high = excerpt.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (JSON.stringify({ ...row, excerpt: excerpt.slice(0, middle) }).length <= budget)
          low = middle;
        else high = middle - 1;
      }
      if (!low) throw Error('El registro no cabe en la respuesta MCP.');
      page.push({ ...row, excerpt: excerpt.slice(0, low) });
      nextExcerptOffset = (q.excerptOffset ?? 0) + low;
      break;
    }
    return {
      items: page,
      ...(q.taskId
        ? {
            asvs: taskAsvsContext(
              s,
              g,
              s.records.find((r) => r.id === q.taskId)!.project,
              q.taskId,
            ),
          }
        : {}),
      nextOffset: q.offset + page.length < rows.length ? q.offset + page.length : null,
      ...(nextExcerptOffset !== null && { nextExcerptOffset }),
    };
  }
  sessionInfo(g: Grant) {
    const projects =
      g.scope === 'projects'
        ? this.require()
            .records.filter((r) => r.kind === 'project' && g.projectIds.includes(r.id))
            .map((r) => ({ id: r.id, title: r.title }))
        : this.visible(g)
            .filter((share) =>
              this.require().records.some((r) => r.id === share.recordId && r.kind === 'project'),
            )
            .map((share) => ({ id: share.recordId, title: share.title }));
    const records = this.require().records;
    return {
      connected: true,
      provider: g.provider,
      scope: g.scope,
      expiresAt: g.expiresAt,
      canCompleteTasks: g.canCompleteTasks === true,
      projects,
      ...(g.scope === 'projects'
        ? {
            scopes: effectiveGrantScopes(g, records).map((scope) =>
              scope === GENERAL_SCOPE
                ? { id: GENERAL_SCOPE, title: 'General del proyecto' }
                : { id: scope, title: findSubproject(records, scope)!.title },
            ),
          }
        : {}),
    };
  }
  filterRecords(g: Grant, input: unknown) {
    if (g.scope !== 'projects') throw Error('Esta consulta requiere una sesión de proyectos.');
    const q = z
      .object({
        kind: z
          .enum([
            'task',
            'entry',
            'incident',
            'idea',
            'practice',
            'decision',
            'meeting',
            'project',
            'subproject',
            'objective',
          ])
          .optional(),
        projectId: short.optional(),
        subprojectId: short.optional(),
        from: z.string().refine(validDay, 'Fecha inválida').optional(),
        to: z.string().refine(validDay, 'Fecha inválida').optional(),
        state: z.enum(['Por hacer', 'En curso', 'En revisión', 'Completada']).optional(),
        priority: z.enum(PRIORITIES).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(10).default(5),
      })
      .strict()
      .parse(input);
    if (q.projectId && !g.projectIds.includes(q.projectId)) throw Error('Proyecto no autorizado.');
    if (q.from && q.to && q.from > q.to) throw Error('Rango de fechas inválido.');
    const rows = this.grantRecords(g)
      .filter((r) => !q.kind || r.kind === q.kind)
      .filter((r) => !q.projectId || r.id === q.projectId || r.project === q.projectId)
      .filter(
        (r) =>
          !q.subprojectId ||
          (q.subprojectId === GENERAL_SCOPE ? !r.subprojectId : r.subprojectId === q.subprojectId),
      )
      .filter((r) => !q.state || (r.kind === 'task' && r.state === q.state))
      .filter((r) => !q.priority || (r.kind === 'task' && r.priority === q.priority))
      .filter((r) => {
        const day =
          r.kind === 'task'
            ? r.due
            : r.kind === 'meeting'
              ? r.from.slice(0, 10)
              : 'date' in r
                ? r.date
                : '';
        return (!q.from || day >= q.from) && (!q.to || day <= q.to);
      })
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        version: r.version,
        title: r.title,
        projectId: r.kind === 'project' ? r.id : r.project,
        ...(r.subprojectId ? { subprojectId: r.subprojectId } : {}),
        ...(r.kind === 'task' ? { due: r.due, state: r.state, priority: r.priority } : {}),
        ...('date' in r ? { date: r.date } : {}),
      }));
    const items = rows.slice(q.offset, q.offset + q.limit);
    return {
      items,
      nextOffset: q.offset + items.length < rows.length ? q.offset + items.length : null,
    };
  }
  projectSummary(g: Grant, input: unknown) {
    if (g.scope !== 'projects') throw Error('Esta consulta requiere una sesión de proyectos.');
    const { projectId } = z.object({ projectId: short }).strict().parse(input);
    if (!g.projectIds.includes(projectId)) throw Error('Proyecto no autorizado.');
    const project = this.require().records.find((r) => r.id === projectId && r.kind === 'project');
    if (!project) throw Error('Proyecto no disponible.');
    const records = this.grantRecords(g).filter(
      (record) =>
        record.project === projectId && (record.kind !== 'task' || !record.recurrence?.canceledAt),
    );
    const counts = Object.fromEntries(
      [
        'task',
        'entry',
        'incident',
        'idea',
        'practice',
        'decision',
        'meeting',
        'objective',
        'subproject',
      ].map((kind) => [kind, records.filter((r) => r.kind === kind).length]),
    );
    const tasks = records.filter((r): r is Task => r.kind === 'task');
    return {
      project: { id: project.id, title: project.title, version: project.version },
      counts,
      taskStates: Object.fromEntries(
        ['Por hacer', 'En curso', 'En revisión', 'Completada'].map((state) => [
          state,
          tasks.filter((task) => task.state === state).length,
        ]),
      ),
      overdueTasks: tasks.filter((task) => task.state !== 'Completada' && task.due < madridDate())
        .length,
    };
  }
  taskQuality(g: Grant, input: unknown) {
    if (g.scope !== 'projects') throw Error('Esta consulta requiere una sesión de proyectos.');
    const q = z
      .object({
        projectId: short.optional(),
        category: z.enum(TASK_QUALITY_CATEGORIES).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(10).default(5),
      })
      .strict()
      .parse(input);
    if (q.projectId && !g.projectIds.includes(q.projectId)) throw Error('Proyecto no autorizado.');
    const state = this.require();
    const visible = this.grantRecords(g);
    const tasks = visible.filter((record): record is Task => record.kind === 'task');
    const practices = visible.filter((record): record is Practice => record.kind === 'practice');
    const counts = Object.fromEntries(
      TASK_QUALITY_CATEGORIES.map((category) => [category, 0]),
    ) as Record<(typeof TASK_QUALITY_CATEGORIES)[number], number>;
    const items = g.projectIds
      .filter((projectId) => !q.projectId || projectId === q.projectId)
      .flatMap((projectId) => {
        const diagnosis = diagnoseTaskQuality(
          tasks,
          practices,
          state.proposals,
          projectId,
          madridDate(),
        );
        for (const category of TASK_QUALITY_CATEGORIES)
          counts[category] += diagnosis.counts[category];
        return diagnosis.items;
      });
    const matching = q.category ? items.filter((item) => item.category === q.category) : items;
    const page = matching.slice(q.offset, q.offset + q.limit);
    return {
      counts,
      items: page,
      nextOffset: q.offset + page.length < matching.length ? q.offset + page.length : null,
    };
  }
  relatedRecords(g: Grant, input: unknown) {
    if (g.scope !== 'projects') throw Error('Esta consulta requiere una sesión de proyectos.');
    const q = z
      .object({
        recordId: short,
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(10).default(10),
      })
      .strict()
      .parse(input);
    const records = this.grantRecords(g);
    if (!records.some((r) => r.id === q.recordId)) throw Error('Registro no autorizado.');
    const idsFor = (r: RecordItem) => {
      switch (r.kind) {
        case 'task':
          return [...r.dependencyIds, ...r.checks.map((check) => check.practiceId)];
        case 'entry':
          return [...r.taskIds, ...(r.linkedIds || [])];
        case 'meeting':
          return r.sourceIds;
        case 'objective':
          return r.links.map((link) => link.sourceId);
        default:
          return [];
      }
    };
    const source = records.find((r) => r.id === q.recordId)!;
    const rows = records
      .filter(
        (r) =>
          r.id !== q.recordId && (idsFor(source).includes(r.id) || idsFor(r).includes(q.recordId)),
      )
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        version: r.version,
        title: r.title,
        direction: idsFor(source).includes(r.id) ? 'outgoing' : 'incoming',
      }));
    const items = rows.slice(q.offset, q.offset + q.limit);
    return {
      items,
      nextOffset: q.offset + items.length < rows.length ? q.offset + items.length : null,
    };
  }
  private validateProposedCheck(s: Snapshot, task: Task, patch: Record<string, unknown>) {
    const check = z
      .object({
        practiceId: short,
        state: z.enum(['Pendiente', 'Cumplido', 'Requiere consulta']),
        note: text,
      })
      .strict()
      .parse(patch);
    const practice = s.records.find(
      (record): record is Practice => record.kind === 'practice' && record.id === check.practiceId,
    );
    const associated = task.checks.find((item) => item.practiceId === check.practiceId);
    if (
      !practice ||
      !associated ||
      practice.status === 'Borrador' ||
      practice.status === 'Retirada' ||
      (practice.project && practice.project !== task.project) ||
      !practiceReaches(practice, task)
    )
      throw Error('Criterio no asociado o inactivo.');
    if (associated.practiceVersion !== practice.version)
      throw Error('Revisa primero la versión actualizada del criterio.');
    if (task.state === 'Completada') throw Error('La tarea ya está completada.');
    if (check.state !== 'Pendiente' && !check.note.trim())
      throw Error('La verificación requiere una nota con evidencias.');
    return check;
  }
  propose(g: Grant, input: unknown) {
    const d = proposalSchema.parse(input);
    const s = this.require();
    if (
      !['task', 'entry', 'incident', 'idea', 'practice', 'decision', 'meeting', 'project'].includes(
        d.kind,
      ) ||
      (d.kind === 'project' && d.operation !== 'update')
    )
      throw Error('Este tipo requiere edición humana.');
    const shares = this.visible(g);
    const target = d.targetId ? s.records.find((record) => record.id === d.targetId) : undefined;
    if (g.scope === 'projects') {
      const projectId =
        d.operation === 'create'
          ? d.patch.project
          : target?.kind === 'project'
            ? target.id
            : target?.project;
      if (typeof projectId !== 'string' || !g.projectIds.includes(projectId))
        throw Error('El proyecto no está autorizado en esta sesión.');
      if (d.operation === 'create') {
        if (d.patch.subprojectId !== undefined && typeof d.patch.subprojectId !== 'string')
          throw Error('Indica el subproyecto de destino con su identificador.');
        const destination = scopeOf(d.patch as { subprojectId?: string }) || GENERAL_SCOPE;
        if (!effectiveGrantScopes(g, s.records).includes(destination))
          throw Error('El ámbito de destino no está autorizado en esta sesión.');
      }
    }
    const duplicate = s.proposals.find(
      (proposal) =>
        proposal.status === 'pending' &&
        proposal.provider === g.provider &&
        proposal.operation === d.operation &&
        proposal.kind === d.kind &&
        proposal.targetId === d.targetId &&
        (proposal.expectedVersion === d.expectedVersion ||
          (proposal.previousTaskState !== undefined &&
            proposal.expectedVersion === (d.expectedVersion ?? 0) + 1)) &&
        sameProposalValue(proposal.patch, d.patch),
    );
    if (
      duplicate &&
      (d.operation === 'create' ||
        shares.some((share) => share.recordId === d.targetId) ||
        (g.scope === 'selected' &&
          s.shares.some(
            (share) =>
              g.shareIds.includes(share.id) &&
              share.provider === g.provider &&
              share.recordId === d.targetId,
          )))
    )
      return {
        id: duplicate.id,
        status: duplicate.status,
        ...(duplicate.kind === 'task'
          ? { asvs: taskAsvsContext(s, g, duplicate.projectId!, duplicate.targetId) }
          : {}),
      };
    if (
      d.operation !== 'create' &&
      (!d.targetId ||
        !shares.some((sh) => sh.recordId === d.targetId && sh.recordVersion === d.expectedVersion))
    )
      throw Error('Registro o versión no autorizados.');
    if (d.targetId && s.records.find((r) => r.id === d.targetId)?.kind !== d.kind)
      throw Error('Tipo inválido.');
    if (
      d.kind === 'task' &&
      d.operation === 'update' &&
      d.patch.state === 'Completada' &&
      s.proposals.some(
        (proposal) =>
          proposal.status === 'pending' &&
          proposal.targetId === d.targetId &&
          proposal.patch.state === 'Completada',
      )
    )
      throw Error('Ya hay una propuesta de cierre pendiente para esta tarea.');
    if (
      'asvsLinks' in d.patch &&
      (d.kind !== 'task' || d.operation === 'check' || g.scope !== 'projects')
    )
      throw Error('Las asociaciones ASVS requieren una tarea y una sesión de proyecto.');
    if (Array.isArray(d.patch.asvsLinks)) {
      const proposedLinks = d.patch.asvsLinks;
      const old = s.records.find((r): r is Task => r.kind === 'task' && r.id === d.targetId);
      if (d.patch.asvsLinks.some((link) => link && typeof link === 'object' && 'mandatory' in link))
        throw Error('La obligatoriedad ASVS solo la decide la persona.');
      if (
        old?.asvsLinks?.some(
          (link) =>
            link.mandatory &&
            !proposedLinks.some(
              (candidate: unknown) =>
                candidate &&
                typeof candidate === 'object' &&
                'reqId' in candidate &&
                'catalogVersion' in candidate &&
                candidate.reqId === link.reqId &&
                candidate.catalogVersion === link.catalogVersion,
            ),
        )
      )
        throw Error('Una propuesta MCP no puede retirar requisitos ASVS obligatorios.');
      d.patch.asvsLinks = d.patch.asvsLinks.map((link) => {
        const previous = old?.asvsLinks?.find(
          (l) => l.reqId === link.reqId && l.catalogVersion === link.catalogVersion,
        );
        return previous?.mandatory ? { ...link, mandatory: true } : link;
      });
    }
    const forbidden = [
      'id',
      'version',
      'createdAt',
      'updatedAt',
      'checks',
      'completedAt',
      'recurrence',
      'closedAt',
      'sourceIds',
      'taskIds',
      'linkedIds',
      'validationDate',
      'validationReference',
      'tutor',
    ];
    if (
      Object.keys(d.patch).some(
        (k) =>
          forbidden.includes(k) ||
          (k === 'project' && d.operation !== 'create') ||
          (k === 'subprojectId' && d.operation !== 'create') ||
          (k === 'dependencyIds' && d.kind !== 'task'),
      )
    )
      throw Error('El cambio incluye campos reservados a revisión humana.');
    if (d.operation === 'create' && ['task', 'idea', 'incident'].includes(d.kind)) {
      const required =
        d.kind === 'task'
          ? ['title', 'project', 'phase', 'priority', 'due', 'description', 'nextStep']
          : ['title', 'project', 'date', 'description'];
      if (required.some((field) => typeof d.patch[field] !== 'string' || !d.patch[field].trim()))
        throw Error(`La propuesta de ${d.kind} necesita ${required.join(', ')} explícitos.`);
    }
    if (d.kind === 'task' && 'dependencyIds' in d.patch) {
      if (!Array.isArray(d.patch.dependencyIds))
        throw Error('Las dependencias deben indicarse en una lista de identificadores.');
      const projectId =
        d.operation === 'create' ? (d.patch.project as string | undefined) : target?.project;
      const visibleIds = new Set(shares.map((share) => share.recordId));
      for (const depId of d.patch.dependencyIds) {
        if (typeof depId !== 'string') throw Error('Identificador de dependencia inválido.');
        if (!visibleIds.has(depId))
          throw Error('Una tarea de la que depende no está autorizada en esta sesión.');
        const depRecord = s.records.find((r) => r.id === depId);
        if (!depRecord || depRecord.kind !== 'task')
          throw Error('Una tarea de la que depende ya no existe.');
        if (projectId !== undefined && depRecord.project !== projectId)
          throw Error('Una tarea de la que depende pertenece a otro proyecto.');
      }
    }
    if (
      d.kind === 'practice' &&
      Object.keys(d.patch).some((k) =>
        ['status', 'mandatory', 'pinned', 'owner', 'source'].includes(k),
      )
    )
      throw Error('La IA no puede establecer autoridad de una práctica.');
    if (
      'attachments' in d.patch &&
      (d.operation !== 'create' ||
        !['task', 'incident', 'idea', 'decision', 'meeting'].includes(d.kind))
    )
      throw Error('Los adjuntos solo se pueden proponer al crear estos registros.');
    let patch = { ...d.patch };
    if ('attachments' in patch) patch.attachments = normalizeAttachments(patch.attachments);
    let entryMentionIds: EntryMentionIds | undefined;
    if (d.kind === 'entry') {
      const projectId = d.operation === 'create' ? d.patch.project : target?.project;
      const origin = d.operation === 'create' ? (d.patch as { subprojectId?: string }) : target;
      const visibleIds = new Set(shares.map((share) => share.recordId));
      const records = s.records.filter(
        (record) =>
          record.project === projectId &&
          visibleIds.has(record.id) &&
          sameScope(record, origin ?? {}),
      );
      const resolved = resolveEntryMentions(d.patch, records);
      patch = resolved.entry;
      entryMentionIds = { taskIds: resolved.taskIds, linkedIds: resolved.linkedIds };
    }
    if (d.operation === 'check') {
      if (d.kind !== 'task') throw Error('Verificación inválida.');
      const t = s.records.find((r): r is Task => r.id === d.targetId && r.kind === 'task');
      if (!t) throw Error('Tarea no disponible.');
      const c = this.validateProposedCheck(s, t, patch);
      if (!shares.some((sh) => sh.recordId === c.practiceId))
        throw Error('Criterio no autorizado.');
    } else {
      const before = s.records.find((r) => r.id === d.targetId);
      let candidate: Record<string, unknown> = { ...(before || blank(d.kind)), ...patch };
      if (entryMentionIds) candidate = includeEntryMentionIds(candidate, entryMentionIds);
      if (d.kind === 'practice') {
        candidate.status = 'Borrador';
        candidate.mandatory = false;
        candidate.pinned = false;
      }
      if (
        before?.kind === 'task' &&
        d.operation === 'update' &&
        patch.state === 'Completada' &&
        before.checks.some((check) => check.mandatory && unresolved(check)) &&
        before.checks
          .filter((check) => check.mandatory && unresolved(check))
          .every((check) =>
            s.proposals.some(
              (proposal) =>
                proposal.status === 'pending' &&
                proposal.operation === 'check' &&
                proposal.targetId === before.id &&
                proposal.patch.practiceId === check.practiceId &&
                proposal.patch.state === 'Cumplido',
            ),
          )
      ) {
        // The pending checks are validated again when the review applies the closure.
        candidate = { ...candidate, state: 'En revisión' };
      }
      // Closure proposals are drafts; all conditions are enforced against the final batch.
      if (d.kind === 'task' && d.operation === 'update' && patch.state === 'Completada')
        candidate = { ...candidate, state: 'En revisión' };
      const normalized = this.normalize(d.kind, candidate as Record<string, unknown>, before);
      if (normalized.kind === 'task' && 'asvsLinks' in patch)
        patch.asvsLinks = normalized.asvsLinks;
    }
    const normalizedDuplicate = s.proposals.find(
      (proposal) =>
        proposal.status === 'pending' &&
        proposal.provider === g.provider &&
        proposal.operation === d.operation &&
        proposal.kind === d.kind &&
        proposal.targetId === d.targetId &&
        proposal.expectedVersion === d.expectedVersion &&
        sameProposalValue(proposal.patch, patch),
    );
    if (normalizedDuplicate)
      return {
        id: normalizedDuplicate.id,
        status: normalizedDuplicate.status,
        ...(normalizedDuplicate.kind === 'task'
          ? {
              asvs: taskAsvsContext(
                s,
                g,
                normalizedDuplicate.projectId!,
                normalizedDuplicate.targetId,
              ),
            }
          : {}),
      };
    return this.transaction(() => {
      const p: Proposal = {
        ...d,
        patch,
        ...(entryMentionIds && { entryMentionIds }),
        id: randomUUID(),
        provider: g.provider,
        projectId:
          d.operation === 'create'
            ? String(d.patch.project || '')
            : target?.kind === 'project'
              ? target.id
              : target?.project,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      if (
        p.kind === 'task' &&
        p.operation === 'update' &&
        p.patch.state === 'Completada' &&
        target?.kind === 'task' &&
        target.state !== 'Completada'
      ) {
        p.previousTaskState = target.state;
        const reviewing = this.write(
          'task',
          { ...target, state: 'En revisión' },
          target.id,
          target.version,
          `Propuesta de ${g.provider} pendiente`,
        );
        p.expectedVersion = reviewing.version;
      }
      s.proposals.unshift(p);
      return {
        id: p.id,
        status: p.status,
        ...(p.kind === 'task' ? { asvs: taskAsvsContext(s, g, p.projectId!, p.targetId) } : {}),
      };
    });
  }
  proposalStatus(g: Grant) {
    const state = this.require();
    const visibleIds = new Set(this.visible(g).map((share) => share.recordId));
    const grantedIds = new Set(
      state.shares
        .filter((share) => g.shareIds.includes(share.id) && share.provider === g.provider)
        .map((share) => share.recordId),
    );
    const scopes = effectiveGrantScopes(g, state.records);
    const general = g.scope === 'projects' && scopes.includes(GENERAL_SCOPE);
    const statuses = state.proposals
      .filter(
        (p) =>
          p.provider === g.provider &&
          (g.scope === 'projects'
            ? !!p.projectId &&
              g.projectIds.includes(p.projectId) &&
              (p.targetId
                ? visibleIds.has(p.targetId)
                : scopes.includes(scopeOf(p.patch as { subprojectId?: string }) || GENERAL_SCOPE))
            : !p.targetId || visibleIds.has(p.targetId) || grantedIds.has(p.targetId)),
      )
      .slice(0, 20)
      .map((p) => ({ id: p.id, status: p.status, createdAt: p.createdAt }));
    return [
      ...statuses,
      ...(state.asvs?.proposals ?? [])
        .filter(
          (p) =>
            p.provider === g.provider &&
            g.scope === 'projects' &&
            g.projectIds.includes(p.request.projectId) &&
            (p.request.taskId ? visibleIds.has(p.request.taskId) : general),
        )
        .map((p) => ({ id: p.id, status: p.status, createdAt: p.createdAt })),
      ...(state.asvs?.revisionProposals ?? [])
        .filter(
          (p) => p.provider === g.provider && general && g.projectIds.includes(p.request.projectId),
        )
        .map((p) => ({ id: p.id, status: p.status, createdAt: p.createdAt })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }
  completeTask(g: Grant, input: unknown) {
    if (Date.parse(g.expiresAt) <= Date.now()) throw Error('Sesión MCP caducada.');
    if (g.canCompleteTasks !== true || g.scope !== 'projects')
      throw Error('La sesión no permite completar tareas sin revisión.');
    const { taskId, closureId, checkIds, asvsIds } = z
      .object({
        taskId: short,
        closureId: short,
        checkIds: z.array(short).max(100),
        asvsIds: z.array(short).max(50).default([]),
      })
      .strict()
      .parse(input);
    const s = this.require();
    const task = s.records.find((r): r is Task => r.kind === 'task' && r.id === taskId);
    if (!task || !grantSees(g, task, s.records) || task.state === 'Completada')
      throw Error('Tarea no autorizada o ya completada.');
    if (new Set(checkIds).size !== checkIds.length) throw Error('Hay una verificación repetida.');
    const proposals = [closureId, ...checkIds].map((id) => s.proposals.find((p) => p.id === id));
    const [closure, ...checks] = proposals;
    if (
      !closure ||
      closure.status !== 'pending' ||
      closure.provider !== g.provider ||
      closure.kind !== 'task' ||
      closure.operation !== 'update' ||
      closure.targetId !== taskId ||
      closure.patch.state !== 'Completada' ||
      typeof closure.patch.solution !== 'string' ||
      !closure.patch.solution.trim() ||
      Object.keys(closure.patch).some((key) => !['state', 'solution'].includes(key))
    )
      throw Error('La propuesta de cierre no es apta para aceptación automática.');
    const fulfilled = new Set(
      task.checks
        .filter((check) => check.state === 'Cumplido' && check.note.trim())
        .map((check) => check.practiceId),
    );
    for (const proposal of checks) {
      if (
        !proposal ||
        proposal.status !== 'pending' ||
        proposal.provider !== g.provider ||
        proposal.kind !== 'task' ||
        proposal.operation !== 'check' ||
        proposal.targetId !== taskId ||
        proposal.patch.state !== 'Cumplido'
      )
        throw Error('Verificación no apta para aceptación automática.');
      const check = this.validateProposedCheck(s, task, proposal.patch);
      if (fulfilled.has(check.practiceId)) throw Error('Criterio repetido o ya verificado.');
      fulfilled.add(check.practiceId);
    }
    if (task.checks.some((check) => !fulfilled.has(check.practiceId)))
      throw Error('Faltan evidencias de criterios asociados a la tarea.');
    this.validateTaskAsvsBatch([closureId], asvsIds, g.provider);
    return this.reviewBatch([closureId, ...checkIds], true, asvsIds, true);
  }
  private applyReview(
    s: Snapshot,
    p: Proposal,
    accept: boolean,
    expectedVersion = p.expectedVersion,
  ) {
    if (!accept) {
      p.status = 'rejected';
      const task = s.records.find(
        (record): record is Task => record.kind === 'task' && record.id === p.targetId,
      );
      if (
        p.previousTaskState &&
        task?.state === 'En revisión' &&
        task.version === p.expectedVersion &&
        !s.proposals.some(
          (other) =>
            other.id !== p.id &&
            other.status === 'pending' &&
            other.targetId === task.id &&
            other.patch.state === 'Completada',
        )
      )
        this.write(
          'task',
          { ...task, state: p.previousTaskState },
          task.id,
          task.version,
          'Propuesta rechazada',
        );
      return p;
    }
    const before = s.records.find((r) => r.id === p.targetId);
    let data = { ...(before || blank(p.kind)), ...p.patch } as Record<string, unknown>;
    if (p.kind === 'entry' && p.entryMentionIds) {
      const mentionedIds = [...p.entryMentionIds.taskIds, ...p.entryMentionIds.linkedIds];
      if (
        mentionedIds.some(
          (id) => !s.records.some((record) => record.id === id && record.project === p.projectId),
        )
      )
        throw Error('Un registro mencionado ya no pertenece al proyecto de la entrada.');
      data = includeEntryMentionIds(data, p.entryMentionIds);
    }
    if (p.kind === 'task' && Array.isArray(p.patch.dependencyIds)) {
      const taskProject =
        p.operation === 'create' ? String(p.patch.project || '') : before?.project || p.projectId;
      for (const depId of p.patch.dependencyIds) {
        const depRecord = s.records.find((r) => r.id === depId);
        if (!depRecord || depRecord.kind !== 'task')
          throw Error('Una tarea de la que depende ya no existe.');
        if (taskProject !== undefined && depRecord.project !== taskProject)
          throw Error('Una tarea de la que depende pertenece a otro proyecto.');
      }
    }
    if (p.operation === 'check') {
      if (!before || before.kind !== 'task') throw Error('Tarea no disponible.');
      this.validateProposedCheck(s, before, p.patch);
      data = {
        ...before,
        checks: before.checks.map((c) =>
          c.practiceId === p.patch.practiceId
            ? { ...c, state: p.patch.state, note: p.patch.note }
            : c,
        ),
      };
    }
    if (p.kind === 'practice') {
      data.status = 'Borrador';
      data.mandatory = false;
      data.pinned = false;
    }
    this.write(
      p.kind,
      data,
      p.operation === 'create' ? undefined : p.targetId,
      expectedVersion,
      `Propuesta de ${p.provider} revisada`,
    );
    p.status = 'accepted';
    return p;
  }
  review(id: string, accept: boolean) {
    return this.transaction(() => {
      const s = this.require(),
        p = s.proposals.find((p) => p.id === id);
      if (!p || p.status !== 'pending') throw Error('Propuesta no disponible.');
      return this.applyReview(s, p, accept);
    });
  }
  private validateTaskAsvsBatch(ids: string[], asvsIds: string[], provider?: Provider) {
    const state = this.require();
    if (new Set(asvsIds).size !== asvsIds.length) throw Error('Verificación ASVS repetida.');
    for (const id of asvsIds) {
      const p = state.asvs?.proposals?.find((p) => p.id === id && p.status === 'pending');
      const closure = state.proposals.find(
        (c) =>
          ids.includes(c.id) &&
          c.status === 'pending' &&
          c.kind === 'task' &&
          c.patch.state === 'Completada' &&
          c.targetId === p?.request.taskId,
      );
      if (
        !p ||
        p.destination !== 'task' ||
        !closure ||
        p.provider !== closure.provider ||
        (provider && (p.provider !== provider || p.request.state !== 'Cumplido'))
      )
        throw Error('Verificación ASVS no apta para el lote de cierre.');
    }
  }
  reviewBatch(ids: string[], accept: boolean, asvsIds: string[] = [], autonomous = false) {
    if (!Array.isArray(ids) || !ids.length) throw Error('Selecciona propuestas para revisar.');
    if (new Set(ids).size !== ids.length) throw Error('Hay una propuesta repetida en el lote.');
    return this.transaction(() => {
      const s = this.require();
      const proposals = ids.map((id) => {
        const p = s.proposals.find((prop) => prop.id === id);
        if (!p || p.status !== 'pending') throw Error('Propuesta no disponible.');
        return p;
      });
      this.validateTaskAsvsBatch(ids, asvsIds);
      if (!accept && asvsIds.length)
        reviewAsvsProposals(s, { ids: asvsIds, accept: false }, this.activeProjectId);
      if (!accept) return proposals.map((p) => this.applyReview(s, p, false));
      const plan = planProposalReview(proposals, s.records);
      if (plan.conflicts.size)
        throw Error(`Conflicto en el lote: ${plan.conflicts.values().next().value}`);
      const projected = structuredClone(s);
      // Review ASVS before practice checks increment task versions, but against final content.
      for (const p of plan.ordered) {
        if (p.kind !== 'task' || p.operation !== 'update') continue;
        const task = projected.records.find(
          (r): r is Task => r.kind === 'task' && r.id === p.targetId,
        )!;
        Object.assign(task, p.patch);
        for (const id of asvsIds) {
          const verification = projected.asvs!.proposals!.find((a) => a.id === id)!;
          if (
            verification.request.taskId === task.id &&
            p.previousTaskState &&
            verification.request.expectedTaskVersion === task.version - 1
          )
            verification.request.expectedTaskVersion = task.version;
        }
      }
      if (asvsIds.length)
        reviewAsvsProposals(projected, { ids: asvsIds, accept: true }, this.activeProjectId);
      for (const p of plan.ordered) {
        if (p.kind === 'task' && p.operation === 'update' && p.patch.state === 'Completada') {
          const task = projected.records.find(
            (r): r is Task => r.kind === 'task' && r.id === p.targetId,
          )!;
          assertTaskAsvsClosure(projected, task, autonomous);
        }
      }
      s.asvs = projected.asvs;
      return plan.ordered.map((p) => {
        const current = p.targetId
          ? s.records.find((record) => record.id === p.targetId)
          : undefined;
        return this.applyReview(s, p, true, current?.version);
      });
    });
  }
}
