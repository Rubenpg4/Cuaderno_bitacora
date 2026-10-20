import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Repeat,
  Scale,
  Undo2,
} from 'lucide-react';
import { taskDateLabel, type Task } from '../../shared/model';
import { addDays } from '../../shared/recurrence';
import type { WeeklySignal } from '../../shared/weeklyReviewSignals';
import {
  DEFAULT_DAILY_CAPACITY,
  balanceWeek,
  weekPlan,
  weekStart,
  type PlannedMove,
  type PlannerTask,
} from '../weeklyReview';

const CAPACITY_KEY = 'bitacora-planner-capacity';
const WEEKEND_KEY = 'bitacora-planner-weekend';
const HISTORY_LIMIT = 20;

export interface TaskReschedule {
  task: Task;
  due: string;
}

interface Props {
  tasks: Task[];
  projectId: string;
  today: string;
  search: string;
  openTask: (task: Task) => void;
  rescheduleTasks: (changes: TaskReschedule[]) => Promise<boolean>;
  signals: WeeklySignal[];
  previousReviewDay?: string;
  finishReview: () => Promise<void>;
  openSignal: (signal: WeeklySignal) => void;
  createFollowUp: (signal: WeeklySignal) => void;
  decideSignal: (
    signal: WeeklySignal,
    mode: 'dismissed' | 'postponed',
    until?: string,
  ) => Promise<void>;
}

type MoveRecord = { taskId: string; from: string; to: string };

function readStored<T>(key: string, parse: (value: string) => T | undefined, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return (value === null ? undefined : parse(value)) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Las preferencias del planificador son una comodidad local; sin almacenamiento se usan las predeterminadas.
  }
}

function dayParts(day: string) {
  const date = new Date(`${day}T12:00:00`);
  const weekday = date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    number: date.getDate(),
    month: date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
  };
}

function shortDay(day: string) {
  const { weekday, number, month } = dayParts(day);
  return `${weekday} ${number} ${month}`;
}

function weekCaption(offset: number) {
  if (offset === 0) return 'Esta semana';
  if (offset === 1) return 'Próxima semana';
  return `Dentro de ${offset} semanas`;
}

function priorityClass(task: Task) {
  return `priority-${task.priority.toLowerCase().replaceAll(' ', '-')}`;
}

