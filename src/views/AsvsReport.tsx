import { useEffect, useRef, useState } from 'react';
import { asvsCatalog } from '../../shared/asvsCatalog';
import type { AsvsReportPreview, AsvsReportSelection } from '../../shared/asvsReport';
import type { AsvsData, AsvsOverview } from '../../shared/asvsTracking';
import type { RecordItem, Task } from '../../shared/model';
import { api, download } from '../api';
import { Button, Field, Notice } from '../ui';

export default function AsvsReport({
  overview,
  records,
  data,
}: {
  overview: AsvsOverview;
  records: RecordItem[];
  data?: AsvsData;
}) {
  const config = overview.config!;
  const [selection, setSelection] = useState<AsvsReportSelection>(() => ({
    projectId: config.projectId,
    requirementIds: asvsCatalog.requirements
      .filter((r) => r.minLevel <= (config.level ?? 3))
      .map((r) => r.reqId),
    taskIds: [],
    evidenceIds: [],
    includeOriginal: true,
  }));
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<'md' | 'csv'>('md');
  const [preview, setPreview] = useState<AsvsReportPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    revision.current++;
    setPreview(undefined);
    setReviewed(false);
    setMessage('');
  }, [overview, records, data]);
  const selected = new Set(selection.requirementIds);
  const tasks = records.filter(
    (r): r is Task =>
      r.kind === 'task' &&
      r.project === config.projectId &&
      !!r.asvsLinks?.some(
        (l) => l.catalogVersion === config.catalogVersion && selected.has(l.reqId),
      ),
  );
  const assessments = [
    ...overview.items.map((i) => i.assessment),
    ...(data?.taskVerifications ?? []).filter((a) => selection.taskIds.includes(a.taskId ?? '')),
  ].filter((a) => a.catalogVersion === config.catalogVersion && selected.has(a.reqId));
  const evidence = assessments.flatMap((a) => a.evidence.map((e) => ({ ...e, reqId: a.reqId })));
  const requirements = asvsCatalog.requirements.filter((r) =>
    `${r.canonicalRef} ${r.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function change(patch: Partial<AsvsReportSelection>) {
    revision.current++;
    setSelection((current) => ({ ...current, ...patch }));
    setPreview(undefined);
    setReviewed(false);
    setError('');
    setMessage('');
  }
  function toggle(key: 'requirementIds' | 'taskIds' | 'evidenceIds', id: string) {
    const values = selection[key];
    change({
      [key]: values.includes(id) ? values.filter((v) => v !== id) : [...values, id],
      ...(key === 'requirementIds' ? { taskIds: [], evidenceIds: [] } : {}),
      ...(key === 'taskIds' ? { evidenceIds: [] } : {}),
    });
  }
  async function showPreview() {
    setBusy(true);
    setError('');
    setReviewed(false);
    const requestRevision = revision.current;
    try {
      const result = await api<AsvsReportPreview>('asvs-report-preview', selection);
      if (requestRevision === revision.current) {
        setPreview(result);
        requestAnimationFrame(() => previewRef.current?.focus());
      }
    } catch (err) {
      if (requestRevision === revision.current) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportReport() {
    if (!preview || !reviewed) return;
    setBusy(true);
    setError('');
    try {
      const out = await api<{ data: string; type: string; extension: string }>(
        'asvs-report-export',
        {
          selection,
          format,
          expectedDigest: preview.digest,
          reviewed,
        },
      );
      const saved = await download(
        out.data,
        out.type,
        `bitacora-asvs-${preview.date}.${out.extension}`,
      );
      setMessage(saved ? 'Informe ASVS exportado.' : 'Guardado cancelado.');
    } catch (err) {
      setError((err as Error).message);
      setPreview(undefined);
      setReviewed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="asvs-config asvs-report">
      <summary>Exportar trazabilidad ASVS</summary>
      <p>
        Selecciona requisitos y, opcionalmente, tareas y referencias de evidencia. Se omiten notas
        privadas, responsables, contenido de registros, adjuntos, autorizaciones, historial y
        propuestas. Revisa las referencias elegidas antes de compartir el informe.
      </p>
      <fieldset disabled={busy}>
        <legend>Contenido del informe ASVS</legend>
        <Field label="Buscar requisitos para exportar">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="asvs-actions">
          <Button
            variant="secondary"
            onClick={() =>
              change({
                requirementIds: asvsCatalog.requirements
                  .filter((r) => r.minLevel <= (config.level ?? 3))
                  .map((r) => r.reqId),
                taskIds: [],
                evidenceIds: [],
              })
            }
          >
            Seleccionar nivel objetivo
          </Button>
          <Button
            variant="secondary"
            onClick={() => change({ requirementIds: [], taskIds: [], evidenceIds: [] })}
          >
            Limpiar selección
          </Button>
        </div>
        <p role="status">
          {selection.requirementIds.length} requisitos seleccionados · {requirements.length}{' '}
          visibles
        </p>
        <div className="asvs-report-options">
          {requirements.map((r) => (
            <label key={r.reqId}>
              <input
                type="checkbox"
                checked={selected.has(r.reqId)}
                onChange={() => toggle('requirementIds', r.reqId)}
              />
              {r.canonicalRef} · L{r.minLevel}
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={selection.includeOriginal}
            onChange={(e) => change({ includeOriginal: e.target.checked })}
          />{' '}
          Incluir texto oficial en inglés
        </label>
        <details>
          <summary>Tareas vinculadas ({tasks.length})</summary>
          {!tasks.length && <p>No hay tareas vinculadas a los requisitos seleccionados.</p>}
          <div className="asvs-report-options">
            {tasks.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={selection.taskIds.includes(t.id)}
                  onChange={() => toggle('taskIds', t.id)}
                />
                {t.title} · {t.state}
              </label>
            ))}
          </div>
        </details>
        <details>
          <summary>Referencias de evidencia ({evidence.length})</summary>
          {!evidence.length && <p>No hay evidencia aceptada en esta selección.</p>}
          <div className="asvs-report-options">
            {evidence.map((e) => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  checked={selection.evidenceIds.includes(e.id)}
                  onChange={() => toggle('evidenceIds', e.id)}
                />
                {e.reqId} · {e.reference} · {e.revision}
              </label>
            ))}
          </div>
        </details>
        <Field label="Formato del informe ASVS">
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as 'md' | 'csv');
              setReviewed(false);
            }}
          >
            <option value="md">Markdown</option>
            <option value="csv">CSV</option>
          </select>
        </Field>
        <Button
          disabled={busy || !selection.requirementIds.length}
          onClick={() => void showPreview()}
        >
          Previsualizar informe ASVS
        </Button>
      </fieldset>
      {preview && (
        <section aria-label="Vista previa del informe ASVS" ref={previewRef} tabIndex={-1}>
          <h3>Vista previa del informe ASVS</h3>
          <p>
            La selección y los estados aceptados corresponden al {preview.date}. Los recuentos del
            nivel objetivo se distinguen de los de la selección. Parciales, desactualizados y
            exclusiones se indican por separado.
          </p>
          <pre
            className="asvs-report-preview"
            tabIndex={0}
            aria-label={`Contenido ${format === 'md' ? 'Markdown' : 'CSV'} del informe ASVS`}
          >
            {preview[format]}
          </pre>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            He revisado el contenido del informe ASVS
          </label>
          <Button disabled={busy || !reviewed} onClick={() => void exportReport()}>
            Descargar informe ASVS
          </Button>
        </section>
      )}
      {error && <Notice error>{error}</Notice>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
