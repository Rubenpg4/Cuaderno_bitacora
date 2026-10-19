import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  LockKeyhole,
  Database,
  Plug,
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  Clock3,
  Flag,
  MoreHorizontal,
  Folder,
  Download,
  Menu,
  X,
  FileText,
  AlertCircle,
  Lightbulb,
  Feather,
} from 'lucide-react';
import {
  madridDate,
  taskDateLabel,
  isTaskCompletedOnDay,
  weeklyReport,
  reportStart,
  memoryReport,
  isIncidentResolved,
  resolveTaskMoveChange,
  type Snapshot,
  type QuickCapture as CaptureNote,
  type McpProfile,
  type RecordItem,
  type Task,
  type Entry,
  type Incident,
  type Decision,
  type Idea,
  type Kind,
  type Meeting,
  type AgreementItem,
  type Project,
  type Objective,
  type Practice,
  type Proposal,
  type Subproject,
  type WorkspaceStatus,
} from '../shared/model';
import {
  GENERAL_SCOPE,
  findSubproject,
  inSelection,
  isArchivedScope,
  subprojectsOf,
  type ScopeSelection,
} from '../shared/subprojects';
import { api, getSnapshot, saveRecord } from './api';
import { Badge, Button, Empty, Field, Modal, Notice } from './ui';
import TodayTaskRow from './app/TodayTaskRow';
import { buildCalendarData } from './app/calendarData';
import {
  playProposalSound,
  readProposalSoundEnabled,
  saveProposalSoundEnabled,
} from './app/proposalSound';
import RecordEditor from './RecordEditor';
import CopyRecordId from './CopyRecordId';
import DailyComposer from './DailyComposer';
import { mentionSummaryText } from './EntryMentions';
import Assistants from './Assistants';
import Backup from './Backup';
import Export from './Export';
import LockScreen from './app/LockScreen';
import ProjectTree from './app/ProjectTree';
import SubprojectManager from './app/SubprojectManager';
import QuickCapture, { QuickCaptureButton } from './app/QuickCapture';
import ThemeToggle from './app/ThemeToggle';
import { kindNames, navigation, pageCopy } from './app/navigation';
import BoardView from './views/BoardView';
import TaskListView from './views/TaskListView';
import TaskSeriesManager from './views/TaskSeriesManager';
import DiaryView from './views/DiaryView';
import CalendarMonths from './views/CalendarMonths';
import DayDetails from './views/DayDetails';
import PracticesView from './views/PracticesView';
const AsvsView = lazy(() => import('./views/AsvsView'));
import TaskFilters from './views/TaskFilters';
import WeeklyReviewView from './views/WeeklyReviewView';
import { weeklyReview } from './weeklyReview';
import { visibleWeeklySignals, type WeeklySignal } from '../shared/weeklyReviewSignals';
import { objectiveCoverage } from '../shared/objectiveCoverage';
import {
  BOARD_FILTERS_KEY,
  LIST_FILTERS_KEY,
  TODAY_FILTERS_KEY,
  emptyTaskFilters,
  filterBoardTasks,
  filterTasks,
  nextRecurringTasks,
  readSavedFilters,
  saveFilters,
  type TaskFilters as TaskFiltersType,
  type BoardDateScope,
} from './taskFilters';
type Dialog =
  | {
      type: 'record';
      kind: Kind;
      record?: RecordItem;
      initial?: Record<string, unknown>;
      capture?: CaptureNote;
      followUp?: { meetingId: string; agreementId: string; meetingVersion: number };
      focusEvidence?: boolean;
      chooseScope?: boolean;
    }
  | { type: 'subprojects' }
  | { type: 'assistants'; proposalId?: string }
  | { type: 'backup' }
  | { type: 'export'; body: string };
