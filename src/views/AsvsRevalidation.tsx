import { useState } from 'react';
import type { AsvsData, AsvsOverview } from '../../shared/asvsTracking';
import { api } from '../api';
import { Button, Field, Notice } from '../ui';

export default function AsvsRevalidation({
  data,
  overview,
  onSaved,
  open = false,
}: {
  data?: AsvsData;
  overview: AsvsOverview;
  onSaved: (result: AsvsOverview) => void;
  open?: boolean;
}) {
  const [reference, setReference] = useState('');
  const [revision, setRevision] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const references = [
    ...new Set(
      [...overview.items.map((i) => i.assessment), ...(data?.taskVerifications ?? [])].flatMap(
        (a) => a.evidence.filter((e) => !e.recordId).map((e) => e.reference),
      ),
    ),
  ];
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<AsvsOverview>('asvs-source-revision', {
        projectId: overview.config!.projectId,
        expectedConfigVersion: overview.config!.version,
        expectedVersion:
          data?.sourceRevisions?.find((r) => r.reference === reference)?.version ?? 0,
        reference,
        revision,
        reason,
      });
      onSaved(result);
      setRevision('');
      setReason('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(id: string, accept: boolean) {
    setBusy(true);
    setError('');
    try {
      onSaved(await api<AsvsOverview>('asvs-revision-review', { id, accept }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="asvs-tool" open={open}>
      <summary>Revalidar una revisión externa</summary>
      <p>
        Bitácora detecta cambios de fuentes registradas. No vigila repositorios ni archivos
        externos. Señala una nueva revisión de una referencia usada como evidencia para revalidar su
        alcance. El historial conserva qué se probó; este aviso no valida la nueva revisión.
      </p>
      {references.length ? (
        <form onSubmit={save} aria-label="Registrar revisión externa">
          <div className="asvs-fields">
            <Field label="Fuente externa a revalidar">
              <select required value={reference} onChange={(e) => setReference(e.target.value)}>
                <option value="">Selecciona una referencia</option>
                {references.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Nueva revisión externa">
              <input
                required
                maxLength={240}
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="Commit, versión o revisión fija"
              />
            </Field>
          </div>
          <Field label="Motivo de revalidación">
            <textarea
              required
              maxLength={16000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            Registrar cambio de revisión
          </Button>
        </form>
      ) : (
        <p>No hay referencias externas en las evaluaciones registradas.</p>
      )}
      {(data?.revisionProposals ?? [])
        .filter((p) => p.status === 'pending')
        .map((p) => (
          <article className="asvs-history" key={p.id}>
            <h3>Revisión externa propuesta por {p.provider}</h3>
            <p>
              {p.request.reference} · nueva revisión {p.request.revision}
            </p>
            <p>{p.request.reason}</p>
            <Button disabled={busy} onClick={() => void review(p.id, true)}>
              Confirmar nueva revisión
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void review(p.id, false)}>
              Rechazar revisión
            </Button>
          </article>
        ))}
      {(data?.sourceRevisions?.length ?? 0) > 0 && (
        <details>
          <summary>Historial de avisos de revisión externa</summary>
          <ol>
            {data?.history
              .filter((h) => h.kind === 'source-revision')
              .map(
                (h) =>
                  h.kind === 'source-revision' && (
                    <li key={h.id}>
                      {h.after.reference} · {h.before?.revision ?? 'Primera revisión señalada'} →{' '}
                      {h.after.revision} · {new Date(h.at).toLocaleString('es-ES')}
                      <p>{h.after.reason}</p>
                    </li>
                  ),
              )}
          </ol>
        </details>
      )}
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}
