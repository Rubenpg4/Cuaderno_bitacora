import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Project, RecordItem, Snapshot, Subproject } from '../../shared/model';
import { subprojectsOf } from '../../shared/subprojects';
import { api } from '../api';
import { Badge, Button, Field, Notice } from '../ui';

interface Props {
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  onEnter: (subproject: Subproject) => void;
  onChanged: (message: string) => void;
}

function contentCount(records: RecordItem[], drafts: Snapshot['drafts'], id: string) {
  return (
    records.filter((record) => record.subprojectId === id).length +
    Object.values(drafts ?? {}).filter((draft) => draft.subprojectId === id).length
  );
}

/** Lifecycle of subprojects; the service validates every change again. */
export default function SubprojectManager({ snapshot, refresh, onEnter, onChanged }: Props) {
  const root = snapshot.records.find((record): record is Project => record.kind === 'project');
  const subprojects = subprojectsOf(snapshot.records);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string; description: string }>();
  const [error, setError] = useState('');
  const [blockedDelete, setBlockedDelete] = useState<Subproject>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, message: string) {
    setError('');
    setBusy(true);
    try {
      await action();
      await refresh();
      onChanged(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create() {
    void run(async () => {
      await api('subproject-save', { data: { title, description } });
      setTitle('');
      setDescription('');
    }, 'Subproyecto creado.');
  }
  function setStatus(child: Subproject, status: Subproject['status']) {
    if (
      status === 'Archivado' &&
      !window.confirm(
        `¿Archivar «${child.title}»? Su contenido quedará en solo lectura y se revocarán sus permisos MCP y propuestas pendientes.`,
      )
    )
      return;
    setBlockedDelete(undefined);
    void run(
      () => api('subproject-status', { id: child.id, expectedVersion: child.version, status }),
      status === 'Archivado' ? 'Subproyecto archivado.' : 'Subproyecto restaurado.',
    );
  }
  function remove(child: Subproject) {
    if (contentCount(snapshot.records, snapshot.drafts, child.id)) {
      setBlockedDelete(child);
      return;
    }
    if (!window.confirm(`¿Eliminar el subproyecto vacío «${child.title}»?`)) return;
    void run(
      () =>
        api('subproject-delete', {
          id: child.id,
          expectedVersion: child.version,
          confirm: 'ELIMINAR',
        }),
      'Subproyecto eliminado.',
    );
  }

  return (
    <div className="subproject-manager">
      <p className="muted">
        Los subproyectos organizan el trabajo dentro de «{root?.title}». Comparten su cifrado,
        contraseña y perfil MCP; para separar el acceso entre personas usa cuadernos distintos.
      </p>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <h3>Nuevo subproyecto</h3>
        <Field label="Nombre del subproyecto">
          <input
            value={title}
            maxLength={240}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Descripción breve">
          <input
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy || !title.trim()}>
          <Plus size={16} /> Crear subproyecto
        </Button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {blockedDelete && (
        <Notice error>
          «{blockedDelete.title}» tiene registros o borradores, así que no se elimina para no
          perderlos. Puedes archivarlo para conservar su contenido en solo lectura.
          {blockedDelete.status === 'Activo' && (
            <div className="row">
              <Button variant="secondary" onClick={() => setStatus(blockedDelete, 'Archivado')}>
                <Archive size={16} /> Archivar «{blockedDelete.title}»
              </Button>
            </div>
          )}
        </Notice>
      )}
      <section className="form-section">
        <h3>Subproyectos de {root?.title}</h3>
        {!subprojects.length && <p className="muted">Aún no hay subproyectos.</p>}
        <ul className="subproject-list">
          {subprojects.map((child) => {
            const count = contentCount(snapshot.records, snapshot.drafts, child.id);
            return (
              <li key={child.id} className="subproject-item">
                {editing?.id === child.id ? (
                  <form
                    className="subproject-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await api('subproject-save', {
                          id: child.id,
                          expectedVersion: child.version,
                          data: { title: editing.title, description: editing.description },
                        });
                        setEditing(undefined);
                      }, 'Subproyecto actualizado.');
                    }}
                  >
                    <Field label={`Nuevo nombre de ${child.title}`}>
                      <input
                        value={editing.title}
                        maxLength={240}
                        required
                        onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                      />
                    </Field>
                    <Field label="Descripción breve">
                      <input
                        value={editing.description}
                        maxLength={1000}
                        onChange={(event) =>
                          setEditing({ ...editing, description: event.target.value })
                        }
                      />
                    </Field>
                    <div className="row">
                      <Button type="submit" disabled={busy}>
                        Guardar cambios
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(undefined)}>
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="subproject-summary">
                      <strong>{child.title}</strong>
                      <Badge tone={child.status === 'Activo' ? 'green' : 'amber'}>
                        {child.status === 'Activo' ? 'Activo' : 'Archivado · solo lectura'}
                      </Badge>
                      {child.description && <small>{child.description}</small>}
                      <small>
                        {count} {count === 1 ? 'registro' : 'registros'}
                      </small>
                    </div>
                    <div className="row subproject-actions">
                      <Button variant="secondary" onClick={() => onEnter(child)}>
                        <ArrowUpRight size={15} /> Entrar
                      </Button>
                      {child.status === 'Activo' ? (
                        <>
                          <Button
                            variant="ghost"
                            ariaLabel={`Editar ${child.title}`}
                            onClick={() =>
                              setEditing({
                                id: child.id,
                                title: child.title,
                                description: child.description,
                              })
                            }
                          >
                            <Pencil size={15} /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            ariaLabel={`Archivar ${child.title}`}
                            disabled={busy}
                            onClick={() => setStatus(child, 'Archivado')}
                          >
                            <Archive size={15} /> Archivar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          ariaLabel={`Restaurar ${child.title}`}
                          disabled={busy}
                          onClick={() => setStatus(child, 'Activo')}
                        >
                          <ArchiveRestore size={15} /> Restaurar
                        </Button>
                      )}
                      <Button
                        variant="ghost danger"
                        ariaLabel={`Eliminar ${child.title}`}
                        disabled={busy}
                        onClick={() => remove(child)}
                      >
                        <Trash2 size={15} /> Eliminar
                      </Button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <Notice>
        Al restaurar un subproyecto no se recuperan sesiones MCP ni propuestas anteriores. Los
        registros no se trasladan entre «General» y los subproyectos.
      </Notice>
    </div>
  );
}