type ProposalNotice = Pick<Proposal, 'id' | 'provider' | 'status' | 'createdAt'> & {
  title: string;
};
function proposalNotices(snapshot: Snapshot): ProposalNotice[] {
  return [
    ...snapshot.proposals.map((p) => ({
      ...p,
      title: String(
        p.patch.title ||
          snapshot.records.find((r) => r.id === p.targetId)?.title ||
          'Propuesta de cambios',
      ),
    })),
    ...(snapshot.asvs?.proposals ?? []).map((p) => ({ ...p, title: `ASVS ${p.reference}` })),
  ];
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [workspaceTitle, setWorkspaceTitle] = useState('');
  const [workspaceProfile, setWorkspaceProfile] = useState<McpProfile>('personal');
  const [view, rawSetView] = useState('Hoy');
  const [project, rawSetProject] = useState('');
  // Selected scope inside the unlocked notebook; it is discarded when locking or switching.
  const [scope, rawSetScope] = useState<ScopeSelection>('all');
  const [weeklySignalPage, setWeeklySignalPage] = useState<{
    projectId: string;
    signals: WeeklySignal[];
  }>();
  const [asvsReference, setAsvsReference] = useState('');
  const [day, rawSetDay] = useState(madridDate());
  const [selected, setSelected] = useState('');
  const [dialog, setDialog] = useState<Dialog>();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [newProposals, setNewProposals] = useState<ProposalNotice[]>([]);
  const [proposalSoundEnabled, setProposalSoundEnabled] = useState(readProposalSoundEnabled);
  const seenProposalIds = useRef<Set<string> | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [diaryType, setDiaryType] = useState<'entries' | 'incidents' | 'decisions' | 'ideas'>(
    'entries',
  );
  const [dailyComposerRevision, setDailyComposerRevision] = useState(0);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [detailDay, setDetailDay] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState('');
  const [draggedIncidentId, setDraggedIncidentId] = useState('');
  const [todayFilters, rawSetTodayFilters] = useState<TaskFiltersType>(() =>
    readSavedFilters(TODAY_FILTERS_KEY),
  );
  const [boardFilters, rawSetBoardFilters] = useState<TaskFiltersType>(() => ({
    ...readSavedFilters(BOARD_FILTERS_KEY),
    dueFrom: '',
    dueTo: '',
  }));
  const [listFilters, rawSetListFilters] = useState<TaskFiltersType>(() =>
    readSavedFilters(LIST_FILTERS_KEY),
  );
  const [boardDateScope, setBoardDateScope] = useState<BoardDateScope>('upcoming');
  const setTodayFilters = useCallback(
    (value: TaskFiltersType | ((prev: TaskFiltersType) => TaskFiltersType)) => {
      rawSetTodayFilters((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        saveFilters(TODAY_FILTERS_KEY, next);
        return next;
      });
    },
    [],
  );
  const setBoardFilters = useCallback(
    (value: TaskFiltersType | ((prev: TaskFiltersType) => TaskFiltersType)) => {
      rawSetBoardFilters((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        saveFilters(BOARD_FILTERS_KEY, { ...next, dueFrom: '', dueTo: '' });
        return next;
      });
    },
    [],
  );
  const setListFilters = useCallback(
    (value: TaskFiltersType | ((prev: TaskFiltersType) => TaskFiltersType)) => {
      rawSetListFilters((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        saveFilters(LIST_FILTERS_KEY, next);
        return next;
      });
    },
    [],
  );
  const movingTaskIds = useRef(new Set<string>());
  const syncingTodayTasks = useRef(false);
  const flushes = useRef(new Set<() => Promise<void>>());
  const registerFlush = useCallback((fn: () => Promise<void>) => {
    flushes.current.add(fn);
    return () => {
      flushes.current.delete(fn);
    };
  }, []);
  const flushAll = useCallback(async () => {
    await Promise.all([...flushes.current].map((flush) => flush()));
  }, []);
  async function flushBefore(fn: () => void) {
    try {
      await flushAll();
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function setView(v: string) {
    void flushBefore(() => rawSetView(v));
  }
  function setDay(v: string) {
    void flushBefore(() => rawSetDay(v));
  }
  function setScope(next: ScopeSelection) {
    void flushBefore(() => {
      rawSetScope(next);
      setSelected('');
    });
  }
  const close = useCallback(() => {
    void flushAll()
      .then(() => setDialog(undefined))
      .catch((e) => setError(e.message));
  }, [flushAll]);
  const refresh = useCallback(async () => {
    try {
      const s = await getSnapshot();
      setSnapshot(s);
      const current = await api<WorkspaceStatus>('status');
      setStatus(current);
      rawSetProject(current.activeProjectId || '');
    } catch (e) {
      const status = await api<WorkspaceStatus>('status');
      setStatus(status);
      if (!status.unlocked) {
        setSnapshot(undefined);
        rawSetScope('all');
        setDialog(undefined);
        setCaptureOpen(false);
      } else throw e;
    }
  }, []);
  useEffect(() => {
    void api<WorkspaceStatus>('status')
      .then((s) => {
        setStatus(s);
        setSelectedWorkspace(s.activeProjectId || s.projects[0]?.id || '');
        if (s.unlocked) void refresh();
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const id = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [!!snapshot, refresh]);
  useEffect(() => {
    if (!snapshot || view !== 'Revisión semanal' || !project) return;
    let disposed = false;
    void api<WeeklySignal[]>('weekly-signals')
      .then((signals) => {
        if (!disposed) setWeeklySignalPage({ projectId: project, signals });
      })
      .catch((cause) => {
        if (!disposed) setError((cause as Error).message);
      });
    return () => {
      disposed = true;
    };
  }, [snapshot, view, project]);
  useEffect(() => {
    if (!snapshot) {
      seenProposalIds.current = null;
      setNewProposals([]);
      return;
    }

    const seen = seenProposalIds.current;
    const proposals = proposalNotices(snapshot);
    if (!seen) {
      seenProposalIds.current = new Set(proposals.map((proposal) => proposal.id));
      return;
    }

    const additions = proposals
      .filter((proposal) => proposal.status === 'pending' && !seen.has(proposal.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    proposals.forEach((proposal) => seen.add(proposal.id));
    if (additions.length && proposalSoundEnabled) playProposalSound();
    setNewProposals((current) => [
      ...current.filter((proposal) =>
        proposals.some((item) => item.id === proposal.id && item.status === 'pending'),
      ),
      ...additions,
    ]);
  }, [snapshot, proposalSoundEnabled]);
  function toggleProposalSound() {
    const enabled = !proposalSoundEnabled;
    setProposalSoundEnabled(enabled);
    saveProposalSoundEnabled(enabled);
  }
  useEffect(() => {
    if (!snapshot || view !== 'Hoy' || syncingTodayTasks.current) return;
    // Only tasks of the selected, writable scope may be started or stopped from this view.
    const tasks = snapshot.records.filter(
      (record): record is Task =>
        record.kind === 'task' &&
        !record.recurrence?.canceledAt &&
        inSelection(record, scope) &&
        !isArchivedScope(snapshot.records, record),
    );
    const scoped = tasks.filter(
      (task) =>
        (!project || task.project === project) &&
        (!search ||
          `${task.title} ${task.description} ${task.solution}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
    const visibleTasks = filterTasks(scoped, todayFilters, tasks);
    const visibleReadyTodayTaskIds = new Set(
      visibleTasks
        .filter(
          (task) =>
            task.due === day &&
            task.state !== 'Completada' &&
            task.state !== 'En revisión' &&
            task.dependencyIds.every((id) =>
              tasks.some((dependency) => dependency.id === id && dependency.state === 'Completada'),
            ) &&
            !snapshot.proposals.some(
              (proposal) =>
                proposal.status === 'pending' &&
                proposal.targetId === task.id &&
                proposal.patch.state === 'Completada',
            ),
        )
        .map((task) => task.id),
    );

    const toStart = Array.from(visibleReadyTodayTaskIds).filter((id) => {
      const task = tasks.find((t) => t.id === id);
      return task && task.state !== 'En curso';
    });

    const projectTasks = tasks.filter((task) => !project || task.project === project);
    const toStop = projectTasks
      .filter(
        (task) =>
          task.state === 'En curso' &&
          task.due >= madridDate() &&
          !visibleReadyTodayTaskIds.has(task.id),
      )
      .map((task) => task.id);

    if (!toStart.length && !toStop.length) return;
    syncingTodayTasks.current = true;
    (async () => {
      if (toStop.length) await api('stop-today-tasks', { ids: toStop });
      if (toStart.length) await api('start-today-tasks', { day, ids: toStart });
    })()
      .then(refresh)
      .catch((error) => setError((error as Error).message))
      .finally(() => {
        syncingTodayTasks.current = false;
      });
  }, [snapshot, view, project, scope, search, todayFilters, day, refresh]);
  useEffect(() => {
    if (
      snapshot &&
      scope !== 'all' &&
      scope !== GENERAL_SCOPE &&
      !findSubproject(snapshot.records, scope)
    )
      rawSetScope('all');
  }, [snapshot, scope]);
  useEffect(() => {
    if (!snapshot) return;
    let last = 0;
    function activity() {
      if (Date.now() - last > 30000) {
        last = Date.now();
        void api('activity').catch(() => {});
      }
    }
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [!!snapshot]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && snapshot) {
        e.preventDefault();
        setView('Hoy');
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [snapshot]);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ]);
      unlisten = await listen('quick-capture', () => {
        if (snapshot) openCapture();
        else document.querySelector<HTMLInputElement>('.unlock-card input')?.focus();
      });
      if (disposed) unlisten();
      if (!(await invoke<boolean>('quick_capture_shortcut_available')))
        setError('El atajo Ctrl+Mayús+B no está disponible. Usa el botón Captura rápida.');
    })().catch(() => setError('No se pudo activar el atajo de captura rápida.'));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [!!snapshot]);
  function openCapture() {
    void flushBefore(() => {
      setDialog(undefined);
      setDetailDay('');
      setCaptureOpen(true);
    });
  }
  function convertCapture(capture: CaptureNote, kind: Kind) {
    const title = capture.text.trim().split('\n')[0].slice(0, 240);
    const content = capture.text;
    const initial = {
      project: capture.project,
      ...scopeDefaults(),
      title,
      ...(kind === 'entry'
        ? { activity: content, original: content }
        : kind === 'decision'
          ? { decision: content }
          : { description: content }),
    };
    setCaptureOpen(false);
    setDialog({ type: 'record', kind, initial, capture, chooseScope: scope === 'all' });
  }
  /** New records use the selected scope; «Todo el proyecto» asks for a destination. */
  function scopeDefaults(): { subprojectId?: string } {
    return scope !== 'all' && scope !== GENERAL_SCOPE ? { subprojectId: scope } : {};
  }
  async function unlock() {
    setError('');
    setBusy(true);
    try {
      const s = await api<Snapshot>('unlock', { projectId: selectedWorkspace, password });
      rawSetScope('all');
      setSnapshot(s);
      const current = await api<WorkspaceStatus>('status');
      setStatus(current);
      rawSetProject(current.activeProjectId || '');
      setSelectedWorkspace(current.activeProjectId || '');
      setPassword('');
      setRepeat('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createWorkspace() {
    setError('');
    if (password !== repeat) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      const s = await api<Snapshot>('create-project', {
        title: workspaceTitle,
        password,
        profile: workspaceProfile,
      });
      rawSetScope('all');
      setSnapshot(s);
      const current = await api<WorkspaceStatus>('status');
      setStatus(current);
      rawSetProject(current.activeProjectId || '');
      setSelectedWorkspace(current.activeProjectId || '');
      setWorkspaceTitle('');
      setWorkspaceProfile('personal');
      setPassword('');
      setRepeat('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeWorkspace() {
    setError('');
    setBusy(true);
    try {
      const current = await api<WorkspaceStatus>('remove-project', {
        projectId: selectedWorkspace,
        password,
        confirm: 'ELIMINAR',
      });
      setStatus(current);
      setSelectedWorkspace(current.projects[0]?.id || '');
      setPassword('');
      setRepeat('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function lock() {
    try {
      await flushAll();
      await api('lock');
      setSnapshot(undefined);
      rawSetScope('all');
      setStatus(await api<WorkspaceStatus>('status'));
      setDialog(undefined);
      setCaptureOpen(false);
      setDetailDay('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function openRecord(r: RecordItem, focusEvidence = false) {
    void flushBefore(() => {
      if (r.kind === 'task') {
        setSelected(r.id);
      }
      setDialog({ type: 'record', kind: r.kind, record: r, focusEvidence });
    });
  }
  async function deleteTask(task: Task) {
    if (
      !window.confirm(
        task.recurrence
          ? `¿Cancelar solo esta aparición de «${task.title}»? La serie continuará.`
          : `¿Borrar la tarea «${task.title}»? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setError('');
    try {
      await flushAll();
      await api('delete-task', { id: task.id, expectedVersion: task.version });
      if (selected === task.id) setSelected('');
      close();
      await refresh();
      setToast(task.recurrence ? 'Aparición cancelada.' : 'Tarea borrada.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteIncident(incident: Incident) {
    if (
      !window.confirm(
        `¿Borrar la incidencia «${incident.title}»? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setError('');
    try {
      await flushAll();
      await api('delete-incident', { id: incident.id, expectedVersion: incident.version });
      if (selected === incident.id) setSelected('');
      close();
      await refresh();
      setToast('Incidencia borrada.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteJournalRecord(record: Entry | Decision | Idea) {
    const label = { entry: 'entrada', decision: 'decisión', idea: 'idea' }[record.kind];
    if (!window.confirm(`¿Borrar la ${label} «${record.title}»? Esta acción no se puede deshacer.`))
      return;
    setError('');
    try {
      await flushAll();
      await api(`delete-${record.kind}`, { id: record.id, expectedVersion: record.version });
      await refresh();
      if (record.kind === 'entry') setDailyComposerRevision((revision) => revision + 1);
      setDialog(undefined);
      setToast(`${label[0].toUpperCase()}${label.slice(1)} borrada.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteMeeting(record: Meeting) {
    if (!window.confirm(`¿Borrar la reunión «${record.title}»? Esta acción no se puede deshacer.`))
      return;
    setError('');
    try {
      await flushAll();
      await api('delete-meeting', { id: record.id, expectedVersion: record.version });
      setDialog(undefined);
      await refresh();
      setToast('Reunión borrada.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deletePractice(record: Practice) {
    if (
      !window.confirm(
        `¿Borrar la política o criterio «${record.title}»? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setError('');
    try {
      await flushAll();
      await api('delete-practice', { id: record.id, expectedVersion: record.version });
      setDialog(undefined);
      await refresh();
      setToast('Política o criterio borrado.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteObjective(record: Objective) {
    if (!window.confirm(`¿Borrar el objetivo «${record.title}»? Esta acción no se puede deshacer.`))
      return;
    setError('');
    try {
      await flushAll();
      await api('delete-objective', { id: record.id, expectedVersion: record.version });
      setDialog(undefined);
      await refresh();
      setToast('Objetivo borrado.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function create(kind: Kind, initial: Record<string, unknown> = {}) {
    void flushBefore(() => {
      setDialog({
        type: 'record',
        kind,
        initial: {
          project,
          ...scopeDefaults(),
          ...(kind === 'task' ? { due: view === 'Hoy' ? day : madridDate() } : {}),
          ...initial,
        },
        chooseScope: scope === 'all',
      });
    });
  }
  function startFollowUp(meeting: Meeting, agreement: AgreementItem) {
    void flushBefore(() => {
      setDialog({
        type: 'record',
        kind: 'task',
        initial: {
          project: meeting.project,
          ...(meeting.subprojectId ? { subprojectId: meeting.subprojectId } : {}),
          due: madridDate(),
          title: `Dar seguimiento a ${agreement.text.slice(0, 200)}`,
          description: `Acuerdo de ${meeting.title}\n${agreement.text}`,
        },
        followUp: {
          meetingId: meeting.id,
          agreementId: agreement.id,
          meetingVersion: meeting.version,
        },
      });
    });
  }
  function createFollowUpFromSignal(signal: WeeklySignal) {
    const meeting = snapshot?.records.find((record) => record.id === signal.recordId);
    const agreement =
      meeting?.kind === 'meeting'
        ? meeting.agreementItems?.find((item) => item.id === signal.itemId)
        : undefined;
    if (meeting?.kind === 'meeting' && agreement) startFollowUp(meeting, agreement);
  }
  async function finishWeeklyReview() {
    await api('finish-weekly-review', { expectedVersion: snapshot?.weeklyReview?.version ?? 0 });
    await refresh();
    setToast('Revisión registrada.');
  }
  async function decideWeeklySignal(
    signal: WeeklySignal,
    mode: 'dismissed' | 'postponed',
    until?: string,
  ) {
    await api('decide-weekly-signal', {
      expectedVersion: snapshot?.weeklyReview?.version ?? 0,
      key: signal.key,
      cause: signal.cause,
      mode,
      until,
    });
    await refresh();
  }
  function startTaskDrag(event: DragEvent<HTMLElement>, task: Task) {
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(task.id);
  }
  async function moveTask(task: Task, change: Partial<Pick<Task, 'state' | 'due'>>) {
    if (movingTaskIds.current.has(task.id)) return;
    if (Object.entries(change).every(([key, value]) => task[key as 'state' | 'due'] === value))
      return;
    movingTaskIds.current.add(task.id);
    setDraggedTaskId('');
    setError('');
    try {
      const activeDay = view === 'Hoy' ? day : madridDate();
      const allTasks = snapshot?.records.filter((r): r is Task => r.kind === 'task') || [];
      const hasPendingCompletion = Boolean(
        snapshot?.proposals.some(
          (p) => p.status === 'pending' && p.targetId === task.id && p.patch.state === 'Completada',
        ),
      );
      const nextChange = resolveTaskMoveChange(task, change, activeDay, {
        allTasks,
        hasPendingCompletionProposal: hasPendingCompletion,
      });
      await saveRecord('task', { ...task, ...nextChange }, task);
      await refresh();
      setToast(
        change.due ? `Tarea movida al ${taskDateLabel(change.due)}.` : 'Estado actualizado.',
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      movingTaskIds.current.delete(task.id);
    }
  }
  async function updateReviewTask(task: Task, patch: Partial<Pick<Task, 'due' | 'nextStep'>>) {
    await saveRecord('task', { ...task, ...patch }, task);
    await refresh();
    setToast('Tarea actualizada.');
  }
  function startIncidentDrag(event: DragEvent<HTMLElement>, incident: Incident) {
    event.dataTransfer.setData('text/plain', incident.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedIncidentId(incident.id);
  }
  async function moveIncident(
    incident: Incident,
    change: Partial<Pick<Incident, 'date' | 'resolvedDate' | 'solution'>>,
  ) {
    setDraggedIncidentId('');
    setError('');
    try {
      await saveRecord('incident', { ...incident, ...change }, incident);
      await refresh();
      setToast('Incidencia actualizada.');
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    }
  }
  async function saved() {
    await refresh();
    close();
    setToast('Guardado en tu bitácora.');
  }
  if (!snapshot) {
    return (
      <>
        <LockScreen
          status={status}
          password={password}
          repeat={repeat}
          error={error}
          busy={busy}
          setPassword={setPassword}
          setRepeat={setRepeat}
          unlock={unlock}
          selectedWorkspace={selectedWorkspace}
          setSelectedWorkspace={setSelectedWorkspace}
          workspaceTitle={workspaceTitle}
          setWorkspaceTitle={setWorkspaceTitle}
          workspaceProfile={workspaceProfile}
          setWorkspaceProfile={setWorkspaceProfile}
          createWorkspace={createWorkspace}
          removeWorkspace={removeWorkspace}
        />
        <QuickCaptureButton
          locked
          onClick={() => document.querySelector<HTMLInputElement>('.unlock-card input')?.focus()}
        />
      </>
    );
  }
  const subprojects = subprojectsOf(snapshot.records);
  const selectedChild = findSubproject(snapshot.records, scope);
  const archivedScope = selectedChild?.status === 'Archivado';
  // Views read only the selected scope; «Todo el proyecto» aggregates every child.
  const scopedSnapshot: Snapshot = {
    ...snapshot,
    records: snapshot.records.filter((record) => inSelection(record, scope)),
  };
  const records = scopedSnapshot.records.filter(
    (record) => record.kind !== 'task' || !record.recurrence?.canceledAt,
  );
  const projects = records.filter((r): r is Project => r.kind === 'project');
  const rootProject = projects[0];
  const scopeLabel =
    scope === 'all'
      ? 'Todo el proyecto'
      : `${rootProject?.title || 'Proyecto'} / ${selectedChild?.title || 'General'}`;
  const objectives = records.filter((r): r is Objective => r.kind === 'objective');
  const tasks = records.filter((r): r is Task => r.kind === 'task');
  const entries = records.filter((r): r is Entry => r.kind === 'entry');
  const incidents = records.filter((r): r is Incident => r.kind === 'incident');
  const decisions = records.filter((r): r is Decision => r.kind === 'decision');
  const ideas = records.filter((r): r is Idea => r.kind === 'idea');
  const scoped = records.filter(
    (r) =>
      (!project || r.project === project || r.id === project) &&
      (!search ||
        `${r.title} ${r.kind === 'entry' ? r.activity : r.kind === 'incident' || r.kind === 'task' ? `${r.description} ${r.solution}` : ''}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const scopedTasks = scoped.filter((r): r is Task => r.kind === 'task');
  const nextTasks = nextRecurringTasks(tasks);
  const nextTaskIds = new Set(nextTasks.map((task) => task.id));
  const boardListTasks = scopedTasks.filter((task) => nextTaskIds.has(task.id));
  const todayEntries = entries.filter((e) => e.date === day && (!project || e.project === project));
  const dayIncidents = incidents.filter(
    (incident) =>
      (incident.date === day || incident.resolvedDate === day) &&
      (!project || incident.project === project),
  );
  const dayDecisions = decisions.filter(
    (decision) => decision.date === day && (!project || decision.project === project),
  );
  const dayIdeas = ideas.filter(
    (idea) => idea.date === day && (!project || idea.project === project),
  );
  const proposalCount = proposalNotices(snapshot).filter((p) => p.status === 'pending').length;
  const dateLabel = new Date(day + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const todayTasks = filterTasks(scopedTasks, todayFilters, tasks);
  const boardTasks = filterBoardTasks(
    boardListTasks,
    boardFilters,
    tasks,
    madridDate(),
    boardDateScope,
  );
  const listTasks = filterTasks(boardListTasks, listFilters, tasks);
  const projectTaskCount = nextTasks.filter((task) => !project || task.project === project).length;
  const visibleTasks = view === 'Tablero' ? boardTasks : view === 'Hoy' ? todayTasks : scopedTasks;
  const currentDay = madridDate();
  const reviewItems = weeklyReview(tasks, project, currentDay).filter(
    ({ task }) =>
      !search ||
      `${task.title} ${task.description} ${task.nextStep}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const reviewSignals = visibleWeeklySignals(
    weeklySignalPage?.projectId === project ? weeklySignalPage.signals : [],
    snapshot.weeklyReview,
    currentDay,
  ).filter(
    (signal) =>
      (signal.kind === 'asvs'
        ? scope === 'all' || scope === GENERAL_SCOPE
        : records.some((record) => record.id === signal.recordId)) &&
      (!search ||
        `${signal.title} ${signal.explanation}`.toLowerCase().includes(search.toLowerCase())),
  );
  const dailyTasks = todayTasks
    .filter(
      (task) =>
        task.due === day ||
        isTaskCompletedOnDay(task, day) ||
        (day === currentDay && task.due < day && task.state !== 'Completada'),
    )
    .sort((a, b) => {
      const aOverdue = a.due < day && a.state !== 'Completada';
      const bOverdue = b.due < day && b.state !== 'Completada';
      return Number(bOverdue) - Number(aOverdue);
    });
  const hasTasksOnDay = scopedTasks.some(
    (task) =>
      task.due === day ||
      isTaskCompletedOnDay(task, day) ||
      (day === currentDay && task.due < day && task.state !== 'Completada'),
  );
  const hasOpenFocusTasks = tasks.some(
    (task) =>
      (!project || task.project === project) &&
      task.due <= currentDay &&
      task.state !== 'Completada',
  );
  const priorityOrder: Record<string, number> = {
    Crítica: 0,
    'Muy alta': 1,
    Alta: 2,
    Media: 3,
    Baja: 4,
    'Muy baja': 5,
  };
  const upcomingTasks = todayTasks
    .filter((t) => t.due > day && t.state !== 'Completada')
    .sort((a, b) => {
      if (a.due !== b.due) return a.due.localeCompare(b.due);
      const pA = priorityOrder[a.priority] ?? 99;
      const pB = priorityOrder[b.priority] ?? 99;
      if (pA !== pB) return pA - pB;
      return b.createdAt.localeCompare(a.createdAt);
    });
  const scopedIncidents = scoped.filter((r): r is Incident => r.kind === 'incident');
  const scopedDecisions = scoped.filter((r): r is Decision => r.kind === 'decision');
  const scopedIdeas = scoped.filter((r): r is Idea => r.kind === 'idea');
  const { tasksByDay, incidentsByDay, decisionsByDay, ideasByDay, markedDays, todayMarkedDays } =
    buildCalendarData({
      visibleTasks,
      allTasks: tasks,
      entries,
      allIncidents: incidents,
      scopedIncidents,
      scopedDecisions,
      scopedIdeas,
    });
  const meetings = scoped
    .filter((r): r is Meeting => r.kind === 'meeting')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function projectName(id: string, subprojectId?: string) {
    const title = projects.find((p) => p.id === id)?.title || 'Transversal';
    if (!subprojects.length) return title;
    return `${title} / ${findSubproject(snapshot!.records, subprojectId)?.title || 'General'}`;
  }
  function taskRow(task: Task, isUpcoming = false) {
    return (
      <TodayTaskRow
        key={task.id}
        task={task}
        day={day}
        isUpcoming={isUpcoming}
        selected={selected === task.id}
        dragging={draggedTaskId === task.id}
        projectName={projectName}
        onDragStart={startTaskDrag}
        onDragEnd={() => setDraggedTaskId('')}
        onSelect={() => {
          openRecord(task);
        }}
        onMoveToday={() => void moveTask(task, { due: day })}
        onOpen={() => openRecord(task)}
        onDelete={() => void deleteTask(task)}
      />
    );
  }
  const newestProposal = newProposals[0];
  const proposalNotice = newestProposal && (
    <div className="proposal-notice" role="status">
      <div className="proposal-notice-icon" aria-hidden="true">
        <FileText size={20} />
      </div>
      <div className="proposal-notice-content">
        <strong>Nueva propuesta</strong>
        <span>{newestProposal.title}</span>
      </div>
      <button
        type="button"
        className="proposal-notice-open"
        onClick={() => {
          setDialog({ type: 'assistants', proposalId: newestProposal.id });
          setNewProposals((current) => current.slice(1));
        }}
      >
        Abrir propuesta <ArrowUpRight size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="proposal-notice-dismiss"
        aria-label="Descartar aviso de propuesta"
        onClick={() => setNewProposals((current) => current.slice(1))}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand">
          <BookOpen size={27} />
          <strong>
            bitácora<span>Tu cuaderno de prácticas</span>
          </strong>
        </div>
        <div className="workspace-chip">
          <span className="avatar">B</span>
          <span>
            Mi espacio de trabajo<small>Prácticas profesionales</small>
          </span>
        </div>
        <nav aria-label="Navegación principal">
          {navigation.map((n) => (
            <button
              key={n.name}
              className={view === n.name ? 'active' : ''}
              aria-current={view === n.name ? 'page' : undefined}
              onClick={() => {
                setView(n.name);
                setMobileNav(false);
                setSearch('');
              }}
            >
              <n.icon size={19} />
              <span>{n.name}</span>
              {n.name === 'Hoy' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="projects-heading">
          <span>Mis proyectos</span>
        </div>
        <div className="project-list">
          {rootProject ? (
            <ProjectTree
              project={rootProject}
              subprojects={subprojects}
              tasks={snapshot.records.filter((r): r is Task => r.kind === 'task')}
              scope={scope}
              onSelect={(next) => {
                setScope(next);
                setMobileNav(false);
              }}
              onOpenProject={() => openRecord(rootProject)}
              onManage={() => {
                setMobileNav(false);
                void flushBefore(() => setDialog({ type: 'subprojects' }));
              }}
            />
          ) : (
            <p>Cuaderno sin ficha de proyecto.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setDialog({ type: 'assistants' })}>
            <Plug size={18} /> Asistentes
            {proposalCount > 0 && <Badge tone="blue">{proposalCount}</Badge>}
          </button>
          <button onClick={() => setDialog({ type: 'backup' })}>
            <Database size={18} /> Ajustes y copias
          </button>
          <div className="local-status">
            <span /> Datos cifrados en este equipo
          </div>
          <button className="lock-button" onClick={() => void lock()}>
            <LockKeyhole size={15} /> Bloquear bitácora
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button menu-button"
              aria-label="Abrir navegación"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              <span className="breadcrumb-scope" title={scopeLabel}>
                {scopeLabel}
              </span>{' '}
              <ChevronRight size={13} aria-hidden="true" /> <strong>{view}</strong>
            </span>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            {view !== 'Lista' && (
              <label className="search">
                <Search size={16} />
                <input
                  id="global-search"
                  aria-label="Buscar registros"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar en esta vista…"
                />
                <kbd>Ctrl K</kbd>
              </label>
            )}
          </div>
        </header>
        <div className="workspace-body">
          <main id="main" className="main-content">
            <div className="page-heading">
              <div>
                <div className="page-context">
                  {view === 'Hoy' && `${dateLabel} · `}
                  {project ? (
                    <span className="page-scope">{scopeLabel}</span>
                  ) : (
                    view !== 'Hoy' && 'Mi recorrido profesional'
                  )}
                </div>
                <h1>{pageCopy[view][0]}</h1>
                <p>{pageCopy[view][1]}</p>
              </div>
              {view === 'Tablero' || view === 'Lista' ? (
                <Button onClick={() => create('task')}>
                  <Plus size={17} /> Nueva tarea
                </Button>
              ) : view === 'Buenas prácticas' ? (
                <Button onClick={() => create('practice')}>
                  <Plus size={17} /> Nueva práctica
                </Button>
              ) : view === 'Diario' ? (
                <Button
                  onClick={() =>
                    create(
                      diaryType === 'entries'
                        ? 'entry'
                        : diaryType === 'incidents'
                          ? 'incident'
                          : diaryType === 'decisions'
                            ? 'decision'
                            : 'idea',
                    )
                  }
                >
                  <Plus size={17} />{' '}
                  {diaryType === 'entries'
                    ? 'Nueva entrada'
                    : diaryType === 'incidents'
                      ? 'Nueva incidencia'
                      : diaryType === 'decisions'
                        ? 'Nueva decisión'
                        : 'Nueva idea'}
                </Button>
              ) : null}
            </div>
            {archivedScope && (
              <Notice>
                «{selectedChild.title}» está archivado: puedes consultar su contenido, pero no crear
                ni editar registros. Restáuralo desde «Gestionar subproyectos» para volver a
                trabajar en él.
              </Notice>
            )}
            {view === 'Hoy' && (
              <>
                <div className="week-strip">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(day + 'T12:00:00');
                    const w = (d.getDay() + 6) % 7;
                    d.setDate(d.getDate() - w + i);
                    const iso = madridDate(d);
                    const has = entries.some((e) => e.date === iso);
                    const dayTasks = tasksByDay.get(iso) || [];
                    const dayIncs = incidentsByDay.get(iso) || [];
                    const dayDecisions = decisionsByDay.get(iso) || [];
                    const dayIdeas = ideasByDay.get(iso) || [];
                    const hasUnresolvedInc = dayIncs.some((inc) => !isIncidentResolved(inc));
                    const isDragging = Boolean(draggedTaskId || draggedIncidentId);
                    return (
                      <button
                        key={iso}
                        className={`${iso === day ? 'active' : ''} ${iso === madridDate() ? 'is-today' : ''} ${isDragging ? 'accepts-task' : ''}`}
                        aria-label={`${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}, ${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}${dayIncs.length ? `, ${dayIncs.length} ${dayIncs.length === 1 ? 'incidencia' : 'incidencias'}` : ''}${dayDecisions.length ? `, ${dayDecisions.length} ${dayDecisions.length === 1 ? 'decisión' : 'decisiones'}` : ''}${dayIdeas.length ? `, ${dayIdeas.length} ${dayIdeas.length === 1 ? 'idea' : 'ideas'}` : ''}${dayTasks.length ? `: ${dayTasks.map((task) => task.title).join(', ')}` : ''}`}
                        aria-haspopup="dialog"
                        aria-current={iso === day ? 'date' : undefined}
                        onClick={() => setDetailDay(iso)}
                        onDragOver={(event) => {
                          if (!isDragging) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedTaskId) {
                            const task = tasks.find((item) => item.id === draggedTaskId);
                            if (task) void moveTask(task, { due: iso });
                          } else if (draggedIncidentId) {
                            const inc = incidents.find((item) => item.id === draggedIncidentId);
                            if (inc) {
                              if (isIncidentResolved(inc)) {
                                void moveIncident(inc, { resolvedDate: iso });
                              } else {
                                void moveIncident(inc, { date: iso });
                              }
                            }
                          }
                        }}
                      >
                        <span>
                          {d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}
                        </span>
                        <strong>{d.getDate()}</strong>
                        {dayTasks.length > 0 && (
                          <span className="week-task-summary" title={`Tarea: ${dayTasks[0].title}`}>
                            <CheckSquare size={12} aria-hidden="true" />
                            <span className="week-task-title" title={dayTasks[0].title}>
                              {dayTasks[0].title}
                            </span>
                            {dayTasks.length > 1 && <b>+{dayTasks.length - 1}</b>}
                          </span>
                        )}
                        {dayTasks.length === 0 && dayIncs.length > 0 && (
                          <span
                            className={`week-incident-summary ${hasUnresolvedInc ? 'unresolved' : 'resolved'}`}
                            title={`Incidencia: ${dayIncs[0].title}`}
                          >
                            {hasUnresolvedInc ? (
                              <AlertCircle size={12} aria-hidden="true" />
                            ) : (
                              <CheckCircle2 size={12} aria-hidden="true" />
                            )}
                            <span className="week-task-title">{dayIncs[0].title}</span>
                            {dayIncs.length > 1 && <b>+{dayIncs.length - 1}</b>}
                          </span>
                        )}
                        {dayTasks.length === 0 &&
                          dayIncs.length === 0 &&
                          dayDecisions.length > 0 && (
                            <span
                              className="week-note-summary decision"
                              title={`Decisión: ${dayDecisions[0].title}`}
                            >
                              <BookOpen size={12} aria-hidden="true" />
                              <span className="week-task-title">{dayDecisions[0].title}</span>
                            </span>
                          )}
                        {dayTasks.length === 0 &&
                          dayIncs.length === 0 &&
                          dayDecisions.length === 0 &&
                          dayIdeas.length > 0 && (
                            <span
                              className="week-note-summary idea"
                              title={`Idea: ${dayIdeas[0].title}`}
                            >
                              <Lightbulb size={12} aria-hidden="true" />
                              <span className="week-task-title">{dayIdeas[0].title}</span>
                            </span>
                          )}
                        <span className="week-day-counts" aria-hidden="true">
                          <i className={has ? 'has-entry' : ''} />
                          {dayTasks.length > 0 && (
                            <span
                              className="calendar-note-count task"
                              title={`${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}`}
                            >
                              <CheckSquare size={11} /> {dayTasks.length}
                            </span>
                          )}
                          {dayIncs.length > 0 && (
                            <span
                              className={`calendar-note-count incident ${hasUnresolvedInc ? 'unresolved' : 'resolved'}`}
                              title={`${dayIncs.length} ${dayIncs.length === 1 ? 'incidencia' : 'incidencias'}`}
                            >
                              {hasUnresolvedInc ? (
                                <AlertCircle size={11} />
                              ) : (
                                <CheckCircle2 size={11} />
                              )}{' '}
                              {dayIncs.length}
                            </span>
                          )}
                          {dayDecisions.length > 0 && (
                            <span
                              className="calendar-note-count decision"
                              title={`${dayDecisions.length} ${dayDecisions.length === 1 ? 'decisión' : 'decisiones'}`}
                              aria-hidden="true"
                            >
                              <BookOpen size={11} /> {dayDecisions.length}
                            </span>
                          )}
                          {dayIdeas.length > 0 && (
                            <span
                              className="calendar-note-count idea"
                              title={`${dayIdeas.length} ${dayIdeas.length === 1 ? 'idea' : 'ideas'}`}
                              aria-hidden="true"
                            >
                              <Lightbulb size={11} /> {dayIdeas.length}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  <div className="week-controls">
                    <button
                      aria-label="Semana anterior"
                      className="icon-button"
                      onClick={() => {
                        const d = new Date(day + 'T12:00:00');
                        d.setDate(d.getDate() - 7);
                        setDay(madridDate(d));
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      aria-label="Semana siguiente"
                      className="icon-button"
                      onClick={() => {
                        const d = new Date(day + 'T12:00:00');
                        d.setDate(d.getDate() + 7);
                        setDay(madridDate(d));
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="calendar-expand-row">
                  <Button variant="ghost" onClick={() => setCalendarExpanded(!calendarExpanded)}>
                    <CalendarDays size={16} />
                    {calendarExpanded ? 'Contraer calendario' : 'Ampliar calendario al mes'}
                  </Button>
                </div>
                {calendarExpanded && (
                  <CalendarMonths
                    day={day}
                    markedDays={todayMarkedDays}
                    tasksByDay={tasksByDay}
                    incidentsByDay={incidentsByDay}
                    decisionsByDay={decisionsByDay}
                    ideasByDay={ideasByDay}
                    openDay={setDetailDay}
                    draggedTaskId={draggedTaskId}
                    dropTask={(date) => {
                      const task = tasks.find((item) => item.id === draggedTaskId);
                      if (task) void moveTask(task, { due: date });
                    }}
                    draggedIncidentId={draggedIncidentId}
                    dropIncident={(date) => {
                      const inc = incidents.find((item) => item.id === draggedIncidentId);
                      if (inc) {
                        if (isIncidentResolved(inc)) {
                          void moveIncident(inc, { resolvedDate: date });
                        } else {
                          void moveIncident(inc, { date });
                        }
                      }
                    }}
                  />
                )}
                <div className="daily-metrics">
                  <div>
                    <span className="metric-icon blue">
                      <Clock3 size={19} />
                    </span>
                    <span>
                      <strong>{dailyTasks.filter((t) => t.state === 'En curso').length}</strong> en
                      curso
                    </span>
                  </div>
                  <div>
                    <span className="metric-icon green">
                      <CheckCircle2 size={19} />
                    </span>
                    <span>
                      <strong>{dailyTasks.filter((t) => t.state === 'Completada').length}</strong>{' '}
                      completadas
                    </span>
                  </div>
                  <div>
                    <span className="metric-icon amber">
                      <Flag size={19} />
                    </span>
                    <span>
                      <strong>{dailyTasks.filter((t) => !!t.blocked).length}</strong> con bloqueos
                    </span>
                  </div>
                </div>
                <section className="focus-section">
                  <div className="section-heading">
                    <h2>Tu foco de trabajo</h2>
                    <Button variant="ghost" onClick={() => create('task')}>
                      <Plus size={15} /> Añadir tarea
                    </Button>
                  </div>
                  <TaskFilters
                    tasks={scopedTasks}
                    filters={todayFilters}
                    onChange={setTodayFilters}
                    count={dailyTasks.length}
                  />
                  {dailyTasks.length ? (
                    <div className="task-list">{dailyTasks.map((t) => taskRow(t))}</div>
                  ) : !hasOpenFocusTasks && upcomingTasks.length ? (
                    <p className="upcoming-empty-note">
                      {hasTasksOnDay
                        ? 'No hay tareas para hoy con los filtros aplicados.'
                        : 'No tienes tareas programadas para hoy.'}
                    </p>
                  ) : (
                    <Empty
                      title={
                        hasTasksOnDay
                          ? 'No hay tareas con estos filtros.'
                          : 'Todo empieza por un siguiente paso.'
                      }
                      action={
                        !hasTasksOnDay && (
                          <Button variant="secondary" onClick={() => create('task')}>
                            <Plus size={16} /> Crear mi primera tarea
                          </Button>
                        )
                      }
                    >
                      {hasTasksOnDay
                        ? 'Prueba otros criterios o limpia los filtros para ver todas las tareas del día.'
                        : 'Añade una tarea concreta: investigar una alternativa, preparar un diagrama o validar una decisión.'}
                    </Empty>
                  )}
                  {!hasOpenFocusTasks && upcomingTasks.length > 0 && (
                    <div className="upcoming-tasks-section">
                      <div className="upcoming-tasks-heading">
                        <div className="row" style={{ alignItems: 'center', gap: 7 }}>
                          <CalendarDays size={16} className="upcoming-heading-icon" />
                          <h3>Próximas tareas programadas</h3>
                        </div>
                        <span className="upcoming-tasks-count">
                          {upcomingTasks.length}{' '}
                          {upcomingTasks.length === 1
                            ? 'tarea en los próximos días'
                            : 'tareas en los próximos días'}
                        </span>
                      </div>
                      <p className="upcoming-tasks-desc">
                        {dailyTasks.length > 0
                          ? 'Has completado las tareas de hoy y las retrasadas. Puedes anticipar trabajo de las siguientes jornadas:'
                          : 'Puedes anticipar trabajo y mantener el ritmo con las tareas programadas para los días siguientes:'}
                      </p>
                      <div className="task-list">{upcomingTasks.map((t) => taskRow(t, true))}</div>
                    </div>
                  )}
                </section>
                <section className="focus-section">
                  <div className="section-heading">
                    <h2>Incidencias del día</h2>
                    <Button variant="ghost" onClick={() => create('incident', { date: day })}>
                      <Plus size={15} /> Registrar incidencia
                    </Button>
                  </div>
                  {dayIncidents.map((incident) => {
                    const resolved = isIncidentResolved(incident);
                    return (
                      <div className="copyable-mini" key={incident.id}>
                        <button
                          className={`entry-mini ${resolved ? 'resolved' : 'unresolved'}`}
                          onClick={() => openRecord(incident)}
                        >
                          {resolved ? (
                            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                          ) : (
                            <AlertCircle size={18} style={{ flexShrink: 0 }} />
                          )}
                          <span>
                            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                              <strong>{incident.title}</strong>
                              <Badge tone={resolved ? 'green' : 'red'}>
                                {resolved ? 'Solucionada' : 'Sin solucionar'}
                              </Badge>
                            </span>
                            <small>
                              {incident.resolvedDate === day
                                ? `Resuelta: ${incident.solution}`
                                : incident.description}
                            </small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                        <CopyRecordId id={incident.id} title={incident.title} />
                      </div>
                    );
                  })}
                  {!dayIncidents.length && (
                    <p className="muted">No hay incidencias registradas para este día.</p>
                  )}
                </section>
                <section className="focus-section">
                  <div className="section-heading">
                    <h2>Decisiones del día</h2>
                    <Button variant="ghost" onClick={() => create('decision', { date: day })}>
                      <Plus size={15} /> Registrar decisión
                    </Button>
                  </div>
                  {dayDecisions.map((decision) => (
                    <div className="copyable-mini" key={decision.id}>
                      <button className="entry-mini" onClick={() => openRecord(decision)}>
                        <BookOpen size={18} style={{ flexShrink: 0 }} />
                        <span>
                          <strong>{decision.title}</strong>
                          <small>{decision.decision || decision.problem}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                      <CopyRecordId id={decision.id} title={decision.title} />
                    </div>
                  ))}
                  {!dayDecisions.length && (
                    <p className="muted">No hay decisiones registradas para este día.</p>
                  )}
                </section>
                <section className="focus-section">
                  <div className="section-heading">
                    <h2>Ideas del día</h2>
                    <Button variant="ghost" onClick={() => create('idea', { date: day })}>
                      <Plus size={15} /> Registrar idea
                    </Button>
                  </div>
                  {dayIdeas.map((idea) => (
                    <div className="copyable-mini" key={idea.id}>
                      <button className="entry-mini" onClick={() => openRecord(idea)}>
                        <Lightbulb size={18} style={{ flexShrink: 0 }} />
                        <span>
                          <strong>{idea.title}</strong>
                          <small>{idea.description}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                      <CopyRecordId id={idea.id} title={idea.title} />
                    </div>
                  ))}
                  {!dayIdeas.length && (
                    <p className="muted">No hay ideas registradas para este día.</p>
                  )}
                </section>
                {!archivedScope && (
                  <DailyComposer
                    key={`${day}-${project}-${scope}-${dailyComposerRevision}`}
                    day={day}
                    project={project}
                    subprojectId={selectedChild?.id}
                    snapshot={scopedSnapshot}
                    refresh={refresh}
                    registerFlush={registerFlush}
                    openRecord={openRecord}
                  />
                )}
                {todayEntries.length > 0 && (
                  <section className="focus-section">
                    <div className="section-heading">
                      <h2>Ya en tu diario</h2>
                      <Badge>{todayEntries.length}</Badge>
                    </div>
                    {todayEntries.map((e) => (
                      <button className="entry-mini" key={e.id} onClick={() => openRecord(e)}>
                        <span className="entry-line" />
                        <span>
                          <strong>{e.title}</strong>
                          <small>{mentionSummaryText(e.result || e.activity, records)}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </section>
                )}
                <div className="meeting-callout">
                  <CalendarDays size={25} />
                  <div>
                    <strong>El martes, todo tendrá su contexto.</strong>
                    <p>Tus avances y bloqueos se reunirán en un informe listo para revisar.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Preparar reunión del martes"
                    onClick={() => setView('Martes')}
                  >
                    <ArrowUpRight size={20} />
                  </button>
                </div>
              </>
            )}
            {view === 'Tablero' && (
              <BoardView
                tasks={boardTasks}
                allTasks={tasks}
                incidents={scopedIncidents}
                filters={
                  <TaskFilters
                    tasks={boardListTasks}
                    filters={boardFilters}
                    onChange={setBoardFilters}
                    showDates
                    dateScope={boardDateScope}
                    onDateScopeChange={(scope) => {
                      setBoardDateScope(scope);
                      if (scope !== 'range') {
                        setBoardFilters((filters) => ({ ...filters, dueFrom: '', dueTo: '' }));
                      }
                    }}
                    onClear={() => {
                      setBoardFilters({ ...emptyTaskFilters });
                      setBoardDateScope('upcoming');
                    }}
                    count={boardTasks.length}
                  />
                }
                selectedId={selected}
                projectName={projectName}
                openTask={openRecord}
                openIncident={openRecord}
                createTask={(state) => create('task', { state })}
                createIncident={() => create('incident', { date: day })}
                day={day}
                markedDays={markedDays}
                tasksByDay={tasksByDay}
                incidentsByDay={incidentsByDay}
                openDay={setDetailDay}
                draggedTaskId={draggedTaskId}
                startTaskDrag={startTaskDrag}
                endTaskDrag={() => setDraggedTaskId('')}
                moveTask={(task, change) => void moveTask(task, change)}
                draggedIncidentId={draggedIncidentId}
                startIncidentDrag={startIncidentDrag}
                endIncidentDrag={() => setDraggedIncidentId('')}
                moveIncident={(incident, change) => void moveIncident(incident, change)}
              />
            )}
            {view === 'Revisión semanal' && (
              <WeeklyReviewView
                items={reviewItems}
                tasks={tasks}
                projectId={project}
                today={currentDay}
                search={search}
                openTask={openRecord}
                updateTask={updateReviewTask}
                signals={reviewSignals}
                previousReviewDay={snapshot.weeklyReview?.baseline?.day}
                finishReview={finishWeeklyReview}
                openSignal={(signal) => {
                  if (signal.kind === 'asvs') {
                    setAsvsReference(signal.itemId ?? '');
                    setView('Verificación ASVS');
                    return;
                  }
                  const source = snapshot.records.find((record) => record.id === signal.recordId);
                  if (source) openRecord(source, signal.kind === 'evidence');
                }}
                createFollowUp={createFollowUpFromSignal}
                decideSignal={decideWeeklySignal}
              />
            )}
            {view === 'Lista' && (
              <>
                <TaskSeriesManager
                  series={(snapshot.taskSeries ?? []).filter(
                    (item) =>
                      (!project || item.project === project) &&
                      (scope === 'all' ||
                        (scope === GENERAL_SCOPE
                          ? !item.subprojectId
                          : item.subprojectId === scope)),
                  )}
                  tasks={scopedSnapshot.records.filter(
                    (record): record is Task => record.kind === 'task',
                  )}
                  refresh={refresh}
                />
                <TaskFilters
                  tasks={nextTasks.filter((task) => !project || task.project === project)}
                  filters={listFilters}
                  onChange={setListFilters}
                  showDates
                  count={listTasks.length}
                />
                <TaskListView
                  tasks={listTasks}
                  scopeLabel={
                    scope === 'all' && subprojects.length
                      ? (task) => projectName(task.project, task.subprojectId)
                      : undefined
                  }
                  total={projectTaskCount}
                  search={search}
                  onSearchChange={setSearch}
                  onClear={() => {
                    setSearch('');
                    setListFilters({ ...emptyTaskFilters });
                  }}
                  openTask={openRecord}
                  deleteTask={(task) => void deleteTask(task)}
                  createTask={() => create('task')}
                />
              </>
            )}
            {view === 'Diario' && (
              <DiaryView
                records={scoped}
                allRecords={records}
                mode={diaryType}
                setMode={setDiaryType}
                projectName={projectName}
                openRecord={openRecord}
              />
            )}
            {view === 'Martes' && (
              <>
                <div className="report-intro">
                  <div className="report-icon">
                    <CalendarDays size={34} />
                  </div>
                  <div>
                    <h2>Tu próxima conversación</h2>
                    <p>
                      Periodo desde {new Date(reportStart(records)).toLocaleDateString('es-ES')}{' '}
                      hasta ahora. Puedes ajustarlo al abrir el borrador.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      const from = reportStart(records),
                        to = new Date().toISOString();
                      // Sources must share the meeting's scope; «Todo el proyecto» starts in General.
                      const report = weeklyReport(
                        scope === 'all'
                          ? records.filter((record) => inSelection(record, GENERAL_SCOPE))
                          : records,
                        from,
                        to,
                      );
                      create('meeting', {
                        title: `Reunión · ${madridDate()}`,
                        from,
                        to,
                        ...report,
                      });
                    }}
                  >
                    <Feather size={17} /> Preparar reunión
                  </Button>
                </div>
                <div className="meeting-topics">
                  {[
                    ['Avances', 'Resultados respaldados por tus entradas.'],
                    ['Bloqueos', 'Dónde necesitas ayuda para continuar.'],
                    ['Calidad', 'Riesgos y consultas que conviene resolver.'],
                  ].map(([a, b]) => (
                    <div key={a}>
                      <h3>{a}</h3>
                      <p>{b}</p>
                    </div>
                  ))}
                </div>
                <h2 className="section-title">Reuniones registradas</h2>
                {!meetings.length && (
                  <Empty title="Tu primer martes, preparado.">
                    Genera un borrador local a partir de tus registros o solicita una propuesta a tu
                    asistente.
                  </Empty>
                )}
                {meetings.map((m) => (
                  <article className="meeting-card" key={m.id}>
                    <div className="row spread">
                      <div>
                        <Badge tone={m.closedAt ? 'green' : 'amber'}>
                          {m.closedAt ? 'Cerrada' : 'Borrador'}
                        </Badge>
                        <h3>{m.title}</h3>
                        <p>
                          {new Date(m.from).toLocaleDateString('es-ES')} —{' '}
                          {new Date(m.to).toLocaleDateString('es-ES')}
                        </p>
                      </div>
                      <div className="row">
                        <Button variant="secondary" onClick={() => openRecord(m)}>
                          Revisar
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setDialog({ type: 'export', body: m.body })}
                        >
                          <Download size={16} /> Exportar
                        </Button>
                      </div>
                    </div>
                    {m.agreements && (
                      <>
                        <h4>Acuerdos</h4>
                        <p className="preserve">{m.agreements}</p>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            create('task', {
                              description: `Acuerdo de ${m.title}\n${m.agreements}`,
                              title: 'Dar seguimiento al acuerdo',
                            })
                          }
                        >
                          <Plus size={15} /> Preparar tarea con este texto
                        </Button>
                      </>
                    )}
                  </article>
                ))}
              </>
            )}
            {view === 'Memoria' && (
              <>
                <div className="memory-summary">
                  <GraduationCap size={42} strokeWidth={1.3} />
                  <div>
                    <h2>La memoria se construye trabajando.</h2>
                    <p>
                      {entries.length} entradas ·{' '}
                      {records.filter((r) => r.kind === 'decision').length} decisiones ·{' '}
                      {entries.filter((e) => !!e.evidence).length} entradas con evidencia
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      setDialog({
                        type: 'export',
                        body: memoryReport(records, snapshot.settings.universityStructure),
                      })
                    }
                  >
                    <Download size={16} /> Revisar y exportar
                  </Button>
                </div>
                <Field
                  label="Estructura o rúbrica de tu asignatura"
                  hint="Se guarda al salir del campo. Servirá de referencia en la memoria y para preparar contexto autorizado."
                >
                  <textarea
                    rows={3}
                    defaultValue={snapshot.settings.universityStructure}
                    onBlur={(e) =>
                      void api('settings', {
                        ...snapshot.settings,
                        universityStructure: e.target.value,
                      })
                        .then(refresh)
                        .catch((e) => setError(e.message))
                    }
                  />
                </Field>
                <div className="section-heading">
                  <h2>Proyectos y validaciones</h2>
                </div>
                {projects.map((p) => (
                  <button className="memory-project" key={p.id} onClick={() => openRecord(p)}>
                    <Folder size={25} />
                    <div>
                      <h3>{p.title}</h3>
                      <p>{p.kind === 'project' ? p.objective : ''}</p>
                      <small>
                        {entries.filter((e) => e.project === p.id).length} entradas vinculadas
                      </small>
                    </div>
                    <Badge tone={p.kind === 'project' && p.validationDate ? 'green' : 'amber'}>
                      {p.kind === 'project' && p.validationDate
                        ? 'Validación registrada'
                        : 'Pendiente de tutor'}
                    </Badge>
                  </button>
                ))}
                <div className="section-heading">
                  <h2>Objetivos y cobertura</h2>
                  <Button onClick={() => create('objective')}>
                    <Plus size={16} /> Nuevo objetivo
                  </Button>
                </div>
                {objectives.filter((objective) => !project || objective.project === project)
                  .length === 0 && (
                  <Empty title="Aún no hay objetivos estructurados">
                    Crea uno y vincula trabajo, resultados y evidencias del cuaderno.
                  </Empty>
                )}
                {objectives
                  .filter((objective) => !project || objective.project === project)
                  .map((objective) => {
                    const coverage = objectiveCoverage(objective, snapshot.records);
                    return (
                      <article className="memory-project objective-card" key={objective.id}>
                        <div>
                          <Button variant="ghost" onClick={() => openRecord(objective)}>
                            <h3>{objective.title}</h3>
                          </Button>
                          <p>{objective.description}</p>
                          <Badge
                            tone={objective.validation.state === 'Validado' ? 'green' : 'amber'}
                          >
                            {objective.validation.state}
                          </Badge>
                          <p>
                            {coverage.gaps.length
                              ? coverage.gaps.join(' · ')
                              : 'Sin lagunas registradas'}
                          </p>
                          {coverage.links.map((link) => {
                            const source = snapshot.records.find(
                              (item) => item.id === link.sourceId,
                            );
                            return source ? (
                              <Button
                                key={link.id}
                                variant="ghost"
                                onClick={() => openRecord(source)}
                              >
                                {link.role}: {source.title}
                                {source.kind === 'entry' || source.kind === 'task'
                                  ? ` · ${source.kind === 'entry' ? source.date : source.due}`
                                  : ''}
                                {link.reference ? ` · ${link.reference}` : ''}
                              </Button>
                            ) : null;
                          })}
                        </div>
                      </article>
                    );
                  })}
                <h2 className="section-title">Evidencias por completar</h2>
                {entries
                  .filter((e) => !e.evidence)
                  .slice(0, 10)
                  .map((e) => (
                    <button className="entry-mini" key={e.id} onClick={() => openRecord(e)}>
                      <FileText size={19} />
                      <span>
                        <strong>{e.title}</strong>
                        <small>Añadir referencia o evidencia</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                <Notice>
                  La memoria cita los registros originales. Las validaciones se introducen
                  manualmente y el texto interno de políticas se omite de la exportación por
                  defecto.
                </Notice>
              </>
            )}
            {view === 'Verificación ASVS' && (
              <Suspense fallback={<Notice>Cargando verificación ASVS…</Notice>}>
                <AsvsView
                  key={project}
                  projectId={project}
                  records={snapshot.records}
                  openRecord={openRecord}
                  data={snapshot.asvs}
                  initialReference={asvsReference}
                  onChanged={() =>
                    void refresh().catch((cause) => setError((cause as Error).message))
                  }
                />
              </Suspense>
            )}
            {view === 'Buenas prácticas' && (
              <PracticesView
                records={scoped}
                category={category}
                setCategory={setCategory}
                projectName={projectName}
                openRecord={openRecord}
                hasDraftNew={
                  !!snapshot.drafts?.[`new:practice${selectedChild ? `:${selectedChild.id}` : ''}`]
                }
                onOpenNewDraft={() => create('practice')}
              />
            )}
            {error && <Notice error>{error}</Notice>}
            {snapshot.recurrenceWarning && <Notice error>{snapshot.recurrenceWarning}</Notice>}
            <footer className="main-footer">
              <span>Hecho con intención. Registrado con contexto.</span>
              <span>Bitácora · Privado y local</span>
            </footer>
          </main>
        </div>
      </div>
      {detailDay && !dialog && (
        <Modal
          title="Detalles del día"
          onClose={() => setDetailDay('')}
          wide
          floatingAction={
            <QuickCaptureButton
              onClick={openCapture}
              count={snapshot.captures?.filter((capture) => !capture.convertedRecordId).length}
            />
          }
        >
          <DayDetails
            day={detailDay}
            records={records.filter((record) => !project || record.project === project)}
            allRecords={records}
            projectName={projectName}
            openRecord={(record) => {
              setDetailDay('');
              openRecord(record);
            }}
            today={madridDate()}
          />
        </Modal>
      )}
      {dialog && (
        <Modal
          title={
            dialog.type === 'record'
              ? dialog.kind === 'entry'
                ? 'Deja constancia de tu día'
                : `${dialog.record ? 'Editar' : dialog.kind === 'objective' ? 'Nuevo' : 'Nueva'} ${kindNames[dialog.kind]}`
              : dialog.type === 'subprojects'
                ? 'Subproyectos'
                : dialog.type === 'assistants'
                  ? 'Tus asistentes, tu contexto'
                  : dialog.type === 'backup'
                    ? 'Ajustes y copias'
                    : 'Revisar antes de exportar'
          }
          onClose={close}
          wide={dialog.type !== 'backup'}
          floatingAction={
            <QuickCaptureButton
              onClick={openCapture}
              count={snapshot.captures?.filter((capture) => !capture.convertedRecordId).length}
            />
          }
        >
          {dialog.type === 'record' ? (
            <RecordEditor
              key={dialog.record?.id || dialog.capture?.id || dialog.kind}
              kind={dialog.kind}
              record={dialog.record}
              initial={dialog.initial}
              capture={dialog.capture}
              followUp={dialog.followUp}
              focusEvidence={dialog.focusEvidence}
              chooseScope={dialog.chooseScope}
              onManageSubprojects={() => setDialog({ type: 'subprojects' })}
              snapshot={snapshot}
              onSaved={() => void saved()}
              onRefresh={refresh}
              onOpenRecord={openRecord}
              onCreateFollowUp={startFollowUp}
              registerFlush={registerFlush}
              onDelete={
                dialog.record?.kind === 'task'
                  ? () => void deleteTask(dialog.record as Task)
                  : dialog.record?.kind === 'incident'
                    ? () => void deleteIncident(dialog.record as Incident)
                    : dialog.record?.kind === 'entry' ||
                        dialog.record?.kind === 'decision' ||
                        dialog.record?.kind === 'idea'
                      ? () => void deleteJournalRecord(dialog.record as Entry | Decision | Idea)
                      : dialog.record?.kind === 'meeting'
                        ? () => void deleteMeeting(dialog.record as Meeting)
                        : dialog.record?.kind === 'practice'
                          ? () => void deletePractice(dialog.record as Practice)
                          : dialog.record?.kind === 'objective'
                            ? () => void deleteObjective(dialog.record as Objective)
                            : undefined
              }
            />
          ) : dialog.type === 'subprojects' ? (
            <SubprojectManager
              snapshot={snapshot}
              refresh={refresh}
              onChanged={setToast}
              onEnter={(child: Subproject) => {
                rawSetScope(child.id);
                setSelected('');
                setMobileNav(false);
                close();
              }}
            />
          ) : dialog.type === 'assistants' ? (
            <Assistants
              snapshot={snapshot}
              refresh={refresh}
              focusProposalId={dialog.proposalId}
              currentSubprojectId={selectedChild?.id}
              proposalSoundEnabled={proposalSoundEnabled}
              toggleProposalSound={toggleProposalSound}
            />
          ) : dialog.type === 'backup' ? (
            <Backup refresh={refresh} projectId={project} mcpProfile={snapshot.mcpProfile} />
          ) : (
            <Export initial={dialog.body} />
          )}
          {proposalNotice}
        </Modal>
      )}
      {!dialog && !detailDay && !captureOpen && (
        <QuickCaptureButton
          onClick={openCapture}
          count={snapshot.captures?.filter((capture) => !capture.convertedRecordId).length}
        />
      )}
      {captureOpen && (
        <QuickCapture
          captures={snapshot.captures || []}
          records={records}
          onClose={() => setCaptureOpen(false)}
          onRefresh={refresh}
          onConvert={convertCapture}
        />
      )}
      {!dialog && proposalNotice}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
