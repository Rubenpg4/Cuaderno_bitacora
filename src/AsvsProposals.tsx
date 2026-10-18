import { useEffect, useState } from 'react';
import { asvsCatalog } from '../shared/asvsCatalog';
import type { AsvsProposal } from '../shared/asvsTracking';
import type { Snapshot } from '../shared/model';
import { api } from './api';
import { Button, Field, Notice } from './ui';

function conflict(snapshot: Snapshot, p: AsvsProposal) {
  const data = snapshot.asvs;
  const target =
    p.destination === 'task'
      ? data?.taskVerifications?.find(
          (a) => a.taskId === p.request.taskId && a.reqId === p.before.reqId,
        )
      : data?.assessments.find((a) => a.id === p.request.targetId);
  const taskVersion = snapshot.records.find((r) => r.id === p.request.taskId)?.version;
  return (
    !data?.config.level ||
    data.config.version !== p.request.expectedConfigVersion ||
    (target?.version ?? (p.destination === 'task' ? 0 : undefined)) !== p.request.expectedVersion ||
    (p.request.taskId && taskVersion !== p.request.expectedTaskVersion)
  );
}
export default function AsvsProposals({
  snapshot,
  refresh,
  focusProposalId,
}: {
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  focusProposalId?: string;
}) {
  const pending = snapshot.asvs?.proposals?.filter((p) => p.status === 'pending') ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<
    Record<string, { approved: boolean; reason: string; reference: string; responsible: string }>
  >({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (pending.some((p) => p.id === focusProposalId)) setPreviewIds([focusProposalId!]);
  }, [focusProposalId]);
  const preview = previewIds
    .map((id) => pending.find((p) => p.id === id))
    .filter((p): p is AsvsProposal => !!p);
  const uniqueTargets = new Set(
    preview.map((p) =>
      p.destination === 'task' ? `task:${p.request.taskId}:${p.before.reqId}` : p.request.targetId,
    ),
  ).size;
  async function review(ids: string[], accept: boolean) {
    setError('');
    setBusy(true);
    try {
      await api('asvs-review-proposals', {
        ids,
        accept,
        ...(accept
          ? {
              decisions: Object.fromEntries(
                ids.filter((id) => decisions[id]).map((id) => [id, decisions[id]]),
              ),
            }
          : {}),
      });
      setPreviewIds([]);
      setSelected([]);
      setDecisions({});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!pending.length) return null;
  return (
    <section className="form-section asvs-proposals" aria-label="Propuestas ASVS">
      <h3>Evaluaciones ASVS pendientes ({pending.length})</h3>
      <p>
        Solo la revisión humana cambia la evaluación aceptada. Una propuesta parcial no verifica el
        proyecto.
      </p>
      <Button disabled={busy || !selected.length} onClick={() => setPreviewIds(selected)}>
        Revisar lote ASVS ({selected.length})
      </Button>
      {pending.map((p) => (
        <article
          className="proposal proposal-card"
          key={p.id}
          aria-label={`Propuesta ASVS ${p.reference}`}
        >
          <Field label={`Seleccionar ${p.reference} para lote`}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected((ids) =>
                  e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                )
              }
            />
          </Field>
          <strong>
            {p.reference} · {p.provider} · {p.request.state}
          </strong>
          <p>{p.rationale}</p>
          {p.destination === 'task' && (
            <p>
              Verificación de tarea:{' '}
              {snapshot.records.find((r) => r.id === p.request.taskId)?.title}. Puede aceptarse
              junto con su cierre en las propuestas de Tareas.
            </p>
          )}
          {conflict(snapshot, p) && (
            <Notice error>
              La configuración, evaluación o tarea cambió. Solicita una propuesta actualizada.
            </Notice>
          )}
          <Button disabled={busy || !!conflict(snapshot, p)} onClick={() => setPreviewIds([p.id])}>
            Revisar propuesta ASVS
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void review([p.id], false)}>
            Rechazar propuesta ASVS
          </Button>
        </article>
      ))}
      {error && <Notice error>{error}</Notice>}
      {previewIds.length > 0 && (
        <div className="proposal-preview-backdrop" role="presentation">
          <section
            className="proposal-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Vista previa ASVS"
          >
            <h3>Revisión humana ASVS</h3>
            {preview.map((p) => (
              <section key={p.id} className="form-section">
                <strong>{p.reference}</strong>
                <p lang="en">
                  {asvsCatalog.requirements.find((r) => r.reqId === p.before.reqId)?.description}
                </p>
                <p>{p.rationale}</p>
                <dl className="diff">
                  <div>
                    <dt>Estado</dt>
                    <dd>
                      <del>{p.before.state}</del>
                      <ins>{p.request.state}</ins>
                    </dd>
                  </div>
                  <div>
                    <dt>Aplicabilidad</dt>
                    <dd>
                      <del>{p.before.applicability}</del>
                      <ins>{p.request.applicability}</ins>
                    </dd>
                  </div>
                  <div>
                    <dt>Alcance</dt>
                    <dd>
                      <del>
                        {p.before.scope} · {p.before.scopeDetail}
                      </del>
                      <ins>
                        {p.request.scope} · {p.request.scopeDetail} · Pendiente:{' '}
                        {p.request.pendingScope || 'Ninguno declarado'}
                      </ins>
                    </dd>
                  </div>
                  <div>
                    <dt>Nota o hallazgo</dt>
                    <dd>
                      <del>{p.before.note || 'Sin nota'}</del>
                      <ins>{p.request.note}</ins>
                    </dd>
                  </div>
                  <div>
                    <dt>Método y responsable</dt>
                    <dd>
                      <del>
                        {p.before.method} · {p.before.responsible}
                      </del>
                      <ins>
                        {p.request.method} · {p.request.responsible}
                      </ins>
                    </dd>
                  </div>
                  <div>
                    <dt>Evidencias</dt>
                    <dd>
                      <del>
                        {p.before.evidence
                          .map((e) => `${e.reference} (${e.revision})`)
                          .join('; ') || 'Sin evidencia'}
                      </del>
                      <ins>
                        {p.request.evidence
                          .map(
                            (e) =>
                              `${e.reference} (${e.revision})${e.recordId ? ` · Fuente: ${snapshot.records.find((r) => r.id === e.recordId)?.title ?? 'Eliminada'}` : ''}`,
                          )
                          .join('; ') || 'Sin evidencia'}
                      </ins>
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  Versión de evaluación {p.request.expectedVersion} · Configuración{' '}
                  {p.request.expectedConfigVersion} · Catálogo OWASP ASVS {p.before.catalogVersion}
                </p>
                {p.request.state === 'No aplicable' &&
                  (() => {
                    const d = decisions[p.id] ?? {
                      approved: false,
                      reason: p.request.note,
                      reference: '',
                      responsible: p.request.responsible,
                    };
                    const change = (patch: Partial<typeof d>) =>
                      setDecisions((current) => ({ ...current, [p.id]: { ...d, ...patch } }));
                    return (
                      <div>
                        <Field label="Apruebo la exclusión de aplicabilidad">
                          <input
                            type="checkbox"
                            checked={d.approved}
                            onChange={(e) => change({ approved: e.target.checked })}
                          />
                        </Field>
                        <Field label="Motivo de decisión humana">
                          <textarea
                            value={d.reason}
                            maxLength={16000}
                            onChange={(e) => change({ reason: e.target.value })}
                          />
                        </Field>
                        <Field label="Referencia de decisión humana">
                          <input
                            value={d.reference}
                            maxLength={2000}
                            onChange={(e) => change({ reference: e.target.value })}
                          />
                        </Field>
                        <Field label="Responsable de decisión humana">
                          <input
                            value={d.responsible}
                            maxLength={240}
                            onChange={(e) => change({ responsible: e.target.value })}
                          />
                        </Field>
                      </div>
                    );
                  })()}
              </section>
            ))}
            {uniqueTargets !== preview.length && (
              <Notice error>El lote cambia dos veces la misma evaluación.</Notice>
            )}
            {error && <Notice error>{error}</Notice>}
            <div className="row">
              <Button
                disabled={
                  busy ||
                  preview.length !== previewIds.length ||
                  preview.some((p) => !!conflict(snapshot, p)) ||
                  uniqueTargets !== preview.length ||
                  preview.some(
                    (p) =>
                      p.request.state === 'No aplicable' &&
                      (!decisions[p.id]?.approved ||
                        !decisions[p.id]?.reason.trim() ||
                        !decisions[p.id]?.reference.trim() ||
                        !decisions[p.id]?.responsible.trim()),
                  )
                }
                onClick={() => void review(previewIds, true)}
              >
                Aceptar evaluación ASVS ({preview.length})
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setPreviewIds([])}>
                Volver
              </Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
