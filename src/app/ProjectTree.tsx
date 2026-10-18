import { Archive, FolderCog, MoreHorizontal, Plus } from 'lucide-react';
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

/** Root header, «General» and children; archived children stay folded and read-only. */
export default function ProjectTree({
  project,
  subprojects,
  tasks,
  scope,
  onSelect,
  onOpenProject,
  onManage,
}: Props) {
  const openTasks = (owner: string) =>
    tasks.filter(
      (task) =>
        task.state !== 'Completada' &&
        !task.recurrence?.canceledAt &&
        (task.subprojectId || GENERAL_SCOPE) === owner,
    ).length;
  const active = subprojects.filter((child) => child.status === 'Activo');
  const archived = subprojects.filter((child) => child.status === 'Archivado');
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
    <div className="project-tree">
      <div className="project-nav">
        <button
          type="button"
          className={scope === 'all' ? 'selected' : ''}
          aria-current={scope === 'all' ? 'true' : undefined}
          aria-label={`Todo el proyecto ${project.title}`}
          title="Todo el proyecto"
          onClick={() => onSelect('all')}
        >
          <span className="project-dot" />
          {project.title}
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
      <ul className="scope-tree" aria-label={`Ámbitos de ${project.title}`}>
        {item(GENERAL_SCOPE, 'General')}
        {active.map((child) => item(child.id, child.title))}
      </ul>
      <button type="button" className="scope-manage" onClick={onManage}>
        {subprojects.length ? <FolderCog size={14} /> : <Plus size={14} />}
        {subprojects.length ? 'Gestionar subproyectos' : 'Nuevo subproyecto'}
      </button>
      {archived.length > 0 && (
        <details className="scope-archived" open={archived.some((child) => child.id === scope)}>
          <summary>
            <Archive size={13} aria-hidden="true" /> Archivados ({archived.length})
          </summary>
          <ul className="scope-tree" aria-label="Subproyectos archivados">
            {archived.map((child) => item(child.id, child.title, ' (archivado, solo lectura)'))}
          </ul>
        </details>
      )}
    </div>
  );
}
