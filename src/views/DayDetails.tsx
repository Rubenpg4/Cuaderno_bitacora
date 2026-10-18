import type { ReactNode } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckSquare2,
  ChevronDown,
  Clock3,
  FileText,
  Lightbulb,
  Users,
} from 'lucide-react';
import {
  isIncidentResolved,
  madridDate,
  taskCompletionDay,
  isTaskCompletedOnDay,
  type Decision,
  type Entry,
  type Idea,
  type Incident,
  type Meeting,
  type RecordItem,
  type Task,
} from '../../shared/model';
import { MentionText, mentionSummaryText } from '../EntryMentions';
import CopyRecordId from '../CopyRecordId';
import { Badge } from '../ui';
import { isOverdueTask } from '../taskFilters';
import { Attachments } from '../Attachments';

interface DayDetailsProps {
  day: string;
  records: RecordItem[];
  allRecords: RecordItem[];
  projectName: (id: string, subprojectId?: string) => string;
  openRecord: (record: RecordItem) => void;
  today?: string;
}

type DayRecord = Task | Incident | Entry | Decision | Idea | Meeting;

function DayField({ label, value }: { label: string; value?: ReactNode }) {
  if (!value) return null;
  return (
    <div className="day-detail-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function recordFields(
  record: DayRecord,
  day: string,
  records: RecordItem[],
  openRecord: (record: RecordItem) => void,
) {
  const linkedText = (value: string) =>
    value ? <MentionText value={value} records={records} onOpen={openRecord} /> : undefined;
  switch (record.kind) {
    case 'task':
      return (
        <>
          <DayField label="Descripción" value={record.description} />
          <DayField label="Solución" value={record.solution} />
          <DayField label="Siguiente paso" value={record.nextStep} />
          <DayField label="Bloqueo" value={record.blocked} />
          <DayField label="Tipo" value={record.type} />
          <DayField label="Fase" value={record.phase} />
          <DayField label="Etiquetas" value={record.tags.join(', ')} />
          <DayField
            label="Depende de"
            value={record.dependencyIds
              .map((id) => records.find((item) => item.id === id)?.title || id)
              .join(', ')}
          />
          {record.checks.length > 0 && (
            <DayField
              label="Criterios de calidad"
              value={record.checks.map((check) => `${check.title}: ${check.state}`).join('\n')}
            />
          )}
          <DayField label="Fecha de finalización prevista" value={record.due} />
          {record.state === 'Completada' && (
            <DayField label="Fecha real de finalización" value={taskCompletionDay(record)} />
          )}
        </>
      );
    case 'incident':
      return (
        <>
          <DayField label="Descripción" value={record.description} />
          <DayField label="Solución" value={record.solution} />
          {record.date !== day && <DayField label="Apareció" value={record.date} />}
          {record.resolvedDate && record.resolvedDate !== day && (
            <DayField label="Se resolvió" value={record.resolvedDate} />
          )}
        </>
      );
    case 'entry':
      return (
        <>
          <DayField label="Actividad" value={linkedText(record.activity)} />
          <DayField label="Resultado" value={linkedText(record.result)} />
          <DayField label="Aprendizaje" value={linkedText(record.learning)} />
          <DayField label="Siguiente paso" value={linkedText(record.nextStep)} />
          <DayField label="Bloqueo" value={linkedText(record.blocker)} />
          <DayField label="Competencia" value={record.competency} />
          <DayField label="Evidencia" value={record.evidence} />
          <DayField label="Texto original" value={linkedText(record.original)} />
          <DayField label="Contribución" value={record.contribution} />
          <DayField
            label="Tareas vinculadas"
            value={
              record.taskIds.length
                ? record.taskIds.map((id, index) => {
                    const task = records.find((item) => item.id === id);
                    return task?.kind === 'task' ? (
                      <span key={id}>
                        {index > 0 && ', '}
                        {linkedText(`@[task:${id}]`)}
                      </span>
                    ) : null;
                  })
                : undefined
            }
          />
          <DayField
            label="Otros registros vinculados"
            value={
              record.linkedIds?.length
                ? record.linkedIds.map((id, index) => {
                    const linked = records.find((item) => item.id === id);
                    return linked && ['incident', 'decision', 'idea'].includes(linked.kind) ? (
                      <span key={id}>
                        {index > 0 && ', '}
                        {linkedText(`@[${linked.kind}:${id}]`)}
                      </span>
                    ) : null;
                  })
                : undefined
            }
          />
        </>
      );
    case 'decision':
      return (
        <>
          <DayField label="Problema" value={record.problem} />
          <DayField label="Alternativas" value={record.alternatives} />
          <DayField label="Decisión" value={record.decision} />
          <DayField label="Motivo" value={record.reason} />
          <DayField label="Consecuencias" value={record.consequences} />
          <DayField label="Evidencia" value={record.evidence} />
        </>
      );
    case 'idea':
      return <DayField label="Descripción" value={record.description} />;
    case 'meeting':
      return (
        <>
          <DayField label="Desde" value={record.from.replace('T', ' ')} />
          <DayField label="Hasta" value={record.to.replace('T', ' ')} />
          <DayField label="Contenido" value={record.body} />
          <DayField label="Acuerdos" value={record.agreements} />
        </>
      );
  }
}

const sections = [
  { kind: 'task', label: 'Tareas', icon: CheckSquare2 },
  { kind: 'incident', label: 'Incidencias', icon: AlertCircle },
  { kind: 'entry', label: 'Diario', icon: FileText },
  { kind: 'decision', label: 'Decisiones', icon: BookOpen },
  { kind: 'idea', label: 'Ideas', icon: Lightbulb },
  { kind: 'meeting', label: 'Reuniones', icon: Users },
] as const;

function categoryPreview(kind: DayRecord['kind'], items: DayRecord[], today: string) {
  const titles = items
    .slice(0, 2)
    .map((item) => item.title)
    .join(', ');
  const more = items.length > 2 ? ` y ${items.length - 2} más` : '';
  const titlePreview = `${titles}${more}`;
  if (kind === 'task') {
    const tasks = items.filter((item): item is Task => item.kind === 'task');
    const completed = tasks.filter((item) => item.state === 'Completada').length;
    const open = tasks.length - completed;
    const overdue = tasks.filter((item) => isOverdueTask(item, today)).length;
    const overduePreview = overdue > 0 ? ` · ${overdue} con retraso` : '';
    return `${open} ${open === 1 ? 'abierta' : 'abiertas'} · ${completed} ${completed === 1 ? 'completada' : 'completadas'}${overduePreview} · ${titlePreview}`;
  }
  if (kind === 'incident') {
    const incidents = items.filter((item): item is Incident => item.kind === 'incident');
    const resolved = incidents.filter((item) => isIncidentResolved(item)).length;
    const pending = incidents.length - resolved;
    return `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'} · ${resolved} ${resolved === 1 ? 'solucionada' : 'solucionadas'} · ${titlePreview}`;
  }
  return titlePreview;
}

function renderSectionBadges(kind: DayRecord['kind'], items: DayRecord[], today: string) {
  if (kind === 'task') {
    const tasks = items.filter((item): item is Task => item.kind === 'task');
    const overdue = tasks.filter((item) => isOverdueTask(item, today)).length;
    const todo = tasks.filter((item) => item.state === 'Por hacer').length;
    const inProgress = tasks.filter((item) => item.state === 'En curso').length;
    const inReview = tasks.filter((item) => item.state === 'En revisión').length;
    const completed = tasks.filter((item) => item.state === 'Completada').length;

    return (
      <span className="day-section-badges">
        {overdue > 0 && <Badge tone="red">{overdue} con retraso</Badge>}
        {todo > 0 && <Badge>{todo} por hacer</Badge>}
        {inProgress > 0 && <Badge tone="blue">{inProgress} en curso</Badge>}
        {inReview > 0 && <Badge tone="amber">{inReview} en revisión</Badge>}
        {completed > 0 && (
          <Badge tone="green">
            {completed} {completed === 1 ? 'completada' : 'completadas'}
          </Badge>
        )}
      </span>
    );
  }
  if (kind === 'incident') {
    const incidents = items.filter((item): item is Incident => item.kind === 'incident');
    const unresolved = incidents.filter((item) => !isIncidentResolved(item)).length;
    const resolved = incidents.filter((item) => isIncidentResolved(item)).length;

    return (
      <span className="day-section-badges">
        {unresolved > 0 && <Badge tone="red">{unresolved} sin resolver</Badge>}
        {resolved > 0 && (
          <Badge tone="green">
            {resolved} {resolved === 1 ? 'resuelta' : 'resueltas'}
          </Badge>
        )}
      </span>
    );
  }
  return null;
}

function renderCardBadges(record: DayRecord, today: string) {
  if (record.kind === 'task') {
    const overdue = isOverdueTask(record, today);
    return (
      <span className="day-detail-badges">
        <Badge
          tone={
            record.state === 'Completada'
              ? 'green'
              : record.state === 'En curso'
                ? 'blue'
                : record.state === 'En revisión'
                  ? 'amber'
                  : ''
          }
        >
          {record.state}
        </Badge>
        {overdue && (
          <Badge tone="red">
            <Clock3 size={11} aria-hidden="true" /> Con retraso
          </Badge>
        )}
        {record.blocked && <Badge tone="amber">Bloqueada</Badge>}
      </span>
    );
  }
  if (record.kind === 'incident') {
    const resolved = isIncidentResolved(record);
    return (
      <span className="day-detail-badges">
        <Badge tone={resolved ? 'green' : 'red'}>{resolved ? 'Resuelta' : 'Sin resolver'}</Badge>
      </span>
    );
  }
  return null;
}

function recordPreview(record: DayRecord, day: string, records: RecordItem[], today: string) {
  switch (record.kind) {
    case 'task':
      return [
        record.due !== day && isTaskCompletedOnDay(record, day)
          ? `Completada este día (prevista para ${record.due})`
          : record.state,
        isOverdueTask(record, today) ? 'Con retraso' : '',
        `Prioridad ${record.priority.toLowerCase()}`,
        record.blocked ? 'Con bloqueo' : '',
        record.nextStep || record.description,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'incident':
      return [
        record.date === day ? 'Apareció este día' : 'Se resolvió este día',
        isIncidentResolved(record) ? 'Solucionada' : 'Pendiente',
        record.date === day
          ? record.description || record.solution
          : record.solution || record.description,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'entry':
      return mentionSummaryText(
        record.activity || record.result || 'Sin actividad descrita',
        records,
      );
    case 'decision':
      return record.decision || record.problem || 'Sin decisión descrita';
    case 'idea':
      return record.description || 'Sin descripción';
    case 'meeting':
      return [record.from.replace('T', ' '), record.agreements || record.body]
        .filter(Boolean)
        .join(' · ');
  }
}

export default function DayDetails({
  day,
  records,
  allRecords,
  projectName,
  openRecord,
  today,
}: DayDetailsProps) {
  const currentDay = today ?? madridDate();
  const date = new Date(`${day}T12:00:00`);
  const dayRecords = records.filter((record): record is DayRecord => {
    if (record.kind === 'task') return record.due === day || isTaskCompletedOnDay(record, day);
    if (record.kind === 'incident') return record.date === day || record.resolvedDate === day;
    if (record.kind === 'meeting')
      return record.from.slice(0, 10) <= day && record.to.slice(0, 10) >= day;
    if (record.kind === 'entry' || record.kind === 'decision' || record.kind === 'idea')
      return record.date === day;
    return false;
  });

  return (
    <div className="day-details">
      <header className="day-details-intro">
        <span className="day-details-number">{date.getDate()}</span>
        <div>
          <p className="day-details-weekday">
            {date.toLocaleDateString('es-ES', { weekday: 'long' })}
          </p>
          <p className="day-details-month">
            {date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
          </p>
          <p className="day-details-total">
            {dayRecords.length} {dayRecords.length === 1 ? 'registro' : 'registros'} en este día
          </p>
        </div>
      </header>
      {dayRecords.length === 0 && (
        <p className="day-details-empty">Todavía no hay registros para este día.</p>
      )}
      {sections.map(({ kind, label, icon: Icon }) => {
        const items = dayRecords.filter((record) => record.kind === kind);
        if (!items.length) return null;
        return (
          <details className={`day-details-section ${kind}`} key={kind}>
            <summary className="day-section-summary">
              <Icon size={18} aria-hidden="true" />
              <span className="day-section-text">
                <span className="day-section-heading">
                  <strong>{label}</strong>
                  <span className="day-section-count">{items.length}</span>
                  {renderSectionBadges(kind, items, currentDay)}
                </span>
                <span className="day-section-preview">
                  {categoryPreview(kind, items, currentDay)}
                </span>
              </span>
              <ChevronDown className="day-detail-chevron" size={17} aria-hidden="true" />
            </summary>
            <div className="day-details-list">
              {items.map((record) => {
                const cardClass = [
                  'day-detail-card',
                  record.kind === 'task' && isOverdueTask(record, currentDay) && 'is-overdue',
                  record.kind === 'task' && record.state === 'Completada' && 'is-completed',
                  record.kind === 'incident' && isIncidentResolved(record) && 'is-resolved',
                  record.kind === 'incident' && !isIncidentResolved(record) && 'is-unresolved',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <details className={cardClass} key={record.id}>
                    <summary className="day-detail-summary">
                      <span className="day-detail-summary-text">
                        <span className="day-detail-title-row">
                          <strong>{record.title}</strong>
                          {renderCardBadges(record, currentDay)}
                        </span>
                        <span className="day-detail-preview">
                          {projectName(record.project, record.subprojectId)} ·{' '}
                          {recordPreview(record, day, allRecords, currentDay)}
                        </span>
                      </span>
                      <ChevronDown className="day-detail-chevron" size={17} aria-hidden="true" />
                    </summary>
                    <div className="day-detail-body">
                      {['task', 'incident', 'idea', 'decision'].includes(record.kind) && (
                        <CopyRecordId id={record.id} title={record.title} />
                      )}
                      <dl className="day-detail-fields">
                        {recordFields(record, day, allRecords, openRecord)}
                      </dl>
                      {'attachments' in record && !!record.attachments?.length && (
                        <Attachments attachments={record.attachments} />
                      )}
                      <button className="day-detail-open" onClick={() => openRecord(record)}>
                        Abrir registro
                      </button>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
