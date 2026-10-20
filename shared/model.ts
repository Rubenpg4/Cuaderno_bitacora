import { objectiveCoverage } from './objectiveCoverage.js';

export const STATES = ['Por hacer', 'En curso', 'En revisión', 'Completada'] as const;
export const PRIORITIES = ['Crítica', 'Muy alta', 'Alta', 'Media', 'Baja', 'Muy baja'] as const;
export const CATEGORIES = [
  'Seguridad y privacidad',
  'Organización',
  'Costes y recursos',
  'Calidad técnica',
] as const;
export const PRACTICE_STATES = [
  'Borrador',
  'Recomendación personal',
  'Política de empresa confirmada',
  'Retirada',
] as const;
export const CHECK_STATES = [
  'Pendiente',
  'Cumplido',
  'No cumplido',
  'No aplicable',
  'Requiere consulta',
] as const;
export const PHASES = [
  'Descubrimiento',
  'Diseño',
  'Implementación',
  'Validación',
  'Documentación',
] as const;
export type Kind =
  | 'task'
  | 'entry'
  | 'incident'
  | 'idea'
  | 'practice'
  | 'decision'
  | 'meeting'
  | 'project'
  | 'subproject'
  | 'objective';
export type Provider = 'claude' | 'codex' | 'antigravity';
export type McpProfile = 'personal' | 'corporativo';
export interface Base {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  project: string;
  /** Subproyecto propietario; vacío significa «General del proyecto». */
  subprojectId?: string;
}
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: string;
}
export interface Practice extends Base {
  kind: 'practice';
  category: (typeof CATEGORIES)[number];
  explanation: string;
  source: string;
  owner: string;
  status: (typeof PRACTICE_STATES)[number];
  mandatory: boolean;
  pinned: boolean;
  phases: string[];
  tags: string[];
}
export interface Check {
  practiceId: string;
  practiceVersion: number;
  title: string;
  explanation: string;
  source: string;
  mandatory: boolean;
  state: (typeof CHECK_STATES)[number];
  note: string;
  authorization: string;
  exceptionReason: string;
}
export interface Task extends Base {
  kind: 'task';
  attachments?: Attachment[];
  phase: string;
  type: string;
  tags: string[];
  priority: (typeof PRIORITIES)[number];
  state: (typeof STATES)[number];
  due: string;
  blocked: string;
  nextStep: string;
  description: string;
  solution: string;
  dependencyIds: string[];
  checks: Check[];
  asvsLinks?: import('./asvsTracking.js').AsvsTaskLink[];
  completedAt?: string;
  recurrence?: {
    seriesId: string;
    occurrenceDate: string;
    canceledAt?: string;
    cancellationReason?: 'rule' | 'manual';
    overriddenFields: string[];
  };
}
export interface TaskSeries extends Base {
  rule: import('./recurrence.js').RecurrenceRule;
  template: Pick<
    Task,
    | 'title'
    | 'phase'
    | 'type'
    | 'tags'
    | 'priority'
    | 'blocked'
    | 'nextStep'
    | 'description'
    | 'dependencyIds'
  >;
  practiceIds: string[];
  generatedThrough?: string;
  stoppedAt?: string;
  archivedAt?: string;
}
export interface Entry extends Base {
  kind: 'entry';
  daily?: boolean;
  date: string;
  taskIds: string[];
  linkedIds?: string[];
  activity: string;
  result: string;
  learning: string;
  nextStep: string;
  blocker: string;
  competency: string;
  evidence: string;
  original: string;
  contribution: 'Investigué' | 'Propuse' | 'Implementé' | 'Validé';
}
export interface Incident extends Base {
  kind: 'incident';
  attachments?: Attachment[];
  date: string;
  description: string;
  solution: string;
  resolvedDate: string;
}
export interface Decision extends Base {
  kind: 'decision';
  attachments?: Attachment[];
  date: string;
  problem: string;
  alternatives: string;
  decision: string;
  reason: string;
  consequences: string;
  evidence: string;
}
export interface Idea extends Base {
  kind: 'idea';
  attachments?: Attachment[];
  date: string;
  description: string;
}
export interface Meeting extends Base {
  kind: 'meeting';
  attachments?: Attachment[];
  from: string;
  to: string;
  body: string;
  agreements: string;
  agreementItems?: AgreementItem[];
  sourceIds: string[];
  closedAt?: string;
}
export interface AgreementItem {
  id: string;
  text: string;
  requiresFollowUp: boolean;
  followUpTaskId?: string;
}
export interface WeeklyReviewBaseline {
  at: string;
  day: string;
  recordIds: string[];
  tasks: {
    id: string;
    state: Task['state'];
    completedAt?: string;
    resultEntryIds: string[];
  }[];
}
export interface WeeklyReviewDecision {
  key: string;
  cause: string;
  mode: 'dismissed' | 'postponed';
  until?: string;
}
export interface WeeklyReviewState {
  version: number;
  baseline?: WeeklyReviewBaseline;
  decisions: WeeklyReviewDecision[];
}
export interface Project extends Base {
  kind: 'project';
  objective: string;
  specifications: string;
  competency: string;
  tutor: string;
  validationDate: string;
  validationReference: string;
}
export const SUBPROJECT_STATES = ['Activo', 'Archivado'] as const;
export interface Subproject extends Base {
  kind: 'subproject';
  description: string;
  status: (typeof SUBPROJECT_STATES)[number];
  archivedAt?: string;
}
export interface ObjectiveLink {
  id: string;
  sourceKind: 'task' | 'entry';
  sourceId: string;
  role: 'trabajo' | 'resultado' | 'evidencia';
  reference: string;
}
export interface Objective extends Base {
  kind: 'objective';
  description: string;
  links: ObjectiveLink[];
  validation: {
    state: 'Pendiente' | 'Validado';
    date: string;
    reference: string;
    responsible: string;
    linkIds: string[];
  };
}
export type RecordItem =
  Task | Entry | Incident | Idea | Practice | Decision | Meeting | Project | Subproject | Objective;
