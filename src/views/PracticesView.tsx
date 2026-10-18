import { useState } from 'react';
import { Pin, FileEdit, Info, Layers, ShieldAlert } from 'lucide-react';
import { CATEGORIES, type Practice, type RecordItem } from '../../shared/model';
import { Badge, Button, Notice } from '../ui';

type StatusFilter = 'all' | 'active' | 'draft' | 'retired';

interface PracticesViewProps {
  records: RecordItem[];
  category: string;
  setCategory: (category: string) => void;
  projectName: (id: string) => string;
  openRecord: (practice: Practice) => void;
  hasDraftNew?: boolean;
  onOpenNewDraft?: () => void;
}

export default function PracticesView({
  records,
  category,
  setCategory,
  projectName,
  openRecord,
  hasDraftNew,
  onOpenNewDraft,
}: PracticesViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const allPractices = records.filter((record): record is Practice => record.kind === 'practice');

  const counts = {
    all: allPractices.length,
    active: allPractices.filter(
      (p) => p.status === 'Recomendación personal' || p.status === 'Política de empresa confirmada',
    ).length,
    draft: allPractices.filter((p) => p.status === 'Borrador').length,
    retired: allPractices.filter((p) => p.status === 'Retirada').length,
  };

  const practices = allPractices.filter((practice) => {
    if (category && practice.category !== category) return false;
    if (statusFilter === 'active') {
      return (
        practice.status === 'Recomendación personal' ||
        practice.status === 'Política de empresa confirmada'
      );
    }
    if (statusFilter === 'draft') {
      return practice.status === 'Borrador';
    }
    if (statusFilter === 'retired') {
      return practice.status === 'Retirada';
    }
    return true;
  });

  return (
    <div className="practices-view-container">
      <Notice icon={<Info size={17} />}>
        Adapta estos ejemplos con tu empresa. Los borradores se mantienen aislados para su
        maduración y no se asocian a tareas hasta ser promovidos a recomendación o política oficial.
      </Notice>
      {hasDraftNew && onOpenNewDraft && (
        <Notice>
          <div className="row spread" style={{ width: '100%', alignItems: 'center' }}>
            <span>Tienes un borrador de nueva práctica pendiente de guardar en tu equipo.</span>
            <Button variant="secondary" onClick={onOpenNewDraft}>
              <FileEdit size={14} /> Continuar borrador
            </Button>
          </div>
        </Notice>
      )}
      <div className="practice-toolbar">
        <div className="practice-status-tabs" role="tablist" aria-label="Filtrar por estado">
          <button
            type="button"
            className={statusFilter === 'all' ? 'active' : ''}
            onClick={() => setStatusFilter('all')}
          >
            Todas <span className="tab-pill-count">{counts.all}</span>
          </button>
          <button
            type="button"
            className={statusFilter === 'active' ? 'active' : ''}
            onClick={() => setStatusFilter('active')}
          >
            Políticas vigentes <span className="tab-pill-count">{counts.active}</span>
          </button>
          <button
            type="button"
            className={statusFilter === 'draft' ? 'active' : ''}
            onClick={() => setStatusFilter('draft')}
          >
            Borradores <span className="tab-pill-count">{counts.draft}</span>
          </button>
          {counts.retired > 0 && (
            <button
              type="button"
              className={statusFilter === 'retired' ? 'active' : ''}
              onClick={() => setStatusFilter('retired')}
            >
              Retiradas <span className="tab-pill-count">{counts.retired}</span>
            </button>
          )}
        </div>
        <div className="category-tabs" role="tablist" aria-label="Filtrar por categoría">
          <button
            type="button"
            className={!category ? 'active' : ''}
            onClick={() => setCategory('')}
          >
            Todas las categorías
          </button>
          {CATEGORIES.map((item, index) => (
            <button
              key={item}
              type="button"
              className={category === item ? 'active' : ''}
              onClick={() => setCategory(item)}
            >
              <span className={`category-dot cat-${index}`} />
              {item}
            </button>
          ))}
        </div>
      </div>
      {practices.length === 0 ? (
        <div className="empty-practices-box">
          <ShieldAlert size={32} className="empty-practices-icon" />
          <h3>No hay criterios en este filtro</h3>
          <p className="muted">
            Prueba a seleccionar otro estado o categoría para ver los criterios disponibles.
          </p>
        </div>
      ) : (
        <div className="practice-list">
          {practices.map((practice) => (
            <button
              className={`practice-card ${practice.status === 'Borrador' ? 'is-draft' : ''}`}
              key={practice.id}
              onClick={() => openRecord(practice)}
            >
              <div className="row spread practice-card-header">
                <Badge>
                  <span
                    className={`category-dot cat-${Math.max(0, CATEGORIES.indexOf(practice.category as (typeof CATEGORIES)[number]))}`}
                  />
                  {practice.category}
                </Badge>
                {practice.pinned && <Pin size={15} className="practice-pin-icon" />}
              </div>
              <h2>{practice.title}</h2>
              <p>{practice.explanation}</p>
              <div className="practice-scope">
                <Layers size={13} className="practice-scope-icon" />
                <span>
                  {practice.project ? projectName(practice.project) : 'Todos los proyectos'} ·{' '}
                  {practice.phases.length ? practice.phases.join(', ') : 'Todas las fases'}
                </span>
              </div>
              <div className="row spread practice-card-footer">
                <Badge
                  tone={
                    practice.status === 'Política de empresa confirmada'
                      ? 'green'
                      : practice.status === 'Borrador'
                        ? 'amber'
                        : 'blue'
                  }
                >
                  {practice.status}
                </Badge>
                <div className="practice-card-version">
                  {practice.mandatory && (
                    <span className="practice-mandatory-pill">Obligatorio</span>
                  )}
                  <span>v{practice.version}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
