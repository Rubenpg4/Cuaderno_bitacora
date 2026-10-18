import { useState } from 'react';
import type { Entry, Objective, ObjectiveLink, Snapshot, Task } from '../shared/model';
import { saveRecord } from './api';
import { Button, Field, Notice } from './ui';

export default function ObjectiveLinks({
  record,
  snapshot,
  onRefresh,
  onOpenObjective,
}: {
  record: Task | Entry;
  snapshot: Snapshot;
  onRefresh: () => Promise<void>;
  onOpenObjective?: (objective: Objective) => void;
}) {
  const objectives = snapshot.records.filter(
    (item): item is Objective => item.kind === 'objective' && item.project === record.project,
  );
  const [objectiveId, setObjectiveId] = useState('');
  const [role, setRole] = useState<ObjectiveLink['role']>('trabajo');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linked = objectives.flatMap((objective) =>
    objective.links
      .filter((link) => link.sourceId === record.id)
      .map((link) => ({ objective, link })),
  );

  async function add() {
    const objective = objectives.find((item) => item.id === objectiveId);
    if (!objective) return;
    if (record.kind === 'task' && role !== 'trabajo') {
      setError('Una tarea solo puede aportar trabajo.');
      return;
    }
    if (role === 'resultado' && record.kind === 'entry' && !record.result.trim()) {
      setError('La entrada necesita un resultado antes de vincularlo.');
      return;
    }
    if (role === 'evidencia' && !reference.trim()) {
      setError('Añade una referencia de evidencia.');
      return;
    }
    if (objective.links.some((link) => link.sourceId === record.id && link.role === role)) {
      setError('Ese vínculo ya existe.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveRecord(
        'objective',
        {
          ...objective,
          links: [
            ...objective.links,
            {
              sourceKind: record.kind,
              sourceId: record.id,
              role,
              reference: role === 'evidencia' ? reference.trim() : '',
            },
          ],
        },
        objective,
      );
      setObjectiveId('');
      setReference('');
      await onRefresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-section">
      <h3>Objetivos vinculados</h3>
      {linked.map(({ objective, link }) => (
        <div className="row" key={link.id}>
          <Button variant="ghost" onClick={() => onOpenObjective?.(objective)}>
            {objective.title} · {link.role}
          </Button>
          {link.reference && <span>{link.reference}</span>}
        </div>
      ))}
      {objectives.length ? (
        <>
          <div className="form-grid">
            <Field label="Objetivo">
              <select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)}>
                <option value="">Selecciona un objetivo</option>
                {objectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Qué aporta">
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as ObjectiveLink['role'])}
              >
                <option value="trabajo">Trabajo</option>
                {record.kind === 'entry' && <option value="resultado">Resultado</option>}
                {record.kind === 'entry' && <option value="evidencia">Evidencia</option>}
              </select>
            </Field>
            {role === 'evidencia' && (
              <Field label="Referencia de evidencia">
                <input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
            )}
          </div>
          <Button variant="secondary" onClick={() => void add()} disabled={busy || !objectiveId}>
            Vincular al objetivo
          </Button>
        </>
      ) : (
        <p className="muted">Crea un objetivo en Memoria para relacionarlo con este registro.</p>
      )}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
