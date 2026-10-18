import { CalendarDays, ChevronDown, Filter, FilterX } from 'lucide-react';
import { useState } from 'react';
import { PHASES, PRIORITIES, STATES, type Task } from '../../shared/model';
import {
  emptyTaskFilters,
  hasActiveFilters,
  type BoardDateScope,
  type TaskFilters as Filters,
} from '../taskFilters';

interface Props {
  tasks: Task[];
  filters: Filters;
  onChange: (filters: Filters) => void;
  showDates?: boolean;
  dateScope?: BoardDateScope;
  onDateScopeChange?: (scope: BoardDateScope) => void;
  onClear?: () => void;
  count: number;
}

const BLOCKED_LABELS: Record<string, string> = {
  blocked: 'Con bloqueo',
  clear: 'Sin bloqueo',
  waiting: 'Esperan tareas previas',
};

export default function TaskFilters({
  tasks,
  filters,
  onChange,
  showDates = false,
  dateScope,
  onDateScopeChange,
  onClear,
  count,
}: Props) {
  const [open, setOpen] = useState(() => hasActiveFilters(filters));
  const [tagSearch, setTagSearch] = useState('');
  const types = [
    ...new Set([...tasks.map((task) => task.type).filter(Boolean), ...filters.type]),
  ].sort();
  const tags = [
    ...new Set([...tasks.flatMap((task) => task.tags), ...filters.tag].filter(Boolean)),
  ].sort();
  const matchingTags = tags.filter((tag) =>
    tag.toLocaleLowerCase('es').includes(tagSearch.trim().toLocaleLowerCase('es')),
  );
  const visibleTags = [...new Set([...filters.tag, ...matchingTags.slice(0, 10)])];
  const active =
    filters.type.length +
    filters.phase.length +
    filters.priority.length +
    filters.state.length +
    filters.tag.length +
    filters.blocked.length +
    [filters.dueFrom, filters.dueTo].filter(Boolean).length +
    (dateScope && dateScope !== 'upcoming' ? 1 : 0);
  const activeSelections = (
    [
      ['type', 'Tipo'],
      ['phase', 'Fase'],
      ['state', 'Estado'],
      ['priority', 'Prioridad'],
      ['tag', 'Etiqueta'],
      ['blocked', 'Bloqueo'],
    ] as const
  ).flatMap(([key, label]) => filters[key].map((value) => ({ key, label, value })));
  function change(key: 'dueFrom' | 'dueTo', value: string) {
    onChange({ ...filters, [key]: value });
  }
  function toggle(key: 'type' | 'phase' | 'priority' | 'state' | 'tag' | 'blocked', value: string) {
    const selected = filters[key];
    onChange({
      ...filters,
      [key]: selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    });
  }
  function optionButtons(
    key: 'type' | 'phase' | 'priority' | 'state' | 'tag' | 'blocked',
    options: readonly string[],
  ) {
    return options.map((option) => (
      <button
        key={option}
        type="button"
        className="task-filter-option"
        aria-pressed={filters[key].includes(option)}
        onClick={() => toggle(key, option)}
      >
        {key === 'blocked' ? BLOCKED_LABELS[option] : option}
      </button>
    ));
  }
  function choices(
    key: 'type' | 'phase' | 'priority' | 'state' | 'blocked',
    label: string,
    options: readonly string[],
  ) {
    return (
      <fieldset className="task-filter-group">
        <legend>{label}</legend>
        <div className="task-filter-options">{optionButtons(key, options)}</div>
      </fieldset>
    );
  }
  return (
    <section className="task-filters" aria-label="Filtros de tareas">
      <div className="task-filters-heading">
        <button
          type="button"
          className="task-filters-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Filter size={16} aria-hidden="true" />
          Filtrar tareas
          {active > 0 && <span className="task-filter-count">{active}</span>}
          <ChevronDown size={16} className="task-filters-chevron" aria-hidden="true" />
        </button>
        <span className="task-filters-visible" aria-live="polite">
          {count} {count === 1 ? 'tarea visible' : 'tareas visibles'}
        </span>
        {showDates && dateScope && onDateScopeChange && (
          <label className="task-filters-date-scope" htmlFor="board-date-scope">
            <CalendarDays size={16} aria-hidden="true" />
            <span>Fechas</span>
            <select
              id="board-date-scope"
              value={dateScope}
              onChange={(event) => {
                const scope = event.target.value as BoardDateScope;
                onDateScopeChange(scope);
                if (scope === 'range') setOpen(true);
              }}
            >
              <option value="upcoming">Desde hoy y vencidas</option>
              <option value="all">Todas las fechas</option>
              <option value="range">Rango personalizado</option>
            </select>
            <ChevronDown size={15} className="task-filters-date-chevron" aria-hidden="true" />
          </label>
        )}
        {active > 0 && (
          <button
            type="button"
            className="task-filters-clear"
            onClick={() => (onClear ? onClear() : onChange({ ...emptyTaskFilters }))}
          >
            <FilterX size={15} aria-hidden="true" /> Limpiar filtros
          </button>
        )}
      </div>
      {active > 0 && (
        <div className="task-filter-active" aria-label="Filtros activos">
          {activeSelections.map(({ key, label, value }) => (
            <button
              type="button"
              key={`${key}-${value}`}
              aria-label={`Quitar filtro ${label}: ${key === 'blocked' ? BLOCKED_LABELS[value] : value}`}
              onClick={() => toggle(key, value)}
            >
              {label}: {key === 'blocked' ? BLOCKED_LABELS[value] : value}{' '}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          {filters.dueFrom && (
            <button
              type="button"
              onClick={() => change('dueFrom', '')}
              aria-label="Quitar fecha desde"
            >
              Desde: {filters.dueFrom} <span aria-hidden="true">×</span>
            </button>
          )}
          {filters.dueTo && (
            <button
              type="button"
              onClick={() => change('dueTo', '')}
              aria-label="Quitar fecha hasta"
            >
              Hasta: {filters.dueTo} <span aria-hidden="true">×</span>
            </button>
          )}
          {dateScope && dateScope !== 'upcoming' && onDateScopeChange && (
            <button
              type="button"
              onClick={() => onDateScopeChange('upcoming')}
              aria-label="Quitar selección de fechas"
            >
              Fechas: {dateScope === 'all' ? 'Todas' : 'Rango'} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="task-filter-content">
          <p className="task-filter-hint">Selecciona varias opciones en cada grupo.</p>
          <div className="task-filter-choice-groups">
            {choices('type', 'Tipo', types)}
            {choices('phase', 'Fase', PHASES)}
            {choices('state', 'Estado', STATES)}
            {choices('priority', 'Prioridad', PRIORITIES)}
            {choices('blocked', 'Bloqueos', ['blocked', 'clear', 'waiting'])}
            <fieldset className="task-filter-group">
              <legend>Etiquetas</legend>
              <label className="task-filter-tag-search">
                Buscar etiquetas
                <input
                  type="search"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  placeholder="Buscar por coincidencia"
                />
              </label>
              {visibleTags.length ? (
                <div className="task-filter-options">{optionButtons('tag', visibleTags)}</div>
              ) : (
                <p className="task-filter-no-results">No hay etiquetas coincidentes.</p>
              )}
              {matchingTags.length > 10 && (
                <p className="task-filter-hint task-filter-tag-hint">
                  Mostrando 10 de {matchingTags.length}. Escribe para acotar la búsqueda.
                </p>
              )}
            </fieldset>
          </div>
          {showDates && (!dateScope || dateScope === 'range') && (
            <div className="task-filter-fields">
              <label>
                Desde
                <input
                  type="date"
                  value={filters.dueFrom}
                  onChange={(event) => change('dueFrom', event.target.value)}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={filters.dueTo}
                  onChange={(event) => change('dueTo', event.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
