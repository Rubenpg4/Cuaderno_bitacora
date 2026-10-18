import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Save,
  Plus,
  ShieldCheck,
  RefreshCw,
  History as HistoryIcon,
  Trash2,
  Link2,
  CheckCircle2,
  CheckSquare2,
} from 'lucide-react';
import {
  CATEGORIES,
  PHASES,
  STATES,
  PRACTICE_STATES,
  CHECK_STATES,
  PRIORITIES,
  weeklyReport,
  staleChecks,
  unresolved,
  madridDate,
  validDay,
  isTaskCompletedOnDay,
  resolveTaskMoveChange,
  type RecordItem,
  type QuickCapture,
  type Kind,
  type Task,
  type Practice,
  type Snapshot,
  type Attachment,
  type Objective,
  type ObjectiveLink,
  type Meeting,
  type AgreementItem,
} from '../shared/model';
import { type RecurrenceRule } from '../shared/recurrence';
import { Attachments } from './Attachments';
import { blank } from './defaults';
import { api, saveRecord } from './api';
import { AutoTextarea, Badge, Button, Field, Notice } from './ui';
import TaskHistory from './TaskHistory';
import TaskRecurrenceFields from './TaskRecurrenceFields';
import TaskPicker from './TaskPicker';
import CopyRecordId from './CopyRecordId';
import { MentionEditor } from './EntryMentions';
import { entryMentionFields, linksFromEntryText } from './entryLinks';
import { useDraft } from './useDraft';
import ObjectiveLinks from './ObjectiveLinks';
const TaskAsvsFields = lazy(() => import('./TaskAsvsFields'));
const labels: Record<string, string> = {
  title: 'Título',
  project: 'Proyecto',
  activity: 'Qué he hecho',
  result: 'Resultado o avance',
  learning: 'Qué he aprendido',
  nextStep: 'Siguiente paso',
  blocker: 'Problema o bloqueo',
  blocked: 'Bloqueo actual',
  competency: 'Competencias trabajadas',
  evidence: 'Evidencia o referencia',
  original: 'Notas originales',
  description: 'Descripción',
  solution: 'Solución',
  problem: 'Problema',
  alternatives: 'Alternativas consideradas',
  decision: 'Decisión',
  reason: 'Motivo',
  consequences: 'Consecuencias',
  objective: 'Objetivo',
  specifications: 'Especificaciones técnicas',
  tutor: 'Tutor o responsable',
  validationReference: 'Referencia de validación',
  explanation: 'Explicación',
  source: 'Fuente o referencia',
  owner: 'Responsable',
  body: 'Informe',
  agreements: 'Acuerdos',
};
const deleteLabels: Partial<Record<Kind, string>> = {
  task: 'tarea',
  incident: 'incidencia',
  entry: 'entrada',
  decision: 'decisión',
  idea: 'idea',
  meeting: 'reunión',
  project: 'proyecto',
  practice: 'política o criterio',
  objective: 'objetivo',
};
export default function RecordEditor({
  kind,
  record,
  snapshot,
  onSaved,
  onRefresh,
  onDelete,
  onOpenRecord,
  registerFlush,
  initial = {},
  capture,
  followUp,
  focusEvidence,
  onCreateFollowUp,
}: {
  kind: Kind;
  record?: RecordItem;
  snapshot: Snapshot;
  onSaved: () => void;
  onRefresh: () => Promise<void>;
  onDelete?: () => void;
  onOpenRecord?: (record: RecordItem) => void;
  registerFlush?: (flush: () => Promise<void>) => () => void;
  initial?: Record<string, unknown>;
  capture?: QuickCapture;
  followUp?: { meetingId: string; agreementId: string; meetingVersion: number };
  focusEvidence?: boolean;
  onCreateFollowUp?: (meeting: Meeting, agreement: AgreementItem) => void;
}) {
  const draftKey = record
    ? `record:${record.id}`
    : capture
      ? `new:capture:${capture.id}`
      : `new:${kind}`;
  const restoredDraft = snapshot.drafts?.[draftKey];
  const outdatedDraft =
    record &&
    restoredDraft &&
    typeof restoredDraft.version === 'number' &&
    restoredDraft.version < record.version
      ? restoredDraft
      : undefined;
  const [staleDraft, setStaleDraft] = useState(outdatedDraft);
  const { data, setData, flush, status } = useDraft(
    draftKey,
    { ...blank(kind), ...record, ...initial },
    outdatedDraft ? undefined : restoredDraft,
  );
  useEffect(() => registerFlush?.(flush), [registerFlush]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState('');
  const [linkRole, setLinkRole] = useState<ObjectiveLink['role']>('trabajo');
  const [linkReference, setLinkReference] = useState('');
  const [criteriaOpen, setCriteriaOpen] = useState(
    record?.kind === 'task' && record.checks.length > 0,
  );
  const practices = snapshot.records.filter((r): r is Practice => r.kind === 'practice');
  const series =
    record?.kind === 'task'
      ? snapshot.taskSeries?.find((item) => item.id === record.recurrence?.seriesId)
      : undefined;
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(series?.rule ?? null);
  const activePractices = practices.filter(
    (p) => p.status !== 'Retirada' && p.status !== 'Borrador',
  );
  const availableDependencies = snapshot.records.filter(
    (r): r is Task => r.kind === 'task' && r.id !== record?.id,
  );
  const agreementItems = (data.agreementItems ?? []) as (Omit<AgreementItem, 'id'> & {
    id?: string;
  })[];
  const changeAgreement = (index: number, patch: Record<string, unknown>) =>
    change(
      'agreementItems',
      agreementItems.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  const change = (key: string, value: unknown) =>
    setData((d) => {
      const updated = { ...d, [key]: value };
      if (
        kind === 'entry' &&
        entryMentionFields.includes(key as (typeof entryMentionFields)[number])
      ) {
        const textLinks = linksFromEntryText(updated, snapshot.records);
        const entryDate = String(updated.date || '');
        const entryProject = String(updated.project || '');
        const autoTaskIds = snapshot.records
          .filter(
            (r): r is Task =>
              r.kind === 'task' &&
              isTaskCompletedOnDay(r, entryDate) &&
              (!entryProject || r.project === entryProject),
          )
          .map((t) => t.id);
        return {
          ...updated,
          ...textLinks,
          taskIds: Array.from(new Set([...autoTaskIds, ...textLinks.taskIds])),
        };
      }
      return updated;
    });
  const entryCompletedTasks =
    kind === 'entry'
      ? snapshot.records.filter(
          (r): r is Task =>
            r.kind === 'task' &&
            isTaskCompletedOnDay(r, String(data.date || '')) &&
            (!data.project || r.project === data.project),
        )
      : [];
  const input = (key: string, multi = false, label = labels[key] || key, placeholder?: string) => (
    <Field label={label} key={key}>
      {multi && kind === 'entry' ? (
        <MentionEditor
          value={data[key] || ''}
          onChange={(value) => change(key, value)}
          records={snapshot.records}
          onOpen={(linked) =>
            void flush()
              .then(() => onOpenRecord?.(linked))
              .catch((e) => setError(e.message))
          }
          ariaLabel={label}
          rows={key === 'activity' ? 4 : 2}
          placeholder={placeholder}
        />
      ) : multi ? (
        <AutoTextarea
          value={String(data[key] || '')}
          onChange={(e) => change(key, e.target.value)}
          rows={key === 'body' ? 12 : 3}
        />
      ) : (
        <input
          value={data[key] || ''}
          onChange={(e) => change(key, e.target.value)}
          required={key === 'title'}
          maxLength={key === 'title' ? 240 : 16000}
        />
      )}
    </Field>
  );
  const select = (key: string, label: string, options: readonly string[]) => (
    <Field label={label}>
      <select value={data[key]} onChange={(e) => change(key, e.target.value)}>
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </Field>
  );
  async function submit() {
    setError('');
    setBusy(true);
    try {
      await flush();
      const entryDate = String(data.date || '');
      const entryProject = String(data.project || '');
      const autoTaskIds =
        kind === 'entry'
          ? snapshot.records
              .filter(
                (r): r is Task =>
                  r.kind === 'task' &&
                  isTaskCompletedOnDay(r, entryDate) &&
                  (!entryProject || r.project === entryProject),
              )
              .map((t) => t.id)
          : [];
      const finalTaskIds = Array.from(
        new Set([...((data.taskIds as string[]) || []), ...autoTaskIds]),
      );
      const prepared =
        kind === 'entry'
          ? {
              ...data,
              taskIds: finalTaskIds,
              title: data.title.trim() || `Avances del ${data.date}`,
              original: data.original || data.activity,
            }
          : kind === 'task'
            ? {
                ...data,
                checks: (data.checks as Task['checks']).filter((c) =>
                  activePractices.some((p) => p.id === c.practiceId),
                ),
              }
            : data;
      if (capture) {
        await api('capture-convert', {
          id: capture.id,
          expectedVersion: capture.version,
          kind,
          data: prepared,
          draftKey,
        });
      } else if (kind === 'task' && !record && recurrenceRule) {
        await api('save-task-series', { data: prepared, rule: recurrenceRule, draftKey });
      } else if (kind === 'task' && !record && followUp) {
        await api('save-follow-up-task', {
          data: prepared,
          meetingId: followUp.meetingId,
          agreementId: followUp.agreementId,
          expectedMeetingVersion: followUp.meetingVersion,
          draftKey,
        });
      } else await saveRecord(kind, prepared, record, draftKey);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function updateCheck(practiceId: string, key: string, value: string) {
    change(
      'checks',
      (data.checks as Task['checks']).map((c) =>
        c.practiceId === practiceId ? { ...c, [key]: value } : c,
      ),
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={`record-form ${kind === 'entry' ? 'entry-composer' : ''}`}
    >
      {capture && (
        <Notice>
          Clasificando un apunte de la bandeja. Se quitará de ella cuando guardes este registro.
          {capture.linkedRecordId && (
            <span>
              {' '}
              Vinculado con «
              {snapshot.records.find((item) => item.id === capture.linkedRecordId)?.title}».
            </span>
          )}
        </Notice>
      )}
      {staleDraft && (
        <Notice>
          Hay un borrador de una versión anterior. Se muestra la versión guardada más reciente.
          <div className="row">
            <Button
              variant="secondary"
              onClick={() => {
                setData(staleDraft);
                setStaleDraft(undefined);
              }}
            >
              Recuperar borrador anterior
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void (async () => {
                  try {
                    await api('delete-draft', { key: draftKey });
                    setStaleDraft(undefined);
                    await onRefresh();
                  } catch (cause) {
                    setError((cause as Error).message);
                  }
                })();
              }}
            >
              Descartar borrador anterior
            </Button>
          </div>
        </Notice>
      )}
      {record &&
        ['task', 'incident', 'idea', 'decision', 'project', 'objective'].includes(record.kind) && (
          <div className="record-id-actions">
            <CopyRecordId id={record.id} title={record.title} />
          </div>
        )}
      {kind !== 'entry' && input('title')}
      {kind === 'task' && (
        <>
          <div className="form-grid">
            {select('phase', 'Fase', PHASES)}
            {select('state', 'Estado', STATES)}
            {select('priority', 'Prioridad', PRIORITIES)}
            <Field label="Fecha de finalización">
              <input
                type="date"
                value={data.due}
                onChange={(e) => {
                  const newDue = e.target.value;
                  const currentTask = {
                    ...data,
                    state: data.state,
                    due: data.due,
                    dependencyIds: (data.dependencyIds as string[]) || [],
                  } as Task;
                  const nextChange = resolveTaskMoveChange(
                    currentTask,
                    { due: newDue },
                    madridDate(),
                    { allTasks: availableDependencies },
                  );
                  if (nextChange.state && nextChange.state !== data.state) {
                    change('state', nextChange.state);
                  }
                  change('due', newDue);
                }}
                required
              />
            </Field>
            {data.state === 'Completada' && (
              <Field label="Fecha real de finalización">
                <input
                  type="date"
                  value={
                    data.completedAt
                      ? validDay(data.completedAt)
                        ? data.completedAt
                        : madridDate(new Date(data.completedAt))
                      : madridDate()
                  }
                  onChange={(e) => change('completedAt', e.target.value)}
                />
              </Field>
            )}
            <Field label="Tipo de tarea">
              <input value={data.type} onChange={(e) => change('type', e.target.value)} />
            </Field>
            <Field label="Etiquetas (separadas por comas)">
              <input
                value={data.tags.join(', ')}
                onChange={(e) =>
                  change(
                    'tags',
                    e.target.value
                      .split(',')
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
          </div>
          {(!record || series) && (
            <>
              <TaskRecurrenceFields
                value={recurrenceRule}
                onChange={setRecurrenceRule}
                defaultStart={String(data.due || madridDate())}
                disabled={!!series?.archivedAt}
                allowNone={!series}
              />
              {series && (
                <div className="form-section">
                  <p className="muted">
                    Serie de{' '}
                    {
                      snapshot.records.filter(
                        (item) => item.kind === 'task' && item.recurrence?.seriesId === series.id,
                      ).length
                    }{' '}
                    apariciones. Los cambios en esta tarea se guardan por separado.
                  </p>
                  {!series.archivedAt && (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy || !recurrenceRule}
                        onClick={async () => {
                          if (
                            !recurrenceRule ||
                            !window.confirm(
                              '¿Aplicar estos datos y la regla a la serie? Las apariciones futuras pendientes se actualizarán.',
                            )
                          )
                            return;
                          setError('');
                          setBusy(true);
                          try {
                            await api('save-task-series', {
                              id: series.id,
                              expectedVersion: series.version,
                              data,
                              rule: recurrenceRule,
                            });
                            onSaved();
                          } catch (cause) {
                            setError((cause as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Actualizar serie con estos datos
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              '¿Detener la repetición? Las apariciones futuras pendientes se cancelarán.',
                            )
                          )
                            return;
                          setError('');
                          setBusy(true);
                          try {
                            await api('stop-task-series', {
                              id: series.id,
                              expectedVersion: series.version,
                            });
                            onSaved();
                          } catch (cause) {
                            setError((cause as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Detener repetición
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <TaskPicker
            label="Depende de estas tareas (opcional)"
            searchLabel="Buscar tareas de las que depende"
            tasks={availableDependencies}
            value={data.dependencyIds}
            onChange={(ids) => change('dependencyIds', ids)}
          />
          {data.state !== 'Por hacer' &&
            (data.dependencyIds as string[]).some((id) =>
              availableDependencies.some(
                (dependency) => dependency.id === id && dependency.state !== 'Completada',
              ),
            ) && <Notice error>Completa las tareas previas antes de iniciar esta tarea.</Notice>}
          {input('description', true)}
          {input('solution', true)}
          {input('blocked', true)}
          {input('nextStep', true)}
          {(snapshot.asvs || data.asvsLinks?.length > 0) && (
            <Suspense fallback={<p>Cargando requisitos ASVS…</p>}>
              <TaskAsvsFields
                links={data.asvsLinks ?? []}
                onChange={(links) => change('asvsLinks', links)}
                snapshot={snapshot}
                task={record?.kind === 'task' ? record : undefined}
                refresh={onRefresh}
              />
            </Suspense>
          )}
          <details
            className="form-section criteria-section"
            open={criteriaOpen}
            onToggle={(event) => setCriteriaOpen(event.currentTarget.open)}
          >
            <summary>
              <ShieldCheck size={19} />
              <strong>Criterios de esta tarea</strong>
              <span className="muted">
                {
                  (data.checks as Task['checks']).filter((c) =>
                    activePractices.some((p) => p.id === c.practiceId),
                  ).length
                }{' '}
                criterios ·{' '}
                {
                  (data.checks as Task['checks']).filter(
                    (c) => activePractices.some((p) => p.id === c.practiceId) && unresolved(c),
                  ).length
                }{' '}
                pendientes
              </span>
            </summary>
            <p className="muted">
              Marca cada criterio cuando lo hayas comprobado. Guarda la tarea para conservar los
              cambios. Las tareas nuevas reciben automáticamente las prácticas vigentes que les
              correspondan.
            </p>
            {record?.kind === 'task' && staleChecks(record, practices) && (
              <Notice error>
                Hay políticas actualizadas o pendientes de aplicar. Revisarlas sincronizará sus
                verificaciones. Guarda antes otros cambios.
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await api('sync-criteria', { id: record.id, version: record.version });
                      await onRefresh();
                      onSaved();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <RefreshCw size={15} /> Revisar versiones
                </Button>
              </Notice>
            )}
            {(data.checks as Task['checks'])
              .filter((c) => activePractices.some((p) => p.id === c.practiceId))
              .map((c) => (
                <div className="check-editor" key={c.practiceId}>
                  <label className="check-editor-main">
                    <input
                      type="checkbox"
                      checked={c.state === 'Cumplido'}
                      disabled={record?.kind === 'task' && record.state === 'Completada'}
                      onChange={(e) =>
                        updateCheck(
                          c.practiceId,
                          'state',
                          e.target.checked ? 'Cumplido' : 'Pendiente',
                        )
                      }
                      aria-label={`Cumplido: ${c.title}`}
                    />
                    <span>
                      <strong>{c.title}</strong>
                      <span className="check-editor-summary">
                        <Badge tone={c.mandatory ? 'amber' : ''}>
                          {c.mandatory ? 'Obligatorio' : 'Recomendación'} · v{c.practiceVersion}
                        </Badge>
                        <span className="muted">{c.state}</span>
                      </span>
                    </span>
                  </label>
                  <details className="check-editor-details">
                    <summary>Detalles y otras respuestas</summary>
                    <p>{c.explanation}</p>
                    {c.source && <small className="muted">Fuente: {c.source}</small>}
                    <Field label="Verificación">
                      <select
                        value={c.state}
                        disabled={record?.kind === 'task' && record.state === 'Completada'}
                        onChange={(e) => updateCheck(c.practiceId, 'state', e.target.value)}
                      >
                        {CHECK_STATES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Motivo o evidencia (opcional)">
                      <AutoTextarea
                        rows={2}
                        value={c.note}
                        disabled={record?.kind === 'task' && record.state === 'Completada'}
                        onChange={(e) => updateCheck(c.practiceId, 'note', e.target.value)}
                      />
                    </Field>
                    <details>
                      <summary>Registrar excepción autorizada</summary>
                      <Field label="Motivo de la excepción">
                        <input
                          value={c.exceptionReason}
                          disabled={record?.kind === 'task' && record.state === 'Completada'}
                          onChange={(e) =>
                            updateCheck(c.practiceId, 'exceptionReason', e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Referencia de autorización">
                        <input
                          value={c.authorization}
                          disabled={record?.kind === 'task' && record.state === 'Completada'}
                          onChange={(e) =>
                            updateCheck(c.practiceId, 'authorization', e.target.value)
                          }
                        />
                      </Field>
                    </details>
                    {c.state === 'Requiere consulta' && (
                      <small>Se incluirá en «Consultas de calidad» de la reunión del martes.</small>
                    )}
                  </details>
                </div>
              ))}
            {!(data.checks as Task['checks']).filter((c) =>
              activePractices.some((p) => p.id === c.practiceId),
            ).length && (
              <p className="muted">
                Se asociarán automáticamente al guardar. Puedes añadir otros criterios después.
              </p>
            )}
            <Field label="Asociar otro criterio">
              <select
                value=""
                disabled={record?.kind === 'task' && record.state === 'Completada'}
                onChange={(e) => {
                  const p = practices.find((p) => p.id === e.target.value);
                  if (p)
                    change('checks', [
                      ...data.checks,
                      {
                        practiceId: p.id,
                        practiceVersion: p.version,
                        title: p.title,
                        explanation: p.explanation,
                        source: p.source,
                        mandatory: p.mandatory,
                        state: 'Pendiente',
                        note: '',
                        exceptionReason: '',
                        authorization: '',
                      },
                    ]);
                }}
              >
                <option value="">Seleccionar práctica…</option>
                {activePractices
                  .filter((p) => !data.project || !p.project || p.project === data.project)
                  .filter(
                    (p) => !data.checks.some((c: Task['checks'][number]) => c.practiceId === p.id),
                  )
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </Field>
            {data.state === 'Completada' &&
              (data.checks as Task['checks'])
                .filter((c) => activePractices.some((p) => p.id === c.practiceId))
                .some(unresolved) && (
                <Notice error>
                  Quedan verificaciones pendientes. Los requisitos obligatorios deben resolverse
                  antes de completar.
                </Notice>
              )}
          </details>
        </>
      )}
      {kind === 'entry' && (
        <>
          <p className="muted">
            Unos minutos ahora. Escribe @ para enlazar una incidencia, tarea, decisión o idea.
          </p>
          {entryCompletedTasks.length > 0 && (
            <div
              className="daily-completed-tasks"
              role="region"
              aria-label="Tareas completadas del día"
            >
              <div className="daily-tasks-header">
                <CheckCircle2 size={16} />
                <strong>Tareas completadas este día ({entryCompletedTasks.length})</strong>
                <small className="muted">Avances verificados de la jornada</small>
              </div>
              <div className="daily-tasks-chips">
                {entryCompletedTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className="daily-task-chip"
                    onClick={() => onOpenRecord?.(task)}
                    title={`Ver tarea: ${task.title}`}
                  >
                    <CheckSquare2 size={14} />
                    <span>{task.title}</span>
                    {task.due !== data.date && (
                      <span className="chip-due-tag">prevista: {task.due}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="¿En qué has avanzado?">
            <MentionEditor
              value={data.activity || ''}
              onChange={(value) => change('activity', value)}
              records={snapshot.records}
              onOpen={(linked) =>
                void flush()
                  .then(() => onOpenRecord?.(linked))
                  .catch((cause) => setError((cause as Error).message))
              }
              rows={4}
              placeholder="Describe tu avance o escribe @ para vincular un registro…"
              ariaLabel="¿En qué has avanzado?"
            />
          </Field>
          <div className="form-grid">
            {input('result', true, 'Resultado', 'Qué ha quedado hecho o más claro')}
            {input('learning', true, 'Aprendizaje', 'Algo que te llevas de hoy')}
            {input('blocker', true, 'Bloqueo o ayuda que necesitas', 'Qué te impide avanzar')}
            {input('nextStep', true, 'Siguiente paso', 'Por dónde continuar')}
          </div>
          <details open={focusEvidence || undefined}>
            <summary>
              <Link2 size={14} /> Más detalles de la entrada
            </summary>
            <Field label="Título del registro">
              <input value={data.title} onChange={(e) => change('title', e.target.value)} />
            </Field>
            <div className="form-grid">
              <Field label="Día">
                <input
                  type="date"
                  value={data.date}
                  required
                  onChange={(e) => change('date', e.target.value)}
                />
              </Field>
              {select('contribution', 'Mi aportación', [
                'Investigué',
                'Propuse',
                'Implementé',
                'Validé',
              ])}
            </div>
            {input('evidence')}
            {input('competency')}
            {input('original', true)}
          </details>
        </>
      )}
      {kind === 'incident' && (
        <>
          <Field label="Día de la incidencia">
            <input
              type="date"
              value={data.date}
              required
              onChange={(e) => change('date', e.target.value)}
            />
          </Field>
          {input('description', true)}
          <div className="form-grid">
            {input('solution', true)}
            <Field label="Día de resolución">
              <input
                type="date"
                value={data.resolvedDate}
                min={data.date}
                required={!!data.solution.trim()}
                onChange={(e) => change('resolvedDate', e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      {kind === 'decision' && (
        <>
          <Field label="Día de la decisión">
            <input
              type="date"
              value={data.date}
              required
              onChange={(e) => change('date', e.target.value)}
            />
          </Field>
          {['problem', 'alternatives', 'decision', 'reason', 'consequences', 'evidence'].map((k) =>
            input(k, true),
          )}
        </>
      )}
      {kind === 'idea' && (
        <>
          <Field label="Día de la idea">
            <input
              type="date"
              value={data.date}
              required
              onChange={(e) => change('date', e.target.value)}
            />
          </Field>
          {input('description', true)}
        </>
      )}
      {kind === 'practice' && (
        <>
          <div className="form-grid">
            {select('category', 'Categoría', CATEGORIES)}
            {select('status', 'Estado de la práctica', PRACTICE_STATES)}
          </div>
          {data.status === 'Borrador' && (
            <p className="muted" style={{ marginTop: '-8px', marginBottom: '12px' }}>
              Los borradores se gestionan de forma aislada y no se asocian a tareas hasta ser
              promovidos a recomendación personal o política confirmada.
            </p>
          )}
          {input('explanation', true)}
          {input('source', true)}
          {input('owner')}
          <div className="row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={data.mandatory}
                onChange={(e) => change('mandatory', e.target.checked)}
              />
              Requisito obligatorio
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={data.pinned}
                onChange={(e) => change('pinned', e.target.checked)}
              />
              Fijar como esencial
            </label>
          </div>
          <fieldset>
            <legend>Fases donde aplica (ninguna = todas)</legend>
            {PHASES.map((p) => (
              <label key={p} className="checkbox">
                <input
                  type="checkbox"
                  checked={data.phases.includes(p)}
                  onChange={(e) =>
                    change(
                      'phases',
                      e.target.checked
                        ? [...data.phases, p]
                        : data.phases.filter((x: string) => x !== p),
                    )
                  }
                />
                {p}
              </label>
            ))}
          </fieldset>
          <Field label="Etiquetas o tipos de tarea (vacío = todos)">
            <input
              value={data.tags.join(', ')}
              onChange={(e) =>
                change(
                  'tags',
                  e.target.value
                    .split(',')
                    .map((s: string) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
          <Notice>
            Solo marca una política como confirmada si tienes una fuente o referencia verificable de
            la empresa.
          </Notice>
        </>
      )}
      {kind === 'project' && (
        <>
          {input('objective', true)}
          {input('specifications', true)}
          {input('competency', true)}
          <section className="form-section">
            <h3>Validación del tutor</h3>
            {input('tutor')}
            <Field label="Fecha de validación">
              <input
                type="date"
                value={data.validationDate}
                onChange={(e) => change('validationDate', e.target.value)}
              />
            </Field>
            {input('validationReference', true)}
            <p className="muted">
              Registra una validación que ya haya ocurrido. La aplicación no la certifica.
            </p>
          </section>
        </>
      )}
      {kind === 'objective' && (
        <>
          {input('description', true, 'Qué se quiere lograr')}
          <section className="form-section">
            <h3>Trabajo, resultados y evidencias</h3>
            <p className="muted">
              Una tarea aporta trabajo. Una entrada puede aportar trabajo, un resultado o una
              referencia de evidencia. Completar una tarea no valida este objetivo.
            </p>
            {((data.links as ObjectiveLink[]) || []).map((link) => {
              const source = snapshot.records.find((item) => item.id === link.sourceId);
              return (
                <div className="row" key={`${link.sourceKind}:${link.sourceId}:${link.role}`}>
                  <span>
                    {link.role}: {source?.title || 'Registro eliminado'}
                    {link.reference ? ` · ${link.reference}` : ''}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      change(
                        'links',
                        (data.links as ObjectiveLink[]).filter((candidate) => candidate !== link),
                      )
                    }
                  >
                    Quitar
                  </Button>
                </div>
              );
            })}
            <div className="form-grid">
              <Field label="Registro de apoyo">
                <select
                  value={linkSourceId}
                  onChange={(event) => setLinkSourceId(event.target.value)}
                >
                  <option value="">Selecciona un registro</option>
                  {snapshot.records
                    .filter(
                      (item) =>
                        (item.kind === 'task' || item.kind === 'entry') &&
                        (item.kind !== 'task' || !item.recurrence?.canceledAt) &&
                        item.project === data.project,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.kind === 'task' ? 'Tarea' : 'Entrada'} · {item.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Qué aporta">
                <select
                  value={linkRole}
                  onChange={(event) => setLinkRole(event.target.value as ObjectiveLink['role'])}
                >
                  <option value="trabajo">Trabajo</option>
                  <option value="resultado">Resultado</option>
                  <option value="evidencia">Evidencia</option>
                </select>
              </Field>
              {linkRole === 'evidencia' && (
                <Field label="Referencia de evidencia">
                  <input
                    value={linkReference}
                    onChange={(event) => setLinkReference(event.target.value)}
                  />
                </Field>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                const source = snapshot.records.find((item) => item.id === linkSourceId);
                if (!source || (source.kind !== 'task' && source.kind !== 'entry')) return;
                if (source.kind === 'task' && linkRole !== 'trabajo') {
                  setError('Una tarea solo puede aportar trabajo.');
                  return;
                }
                if (linkRole === 'evidencia' && !linkReference.trim()) {
                  setError('Añade una referencia de evidencia.');
                  return;
                }
                const links = (data.links as ObjectiveLink[]) || [];
                if (links.some((link) => link.sourceId === source.id && link.role === linkRole)) {
                  setError('Ese vínculo ya existe.');
                  return;
                }
                change('links', [
                  ...links,
                  {
                    sourceKind: source.kind,
                    sourceId: source.id,
                    role: linkRole,
                    reference: linkRole === 'evidencia' ? linkReference.trim() : '',
                  },
                ]);
                setLinkSourceId('');
                setLinkReference('');
                setError('');
              }}
            >
              Vincular registro
            </Button>
          </section>
          <section className="form-section">
            <h3>Validación humana</h3>
            <Field label="Estado">
              <select
                value={(data.validation as Objective['validation']).state}
                onChange={(event) =>
                  change('validation', {
                    ...data.validation,
                    state: event.target.value,
                  })
                }
              >
                <option value="Pendiente">Pendiente</option>
                <option value="Validado">Validado</option>
              </select>
            </Field>
            {(data.validation as Objective['validation']).state === 'Validado' && (
              <>
                <Field label="Fecha de validación">
                  <input
                    type="date"
                    value={(data.validation as Objective['validation']).date}
                    onChange={(event) =>
                      change('validation', { ...data.validation, date: event.target.value })
                    }
                  />
                </Field>
                <Field label="Responsable">
                  <input
                    value={(data.validation as Objective['validation']).responsible}
                    onChange={(event) =>
                      change('validation', { ...data.validation, responsible: event.target.value })
                    }
                  />
                </Field>
                <Field label="Referencia de validación">
                  <input
                    value={(data.validation as Objective['validation']).reference}
                    onChange={(event) =>
                      change('validation', { ...data.validation, reference: event.target.value })
                    }
                  />
                </Field>
              </>
            )}
            <p className="muted">
              La aplicación registra esta declaración; no certifica el objetivo. Si cambias un
              vínculo o un resultado usado, volverá a pendiente.
            </p>
          </section>
        </>
      )}
      {(kind === 'task' || kind === 'entry') &&
        (record?.kind === 'task' || record?.kind === 'entry' ? (
          JSON.stringify(data) === JSON.stringify({ ...blank(kind), ...record, ...initial }) ? (
            <ObjectiveLinks
              record={record}
              snapshot={snapshot}
              onRefresh={onRefresh}
              onOpenObjective={onOpenRecord}
            />
          ) : (
            <p className="muted">
              Guarda los cambios de este registro antes de vincular objetivos.
            </p>
          )
        ) : (
          <p className="muted">Guarda el registro para poder vincularlo con objetivos.</p>
        ))}
      {kind === 'meeting' && (
        <>
          <div className="form-grid">
            {(['from', 'to'] as const).map((k) => (
              <Field key={k} label={k === 'from' ? 'Desde (hora local)' : 'Hasta (hora local)'}>
                <input
                  type="datetime-local"
                  value={new Date(
                    new Date(data[k]).getTime() - new Date(data[k]).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  required
                  onChange={(e) => {
                    if (e.target.value) change(k, new Date(e.target.value).toISOString());
                  }}
                />
              </Field>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              const report = weeklyReport(snapshot.records, data.from, data.to);
              setData((d) => ({ ...d, ...report }));
              setMessage('Borrador regenerado con el periodo seleccionado.');
            }}
          >
            Regenerar con este periodo
          </Button>
          {input('body', true)}
          {input('agreements', true)}
          <section className="agreement-items" aria-label="Acuerdos con seguimiento">
            <h3>Acuerdos con seguimiento</h3>
            <p className="muted">
              Añade aquí solo los acuerdos que quieras revisar por separado. El texto anterior se
              conserva.
            </p>
            {agreementItems.map((agreement, index) => (
              <div className="agreement-item" key={agreement.id ?? `new-${index}`}>
                <Field label={`Acuerdo ${index + 1}`}>
                  <AutoTextarea
                    value={agreement.text}
                    maxLength={16000}
                    required
                    onChange={(event) => changeAgreement(index, { text: event.target.value })}
                  />
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={agreement.requiresFollowUp}
                    onChange={(event) =>
                      changeAgreement(index, {
                        requiresFollowUp: event.target.checked,
                        followUpTaskId: event.target.checked ? agreement.followUpTaskId : undefined,
                      })
                    }
                  />
                  Requiere seguimiento
                </label>
                {agreement.requiresFollowUp && (
                  <Field label={`Tarea vinculada al acuerdo ${index + 1}`}>
                    <select
                      value={agreement.followUpTaskId ?? ''}
                      onChange={(event) =>
                        changeAgreement(index, { followUpTaskId: event.target.value || undefined })
                      }
                    >
                      <option value="">Sin tarea vinculada</option>
                      {snapshot.records
                        .filter(
                          (item): item is Task =>
                            item.kind === 'task' &&
                            item.project === data.project &&
                            !item.recurrence?.canceledAt,
                        )
                        .map((task) => (
                          <option value={task.id} key={task.id}>
                            {task.title}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <div className="row">
                  {record?.kind === 'meeting' &&
                    agreement.id &&
                    agreement.requiresFollowUp &&
                    !agreement.followUpTaskId &&
                    JSON.stringify(agreementItems) ===
                      JSON.stringify(record.agreementItems ?? []) && (
                      <Button
                        variant="secondary"
                        onClick={() => onCreateFollowUp?.(record, agreement as AgreementItem)}
                      >
                        Crear tarea desde acuerdo
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      change(
                        'agreementItems',
                        agreementItems.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Quitar acuerdo
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                change('agreementItems', [...agreementItems, { text: '', requiresFollowUp: true }])
              }
            >
              Añadir acuerdo
            </Button>
          </section>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!data.closedAt}
              onChange={(e) =>
                change('closedAt', e.target.checked ? new Date().toISOString() : undefined)
              }
            />
            Cerrar reunión y usar este periodo como punto de partida
          </label>
        </>
      )}
      {['task', 'incident', 'idea', 'decision', 'meeting'].includes(kind) && (
        <Attachments
          attachments={(data.attachments as Attachment[] | undefined) ?? []}
          onChange={(attachments) => change('attachments', attachments)}
        />
      )}
      {record?.kind === 'task' && (
        <TaskHistory
          task={record}
          snapshot={snapshot}
          hasUnsavedChanges={
            JSON.stringify(data) !== JSON.stringify({ ...blank(kind), ...record, ...initial })
          }
          onRestored={onSaved}
        />
      )}
      {record && record.kind !== 'task' && (
        <details className="history">
          <summary>
            <HistoryIcon size={15} /> Historial de versiones
          </summary>
          {snapshot.history
            .filter((h) => h.recordId === record.id)
            .slice(0, 12)
            .map((h) => (
              <div key={h.id} className="history-item">
                <span>
                  v{h.after.version} · {h.actor}
                  <small>{new Date(h.at).toLocaleString('es-ES')}</small>
                </span>
                {h.before && h.after.version === record.version && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api('undo', { id: h.id });
                        onSaved();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Deshacer
                  </Button>
                )}
              </div>
            ))}
        </details>
      )}
      {message && <Notice>{message}</Notice>}
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="form-footer">
        {record && onDelete ? (
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            <Trash2 size={16} />{' '}
            {record.kind === 'task' && record.recurrence
              ? 'Cancelar aparición'
              : `Borrar ${deleteLabels[record.kind]}`}
          </Button>
        ) : (
          <span className="muted">Solo en tu bitácora local</span>
        )}
        <Button type="submit" disabled={busy}>
          <Save size={16} />
          {busy ? 'Guardando…' : record ? 'Guardar cambios' : 'Crear registro'}
        </Button>
      </div>
    </form>
  );
}
