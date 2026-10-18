import { useState } from 'react';
import type {
  AsvsAssessment,
  AsvsConfig,
  AsvsOverview,
  AsvsState,
} from '../../shared/asvsTracking';
import { ASVS_STATES } from '../../shared/asvsTracking';
import type { RecordItem } from '../../shared/model';
import { api } from '../api';
import { Button, Field, Notice } from '../ui';

export default function AsvsReview({
  assessment,
  config,
  records,
  onSaved,
  onCancel,
}: {
  assessment: AsvsAssessment;
  config: AsvsConfig;
  records: RecordItem[];
  onSaved: (overview: AsvsOverview) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<AsvsState>(assessment.state);
  const [applicability, setApplicability] = useState(assessment.applicability);
  const [scope, setScope] = useState(assessment.scope);
  const [scopeDetail, setScopeDetail] = useState(assessment.scopeDetail);
  const [pendingScope, setPendingScope] = useState(assessment.pendingScope);
  const [taskId, setTaskId] = useState(assessment.taskId ?? '');
  const [note, setNote] = useState(assessment.note);
  const [method, setMethod] = useState(assessment.method);
  const [responsible, setResponsible] = useState(assessment.responsible);
  const [evidence, setEvidence] = useState(
    assessment.evidence.map(({ recordId, reference, revision }) => ({
      recordId: recordId ?? '',
      reference,
      revision,
    })),
  );
  const [reason, setReason] = useState(assessment.decision?.reason ?? '');
  const [decisionReference, setDecisionReference] = useState(assessment.decision?.reference ?? '');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expectedConfigVersion] = useState(config.version);
  const sources = records.filter((r) => ['task', 'entry', 'incident', 'decision'].includes(r.kind));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const overview = await api<AsvsOverview>('asvs-review', {
        projectId: config.projectId,
        targetId: assessment.id,
        expectedVersion: assessment.version,
        expectedConfigVersion,
        state,
        applicability,
        scope,
        scopeDetail: scope === 'project' ? '' : scopeDetail,
        pendingScope: scope === 'project' ? '' : pendingScope,
        ...(scope === 'task'
          ? { taskId, expectedTaskVersion: records.find((r) => r.id === taskId)?.version }
          : {}),
        note,
        method,
        responsible,
        evidence: evidence.map((e) => ({
          reference: e.reference,
          revision: e.revision,
          ...(e.recordId ? { recordId: e.recordId } : {}),
        })),
        ...(state === 'No aplicable'
          ? { decision: { approved, reason, reference: decisionReference, responsible } }
          : {}),
      });
      onSaved(overview);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="asvs-review" onSubmit={save} aria-label={`Revisar ${assessment.reqId}`}>
      <h4>Revisión humana de {assessment.reqId}</h4>
      <div className="asvs-fields">
        <Field label="Aplicabilidad">
          <select
            autoFocus
            value={applicability}
            onChange={(e) => {
              const value = e.target.value as typeof applicability;
              setApplicability(value);
              setState(value === 'No aplicable' ? 'No aplicable' : 'Pendiente');
              if (value === 'No aplicable') setScope('project');
            }}
          >
            <option>Por determinar</option>
            <option>Aplicable</option>
            <option>No aplicable</option>
          </select>
        </Field>
        <Field label="Estado de evaluación">
          <select value={state} onChange={(e) => setState(e.target.value as AsvsState)}>
            {ASVS_STATES.filter((s) =>
              applicability === 'No aplicable' ? s === 'No aplicable' : s !== 'No aplicable',
            ).map((s) => (
              <option
                key={s}
                disabled={applicability !== 'Aplicable' && ['Cumplido', 'No cumplido'].includes(s)}
              >
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Alcance evaluado">
          <select
            value={scope}
            disabled={applicability === 'No aplicable'}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="project">Todo el proyecto</option>
            <option value="component">Componente (parcial)</option>
            <option value="task">Tarea (parcial)</option>
          </select>
        </Field>
        {scope !== 'project' && (
          <>
            <Field label="Componente o alcance cubierto">
              <input
                required
                value={scopeDetail}
                maxLength={16000}
                onChange={(e) => setScopeDetail(e.target.value)}
              />
            </Field>
            <Field label="Alcance pendiente del proyecto">
              <input
                required
                value={pendingScope}
                maxLength={16000}
                onChange={(e) => setPendingScope(e.target.value)}
              />
            </Field>
            {scope === 'task' && (
              <Field label="Tarea evaluada">
                <select required value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  <option value="">Selecciona una tarea</option>
                  {records
                    .filter((r) => r.kind === 'task')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </>
        )}
        <Field label="Método de verificación">
          <input
            required={state !== 'Pendiente'}
            maxLength={240}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Prueba automatizada, revisión de código…"
          />
        </Field>
        <Field label="Responsable de revisión">
          <input
            required={state !== 'Pendiente'}
            maxLength={240}
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Justificación y siguiente paso">
        <textarea
          required={state !== 'Pendiente'}
          maxLength={16000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <fieldset>
        <legend>Evidencias</legend>
        {evidence.map((source, index) => (
          <div className="asvs-evidence-input" key={index}>
            <Field label={`Fuente ${index + 1}`}>
              <select
                value={source.recordId}
                onChange={(e) =>
                  setEvidence(
                    evidence.map((s, i) => (i === index ? { ...s, recordId: e.target.value } : s)),
                  )
                }
              >
                <option value="">Referencia externa</option>
                {sources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Referencia concreta ${index + 1}`}>
              <input
                required
                maxLength={2000}
                value={source.reference}
                onChange={(e) =>
                  setEvidence(
                    evidence.map((s, i) => (i === index ? { ...s, reference: e.target.value } : s)),
                  )
                }
              />
            </Field>
            <Field label={`Revisión o versión ${index + 1}`}>
              <input
                required
                maxLength={240}
                value={source.revision}
                onChange={(e) =>
                  setEvidence(
                    evidence.map((s, i) => (i === index ? { ...s, revision: e.target.value } : s)),
                  )
                }
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => setEvidence(evidence.filter((_, i) => i !== index))}
            >
              Quitar evidencia {index + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={evidence.length >= 30}
          onClick={() => setEvidence([...evidence, { recordId: '', reference: '', revision: '' }])}
        >
          Añadir evidencia
        </Button>
        <p>
          Las referencias externas se registran como texto. Revisa el contexto si cambia el sistema
          evaluado.
        </p>
      </fieldset>
      {state === 'No aplicable' && (
        <fieldset>
          <legend>Decisión humana de exclusión</legend>
          <Field label="Motivo de no aplicabilidad">
            <textarea
              required
              maxLength={16000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field label="Referencia de la decisión">
            <input
              required
              maxLength={2000}
              value={decisionReference}
              onChange={(e) => setDecisionReference(e.target.value)}
            />
          </Field>
          <label className="asvs-approval">
            <input
              type="checkbox"
              checked={approved}
              required
              onChange={(e) => setApproved(e.target.checked)}
            />
            Apruebo excluir este requisito del alcance del proyecto.
          </label>
          <p>
            La exclusión se muestra aparte del cumplimiento y se revisa al cambiar nivel o contexto.
          </p>
        </fieldset>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="row">
        <Button type="submit" disabled={busy}>
          Guardar revisión
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancelar revisión
        </Button>
      </div>
    </form>
  );
}