export interface QuickCapture {
  id: string;
  project: string;
  version: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  linkedRecordId?: string;
  convertedRecordId?: string;
  convertedKind?: 'entry' | 'incident' | 'decision' | 'idea';
}
export interface Share {
  id: string;
  recordId: string;
  provider: Provider;
  title: string;
  excerpt: string;
  recordVersion: number;
  approvedAt: string;
}
export interface Proposal {
  id: string;
  provider: Provider;
  operation: 'create' | 'update' | 'check' | 'delete';
  kind: Kind;
  targetId?: string;
  projectId?: string;
  /** Ámbito del registro cuya eliminación se propone; lo conserva tras borrarlo. */
  targetScope?: string;
  expectedVersion?: number;
  previousTaskState?: Task['state'];
  patch: Record<string, unknown>;
  entryMentionIds?: { taskIds: string[]; linkedIds: string[] };
  /** Meeting sources resolved from `@` mentions; acceptance adds them to `sourceIds`. */
  meetingSourceIds?: string[];
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}
export interface History {
  id: string;
  recordId: string;
  at: string;
  actor: string;
  before: RecordItem | null;
  after: RecordItem;
}
export interface GrantInfo {
  id: string;
  provider: Provider;
  expiresAt: string;
  shareIds: string[];
  scope: 'selected' | 'projects';
  projectIds: string[];
  /** Ámbitos autorizados: `general` y/o IDs de subproyectos activos. */
  scopes?: string[];
  canCompleteTasks?: boolean;
  /** Last authorized MCP call and its tool; never its parameters or content. */
  lastUsedAt?: string;
  lastTool?: string;
}
export interface Snapshot {
  asvs?: import('./asvsTracking.js').AsvsData;
  recurrenceWarning?: string;
  mcpProfile: McpProfile;
  mcpProfileVersion: number;
  /** 1 once the vault uses subproject scopes and earlier MCP excerpts were revoked. */
  subprojectModel?: 1;
  records: RecordItem[];
  weeklyReview?: WeeklyReviewState;
  captures?: QuickCapture[];
  drafts?: Record<string, Record<string, unknown>>;
  shares: Share[];
  proposals: Proposal[];
  history: History[];
  taskSeries?: TaskSeries[];
  taskSeriesHistory?: {
    id: string;
    seriesId: string;
    at: string;
    before: TaskSeries | null;
    after: TaskSeries;
  }[];
  grants: GrantInfo[];
  settings: { companyAuthorized: boolean; universityStructure: string };
  /** Bloqueo por inactividad elegido; sin valor, `DEFAULT_IDLE_LOCK`. */
  idleLock?: IdleLock;
}
/** Minutes without activity before the notebook locks; `never` waits for a manual lock or close. */
export const IDLE_LOCK_OPTIONS = [5, 15, 30, 60, 120, 240, 480, 'never'] as const;
export type IdleLock = (typeof IDLE_LOCK_OPTIONS)[number];
export const DEFAULT_IDLE_LOCK: IdleLock = 15;
export const isIdleLock = (value: unknown): value is IdleLock =>
  IDLE_LOCK_OPTIONS.includes(value as IdleLock);
