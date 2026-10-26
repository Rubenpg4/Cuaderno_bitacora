import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  MAX_NEW_TASK_DEPENDENCIES,
  PRIORITIES,
  madridDate,
  type NewTaskDependency,
  type Task,
} from '../shared/model';
import { addDays } from '../shared/recurrence';
import TaskPicker from './TaskPicker';
import { Badge, Button, Field } from './ui';

export interface TaskDependencyValue {
  dependencyIds: string[];
  newDependencies: NewTaskDependency[];
  blockedIds: string[];
}

/** Ids reachable from `start` following `next`, including the starting ids. */
function reachable(start: string[], next: (id: string) => string[]) {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...next(id));
  }
  return seen;
}

/** Suggests finishing the prerequisite the day before the task, never in the past. */
function suggestedDue(taskDue: string) {
  const today = madridDate();
  const before = taskDue ? addDays(taskDue, -1) : today;
  return before < today ? today : before;
}

const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export default function TaskDependencyFields({
  tasks,
  value,
  onChange,
  taskDue,
  taskPriority,
  taskState,
  allowNew,
  allowBlocks,
  waitingTasks = [],
}: {
  /** Tasks in the same scope as the edited one, excluding itself. */
  tasks: Task[];
  value: TaskDependencyValue;
  onChange: (patch: Partial<TaskDependencyValue>) => void;
  taskDue: string;
  taskPriority: Task['priority'];
  taskState: Task['state'];
  allowNew: boolean;
  allowBlocks: boolean;
  /** Existing tasks that already wait for the edited one. */
  waitingTasks?: Task[];
}) {
  const [draft, setDraft] = useState<NewTaskDependency | null>(null);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  // Offer only combinations the service accepts: a task cannot both precede and wait for this one.
  const upstream = reachable(value.dependencyIds, (id) => byId.get(id)?.dependencyIds ?? []);
  const downstream = reachable(value.blockedIds, (id) =>
    tasks.filter((task) => task.dependencyIds.includes(id)).map((task) => task.id),
  );
  const dependencyOptions = tasks.filter((task) => !downstream.has(task.id));
  const blockOptions = tasks.filter(
    (task) =>
      value.blockedIds.includes(task.id) ||
      (!upstream.has(task.id) &&
        !task.recurrence?.canceledAt &&
        task.state !== 'Completada' &&
        (task.state === 'Por hacer' || taskState === 'Completada')),
  );
  const canAddMore = value.newDependencies.length < MAX_NEW_TASK_DEPENDENCIES;

  function openDraft() {
    setDraft({ title: '', due: suggestedDue(taskDue), priority: taskPriority });
  }
  function addDraft() {
    if (!draft?.title.trim() || !draft.due) return;
    onChange({
      newDependencies: [...value.newDependencies, { ...draft, title: draft.title.trim() }],
    });
    setDraft(null);
  }

  return (
    <div className="task-dependencies">
      <TaskPicker
        label="Depende de estas tareas (opcional)"
        searchLabel="Buscar tareas de las que depende"
        tasks={dependencyOptions}
        value={value.dependencyIds}
        onChange={(dependencyIds) => onChange({ dependencyIds })}
        newCount={value.newDependencies.length}
      />
      {value.newDependencies.length > 0 && (
        <ul className="task-new-dependencies" aria-label="Tareas previas que se crearán">
          {value.newDependencies.map((dependency, index) => (
            <li key={index}>
              <Badge tone="blue">Nueva</Badge>
              <span>
                <strong>{dependency.title}</strong>
                <small>
                  {shortDay(dependency.due)} · {dependency.priority}
                  {taskDue && dependency.due > taskDue ? ' · termina después que esta tarea' : ''}
                </small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Quitar tarea previa «${dependency.title}»`}
                onClick={() =>
                  onChange({
                    newDependencies: value.newDependencies.filter((_, item) => item !== index),
                  })
                }
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!allowNew && value.newDependencies.length > 0 && (
        <small className="muted">
          Las tareas repetidas no admiten tareas previas nuevas. Quítalas o desactiva la repetición.
        </small>
      )}
      {allowNew &&
        (draft ? (
          <fieldset
            className="task-new-dependency-form"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Close only this mini form, not the editor dialog around it.
                event.stopPropagation();
                setDraft(null);
              }
            }}
          >
            <legend>Nueva tarea previa</legend>
            <Field label="Título de la tarea previa">
              <input
                value={draft.title}
                maxLength={240}
                autoFocus
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                onKeyDown={(event) => {
                  // Enter adds the prerequisite instead of submitting the whole task.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addDraft();
                }}
              />
            </Field>
            <div className="form-grid">
              <Field label="Fecha de la tarea previa">
                <input
                  type="date"
                  value={draft.due}
                  onChange={(event) => setDraft({ ...draft, due: event.target.value })}
                />
              </Field>
              <Field label="Prioridad de la tarea previa">
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({ ...draft, priority: event.target.value as Task['priority'] })
                  }
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </Field>
            </div>
            {taskDue && draft.due > taskDue && (
              <small className="muted">Termina después que esta tarea; revisa las fechas.</small>
            )}
            <div className="row">
              <Button disabled={!draft.title.trim() || !draft.due} onClick={addDraft}>
                <Plus size={16} /> Añadir tarea previa
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            </div>
            <small className="muted">
              Se creará en el mismo cuaderno y ámbito al guardar esta tarea; si no la guardas, no se
              crea nada.
            </small>
          </fieldset>
        ) : (
          <Button variant="ghost" disabled={!canAddMore} onClick={openDraft}>
            <Plus size={16} /> Crear tarea previa
          </Button>
        ))}
      {allowBlocks && (
        <TaskPicker
          label="Bloquea a estas tareas (opcional)"
          searchLabel="Buscar tareas que esperarán a esta"
          tasks={blockOptions}
          value={value.blockedIds}
          onChange={(blockedIds) => onChange({ blockedIds })}
          hint="Esas tareas esperarán a que completes esta. Solo se ofrecen tareas «Por hacer» que no formen un ciclo."
        />
      )}
      {waitingTasks.length > 0 && (
        <p className="muted task-waiting">
          Esperan a esta tarea: {waitingTasks.map((task) => task.title).join(', ')}.
        </p>
      )}
    </div>
  );
}
