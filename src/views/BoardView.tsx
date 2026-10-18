import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Clock3,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useState, useRef, type DragEvent, type ReactNode } from 'react';
import {
  STATES,
  daysUntil,
  isIncidentResolved,
  madridDate,
  taskDateLabel,
  unresolved,
  type Incident,
  type Task,
} from '../../shared/model';
import { Badge } from '../ui';
import { isOverdueTask, compareBoardTasks } from '../taskFilters';
import CalendarMonths from './CalendarMonths';
import CopyRecordId from '../CopyRecordId';
import { useBoardAutoScroll } from './boardAutoScroll';

interface BoardViewProps {
  tasks: Task[];
  allTasks: Task[];
  incidents?: Incident[];
  filters: ReactNode;
  selectedId: string;
  projectName: (id: string, subprojectId?: string) => string;
  openTask: (task: Task) => void;
  openIncident?: (incident: Incident) => void;
  createTask: (state: Task['state']) => void;
  createIncident?: () => void;
  day: string;
  markedDays: Set<string>;
  tasksByDay: Map<string, Task[]>;
  incidentsByDay?: Map<string, Incident[]>;
  openDay: (day: string) => void;
  draggedTaskId: string;
  startTaskDrag: (event: DragEvent<HTMLElement>, task: Task) => void;
  endTaskDrag: () => void;
  moveTask: (task: Task, change: Partial<Pick<Task, 'state' | 'due'>>) => void;
  draggedIncidentId?: string;
  startIncidentDrag?: (event: DragEvent<HTMLElement>, incident: Incident) => void;
  endIncidentDrag?: () => void;
  moveIncident?: (
    incident: Incident,
    change: Partial<Pick<Incident, 'date' | 'resolvedDate' | 'solution'>>,
  ) => void;
}

function TaskDeadline({ due, today }: { due: string; today: string }) {
  const days = daysUntil(due, today);
  const tone = days < 0 ? 'overdue' : days <= 3 ? 'urgent' : days <= 7 ? 'soon' : '';
  const label =
    days < 0
      ? `${Math.abs(days)} ${days === -1 ? 'día' : 'días'} de retraso`
      : days === 0
        ? 'Vence hoy'
        : days === 1
          ? 'Queda 1 día'
          : `Quedan ${days} días`;
  return (
    <span className={`task-deadline ${tone}`}>
      <Clock3 size={13} /> {label}
    </span>
  );
}