export interface WorkspaceStatus {
  exists: boolean;
  unlocked: boolean;
  activeProjectId: string | null;
  projects: { id: string; title: string }[];
}
export function madridDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
export function taskDateLabel(day: string) {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function daysUntil(day: string, today = madridDate()) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
export function upcomingDateLabel(day: string, today = madridDate()) {
  const diff = daysUntil(day, today);
  if (diff === 0) return 'Para hoy';
  if (diff === 1) return 'Para mañana';
  const d = new Date(`${day}T12:00:00`);
  const todayDate = new Date(`${today}T12:00:00`);
  const weekday = d.toLocaleDateString('es-ES', { weekday: 'long' });
  const dayNum = d.getDate();
  const month = d.toLocaleDateString('es-ES', { month: 'short' }).replace(/\.?$/, '') + '.';
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  if (d.getFullYear() !== todayDate.getFullYear()) {
    return `${capitalizedWeekday} ${dayNum} de ${month} de ${d.getFullYear()}`;
  }
  return `${capitalizedWeekday} ${dayNum} de ${month}`;
}
export function validDay(day: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
  );
}
export function applicable(p: Practice, t: Task) {
  return (
    p.status !== 'Retirada' &&
    p.status !== 'Borrador' &&
    (!p.project || p.project === t.project) &&
    (!p.subprojectId || p.subprojectId === t.subprojectId) &&
    (!p.phases.length || p.phases.includes(t.phase)) &&
    (!p.tags.length || p.tags.some((tag) => t.tags.includes(tag) || tag === t.type))
  );
}
export function snapshotCheck(p: Practice): Check {
  return {
    practiceId: p.id,
    practiceVersion: p.version,
    title: p.title,
    explanation: p.explanation,
    source: p.source,
    mandatory: p.mandatory,
    state: 'Pendiente',
    note: '',
    authorization: '',
    exceptionReason: '',
  };
}
export function unresolved(c: Check) {
  return (
    (c.state === 'Pendiente' || c.state === 'No cumplido' || c.state === 'Requiere consulta') &&
    !(c.exceptionReason.trim() && c.authorization.trim())
  );
}
export function staleChecks(t: Task, practices: Practice[]) {
  const activePractices = practices.filter(
    (p) => p.status !== 'Retirada' && p.status !== 'Borrador',
  );
  return (
    t.state !== 'Completada' &&
    (t.checks.some((c) =>
      activePractices.some((p) => p.id === c.practiceId && p.version !== c.practiceVersion),
    ) ||
      t.checks.some((c) =>
        practices.some(
          (p) => p.id === c.practiceId && (p.status === 'Borrador' || p.status === 'Retirada'),
        ),
      ) ||
      activePractices.some((p) => applicable(p, t) && !t.checks.some((c) => c.practiceId === p.id)))
  );
}
export function reportStart(records: RecordItem[]) {
  const last = records
    .filter((r): r is Meeting => r.kind === 'meeting' && !!r.closedAt)
    .sort((a, b) => b.to.localeCompare(a.to))[0];
  return last?.to ?? new Date(Date.now() - 7 * 86400000).toISOString();
}
export const ENTRY_MENTION_PATTERN = /@\[(task|incident|decision|idea):([\w-]+)\]/g;

