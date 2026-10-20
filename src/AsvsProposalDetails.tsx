import { asvsCatalog } from '../shared/asvsCatalog';
import { asvsDisplayRequirements, asvsTranslationProvider } from '../shared/asvsCatalogEs';
import type { AsvsAssessment, AsvsProposal, AsvsState } from '../shared/asvsTracking';
import type { RecordItem, Snapshot, Task } from '../shared/model';
import { Badge } from './ui';

const scopeLabels: Record<AsvsAssessment['scope'], string> = {
  project: 'Todo el proyecto',
  component: 'Componente (parcial)',
  task: 'Tarea (parcial)',
};
const sourceLabels: Partial<Record<RecordItem['kind'], string>> = {
  task: 'Tarea',
  entry: 'Entrada',
  incident: 'Incidencia',
  decision: 'Decisión',
};
const stateTones: Partial<Record<AsvsState, string>> = {
  Cumplido: 'green',
  'No cumplido': 'red',
  'Requiere consulta': 'amber',
};

function findRequirement(reference: string) {
  const index = asvsCatalog.requirements.findIndex(
    (r) => r.reqId === reference || r.canonicalRef === reference,
  );
  return index < 0
    ? undefined
    : { display: asvsDisplayRequirements[index], original: asvsCatalog.requirements[index] };
}

/** Requirement text and current project situation, so a proposal is judged in context. */
export function AsvsRequirementContext({
  reference,
  snapshot,
  excludeTaskId,
}: {
  reference: string;
  snapshot: Snapshot;
  excludeTaskId?: string;
}) {
  const requirement = findRequirement(reference);
  if (!requirement) return <p>Referencia ASVS no disponible en el catálogo: {reference}</p>;
  const { display, original } = requirement;
  const assessment = snapshot.asvs?.assessments.find(
    (a) => a.reqId === display.reqId && a.catalogVersion === display.catalogVersion,
  );
  const tasks = snapshot.records.filter(
    (r): r is Task =>
      r.kind === 'task' &&
      r.id !== excludeTaskId &&
      !r.recurrence?.canceledAt &&
      !!r.asvsLinks?.some(
        (l) => l.reqId === display.reqId && l.catalogVersion === display.catalogVersion,
      ),
  );
  return (
    <div className="asvs-context">
      <p className="asvs-context-path">
        <strong>{display.canonicalRef}</strong> · {display.chapterName} › {display.sectionName} · L
        {display.minLevel}
      </p>
      <p lang={asvsTranslationProvider ? 'es' : 'en'}>{display.description}</p>
      {asvsTranslationProvider && (
        <details>
          <summary>Original oficial en inglés</summary>
          <p lang="en">{original.description}</p>
        </details>
      )}
      <p className="muted">
        Estado actual en el proyecto:{' '}
        <Badge tone={stateTones[assessment?.state ?? 'Pendiente']}>
          {assessment?.state ?? 'Pendiente'}
        </Badge>{' '}
        · Aplicabilidad: {assessment?.applicability ?? 'Por determinar'}
        {snapshot.asvs?.config.level ? '' : ' · ASVS desactivado'}
      </p>
      <p className="muted">
        Tareas ya vinculadas:{' '}
        {tasks.length ? tasks.map((t) => `${t.title} (${t.state})`).join('; ') : 'ninguna'}
      </p>
    </div>
  );
}

function Change({ label, before, after }: { label: string; before?: string; after: string }) {
  const changed = before !== undefined && before !== after && before.trim();
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {changed && <del>{before}</del>}
        <span>{after || '—'}</span>
      </dd>
    </div>
  );
}

/** Structured before/after of an assessment or task-verification proposal. */
export function AsvsProposalChange({
  proposal,
  snapshot,
}: {
  proposal: AsvsProposal;
  snapshot: Snapshot;
}) {
  const { before, request } = proposal;
  const scope = (value: Pick<AsvsAssessment, 'scope' | 'scopeDetail' | 'pendingScope'>) =>
    [
      scopeLabels[value.scope],
      value.scopeDetail,
      value.pendingScope && `Pendiente: ${value.pendingScope}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const task =
    proposal.destination === 'task'
      ? snapshot.records.find((r) => r.id === request.taskId)
      : undefined;
  return (
    <div className="asvs-proposal-change">
      <AsvsRequirementContext
        reference={before.reqId}
        snapshot={snapshot}
        excludeTaskId={request.taskId}
      />
      {proposal.destination === 'task' && (
        <p>
          <strong>Verificación de la tarea:</strong> {task?.title ?? 'tarea no disponible'}. No
          cambia la evaluación global del proyecto.
        </p>
      )}
      <dl className="asvs-change">
        <div>
          <dt>Estado</dt>
          <dd>
            <Badge tone={stateTones[before.state]}>{before.state}</Badge> →{' '}
            <Badge tone={stateTones[request.state]}>{request.state}</Badge>
          </dd>
        </div>
        {before.applicability !== request.applicability && (
          <Change
            label="Aplicabilidad"
            before={before.applicability}
            after={request.applicability}
          />
        )}
        <Change
          label="Alcance verificado"
          before={before.reviewedAt ? scope(before) : undefined}
          after={scope(request)}
        />
        <Change label="Hallazgo o nota" before={before.note} after={request.note} />
        <Change
          label="Método y responsable"
          before={before.method && `${before.method} · ${before.responsible}`}
          after={`${request.method} · ${request.responsible}`}
        />
        <div>
          <dt>Evidencias</dt>
          <dd>
            {request.evidence.length ? (
              <ul>
                {request.evidence.map((e, index) => {
                  const source = e.recordId
                    ? snapshot.records.find((r) => r.id === e.recordId)
                    : undefined;
                  return (
                    <li key={index}>
                      {e.reference} · revisión {e.revision}
                      {e.recordId &&
                        ` · ${source ? `${sourceLabels[source.kind] ?? 'Registro'}: ${source.title}` : 'Fuente eliminada'}`}
                    </li>
                  );
                })}
              </ul>
            ) : (
              'Sin evidencia'
            )}
          </dd>
        </div>
      </dl>
      {proposal.rationale && (
        <p>
          <strong>Motivo del asistente ({proposal.provider}):</strong> {proposal.rationale}
        </p>
      )}
    </div>
  );
}
