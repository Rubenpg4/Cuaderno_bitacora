import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ListFilter,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { type Task } from '../../shared/model';
import CopyRecordId from '../CopyRecordId';
import {
  TASK_SORT_FIELDS,
  sortListTasks,
  type TaskSortField,
  type TaskSortRule,
} from '../taskList';

interface Props {
  tasks: Task[];
  /** Provenance shown in the aggregated view of a project with subprojects. */
  scopeLabel?: (task: Task) => string;
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  onClear: () => void;
  openTask: (task: Task) => void;
  deleteTask: (task: Task) => void;
  createTask: () => void;
}

const defaultSort: TaskSortRule[] = [{ field: 'due', direction: 'asc' }];

export default function TaskListView({
  tasks,
  scopeLabel,
  total,
  search,
  onSearchChange,
  onClear,
  openTask,
  deleteTask,
  createTask,
}: Props) {
  const [sortRules, setSortRules] = useState<TaskSortRule[]>(defaultSort);
  const [nextField, setNextField] = useState<TaskSortField>('title');
  const sorted = sortListTasks(tasks, sortRules);
  const selectedFields = new Set(sortRules.map((rule) => rule.field));
  const available = TASK_SORT_FIELDS.filter((item) => !selectedFields.has(item.field));

  function sortFromHeader(field: TaskSortField) {
    setSortRules((rules) => {
      if (rules[0]?.field === field) {
        return [
          { field, direction: rules[0].direction === 'asc' ? 'desc' : 'asc' },
          ...rules.slice(1),
        ];
      }
      const previous = rules.find((rule) => rule.field === field);
      return [
        previous ?? { field, direction: 'asc' },
        ...rules.filter((rule) => rule.field !== field),
      ];
    });
  }

  function changeSortField(index: number, field: TaskSortField) {
    setSortRules((rules) => {
      if (rules[index]?.field === field) return rules;
      if (rules.some((rule) => rule.field === field)) return rules;
      return rules.map((rule, position) => (position === index ? { ...rule, field } : rule));
    });
  }

  function addSecondary() {
    const field = available.some((item) => item.field === nextField)
      ? nextField
      : available[0]?.field;
    if (!field) return;
    setSortRules((rules) =>
      rules.some((rule) => rule.field === field) ? rules : [...rules, { field, direction: 'asc' }],
    );
    setNextField(
      TASK_SORT_FIELDS.find(
        (item) => item.field !== field && !sortRules.some((rule) => rule.field === item.field),
      )?.field ?? 'title',
    );
  }

  function sortHeader(field: TaskSortField) {
    const index = sortRules.findIndex((rule) => rule.field === field);
    const rule = sortRules[index];
    const label = TASK_SORT_FIELDS.find((item) => item.field === field)?.label;
    return (
      <div
        className={`task-list-cell ${field}`}
        role="columnheader"
        aria-sort={
          index === 0 ? (rule.direction === 'asc' ? 'ascending' : 'descending') : undefined
        }
        key={field}
      >
        <button
          type="button"
          onClick={() => sortFromHeader(field)}
          aria-label={`Ordenar por ${label}`}
        >
          {label}
          {rule && (
            <span className="task-list-sort-index">
              {index + 1}
              {rule.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <section className="task-list-view" aria-label="Vista de lista de tareas">
      <div className="task-list-tools">
        <label className="task-list-search">
          <Search size={17} aria-hidden="true" />
          <input
            id="global-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar tareas por título o contenido"
            aria-label="Buscar tareas"
          />
        </label>
        <span className="task-list-result-count" aria-live="polite">
          {sorted.length} de {total} {total === 1 ? 'tarea' : 'tareas'}
        </span>
        {(search || tasks.length !== total) && (
          <button type="button" className="task-list-clear" onClick={onClear}>
            Limpiar búsqueda y filtros
          </button>
        )}
      </div>
      <div className="task-list-sort-tools" aria-label="Orden de la lista">
        <div className="task-list-sort-heading">
          <span className="task-list-sort-icon">
            <ListFilter size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>Ordenar tareas</strong>
            <small>El primer criterio decide el orden; los siguientes desempatan.</small>
          </span>
        </div>
        <div className="task-list-sort-controls">
          <div className="task-list-sort-rules">
            {sortRules.map((rule, index) => (
              <span
                className={`task-list-sort-rule ${index === 0 ? 'primary' : ''}`}
                key={rule.field}
              >
                <span className="task-list-sort-position" aria-hidden="true">
                  {index + 1}
                </span>
                <select
                  aria-label={index === 0 ? 'Orden principal' : `Orden secundario ${index + 1}`}
                  value={rule.field}
                  onChange={(event) => changeSortField(index, event.target.value as TaskSortField)}
                >
                  {TASK_SORT_FIELDS.filter(
                    (item) => item.field === rule.field || !selectedFields.has(item.field),
                  ).map((item) => (
                    <option key={item.field} value={item.field}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="task-list-sort-rule-actions">
                  <button
                    type="button"
                    aria-label={`Cambiar dirección de ${TASK_SORT_FIELDS.find((item) => item.field === rule.field)?.label}`}
                    title={rule.direction === 'asc' ? 'Ascendente' : 'Descendente'}
                    onClick={() =>
                      setSortRules((rules) =>
                        rules.map((item) =>
                          item.field === rule.field
                            ? { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' }
                            : item,
                        ),
                      )
                    }
                  >
                    {rule.direction === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  </button>
                  {sortRules.length > 1 && (
                    <button
                      type="button"
                      className="task-list-sort-remove"
                      aria-label={`Quitar orden por ${TASK_SORT_FIELDS.find((item) => item.field === rule.field)?.label}`}
                      onClick={() =>
                        setSortRules((rules) => rules.filter((item) => item.field !== rule.field))
                      }
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </span>
            ))}
          </div>
          {available.length > 0 && (
            <div className="task-list-add-sort">
              <select
                aria-label="Nuevo criterio secundario"
                value={
                  available.some((item) => item.field === nextField)
                    ? nextField
                    : available[0].field
                }
                onChange={(event) => setNextField(event.target.value as TaskSortField)}
              >
                {available.map((item) => (
                  <option value={item.field} key={item.field}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addSecondary}>
                <Plus size={15} /> Añadir criterio
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="task-list-sort-hint">También puedes pulsar una columna para ponerla primero.</p>
      {sorted.length ? (
        <div className="task-list-table" role="table" aria-label="Tareas del proyecto">
          <div className="task-list-table-head" role="row">
            {TASK_SORT_FIELDS.map((item) => sortHeader(item.field))}
            <div className="task-list-cell actions" role="columnheader">
              Acciones
            </div>
          </div>
          {sorted.map((task) => (
            <div className="task-list-table-row" role="row" key={task.id}>
              <div className="task-list-cell title" role="cell">
                <button type="button" className="task-list-title" onClick={() => openTask(task)}>
                  <span
                    className={`task-list-state-mark ${task.state === 'Completada' ? 'done' : task.state === 'En revisión' ? 'review' : task.state === 'En curso' ? 'active' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{task.title}</span>
                </button>
                {scopeLabel && <small className="task-list-scope">{scopeLabel(task)}</small>}
                {task.blocked && <span className="task-list-blocked">Bloqueada</span>}
              </div>
              <div className="task-list-cell state" role="cell" data-label="Estado">
                <span
                  className={`task-list-status ${task.state === 'Completada' ? 'done' : task.state === 'En revisión' ? 'review' : task.state === 'En curso' ? 'active' : ''}`}
                >
                  {task.state}
                </span>
              </div>
              <div className="task-list-cell priority" role="cell" data-label="Prioridad">
                <span
                  className={`priority priority-${task.priority.toLowerCase().replaceAll(' ', '-')}`}
                >
                  ● {task.priority}
                </span>
              </div>
              <div className="task-list-cell phase" role="cell" data-label="Fase">
                {task.phase || 'Sin fase'}
              </div>
              <div className="task-list-cell due" role="cell" data-label="Fecha">
                <time dateTime={task.due}>
                  {task.due
                    ? new Date(`${task.due}T12:00:00`).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : 'Sin fecha'}
                </time>
              </div>
              <div className="task-list-cell actions" role="cell">
                <button
                  type="button"
                  className="task-row-action"
                  aria-label={`Ampliar detalles de ${task.title}`}
                  onClick={() => openTask(task)}
                >
                  <ChevronRight size={17} />
                </button>
                <CopyRecordId id={task.id} title={task.title} />
                <button
                  type="button"
                  className="task-row-action danger"
                  aria-label={`Borrar tarea ${task.title}`}
                  onClick={() => deleteTask(task)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="task-list-empty">
          <h2>
            {total ? 'No hay tareas con estos criterios' : 'Todavía no hay tareas en este proyecto'}
          </h2>
          <p>
            {total
              ? 'Cambia la búsqueda o limpia los filtros para ver más tareas.'
              : 'Crea una tarea para empezar a organizar el trabajo.'}
          </p>
          {total ? (
            <button type="button" onClick={onClear}>
              Limpiar búsqueda y filtros
            </button>
          ) : (
            <button type="button" onClick={createTask}>
              Crear tarea
            </button>
          )}
        </div>
      )}
    </section>
  );
}