export function mentionSummaryText(value: string, records: RecordItem[]) {
  return value.replace(ENTRY_MENTION_PATTERN, (_, kind: string, id: string) => {
    const record = records.find((item) => item.id === id && item.kind === kind);
    return `@${record?.title || 'Registro eliminado'}`;
  });
}

export function weeklyReport(records: RecordItem[], from: string, to: string) {
  const inRange = (s: string) => s > from && s <= to;
  const entries = records.filter(
    (r): r is Entry =>
      r.kind === 'entry' &&
      r.date >= madridDate(new Date(from)) &&
      r.date <= madridDate(new Date(to)) &&
      inRange(r.createdAt),
  );
  const tasks = records.filter(
    (r): r is Task =>
      r.kind === 'task' && !r.recurrence?.canceledAt && (inRange(r.updatedAt) || !!r.blocked),
  );
  const decisions = records.filter(
    (r): r is Decision => r.kind === 'decision' && inRange(r.createdAt),
  );
  const checks = tasks.flatMap((t) =>
    t.checks
      .filter((c) => c.state === 'Requiere consulta')
      .map((c) => `- ${t.title}: ${c.title}. ${c.note} [${t.id}]`),
  );
  return {
    sourceIds: [...new Set([...entries, ...tasks, ...decisions].map((r) => r.id))],
    body: [
      `# Reunión del martes`,
      `${new Date(from).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} — ${new Date(to).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
      '## Avances',
      ...entries.map(
        (e) => `- ${e.title}: ${mentionSummaryText(e.result || e.activity, records)} [${e.id}]`,
      ),
      '## Bloqueos y ayuda necesaria',
      ...tasks
        .filter((t) => t.blocked)
        .map((t) => `- ${t.title}: ${t.blocked}. Siguiente paso: ${t.nextStep} [${t.id}]`),
      ...entries
        .filter((e) => e.blocker)
        .map((e) => `- ${mentionSummaryText(e.blocker, records)} [${e.id}]`),
      '## Consultas de calidad',
      ...checks,
      '## Decisiones',
      ...decisions.map((d) => `- ${d.title}: ${d.decision}. ${d.reason} [${d.id}]`),
      '## Próximos pasos',
      ...entries
        .filter((e) => e.nextStep)
        .map((e) => `- ${mentionSummaryText(e.nextStep, records)} [${e.id}]`),
    ].join('\n\n'),
  };
}
export function memoryReport(
  records: RecordItem[],
  structure = 'Objetivos, fases, aportaciones, resultados y aprendizajes',
) {
  const entries = records.filter((r): r is Entry => r.kind === 'entry');
  const projects = records.filter((r): r is Project => r.kind === 'project');
  const objectives = records.filter((r): r is Objective => r.kind === 'objective');
  return [
    '# Memoria de prácticas',
    `Estructura de referencia: ${structure}`,
    ...[...new Set(['', ...projects.map((p) => p.id), ...entries.map((e) => e.project)])]
      .map((id) => {
        const p = projects.find((p) => p.id === id);
        const es = entries.filter((e) => e.project === id);
        if (!p && !es.length) return '';
        const ds = records.filter((r): r is Decision => r.kind === 'decision' && r.project === id);
        const ts = records.filter(
          (r): r is Task => r.kind === 'task' && r.project === id && !r.recurrence?.canceledAt,
        );
        return [
          `## ${p?.title || 'Trabajo transversal'}`,
          p
            ? `Objetivo: ${p.objective}\n\n${p.specifications ? `Especificaciones: ${p.specifications}\n\n` : ''}Competencias: ${p.competency}\n\n${p.validationDate && p.validationReference ? `Validación registrada: ${p.tutor}, ${p.validationDate}. Referencia: ${p.validationReference}` : 'Validación del tutor: pendiente'}`
            : '',
          ...objectives
            .filter((objective) => objective.project === id)
            .map((objective) => {
              const coverage = objectiveCoverage(objective, records);
              return [
                `### Objetivo: ${objective.title} [${objective.id}]`,
                objective.description,
                `Validación del objetivo: ${objective.validation.state}.`,
                `Lagunas: ${coverage.gaps.join(', ') || 'ninguna registrada'}.`,
                ...coverage.links.map((link) => {
                  const source = records.find((record) => record.id === link.sourceId)!;
                  return `- ${link.role}: ${source.title} [${source.id}]${link.reference ? `. Referencia: ${link.reference}` : ''}`;
                }),
              ].join('\n\n');
            }),
          ...es.map(
            (e) =>
              `### ${e.date} · ${e.title}\n\n${e.contribution}: ${mentionSummaryText(e.activity, records)}\n\nResultado: ${mentionSummaryText(e.result, records)}\n\nAprendizaje: ${mentionSummaryText(e.learning, records)}\n\nCompetencia: ${e.competency}\n\nEvidencia: ${e.evidence || 'Pendiente de añadir'}\n\nReferencia: [${e.id}]`,
          ),
          ...ds.map(
            (d) =>
              `### Decisión: ${d.title}\n\nProblema: ${d.problem}\n\nAlternativas: ${d.alternatives}\n\nDecisión: ${d.decision}\n\nMotivo: ${d.reason}\n\nConsecuencias: ${d.consequences}\n\nEvidencia: ${d.evidence}\n\nReferencia: [${d.id}]`,
          ),
          '### Calidad aplicada',
          ...ts
            .filter((t) => t.checks.some((c) => c.state === 'Cumplido'))
            .map(
              (t) =>
                `- ${t.title}: ${t.checks.filter((c) => c.state === 'Cumplido').length} criterios declarados cumplidos. Referencia: [${t.id}]. El texto de políticas y notas internas se omite.`,
            ),
        ].join('\n\n');
      })
      .filter(Boolean),
  ].join('\n\n');
}