function SignalActions({
  signal,
  today,
  openSignal,
  createFollowUp,
  decideSignal,
}: Pick<Props, 'today' | 'openSignal' | 'createFollowUp' | 'decideSignal'> & {
  signal: WeeklySignal;
}) {
  const [until, setUntil] = useState(addDays(today, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(mode: 'dismissed' | 'postponed') {
    setBusy(true);
    setError('');
    try {
      await decideSignal(signal, mode, mode === 'postponed' ? until : undefined);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review-followup">
      <strong>
        {signal.kind === 'agreement'
          ? 'Acuerdo sin seguimiento'
          : signal.kind === 'evidence'
            ? 'Resultado sin evidencia'
            : 'Tarea estancada'}
      </strong>
      <p>{signal.explanation}</p>
      <div className="review-followup-actions">
        <button type="button" onClick={() => openSignal(signal)}>
          Abrir{' '}
          {signal.kind === 'agreement'
            ? 'reunión'
            : signal.kind === 'evidence'
              ? 'entrada'
              : 'tarea'}
        </button>
        {signal.kind === 'agreement' && (
          <button type="button" onClick={() => createFollowUp(signal)}>
            Crear tarea desde acuerdo
          </button>
        )}
        <label>
          Posponer hasta
          <input
            type="date"
            min={addDays(today, 1)}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !until || until <= today}
          onClick={() => void decide('postponed')}
        >
          Posponer
        </button>
        <button type="button" disabled={busy} onClick={() => void decide('dismissed')}>
          Descartar
        </button>
      </div>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MoveMenu({
  task,
  days,
  today,
  nextWeek,
  move,
  close,
}: {
  task: Task;
  days: { day: string; count: number }[];
  today: string;
  nextWeek: string;
  move: (day: string) => void;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [other, setOther] = useState(task.due < today ? today : task.due);
  const [alignStart, setAlignStart] = useState(false);

  useLayoutEffect(() => {
    // Se abre hacia la izquierda; en las primeras columnas se saldría del planificador.
    const menu = ref.current;
    const bounds = menu?.closest('.weekly-planner')?.getBoundingClientRect();
    if (menu && bounds && menu.getBoundingClientRect().left < bounds.left) setAlignStart(true);
  }, []);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    function outside(event: MouseEvent) {
      if (!ref.current?.parentElement?.contains(event.target as Node)) closeRef.current();
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  const options = [
    { day: today, label: 'Hoy' },
    { day: addDays(today, 1), label: 'Mañana' },
  ];
  return (
    <div
      ref={ref}
      className={`planner-move-menu ${alignStart ? 'align-start' : ''}`}
      role="group"
      aria-label={`Mover «${task.title}»`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          ref.current?.parentElement
            ?.querySelector<HTMLButtonElement>('.planner-card-move')
            ?.focus();
          close();
        }
      }}
    >
      <div className="planner-move-quick">
        {options.map(({ day, label }) => (
          <button key={label} type="button" disabled={day === task.due} onClick={() => move(day)}>
            {label}
          </button>
        ))}
        <button type="button" disabled={nextWeek === task.due} onClick={() => move(nextWeek)}>
          Lunes siguiente
        </button>
      </div>
      <div className="planner-move-days">
        {days.map(({ day, count }) => (
          <button
            key={day}
            type="button"
            disabled={day < today || day === task.due}
            onClick={() => move(day)}
            aria-label={`${taskDateLabel(day)}, ${count} ${count === 1 ? 'tarea' : 'tareas'}`}
          >
            <span>{dayParts(day).weekday}</span>
            <strong>{dayParts(day).number}</strong>
            <small>{count}</small>
          </button>
        ))}
      </div>
      <form
        className="planner-move-other"
        onSubmit={(event) => {
          event.preventDefault();
          if (other && other !== task.due) move(other);
        }}
      >
        <label htmlFor={`planner-other-${task.id}`}>Otra fecha</label>
        <input
          id={`planner-other-${task.id}`}
          type="date"
          required
          value={other}
          onChange={(event) => setOther(event.target.value)}
        />
        <button type="submit" disabled={!other || other === task.due}>
          Mover
        </button>
      </form>
    </div>
  );
}

function PlannerCard({
  item,
  faded,
  dragging,
  proposedDay,
  menu,
  openTask,
  toggleMenu,
  step,
  startDrag,
  endDrag,
}: {
  item: PlannerTask;
  faded: boolean;
  dragging: boolean;
  proposedDay?: string;
  menu?: ReactNode;
  openTask: () => void;
  toggleMenu: () => void;
  step: (delta: -1 | 1) => void;
  startDrag: (event: DragEvent<HTMLElement>) => void;
  endDrag: () => void;
}) {
  const { task, signals } = item;
  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  return (
    <article
      className={`planner-card ${faded ? 'faded' : ''} ${dragging ? 'dragging' : ''} ${proposedDay ? 'proposed' : ''}`}
      data-planner-task={task.id}
      draggable
      onDragStart={startDrag}
      onDragEnd={endDrag}
    >
      <button
        type="button"
        className="planner-card-main"
        onClick={openTask}
        onKeyDown={keys}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        title="Abrir tarea · ← → para moverla un día"
      >
        <span className="planner-card-title">{task.title}</span>
        <span className="planner-card-meta">
          <span className={`planner-priority ${priorityClass(task)}`} aria-hidden="true" />
          {task.priority} · {task.state}
          {task.recurrence && <Repeat size={11} aria-label="Recurrente" />}
        </span>
        {signals.some((signal) => signal !== 'Recurrente') && (
          <span className="planner-card-signals">
            {signals
              .filter((signal) => signal !== 'Recurrente')
              .map((signal) => (
                <span key={signal}>{signal}</span>
              ))}
          </span>
        )}
        {proposedDay && <span className="planner-card-proposed">→ {shortDay(proposedDay)}</span>}
      </button>
      <button
        type="button"
        className="planner-card-move"
        aria-label={`Mover «${task.title}» a otro día`}
        aria-expanded={Boolean(menu)}
        onClick={toggleMenu}
      >
        <CalendarClock size={15} />
      </button>
      {menu}
    </article>
  );
}

export default function WeeklyReviewView({
  tasks,
  projectId,
  today,
  search,
  openTask,
  rescheduleTasks,
  signals,
  previousReviewDay,
  finishReview,
  openSignal,
  createFollowUp,
  decideSignal,
}: Props) {
  const [offset, setOffset] = useState(0);
  const [capacity, setCapacity] = useState(() =>
    readStored(
      CAPACITY_KEY,
      (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : undefined;
      },
      DEFAULT_DAILY_CAPACITY,
    ),
  );
  const [includeWeekend, setIncludeWeekend] = useState(() =>
    readStored(WEEKEND_KEY, (value) => value === 'true', false),
  );
  const [draggedId, setDraggedId] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [menuFor, setMenuFor] = useState('');
  const [history, setHistory] = useState<MoveRecord[][]>([]);
  const [proposal, setProposal] = useState<{ moves: PlannedMove[]; selected: Set<string> }>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const focusAfterMove = useRef('');
  const root = useRef<HTMLDivElement>(null);

  const start = addDays(weekStart(today), offset * 7);
  const plan = weekPlan(tasks, projectId, today, start);
  const nextWeek = addDays(plan.end, 1);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const weekLoad = plan.days.map(({ day, tasks: dayTasks }) => ({ day, count: dayTasks.length }));
  const openThisWeek = weekLoad.reduce((total, { count }) => total + count, 0);
  const overloaded = weekLoad.filter(({ count }) => count > capacity).length;
  const proposedDays = new Map(
    proposal?.moves
      .filter(({ task }) => proposal.selected.has(task.id))
      .map(({ task, to }) => [task.id, to]) ?? [],
  );
  const query = search.trim().toLowerCase();
  const faded = (task: Task) =>
    Boolean(query) &&
    !`${task.title} ${task.description} ${task.nextStep}`.toLowerCase().includes(query);

  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = '';
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[data-planner-task="${CSS.escape(id)}"] .planner-card-main`,
      )
      ?.focus();
  }, [tasks]);

  useEffect(() => {
    setProposal(undefined);
    setNotice('');
  }, [start, capacity, includeWeekend]);

  async function move(changes: TaskReschedule[], focusId = '') {
    const pending = changes.filter(({ task, due }) => due && task.due !== due);
    if (!pending.length || busy) return;
    setBusy(true);
    setMenuFor('');
    focusAfterMove.current = focusId;
    try {
      if (await rescheduleTasks(pending)) {
        setHistory((previous) => [
          ...previous.slice(1 - HISTORY_LIMIT),
          pending.map(({ task, due }) => ({ taskId: task.id, from: task.due, to: due })),
        ]);
        setProposal(undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const last = history.at(-1);
    if (!last || busy) return;
    setHistory((previous) => previous.slice(0, -1));
    // Solo se revierte lo que sigue donde lo dejó el planificador.
    const changes = last.flatMap(({ taskId, from, to }) => {
      const task = byId.get(taskId);
      return task && task.due === to ? [{ task, due: from }] : [];
    });
    if (!changes.length) return;
    setBusy(true);
    try {
      await rescheduleTasks(changes);
    } finally {
      setBusy(false);
    }
  }

  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z')
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void undoRef.current();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  function step(task: Task, delta: -1 | 1) {
    const from = task.due < today ? addDays(today, -1) : task.due;
    const due = addDays(from, delta);
    if (due < today) return;
    void move([{ task, due }], task.id);
  }

  function propose() {
    const moves = balanceWeek(tasks, projectId, today, start, { capacity, includeWeekend });
    setNotice(
      moves.length
        ? ''
        : overloaded || (offset === 0 && plan.overdue.length)
          ? 'No hay huecos libres con esta capacidad. Sube el límite diario o incluye el fin de semana.'
          : 'La semana ya está equilibrada.',
    );
    setProposal(
      moves.length ? { moves, selected: new Set(moves.map(({ task }) => task.id)) } : undefined,
    );
  }

  function dropZone(day: string) {
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        const task = byId.get(draggedId);
        // «Más adelante» solo recibe tareas de esta semana o atrasadas, nunca las adelanta.
        if (!task || task.due === day || (day === nextWeek && task.due > plan.end)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(day);
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget('');
      },
      onDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        setDropTarget('');
        const task = byId.get(draggedId || event.dataTransfer.getData('text/plain'));
        setDraggedId('');
        if (task) void move([{ task, due: day }], task.id);
      },
    };
  }

  function card(item: PlannerTask) {
    const { task } = item;
    return (
      <PlannerCard
        key={task.id}
        item={item}
        faded={faded(task)}
        dragging={draggedId === task.id}
        proposedDay={proposedDays.get(task.id)}
        openTask={() => openTask(task)}
        toggleMenu={() => setMenuFor((current) => (current === task.id ? '' : task.id))}
        step={(delta) => step(task, delta)}
        startDrag={(event) => {
          event.dataTransfer.setData('text/plain', task.id);
          event.dataTransfer.effectAllowed = 'move';
          setDraggedId(task.id);
          setMenuFor('');
        }}
        endDrag={() => {
          setDraggedId('');
          setDropTarget('');
        }}
        menu={
          menuFor === task.id && (
            <MoveMenu
              task={task}
              days={weekLoad}
              today={today}
              nextWeek={nextWeek}
              move={(due) => void move([{ task, due }], task.id)}
              close={() => setMenuFor('')}
            />
          )
        }
      />
    );
  }

  async function finish() {
    setFinishing(true);
    setFinishError('');
    try {
      await finishReview();
    } catch (cause) {
      setFinishError((cause as Error).message);
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="weekly-planner" ref={root} aria-busy={busy}>
      <section className="planner-toolbar" aria-label="Semana y reparto">
        <div className="planner-week-nav">
          <button
            type="button"
            className="icon-button"
            aria-label="Semana anterior"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <h2>
              {dayParts(plan.start).number} {dayParts(plan.start).month} –{' '}
              {dayParts(plan.end).number} {dayParts(plan.end).month}
            </h2>
            <span>{weekCaption(offset)}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Semana siguiente"
            onClick={() => setOffset((value) => value + 1)}
          >
            <ChevronRight size={18} />
          </button>
          {offset > 0 && (
            <button type="button" className="planner-link" onClick={() => setOffset(0)}>
              Volver a hoy
            </button>
          )}
        </div>
        <div className="planner-tools">
          <label className="planner-capacity">
            Tareas por día
            <input
              type="number"
              min={1}
              max={20}
              value={capacity}
              onChange={(event) => {
                const value = Math.min(20, Math.max(1, Math.round(Number(event.target.value))));
                if (!Number.isFinite(value)) return;
                setCapacity(value);
                store(CAPACITY_KEY, String(value));
              }}
            />
          </label>
          <label className="planner-weekend">
            <input
              type="checkbox"
              checked={includeWeekend}
              onChange={(event) => {
                setIncludeWeekend(event.target.checked);
                store(WEEKEND_KEY, String(event.target.checked));
              }}
            />
            Repartir en fin de semana
          </label>
          <button type="button" className="planner-primary" disabled={busy} onClick={propose}>
            <Scale size={15} /> Equilibrar semana
          </button>
          <button
            type="button"
            className="planner-secondary"
            disabled={busy || !history.length}
            onClick={() => void undo()}
            title="Deshacer el último movimiento (Ctrl + Z)"
          >
            <Undo2 size={15} /> Deshacer
          </button>
        </div>
        <p className="planner-summary">
          <strong>{openThisWeek}</strong> {openThisWeek === 1 ? 'tarea abierta' : 'tareas abiertas'}
          {offset === 0 ? ' de hoy al domingo' : ' esta semana'}
          {overloaded > 0 && (
            <>
              {' · '}
              <span className="planner-warning">
                {overloaded} {overloaded === 1 ? 'día supera' : 'días superan'} {capacity}
              </span>
            </>
          )}
          {plan.overdue.length > 0 && (
            <>
              {' · '}
              <span className="planner-warning">
                {plan.overdue.length} {plan.overdue.length === 1 ? 'atrasada' : 'atrasadas'}
              </span>
            </>
          )}
          <span className="planner-hint">
            Arrastra las tarjetas entre días o usa ← → con una tarjeta seleccionada.
          </span>
        </p>
        {notice && (
          <p className="planner-notice" role="status">
            {notice}
          </p>
        )}
      </section>

      {proposal && (
        <section className="planner-proposal" aria-label="Propuesta de reparto">
          <header>
            <div>
              <h2>Propuesta de reparto</h2>
              <p>
                Desmarca lo que prefieras dejar como está. Nada cambia hasta que apliques la
                propuesta.
              </p>
            </div>
          </header>
          <ul>
            {proposal.moves.map(({ task, from, to }) => (
              <li key={task.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={proposal.selected.has(task.id)}
                    onChange={(event) => {
                      const selected = new Set(proposal.selected);
                      if (event.target.checked) selected.add(task.id);
                      else selected.delete(task.id);
                      setProposal({ ...proposal, selected });
                    }}
                  />
                  <span className="planner-proposal-title">{task.title}</span>
                  <span className="planner-proposal-days">
                    {shortDay(from)} → <strong>{shortDay(to)}</strong>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="planner-proposal-actions">
            <button
              type="button"
              className="planner-primary"
              disabled={busy || !proposal.selected.size}
              onClick={() =>
                void move(
                  proposal.moves
                    .filter(({ task }) => proposal.selected.has(task.id))
                    .map(({ task, to }) => ({ task, due: to })),
                )
              }
            >
              Aplicar {proposal.selected.size} {proposal.selected.size === 1 ? 'cambio' : 'cambios'}
            </button>
            <button
              type="button"
              className="planner-secondary"
              onClick={() => setProposal(undefined)}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {plan.overdue.length > 0 && (
        <section className="planner-tray overdue" aria-label="Atrasadas">
          <header>
            <div>
              <h2>
                <Inbox size={16} /> Por recolocar
              </h2>
              <p>Tareas abiertas con fecha pasada. Arrástralas al día en que vayas a hacerlas.</p>
            </div>
            <button
              type="button"
              className="planner-secondary"
              disabled={busy}
              onClick={() => void move(plan.overdue.map(({ task }) => ({ task, due: today })))}
            >
              Todas a hoy
            </button>
          </header>
          <div className="planner-tray-cards">{plan.overdue.map(card)}</div>
        </section>
      )}

      <div className="planner-grid" role="list" aria-label="Días de la semana">
        {plan.days.map(({ day, past, tasks: dayTasks, done }) => {
          const { weekday, number, month } = dayParts(day);
          const count = dayTasks.length;
          const level = count > capacity ? 'over' : count === capacity ? 'full' : '';
          return (
            <section
              key={day}
              role="listitem"
              aria-label={taskDateLabel(day)}
              className={`planner-day ${day === today ? 'today' : ''} ${past ? 'past' : ''} ${dropTarget === day ? 'drop-target' : ''} ${level}`}
              {...(past ? {} : dropZone(day))}
            >
              <header>
                <span className="planner-day-name">{weekday}</span>
                <strong>{number}</strong>
                <span className="planner-day-month">{month}</span>
                {day === today && <em>Hoy</em>}
              </header>
              <div
                className="planner-meter"
                aria-label={
                  past
                    ? `${done} completadas`
                    : `${count} de ${capacity} tareas${done ? `, ${done} completadas` : ''}`
                }
              >
                {!past && (
                  <>
                    <span className="planner-meter-bar">
                      <span style={{ width: `${Math.min(100, (count / capacity) * 100)}%` }} />
                    </span>
                    <span className="planner-meter-count">
                      {count}/{capacity}
                    </span>
                  </>
                )}
                {done > 0 && (
                  <span className="planner-meter-done">
                    <CheckCircle2 size={12} /> {done}
                  </span>
                )}
              </div>
              <div className="planner-day-cards">
                {past ? (
                  <p className="planner-day-empty">Día pasado</p>
                ) : count ? (
                  dayTasks.map(card)
                ) : (
                  <p className="planner-day-empty">Libre</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section
        className={`planner-tray later ${dropTarget === nextWeek ? 'drop-target' : ''}`}
        aria-label="Más adelante"
        {...dropZone(nextWeek)}
      >
        <header>
          <div>
            <h2>Más adelante</h2>
            <p>
              Suelta aquí una tarjeta para pasarla al {taskDateLabel(nextWeek).toLowerCase()}.
              {plan.laterTotal > plan.later.length &&
                ` Se muestran las ${plan.later.length} siguientes de ${plan.laterTotal}.`}
            </p>
          </div>
        </header>
        {plan.later.length ? (
          <div className="planner-tray-cards">{plan.later.map(card)}</div>
        ) : (
          <p className="planner-day-empty">No hay tareas abiertas después de esta semana.</p>
        )}
      </section>

      <section className="review-group planner-followup" aria-label="Seguimiento">
        <header>
          <div>
            <h2>Seguimiento</h2>
            <p>
              {previousReviewDay
                ? `Comparando con la revisión del ${previousReviewDay}.`
                : 'Aún no hay una revisión anterior. Termina esta revisión para crear el primer punto de comparación.'}{' '}
              Acuerdos, resultados y tareas que requieren una acción explícita.
            </p>
          </div>
          <span>{signals.length}</span>
        </header>
        {signals.length ? (
          <div className="review-cards">
            {signals.map((signal) => (
              <article className="review-card" key={signal.key}>
                <h3>{signal.title}</h3>
                <SignalActions
                  signal={signal}
                  today={today}
                  openSignal={openSignal}
                  createFollowUp={createFollowUp}
                  decideSignal={decideSignal}
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="review-empty">No hay señales de seguimiento visibles.</p>
        )}
        <div className="planner-finish">
          <button
            type="button"
            className="planner-secondary"
            disabled={finishing}
            onClick={() => void finish()}
          >
            Terminar revisión
          </button>
          {finishError && (
            <p className="review-error" role="alert">
              {finishError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
