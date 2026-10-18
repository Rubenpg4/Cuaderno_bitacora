import { AlertCircle, ChevronRight, FileText, Lightbulb, NotebookPen } from 'lucide-react';
import type { Decision, Entry, Idea, Incident, RecordItem } from '../../shared/model';
import { Badge, Empty } from '../ui';
import { MentionText } from '../EntryMentions';
import CopyRecordId from '../CopyRecordId';

type DiaryMode = 'entries' | 'incidents' | 'decisions' | 'ideas';

interface DiaryViewProps {
  records: RecordItem[];
  allRecords: RecordItem[];
  mode: DiaryMode;
  setMode: (mode: DiaryMode) => void;
  projectName: (id: string, subprojectId?: string) => string;
  openRecord: (record: RecordItem) => void;
}

export default function DiaryView({
  records,
  allRecords,
  mode,
  setMode,
  projectName,
  openRecord,
}: DiaryViewProps) {
  const entries = records
    .filter((record): record is Entry | Incident | Decision | Idea =>
      mode === 'entries'
        ? record.kind === 'entry'
        : mode === 'incidents'
          ? record.kind === 'incident'
          : mode === 'decisions'
            ? record.kind === 'decision'
            : record.kind === 'idea',
    )
    .sort((first, second) => second.date.localeCompare(first.date));

  return (
    <>
      <div className="tabbar">
        <button className={mode === 'entries' ? 'active' : ''} onClick={() => setMode('entries')}>
          <NotebookPen size={16} /> Entradas
        </button>
        <button
          className={mode === 'incidents' ? 'active' : ''}
          onClick={() => setMode('incidents')}
        >
          <AlertCircle size={16} /> Incidencias
        </button>
        <button
          className={mode === 'decisions' ? 'active' : ''}
          onClick={() => setMode('decisions')}
        >
          <FileText size={16} /> Decisiones de arquitectura
        </button>
        <button className={mode === 'ideas' ? 'active' : ''} onClick={() => setMode('ideas')}>
          <Lightbulb size={16} /> Ideas
        </button>
      </div>
      <div className="timeline">
        {entries.map((record) => (
          <article className="timeline-item" key={record.id}>
            <div className="timeline-date">
              {new Date(record.date + 'T12:00:00').toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'short',
              })}
              <span />
            </div>
            <div className="copyable-card">
              <button className="journal-card" onClick={() => openRecord(record)}>
                <div className="row spread">
                  <Badge tone="blue">{projectName(record.project, record.subprojectId)}</Badge>
                  <ChevronRight size={16} />
                </div>
                <h2>{record.title}</h2>
                <p>
                  {record.kind === 'entry' ? (
                    <MentionText value={record.activity} records={allRecords} onOpen={openRecord} />
                  ) : record.kind === 'incident' ? (
                    record.description
                  ) : record.kind === 'decision' ? (
                    record.problem
                  ) : (
                    record.description
                  )}
                </p>
                {record.kind === 'entry' &&
                  (record.taskIds.length > 0 || !!record.linkedIds?.length) && (
                    <div className="journal-links">
                      <strong>Vínculos</strong>
                      {[...record.taskIds, ...(record.linkedIds || [])].map((id) => {
                        const linked = allRecords.find((item) => item.id === id);
                        return linked &&
                          ['task', 'incident', 'decision', 'idea'].includes(linked.kind) ? (
                          <MentionText
                            key={id}
                            value={`@[${linked.kind}:${id}]`}
                            records={allRecords}
                            onOpen={openRecord}
                          />
                        ) : null;
                      })}
                    </div>
                  )}
                {record.kind === 'incident' && (
                  <div className="decision-preview">
                    <strong>
                      {record.resolvedDate
                        ? `Resuelta el ${record.resolvedDate}`
                        : 'Pendiente de resolver'}
                    </strong>
                    {record.solution && <p>{record.solution}</p>}
                  </div>
                )}
                {record.kind === 'entry' && (
                  <div className="journal-meta">
                    <span>{record.contribution}</span>
                    {record.evidence && (
                      <span>
                        <FileText size={13} /> Con evidencia
                      </span>
                    )}
                    {record.blocker && <span className="text-warning">Bloqueo registrado</span>}
                  </div>
                )}
                {record.kind === 'decision' && (
                  <div className="decision-preview">
                    <strong>Decisión</strong>
                    <p>{record.decision || 'Pendiente de decidir'}</p>
                  </div>
                )}
                {record.kind === 'idea' && (
                  <div className="decision-preview">
                    <strong>Idea</strong>
                    <p>{record.description || 'Sin descripción'}</p>
                  </div>
                )}
              </button>
              {record.kind !== 'entry' && <CopyRecordId id={record.id} title={record.title} />}
            </div>
          </article>
        ))}
      </div>
      {entries.length === 0 && (
        <Empty
          title={
            mode === 'entries'
              ? 'Tu recorrido empieza aquí.'
              : mode === 'incidents'
                ? 'Registra las incidencias y sus soluciones.'
                : mode === 'decisions'
                  ? 'Conserva el porqué de tus decisiones.'
                  : 'Guarda las ideas para desarrollarlas después.'
          }
        >
          Registra avances a grandes rasgos y vincula las evidencias que los respaldan.
        </Empty>
      )}
    </>
  );
}