export default function BoardView({
  tasks,
  allTasks,
  incidents = [],
  filters,
  selectedId,
  projectName,
  openTask,
  openIncident,
  createTask,
  createIncident,
  day,
  markedDays,
  tasksByDay,
  incidentsByDay,
  openDay,
  draggedTaskId,
  startTaskDrag,
  endTaskDrag,
  moveTask,
  draggedIncidentId = '',
  startIncidentDrag,
  endIncidentDrag,
  moveIncident,
}: BoardViewProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [showIncidents, setShowIncidents] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [dropState, setDropState] = useState<Task['state'] | ''>('');
  const boardRef = useRef<HTMLDivElement>(null);
  const today = madridDate();

  useBoardAutoScroll({
    enabled: calendarOpen && Boolean(draggedTaskId || draggedIncidentId),
    element: boardRef.current,
  });

  const draggedTask = tasks.find((task) => task.id === draggedTaskId);
  const draggedIncident = incidents.find((incident) => incident.id === draggedIncidentId);

  const unresolvedIncidents = incidents.filter((incident) => !isIncidentResolved(incident));
  const resolvedIncidents = incidents.filter((incident) => isIncidentResolved(incident));
  const overdueCount = tasks.filter((task) => isOverdueTask(task, today)).length;
  const groupKeys = [...new Set(tasks.map((task) => `${task.state}:${task.due}`))];
  const allGroupsExpanded =
    groupKeys.length > 0 && groupKeys.every((key) => expandedGroups.has(key));

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <div className="board-toolbar" ref={boardRef}>
        <div>
          <div className="board-stats-bar">
            <span className="board-stat-chip tasks" title={`${tasks.length} tareas en el tablero`}>
              <CheckSquare size={13} />
              <b>{tasks.length}</b> {tasks.length === 1 ? 'tarea' : 'tareas'}
            </span>
            {incidents.length > 0 && (
              <>
                <span className="board-stats-divider" aria-hidden="true" />
                <span
                  className={`board-stat-chip unresolved ${unresolvedIncidents.length === 0 ? 'zero' : ''}`}
                  title={`${unresolvedIncidents.length} incidencias pendientes de solución`}
                >
                  <AlertCircle size={13} />
                  <b>{unresolvedIncidents.length}</b>{' '}
                  {unresolvedIncidents.length === 1 ? 'pendiente' : 'pendientes'}
                </span>
                <span
                  className={`board-stat-chip resolved ${resolvedIncidents.length === 0 ? 'zero' : ''}`}
                  title={`${resolvedIncidents.length} incidencias resueltas`}
                >
                  <CheckCircle2 size={13} />
                  <b>{resolvedIncidents.length}</b>{' '}
                  {resolvedIncidents.length === 1 ? 'resuelta' : 'resueltas'}
                </span>
              </>
            )}
          </div>
          <p>Arrastra tarjetas entre columnas o al calendario para cambiar su fecha.</p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          {createIncident && (
            <button className="button secondary" onClick={createIncident}>
              <Plus size={15} /> Registrar incidencia
            </button>
          )}
          {incidents.length > 0 && (
            <label className="board-incidents-toggle">
              <input
                type="checkbox"
                checked={showIncidents}
                onChange={(e) => setShowIncidents(e.target.checked)}
              />
              Incidencias ({incidents.length})
            </label>
          )}
          {groupKeys.length > 0 && (
            <button
              className="board-calendar-toggle"
              onClick={() => setExpandedGroups(new Set(allGroupsExpanded ? [] : groupKeys))}
            >
              <ChevronDown size={16} className={allGroupsExpanded ? 'board-collapse-icon' : ''} />
              {allGroupsExpanded ? 'Contraer todo' : 'Expandir todo'}
            </button>
          )}
          <button
            className="board-calendar-toggle"
            aria-expanded={calendarOpen}
            onClick={() => setCalendarOpen(!calendarOpen)}
          >
            <CalendarDays size={16} /> {calendarOpen ? 'Ocultar calendario' : 'Mover fechas'}
          </button>
        </div>
      </div>
      {filters}
      {overdueCount > 0 && (
        <p className="board-overdue-notice" role="status">
          <AlertCircle size={16} /> {overdueCount}{' '}
          {overdueCount === 1 ? 'tarea vencida' : 'tareas vencidas'} sin completar. Cambia su fecha
          o márcalas como completadas.
        </p>
      )}
      {calendarOpen && (
        <CalendarMonths
          day={day}
          markedDays={markedDays}
          tasksByDay={tasksByDay}
          incidentsByDay={incidentsByDay}
          openDay={openDay}
          draggedTaskId={draggedTaskId}
          dropTask={(date) => {
            if (draggedTask) moveTask(draggedTask, { due: date });
          }}
          draggedIncidentId={draggedIncidentId}
          dropIncident={(date) => {
            if (draggedIncident && moveIncident) {
              if (isIncidentResolved(draggedIncident)) {
                moveIncident(draggedIncident, { resolvedDate: date });
              } else {
                moveIncident(draggedIncident, { date });
              }
            }
          }}
        />
      )}
      <div className="kanban">
        {STATES.map((state, index) => {
          const columnTasks = tasks.filter((task) => task.state === state).sort(compareBoardTasks);
          const tasksByDue = new Map<string, Task[]>();
          for (const task of columnTasks) {
            const dayTasks = tasksByDue.get(task.due) ?? [];
            dayTasks.push(task);
            tasksByDue.set(task.due, dayTasks);
          }

          const columnIncidents =
            showIncidents && state === 'Por hacer'
              ? [...unresolvedIncidents].sort((a, b) => a.date.localeCompare(b.date))
              : showIncidents && state === 'Completada'
                ? [...resolvedIncidents].sort((a, b) =>
                    (a.resolvedDate || a.date).localeCompare(b.resolvedDate || b.date),
                  )
                : [];

          return (
            <section
              className={`kanban-column ${dropState === state ? 'drop-target' : ''}`}
              key={state}
              onDragOver={(event) => {
                if (draggedTask && draggedTask.state !== state) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropState(state);
                  return;
                }
                if (draggedIncident) {
                  const isResolved = isIncidentResolved(draggedIncident);
                  if (
                    (isResolved && state === 'Por hacer') ||
                    (!isResolved && state === 'Completada')
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropState(state);
                  }
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropState('');
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropState('');
                if (draggedTask && draggedTask.state !== state) {
                  moveTask(draggedTask, { state });
                  return;
                }
                if (draggedIncident && moveIncident) {
                  const isResolved = isIncidentResolved(draggedIncident);
                  if (state === 'Por hacer' && isResolved) {
                    // Reabrir incidencia
                    moveIncident(draggedIncident, { solution: '', resolvedDate: '' });
                  } else if (state === 'Completada' && !isResolved) {
                    // Abrir editor para ingresar la solución requerida
                    if (openIncident) openIncident(draggedIncident);
                  }
                }
              }}
            >
              <h2>
                <span className={`column-dot c${index}`} />
                {state}
                <b>{columnTasks.length}</b>
                {showIncidents && columnIncidents.length > 0 && (
                  <span
                    className={`incident-col-badge ${state === 'Por hacer' ? 'unresolved' : 'resolved'}`}
                    title={`${columnIncidents.length} ${state === 'Por hacer' ? 'incidencias pendientes' : 'incidencias resueltas'}`}
                  >
                    {columnIncidents.length}
                  </span>
                )}
              </h2>

              {/* Incidencias sin solucionar en Por hacer */}
              {state === 'Por hacer' &&
                columnIncidents.map((incident) => (
                  <article
                    className={`task-card incident-card unresolved ${selectedId === incident.id ? 'selected' : ''} ${draggedIncidentId === incident.id ? 'dragging' : ''}`}
                    key={`incident-${incident.id}`}
                    draggable={Boolean(startIncidentDrag)}
                    onDragStart={(event) => startIncidentDrag?.(event, incident)}
                    onDragEnd={() => {
                      setDropState('');
                      endIncidentDrag?.();
                    }}
                  >
                    <button
                      className="task-card-main"
                      onClick={() =>
                        openIncident
                          ? openIncident(incident)
                          : openTask(incident as unknown as Task)
                      }
                    >
                      <div className="row spread" style={{ alignItems: 'center' }}>
                        <span className="card-project">
                          {projectName(incident.project, incident.subprojectId)}
                        </span>
                        <Badge tone="red">
                          <AlertCircle size={11} style={{ marginRight: 4 }} />
                          Sin solucionar
                        </Badge>
                      </div>
                      <h3>{incident.title}</h3>
                      <p>{incident.description || 'Sin descripción detallada.'}</p>
                      <div className="incident-card-date">
                        <CalendarDays size={14} />
                        <span>{taskDateLabel(incident.date)}</span>
                      </div>
                    </button>
                    <CopyRecordId id={incident.id} title={incident.title} />
                  </article>
                ))}

              {/* Tareas agrupadas por fecha de finalización */}
              {[...tasksByDue].map(([due, dayTasks]) => {
                const groupKey = `${state}:${due}`;
                return (
                  <details
                    className="board-day-group"
                    key={due}
                    open={expandedGroups.has(groupKey)}
                  >
                    <summary
                      onClick={(event) => {
                        event.preventDefault();
                        toggleGroup(groupKey);
                      }}
                    >
                      <CalendarDays size={15} aria-hidden="true" />
                      <span className="board-day-label">{taskDateLabel(due)}</span>
                      <span className="board-day-count">
                        {dayTasks.length} {dayTasks.length === 1 ? 'tarea' : 'tareas'}
                      </span>
                      <ChevronDown className="board-day-chevron" size={16} aria-hidden="true" />
                    </summary>
                    {dayTasks.map((task) => (
                      <article
                        className={`task-card ${selectedId === task.id ? 'selected' : ''} ${draggedTaskId === task.id ? 'dragging' : ''}`}
                        key={task.id}
                        draggable
                        onDragStart={(event) => startTaskDrag(event, task)}
                        onDragEnd={() => {
                          setDropState('');
                          endTaskDrag();
                        }}
                      >
                        <button className="task-card-main" onClick={() => openTask(task)}>
                          <span className="card-project">
                            {projectName(task.project, task.subprojectId)}
                          </span>
                          <h3>{task.title}</h3>
                          <p>
                            {task.description ||
                              task.nextStep ||
                              'Añade contexto al abrir la tarea.'}
                          </p>
                          <div className="card-tags">
                            <Badge>{task.phase}</Badge>
                            {task.blocked && <Badge tone="amber">Bloqueada</Badge>}
                            {task.state === 'Por hacer' &&
                              task.dependencyIds.some((id) =>
                                allTasks.some(
                                  (dependency) =>
                                    dependency.id === id && dependency.state !== 'Completada',
                                ),
                              ) && <Badge tone="amber">Espera tareas previas</Badge>}
                          </div>
                          <div className="task-card-date">
                            <CalendarDays size={14} />
                            <span>{taskDateLabel(task.due)}</span>
                          </div>
                          {task.state !== 'Completada' && (
                            <TaskDeadline due={task.due} today={today} />
                          )}
                          {isOverdueTask(task, today) && (
                            <span className="task-overdue-action">
                              Cambia la fecha o completa la tarea
                            </span>
                          )}
                          <div className="task-card-footer">
                            <span
                              className={`priority priority-${task.priority.toLowerCase().replaceAll(' ', '-')}`}
                            >
                              ● {task.priority}
                            </span>
                            <span>
                              <ShieldCheck size={13} />
                              {task.checks.filter((check) => !unresolved(check)).length}/
                              {task.checks.length}
                            </span>
                          </div>
                        </button>
                        <CopyRecordId id={task.id} title={task.title} />
                      </article>
                    ))}
                  </details>
                );
              })}

              {/* Incidencias solucionadas en Completada */}
              {state === 'Completada' &&
                columnIncidents.map((incident) => (
                  <article
                    className={`task-card incident-card resolved ${selectedId === incident.id ? 'selected' : ''} ${draggedIncidentId === incident.id ? 'dragging' : ''}`}
                    key={`incident-${incident.id}`}
                    draggable={Boolean(startIncidentDrag)}
                    onDragStart={(event) => startIncidentDrag?.(event, incident)}
                    onDragEnd={() => {
                      setDropState('');
                      endIncidentDrag?.();
                    }}
                  >
                    <button
                      className="task-card-main"
                      onClick={() =>
                        openIncident
                          ? openIncident(incident)
                          : openTask(incident as unknown as Task)
                      }
                    >
                      <div className="row spread" style={{ alignItems: 'center' }}>
                        <span className="card-project">
                          {projectName(incident.project, incident.subprojectId)}
                        </span>
                        <Badge tone="green">
                          <CheckCircle2 size={11} style={{ marginRight: 4 }} />
                          Solucionada
                        </Badge>
                      </div>
                      <h3>{incident.title}</h3>
                      {incident.solution && (
                        <div className="incident-solution-preview">
                          <strong>Solución</strong>
                          <p title={incident.solution}>{incident.solution}</p>
                        </div>
                      )}
                      <div className="incident-card-date">
                        <CheckCircle2 size={14} />
                        <span>
                          Resuelta el {taskDateLabel(incident.resolvedDate || incident.date)}
                        </span>
                      </div>
                    </button>
                    <CopyRecordId id={incident.id} title={incident.title} />
                  </article>
                ))}

              <button className="add-card" onClick={() => createTask(state)}>
                <Plus size={15} /> Añadir tarea
              </button>
            </section>
          );
        })}
      </div>
    </>
  );
}
