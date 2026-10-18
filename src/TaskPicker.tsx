import { useState } from 'react';
import type { Task } from '../shared/model';
import { Field } from './ui';

const RECENT_TASK_LIMIT = 10;

export default function TaskPicker({
  label,
  searchLabel,
  tasks,
  value,
  onChange,
}: {
  label: string;
  searchLabel: string;
  tasks: Task[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const recent = [...tasks].sort(
    (first, second) =>
      second.updatedAt.localeCompare(first.updatedAt) ||
      second.createdAt.localeCompare(first.createdAt) ||
      first.title.localeCompare(second.title, 'es'),
  );
  const selectedTasks = recent.filter((task) => selected.has(task.id));
  const normalizedQuery = query
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
  const candidates = recent.filter((task) => {
    if (selected.has(task.id)) return false;
    return task.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .includes(normalizedQuery);
  });
  const visible = [...selectedTasks, ...candidates.slice(0, RECENT_TASK_LIMIT)];

  return (
    <details className="task-picker">
      <summary>
        <strong>{label}</strong>
        <span className="muted">
          {value.length === 0
            ? 'Ninguna seleccionada'
            : `${value.length} ${value.length === 1 ? 'seleccionada' : 'seleccionadas'}`}
        </span>
      </summary>
      <Field label={searchLabel}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por título"
        />
      </Field>
      <div className="task-picker-options">
        {visible.map((task) => (
          <label className="checkbox" key={task.id}>
            <input
              type="checkbox"
              checked={selected.has(task.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...value, task.id] : value.filter((id) => id !== task.id),
                )
              }
            />
            <span>
              {task.title} <small>· {task.state}</small>
            </span>
          </label>
        ))}
      </div>
      {candidates.length > RECENT_TASK_LIMIT && (
        <small className="muted">
          Mostrando {RECENT_TASK_LIMIT} de {candidates.length} tareas. Busca por título para
          encontrar otras.
        </small>
      )}
      {!visible.length && (
        <small className="muted">
          {query.trim() ? 'No hay tareas que coincidan.' : 'No hay tareas disponibles.'}
        </small>
      )}
    </details>
  );
}