export function isIncidentResolved(incident: Incident): boolean {
  return Boolean(incident.solution?.trim() && incident.resolvedDate);
}

export function taskCompletionDay(task: Task): string | undefined {
  if (task.state !== 'Completada') return undefined;
  if (!task.completedAt) return task.due;
  if (validDay(task.completedAt)) return task.completedAt;
  const parsed = Date.parse(task.completedAt);
  if (Number.isNaN(parsed)) return task.due;
  return madridDate(new Date(parsed));
}

export function isTaskCompletedOnDay(task: Task, day: string): boolean {
  return task.state === 'Completada' && taskCompletionDay(task) === day;
}

export function areTaskDependenciesMet(task: Task, allTasks: Task[]): boolean {
  return task.dependencyIds.every((id) =>
    allTasks.some((dependency) => dependency.id === id && dependency.state === 'Completada'),
  );
}

export function resolveTaskMoveChange(
  task: Task,
  change: Partial<Pick<Task, 'state' | 'due'>>,
  activeDay: string,
  options?: {
    allTasks?: Task[];
    hasPendingCompletionProposal?: boolean;
  },
): Partial<Pick<Task, 'state' | 'due'>> {
  const nextChange = { ...change };
  if (change.due && !change.state) {
    if (task.state === 'En curso' && change.due !== activeDay && change.due >= madridDate()) {
      nextChange.state = 'Por hacer';
    } else if (
      task.state === 'Por hacer' &&
      (change.due === activeDay || change.due < madridDate())
    ) {
      const depsMet = options?.allTasks
        ? areTaskDependenciesMet(task, options.allTasks)
        : task.dependencyIds.length === 0;
      if (depsMet && !options?.hasPendingCompletionProposal) {
        nextChange.state = 'En curso';
      }
    }
  }
  return nextChange;
}
