import { useEffect, useState } from 'react';
import { taskDateLabel, type Task } from '../../shared/model';
import { addDays } from '../../shared/recurrence';
import type { WeeklySignal } from '../../shared/weeklyReviewSignals';
import { type ReviewGroup, type ReviewTask, weeklyLoad } from '../weeklyReview';

interface Props {
  items: ReviewTask[];
  tasks: Task[];
  projectId: string;
  today: string;
  search: string;
  openTask: (task: Task) => void;
  updateTask: (task: Task, patch: Partial<Pick<Task, 'due' | 'nextStep'>>) => Promise<void>;
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
            : signal.kind === 'asvs'
              ? 'Seguimiento ASVS'
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
              : signal.kind === 'asvs'
                ? 'requisito ASVS'
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

const groups: { name: ReviewGroup; description: string; empty: string }[] = [
  {
    name: 'Atender',
    description: 'Vencidas, previstas esta semana y pendientes de revisión.',
    empty: 'No hay tareas urgentes ni pendientes de revisión.',
  },
  {
    name: 'Desbloquear',
    description: 'Bloqueos declarados y dependencias que aún no están completadas.',
    empty: 'No hay bloqueos pendientes.',
  },
  {
    name: 'Planificar',
    description: 'Tareas posteriores a esta semana que necesitan un siguiente paso.',
    empty: 'Las tareas posteriores ya tienen un siguiente paso.',
  },
];

function ReviewCard({
  item,
  openTask,
  updateTask,
  signal,
  today,
  openSignal,
  createFollowUp,
  decideSignal,
}: Pick<
  Props,
  'openTask' | 'updateTask' | 'today' | 'openSignal' | 'createFollowUp' | 'decideSignal'
> & { item: ReviewTask; signal?: WeeklySignal }) {
  const { task, pendingDependencies } = item;
  const [due, setDue] = useState(task.due);
  const [nextStep, setNextStep] = useState(task.nextStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDue(task.due);
    setNextStep(task.nextStep);
    setError('');
  }, [task.version, task.due, task.nextStep]);

  async function save(patch: Partial<Pick<Task, 'due' | 'nextStep'>>) {
    setBusy(true);
    setError('');
    try {
      await updateTask(task, patch);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="review-card">
      <div className="review-card-top">
        <div>
          <button type="button" className="review-task-link" onClick={() => openTask(task)}>
            {task.title}
          </button>
          <p>
            {taskDateLabel(task.due)} · {task.priority} · {task.state}
          </p>
        </div>
        <span className="review-card-phase">{task.phase}</span>
      </div>
      <div className="review-signals" aria-label="Señales de la tarea">
        {item.signals.map((signal) => (
          <span key={signal}>{signal}</span>
        ))}
      </div>
      {task.blocked.trim() && <p className="review-blocker">Bloqueo: {task.blocked}</p>}
      {pendingDependencies.length > 0 && (
        <div className="review-dependencies">
          <strong>Impiden avanzar:</strong>
          {pendingDependencies.map((dependency) => (
            <button key={dependency.id} type="button" onClick={() => openTask(dependency)}>
              {dependency.title} · {dependency.state}
            </button>
          ))}
        </div>
      )}
      {signal && (
        <SignalActions
          signal={signal}
          today={today}
          openSignal={openSignal}
          createFollowUp={createFollowUp}
          decideSignal={decideSignal}
        />
      )}
      <div className="review-actions">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (due !== task.due) void save({ due });
          }}
        >
          <label htmlFor={`review-due-${task.id}`}>Reprogramar fecha</label>
          <div>
            <input
              id={`review-due-${task.id}`}
              type="date"
              required
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
            <button type="submit" disabled={busy || !due || due === task.due}>
              Guardar fecha
            </button>
          </div>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (nextStep.trim() !== task.nextStep) void save({ nextStep: nextStep.trim() });
          }}
        >
          <label htmlFor={`review-step-${task.id}`}>Siguiente paso</label>
          <div>
            <textarea
              id={`review-step-${task.id}`}
              maxLength={16000}
              rows={2}
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              placeholder="Define una acción concreta"
            />
            <button type="submit" disabled={busy || nextStep.trim() === task.nextStep}>
              Guardar paso
            </button>
          </div>
        </form>
      </div>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export default function WeeklyReviewView({
  items,
  tasks,
  projectId,
  today,
  search,
  openTask,
  updateTask,
  signals,
  previousReviewDay,
  finishReview,
  openSignal,
  createFollowUp,
  decideSignal,
}: Props) {
  const load = weeklyLoad(tasks, projectId, today);
  const groupedTaskIds = new Set(items.map((item) => item.task.id));
  const separateSignals = signals.filter(
    (signal) => signal.kind !== 'stagnant' || !groupedTaskIds.has(signal.recordId),
  );
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
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
    <div className="weekly-review">
      <section className="review-load" aria-label="Corte de revisión">
        <h2>Comparación semanal</h2>
        <p>
          {previousReviewDay
            ? `Comparando con la revisión del ${previousReviewDay}.`
            : 'Aún no hay una revisión anterior. Termina esta revisión para crear el primer punto de comparación.'}
        </p>
        <button type="button" disabled={finishing} onClick={() => void finish()}>
          Terminar revisión
        </button>
        {finishError && (
          <p className="review-error" role="alert">
            {finishError}
          </p>
        )}
      </section>
      <section className="review-load" aria-labelledby="review-load-title">
        <h2 id="review-load-title">Carga de los próximos siete días</h2>
        <p>Cuenta las tareas abiertas previstas para cada día del cuaderno.</p>
        <div className="review-load-days">
          {load.map(({ day, count }) => (
            <div key={day} className={count >= 3 ? 'high' : ''}>
              <span>{taskDateLabel(day)}</span>
              <strong>{count}</strong>
              <small>{count >= 3 ? 'Carga alta' : count === 1 ? 'tarea' : 'tareas'}</small>
            </div>
          ))}
        </div>
      </section>
      {groups.map((group) => {
        const matches = items.filter((item) => item.group === group.name);
        return (
          <section key={group.name} className="review-group" aria-label={group.name}>
            <header>
              <div>
                <h2>{group.name}</h2>
                <p>{group.description}</p>
              </div>
              <span>{matches.length}</span>
            </header>
            {matches.length ? (
              <div className="review-cards">
                {matches.map((item) => (
                  <ReviewCard
                    key={item.task.id}
                    item={item}
                    openTask={openTask}
                    updateTask={updateTask}
                    signal={signals.find(
                      (signal) => signal.kind === 'stagnant' && signal.recordId === item.task.id,
                    )}
                    today={today}
                    openSignal={openSignal}
                    createFollowUp={createFollowUp}
                    decideSignal={decideSignal}
                  />
                ))}
              </div>
            ) : (
              <p className="review-empty">
                {search ? 'No hay coincidencias en este grupo.' : group.empty}
              </p>
            )}
          </section>
        );
      })}
      <section className="review-group" aria-label="Seguimiento">
        <header>
          <div>
            <h2>Seguimiento</h2>
            <p>Acuerdos, resultados y tareas que requieren una acción explícita.</p>
          </div>
          <span>{separateSignals.length}</span>
        </header>
        {separateSignals.length ? (
          <div className="review-cards">
            {separateSignals.map((signal) => (
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
      </section>
    </div>
  );
}
