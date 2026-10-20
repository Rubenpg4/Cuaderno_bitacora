import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Archive, ChevronRight, FolderCog, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { Project, Subproject, Task } from '../../shared/model';
import { GENERAL_SCOPE, type ScopeSelection } from '../../shared/subprojects';

interface Props {
  project: Project;
  subprojects: Subproject[];
  tasks: Task[];
  scope: ScopeSelection;
  onSelect: (scope: ScopeSelection) => void;
  onOpenProject: () => void;
  onManage: () => void;
}

/** From this many active children the tree offers a quick filter. */
export const SCOPE_FILTER_THRESHOLD = 8;
/** Rows the tree keeps visible before the whole sidebar has to scroll. */
const MIN_VISIBLE_ROWS = 3;
const collapsedKey = 'bitacora-project-tree-collapsed';

function readCollapsed() {
  try {
    return window.localStorage.getItem(collapsedKey) === 'yes';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(collapsedKey, collapsed ? 'yes' : 'no');
  } catch {
    // El plegado sigue activo durante esta sesión si el almacenamiento está bloqueado.
  }
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

/**
 * Root header, «General» and children; archived children stay folded and read-only.
 * Only the list of scopes scrolls, so a long tree never pushes the main navigation away.
 */
export default function ProjectTree({
  project,
  subprojects,
  tasks,
  scope,
  onSelect,
  onOpenProject,
  onManage,
}: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [query, setQuery] = useState('');
  const [overflow, setOverflow] = useState({ above: false, below: false });
  const scroller = useRef<HTMLDivElement>(null);
  const openTasks = (owner: string) =>
    tasks.filter(
      (task) =>
        task.state !== 'Completada' &&
        !task.recurrence?.canceledAt &&
        (task.subprojectId || GENERAL_SCOPE) === owner,
    ).length;
  const active = subprojects.filter((child) => child.status === 'Activo');
  const archived = subprojects.filter((child) => child.status === 'Archivado');
  const filterable = active.length >= SCOPE_FILTER_THRESHOLD;
  const needle = filterable ? fold(query.trim()) : '';
  const matches = (title: string) => !needle || fold(title).includes(needle);
  const showGeneral = matches('General');
  const visibleActive = active.filter((child) => matches(child.title));
  const visibleArchived = archived.filter((child) => matches(child.title));
  const rows = (showGeneral ? 1 : 0) + visibleActive.length + (visibleArchived.length ? 1 : 0);
  const listId = `scope-tree-${project.id}`;

  const measure = () => {
    const list = scroller.current;
    if (!list) return;
    const above = list.scrollTop > 1;
    const below = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
    setOverflow((current) =>
      current.above === above && current.below === below ? current : { above, below },
    );
  };

  useEffect(() => {
    const list = scroller.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    return () => observer.disconnect();
  }, [collapsed, filterable]);

  // The selected scope stays in view when it changes, the tree unfolds or the filter clears.
  useEffect(() => {
    scroller.current
      ?.querySelector<HTMLElement>('.scope-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
    measure();
  }, [scope, collapsed, needle]);

  const toggle = () => {
    setCollapsed((current) => {
      storeCollapsed(!current);
      return !current;
    });
  };

  const item = (id: string, title: string, extraLabel = '') => {
    const count = openTasks(id);
    return (
      <li key={id}>
        <button
          type="button"
          className={`scope-item ${scope === id ? 'selected' : ''}`}
          aria-current={scope === id ? 'true' : undefined}
          aria-label={`${title}${extraLabel}, ${count} ${count === 1 ? 'tarea abierta' : 'tareas abiertas'}`}
          title={`${project.title} / ${title}`}
          onClick={() => onSelect(id)}
        >
          <span className="scope-title">{title}</span>
          <span className="scope-count" aria-hidden="true">
            {count}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div
      className={`project-tree ${collapsed ? 'collapsed' : ''} ${filterable ? 'filterable' : ''}`}
      style={{ '--scope-rows': collapsed ? 0 : Math.min(rows, MIN_VISIBLE_ROWS) } as CSSProperties}
    >
      <div className="project-nav">
        <button
          type="button"
          className="project-toggle"
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={`${collapsed ? 'Desplegar' : 'Plegar'} subproyectos de ${project.title}`}
          onClick={toggle}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={scope === 'all' ? 'selected' : ''}
          aria-current={scope === 'all' ? 'true' : undefined}
          aria-label={`Todo el proyecto ${project.title}`}
          title="Todo el proyecto"
          onClick={() => onSelect('all')}
        >
          <span className="project-dot" />
          <span className="project-name">{project.title}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Editar proyecto ${project.title}`}
          onClick={onOpenProject}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {!collapsed && (
        <>
          {filterable && (
            <label className="scope-filter">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Buscar subproyecto…"
                aria-label="Buscar subproyecto"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          <div
            ref={scroller}
            id={listId}
            className={`scope-scroll ${overflow.above ? 'more-above' : ''} ${overflow.below ? 'more-below' : ''}`}
            onScroll={measure}
          >
            <div>
              <ul className="scope-tree" aria-label={`Ámbitos de ${project.title}`}>
                {showGeneral && item(GENERAL_SCOPE, 'General')}
                {visibleActive.map((child) => item(child.id, child.title))}
              </ul>
              {needle && rows === 0 && <p className="scope-empty">Sin coincidencias.</p>}
              {visibleArchived.length > 0 && (
                <details
                  className="scope-archived"
                  open={Boolean(needle) || archived.some((child) => child.id === scope)}
                >
                  <summary>
                    <Archive size={13} aria-hidden="true" /> Archivados ({visibleArchived.length})
                  </summary>
                  <ul className="scope-tree" aria-label="Subproyectos archivados">
                    {visibleArchived.map((child) =>
                      item(child.id, child.title, ' (archivado, solo lectura)'),
                    )}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </>
      )}
      <button type="button" className="scope-manage" onClick={onManage}>
        {subprojects.length ? <FolderCog size={14} /> : <Plus size={14} />}
        {subprojects.length ? 'Gestionar subproyectos' : 'Nuevo subproyecto'}
      </button>
    </div>
  );
}
