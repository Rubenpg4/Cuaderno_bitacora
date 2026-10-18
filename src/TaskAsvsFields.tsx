import { useEffect, useState } from 'react';
import { asvsCatalog } from '../shared/asvsCatalog';
import { asvsDisplayRequirements } from '../shared/asvsCatalogEs';
import { resolveAsvsReference } from '../shared/asvs';
import type { AsvsTaskLink, AsvsAssessment, AsvsAssessmentStatus } from '../shared/asvsTracking';
import type { Snapshot, Task } from '../shared/model';
import { api } from './api';
import { Button, Field, Notice } from './ui';

type Verification = { assessment: AsvsAssessment; status: AsvsAssessmentStatus };
const linkLabels = {
  reason: 'Motivo de pertinencia',
  scope: 'Alcance de la tarea',
  criterion: 'Criterio observable',
  method: 'Método previsto de verificación',
} as const;

export default function TaskAsvsFields({
  links,
  onChange,
  snapshot,
  task,
  refresh,
}: {
  links: AsvsTaskLink[];
  onChange: (links: AsvsTaskLink[]) => void;
  snapshot: Snapshot;
  task?: Task;
  refresh: () => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const config = snapshot.asvs?.config;
  useEffect(() => {
    if (!task || !config) return;
    let live = true;
    api<Verification[]>('asvs-task-status', { projectId: task.project, taskId: task.id })
      .then((result) => {
        if (live) setVerifications(result);
      })
      .catch((err: Error) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [
    task?.id,
    task?.version,
    config?.version,
    snapshot.records,
    snapshot.asvs?.taskVerifications,
  ]);

  function add() {
    const requirement = resolveAsvsReference(asvsCatalog, reference.trim());
    if (!requirement || config?.catalogVersion !== requirement.catalogVersion) {
      setError('Escribe una referencia existente de la versión fijada por el cuaderno.');
      return;
    }
    if (
      links.some(
        (l) => l.reqId === requirement.reqId && l.catalogVersion === requirement.catalogVersion,
      )
    ) {
      setError('Esta referencia ya está asociada a la tarea.');
      return;
    }
    setError('');
    onChange([
      ...links,
      {
        catalogVersion: requirement.catalogVersion,
        reqId: requirement.reqId,
        reason: '',
        scope: '',
        criterion: '',
        method: '',
      },
    ]);
    setReference('');
  }
  return (
    <details className="form-section task-asvs-links" open={links.length > 0}>
      <summary>
        <strong>Requisitos ASVS de esta tarea ({links.length})</strong>
      </summary>
      <p className="muted">
        Las asociaciones y verificaciones de tarea conservan su historial. El cumplimiento del
        proyecto se revisa por separado.
      </p>
      {!config && <p>Configura ASVS en Verificación ASVS para asociar referencias.</p>}
      {config && (
        <div className="row">
          <Field label="Referencia ASVS para asociar">
            <input
              value={reference}
              maxLength={240}
              placeholder={`v${config.catalogVersion}-1.2.5`}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={!reference.trim() || links.length >= 50}
            onClick={add}
          >
            Añadir referencia ASVS
          </Button>
        </div>
      )}
      {links.map((link, index) => {
        const archived =
          link.catalogVersion !== config?.catalogVersion ||
          link.catalogVersion !== asvsCatalog.version;
        const r = resolveAsvsReference(
          asvsCatalog,
          `v${link.catalogVersion}-${link.reqId.slice(1)}`,
        );
        const displayed = asvsDisplayRequirements.find(
          (item) => item.reqId === link.reqId && item.catalogVersion === link.catalogVersion,
        );
        const v = verifications.find(
          (item) =>
            item.assessment.reqId === link.reqId &&
            item.assessment.catalogVersion === link.catalogVersion,
        );
        const savedLink = task?.asvsLinks?.find(
          (item) => item.reqId === link.reqId && item.catalogVersion === link.catalogVersion,
        );
        return (
          <section
            className="form-section"
            key={`${link.catalogVersion}:${link.reqId}`}
            aria-label={`Asociación ${link.reqId}`}
          >
            <strong>{r?.canonicalRef ?? `${link.catalogVersion} · ${link.reqId}`}</strong>
            <p>{displayed?.description ?? r?.description}</p>
            {archived && (
              <p>
                Vínculo de un catálogo anterior. Conserva su historia; revisa el compromiso y añade
                una referencia de la versión activa antes de volver a verificar. No se trasladan
                ticks.
              </p>
            )}
            <Field label={`Exigir ${link.reqId} al cerrar la tarea`}>
              <input
                type="checkbox"
                disabled={archived}
                checked={link.mandatory ?? false}
                onChange={(e) =>
                  onChange(
                    links.map((l, i) => (i === index ? { ...l, mandatory: e.target.checked } : l)),
                  )
                }
              />
            </Field>
            {displayed?.description !== r?.description && (
              <details>
                <summary>Ver original oficial en inglés</summary>
                <p lang="en">{r?.description}</p>
              </details>
            )}
            {(Object.keys(linkLabels) as (keyof typeof linkLabels)[]).map((field) => (
              <Field key={field} label={linkLabels[field]}>
                <textarea
                  readOnly={archived}
                  required
                  value={link[field]}
                  maxLength={16000}
                  onChange={(e) =>
                    onChange(
                      links.map((l, i) => (i === index ? { ...l, [field]: e.target.value } : l)),
                    )
                  }
                />
              </Field>
            ))}
            <Button
              variant="secondary"
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              Retirar {link.reqId}
            </Button>
            <p>
              Verificación de tarea: {v?.assessment.state ?? 'Pendiente'}
              {v?.status.stale ? ` · Requiere revisión: ${v.status.reasons.join(', ')}` : ''}
            </p>
            {savedLink && JSON.stringify(link) !== JSON.stringify(savedLink) && (
              <p>Guarda los cambios de asociación antes de verificar la tarea.</p>
            )}
            {task &&
              savedLink &&
              JSON.stringify(link) === JSON.stringify(savedLink) &&
              !archived &&
              config?.level && (
                <TaskVerificationFields
                  key={`${link.reqId}:${v?.assessment.version ?? 0}:${task.version}`}
                  task={task}
                  link={savedLink}
                  config={config}
                  current={v?.assessment}
                  records={snapshot.records}
                  refresh={refresh}
                />
              )}
            {!task && <p className="muted">Guarda la tarea antes de registrar una verificación.</p>}
            {snapshot.asvs?.history
              .filter(
                (h) =>
                  h.kind === 'task-verification' &&
                  h.after.catalogVersion === link.catalogVersion &&
                  h.after.taskId === task?.id &&
                  h.after.reqId === link.reqId,
              )
              .slice(-5)
              .reverse()
              .map(
                (h) =>
                  h.kind === 'task-verification' && (
                    <p className="muted" key={h.id}>
                      {h.before?.state ?? 'Pendiente'} → {h.after.state} · {h.after.note} ·{' '}
                      {h.after.evidence.map((e) => `${e.reference} (${e.revision})`).join('; ')}
                    </p>
                  ),
              )}
          </section>
        );
      })}
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}

function TaskVerificationFields({
  task,
  link,
  config,
  current,
  records,
  refresh,
}: {
  task: Task;
  link: AsvsTaskLink;
  config: NonNullable<Snapshot['asvs']>['config'];
  current?: AsvsAssessment;
  records: Snapshot['records'];
  refresh: () => Promise<void>;
}) {
  const [state, setState] = useState(current?.state ?? 'Pendiente');
  const [note, setNote] = useState(current?.note ?? '');
  const [responsible, setResponsible] = useState(current?.responsible ?? '');
  const [expectedConfigVersion] = useState(config.version);
  const [evidence, setEvidence] = useState(
    current?.evidence.length
      ? current.evidence.map(({ recordId, reference, revision }) => ({
          recordId: recordId ?? '',
          reference,
          revision,
        }))
      : [{ recordId: '', reference: '', revision: '' }],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('asvs-task-review', {
        projectId: task.project,
        taskId: task.id,
        reqId: link.reqId,
        expectedTaskVersion: task.version,
        expectedVersion: current?.version ?? 0,
        expectedConfigVersion,
        state,
        applicability: 'Aplicable',
        scopeDetail: link.scope,
        pendingScope: 'La verificación del proyecto queda pendiente de revisión global.',
        note,
        method: link.method,
        responsible,
        evidence: evidence
          .filter((e) => e.recordId || e.reference || e.revision)
          .map((e) => ({
            reference: e.reference,
            revision: e.revision,
            ...(e.recordId ? { recordId: e.recordId } : {}),
          })),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="form-section">
      <summary>Revisar verificación de tarea {link.reqId}</summary>
      <Field label="Estado ASVS de la tarea">
        <select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          {['Pendiente', 'Cumplido', 'No cumplido', 'Requiere consulta'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Nota de verificación de tarea">
        <textarea value={note} maxLength={16000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Responsable de verificación de tarea">
        <input
          value={responsible}
          maxLength={240}
          onChange={(e) => setResponsible(e.target.value)}
        />
      </Field>
      {evidence.map((e, index) => {
        const change = (patch: Partial<typeof e>) =>
          setEvidence((items) =>
            items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
          );
        return (
          <fieldset key={index}>
            <legend>Evidencia de tarea {index + 1}</legend>
            <Field label={`Fuente local de evidencia de tarea ${index + 1}`}>
              <select
                value={e.recordId}
                onChange={(event) => {
                  const recordId = event.target.value;
                  const source = records.find((r) => r.id === recordId);
                  change({
                    recordId,
                    ...(source ? { reference: source.title, revision: `v${source.version}` } : {}),
                  });
                }}
              >
                <option value="">Referencia externa</option>
                {records
                  .filter(
                    (r) =>
                      r.project === task.project &&
                      ['task', 'entry', 'incident', 'decision'].includes(r.kind),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label={
                index === 0
                  ? 'Evidencia de verificación de tarea'
                  : `Evidencia de verificación de tarea ${index + 1}`
              }
            >
              <input
                value={e.reference}
                maxLength={2000}
                onChange={(event) => change({ reference: event.target.value })}
              />
            </Field>
            <Field
              label={
                index === 0
                  ? 'Revisión de evidencia de tarea'
                  : `Revisión de evidencia de tarea ${index + 1}`
              }
            >
              <input
                value={e.revision}
                maxLength={240}
                onChange={(event) => change({ revision: event.target.value })}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => setEvidence((items) => items.filter((_, i) => i !== index))}
            >
              Retirar evidencia de tarea {index + 1}
            </Button>
          </fieldset>
        );
      })}
      <Button
        variant="secondary"
        disabled={evidence.length >= 30}
        onClick={() =>
          setEvidence((items) => [...items, { recordId: '', reference: '', revision: '' }])
        }
      >
        Añadir evidencia de tarea
      </Button>
      <Button disabled={busy} onClick={() => void save()}>
        Guardar verificación de tarea
      </Button>
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}
