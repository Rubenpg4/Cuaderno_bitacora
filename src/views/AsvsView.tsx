import { useEffect, useRef, useState } from 'react';
import { Check, History, ShieldCheck } from 'lucide-react';
import { asvsCatalog } from '../../shared/asvsCatalog';
import { asvsHelpLinks } from '../../shared/asvsHelp';
import { asvsDisplayRequirements, asvsTranslationProvider } from '../../shared/asvsCatalogEs';
import {
  ASVS_STATES,
  type AsvsData,
  type AsvsHistory,
  type AsvsOverview,
} from '../../shared/asvsTracking';
import type { RecordItem } from '../../shared/model';
import { api } from '../api';
import { Button, Field, Notice } from '../ui';
import AsvsReview from './AsvsReview';
import AsvsCoverage from './AsvsCoverage';
import AsvsRevalidation from './AsvsRevalidation';
import AsvsCatalogUpdate from './AsvsCatalogUpdate';
import AsvsReport from './AsvsReport';

type HistoryPage = { items: AsvsHistory[]; nextOffset: number | null };
const originals = new Map(asvsCatalog.requirements.map((r) => [r.reqId, r]));
export default function AsvsView({
  projectId,
  records,
  openRecord,
  data,
  initialReference = '',
  onChanged,
}: {
  projectId: string;
  records: RecordItem[];
  openRecord: (record: RecordItem) => void;
  data?: AsvsData;
  initialReference?: string;
  onChanged: () => void;
}) {
  const [overview, setOverview] = useState<AsvsOverview>();
  const [targetLevel, setTargetLevel] = useState('');
  const [filterLevel, setFilterLevel] = useState('target');
  const [query, setQuery] = useState(initialReference);
  const [stateFilter, setStateFilter] = useState('all');
  const [applicability, setApplicability] = useState('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState('');
  const [historyTarget, setHistoryTarget] = useState('');
  const [history, setHistory] = useState<HistoryPage>();
  const [contextReason, setContextReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const savedRevision = useRef(0);
  function saved(result: AsvsOverview) {
    savedRevision.current++;
    setOverview(result);
    setTargetLevel(String(result.config?.level ?? ''));
    onChanged();
  }
  function openRequirement(reference: string) {
    setQuery(reference);
    setFilterLevel('target');
    setStateFilter('all');
    setApplicability('all');
    document.getElementById('asvs-requirements')?.scrollIntoView({ behavior: 'smooth' });
  }

  function closeReview() {
    setEditing('');
    reviewTrigger.current?.focus();
  }

  useEffect(() => {
    let disposed = false;
    const revision = savedRevision.current;
    api<AsvsOverview>('asvs-list', { projectId })
      .then((result) => {
        if (!disposed && revision === savedRevision.current) {
          setOverview(result);
          if (!initialized.current) {
            setTargetLevel(String(result.config?.level ?? ''));
            initialized.current = true;
          }
        }
      })
      .catch((err) => {
        if (!disposed) setError((err as Error).message);
      });
    return () => {
      disposed = true;
    };
  }, [projectId, records]);

  async function configure() {
    setBusy(true);
    setError('');
    try {
      const result = await api<AsvsOverview>('asvs-configure', {
        projectId,
        expectedConfigVersion: overview?.config?.version ?? 0,
        catalogVersion: asvsCatalog.version,
        level: targetLevel ? Number(targetLevel) : null,
        ...(contextReason.trim() ? { contextReason } : {}),
      });
      saved(result);
      setContextReason('');
      setEditing('');
      setMessage('Configuración ASVS guardada.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(targetId: string, offset = 0) {
    setError('');
    try {
      const page = await api<HistoryPage>('asvs-history', { projectId, targetId, offset });
      setHistoryTarget(targetId);
      setHistory((previous) =>
        offset && previous ? { ...page, items: [...previous.items, ...page.items] } : page,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function toggle(id: string) {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!overview) return <Notice>{error || 'Cargando verificación ASVS…'}</Notice>;
  const config = overview.config;
  if (config && config.catalogVersion !== asvsCatalog.version)
    return (
      <section className="asvs-view">
        <Notice error>
          Este cuaderno conserva evaluaciones de ASVS {config.catalogVersion}. Ese catálogo no está
          disponible en esta versión. Usa una versión compatible para consultarlas y revisarlas; sus
          datos siguen conservados.
        </Notice>
        <AsvsCatalogUpdate config={config} onSaved={saved} />
      </section>
    );
  const items = new Map(
    overview.items
      .filter((item) => item.assessment.catalogVersion === asvsCatalog.version)
      .map((item) => [item.assessment.reqId, item]),
  );
  const visibleLevel = filterLevel === 'target' ? (config?.level ?? 3) : Number(filterLevel);
  const normalized = query.trim().toLowerCase();
  const filtered = asvsDisplayRequirements.filter((r) => {
    const item = items.get(r.reqId);
    const state = item?.assessment.state ?? 'Pendiente';
    return (
      r.minLevel <= visibleLevel &&
      (!normalized ||
        `${r.reqId} ${r.canonicalRef} ${r.chapterName} ${r.sectionName} ${r.description} ${originals.get(r.reqId)?.description}`
          .toLowerCase()
          .includes(normalized)) &&
      (stateFilter === 'all' ||
        (stateFilter === 'stale'
          ? item?.status.stale
          : stateFilter === 'partial'
            ? item?.status.partial
            : state === stateFilter)) &&
      (applicability === 'all' ||
        (item?.assessment.applicability ?? 'Por determinar') === applicability)
    );
  });
  const chapters = [...new Set(filtered.map((r) => r.chapterId))];
  const reveal = !!normalized;
  const summary = overview.summary;
  const fulfilled = (ids: string[]) => ids.filter((id) => items.get(id)?.status.tick).length;

  return (
    <section className="asvs-view" aria-label="Verificación ASVS">
      <div className="asvs-config">
        <div>
          <h2>
            <ShieldCheck size={22} aria-hidden="true" /> Alcance de verificación
          </h2>
          <p>
            ASVS {asvsCatalog.version}.{' '}
            {asvsTranslationProvider
              ? 'Traducción al español con DeepL; original oficial en inglés disponible en cada requisito.'
              : 'Texto oficial en inglés; traducción al español pendiente de generar con DeepL.'}{' '}
            Revisión y evidencias locales.
          </p>
        </div>
        <div className="asvs-fields">
          <Field label="Nivel objetivo ASVS">
            <select value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)}>
              <option value="">Desactivado</option>
              <option value="1">L1 — 70 requisitos</option>
              <option value="2">L2 — 253 requisitos</option>
              <option value="3">L3 — 345 requisitos</option>
            </select>
          </Field>
          <Field
            label="Cambio de contexto"
            hint="Rellena solo si ha cambiado el sistema evaluado. Invalida las revisiones anteriores."
          >
            <input
              maxLength={16000}
              value={contextReason}
              onChange={(e) => setContextReason(e.target.value)}
              placeholder="Motivo de una nueva revisión de contexto"
            />
          </Field>
        </div>
        <Button disabled={busy} onClick={() => void configure()}>
          Guardar configuración ASVS
        </Button>
        <p>
          Al desactivar se conserva el historial. Los criterios ya comprometidos en tareas abiertas
          y las buenas prácticas siguen vigentes. Las evaluaciones de proyecto se revisan por
          separado del cierre de tareas.
        </p>
      </div>
      {config?.level ? (
        <div className="asvs-summary" role="status">
          <strong>
            {summary.fulfilled} de {summary.denominator} requisitos aplicables verificados
          </strong>
          <span>
            {summary.excluded} excluidos por decisión humana · {summary.undetermined} por determinar
            · {summary.stale} desactualizados · {summary.partial} parciales
          </span>
          {!summary.denominator && <span>Sin requisitos aplicables evaluables.</span>}
        </div>
      ) : (
        <Notice>
          ASVS está desactivado. Puedes explorar el catálogo; las evaluaciones conservadas no
          cuentan como cumplimiento activo.
        </Notice>
      )}
      {config?.level && (
        <AsvsCoverage
          overview={overview}
          records={records}
          openRecord={openRecord}
          openRequirement={openRequirement}
        />
      )}
      {config && <AsvsRevalidation data={data} overview={overview} onSaved={saved} />}
      {config && (
        <AsvsReport
          key={`${projectId}:${config.version}`}
          overview={overview}
          records={records}
          data={data}
        />
      )}
      {overview.items.some((i) => i.assessment.catalogVersion !== asvsCatalog.version) && (
        <details className="asvs-config">
          <summary>Evaluaciones de catálogos anteriores</summary>
          <p>Se conservan los estados y evidencias históricos. No cuentan en el catálogo activo.</p>
          {overview.items
            .filter((i) => i.assessment.catalogVersion !== asvsCatalog.version)
            .map(({ assessment }) => (
              <details key={assessment.id}>
                <summary>
                  ASVS {assessment.catalogVersion} · {assessment.reqId} · {assessment.state}
                </summary>
                <p>
                  {assessment.note} · {assessment.method} · {assessment.responsible}
                </p>
                {assessment.evidence.map((e) => (
                  <p key={e.id}>
                    {e.reference} · revisión {e.revision}
                  </p>
                ))}
                {assessment.decision && (
                  <p>
                    Decisión humana histórica: {assessment.decision.reason} ·{' '}
                    {assessment.decision.reference}
                  </p>
                )}
              </details>
            ))}
          {data?.history
            .filter((h) => h.kind === 'catalog')
            .map(
              (h) =>
                h.kind === 'catalog' && (
                  <details key={h.id}>
                    <summary>
                      Actualización {h.before.catalogVersion} → {h.after.catalogVersion}
                    </summary>
                    <p>
                      {h.diff.added.length} añadidos · {h.diff.removed.length} retirados ·{' '}
                      {h.diff.changed.length} cambiados
                    </p>
                    <ul>
                      {h.mappings.map((m) => (
                        <li key={m.from}>
                          {m.from} → {m.to}: {m.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ),
            )}
        </details>
      )}
      <div className="asvs-filters" id="asvs-requirements">
        <Field label="Buscar requisito ASVS">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Referencia o texto del requisito"
          />
        </Field>
        <Field label="Nivel de consulta">
          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value="target">Nivel objetivo (todos si desactivado)</option>
            <option value="1">Hasta L1</option>
            <option value="2">Hasta L2</option>
            <option value="3">Hasta L3</option>
          </select>
        </Field>
        <Field label="Filtrar estado ASVS">
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            {ASVS_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="stale">Evidencia desactualizada</option>
            <option value="partial">Cobertura parcial</option>
          </select>
        </Field>
        <Field label="Filtrar aplicabilidad ASVS">
          <select value={applicability} onChange={(e) => setApplicability(e.target.value)}>
            <option value="all">Toda aplicabilidad</option>
            <option>Por determinar</option>
            <option>Aplicable</option>
            <option>No aplicable</option>
          </select>
        </Field>
      </div>
      <p className="asvs-results" role="status">
        {filtered.length} requisitos encontrados. El nivel de consulta y los filtros no cambian el
        nivel objetivo ni las evaluaciones.
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <p role="status">{message}</p>}
      {!filtered.length && (
        <Notice>
          No hay requisitos con estos filtros. Cambia la búsqueda, el estado o la aplicabilidad.
        </Notice>
      )}
      <div className="asvs-tree" key={`${filterLevel}:${stateFilter}:${applicability}:${reveal}`}>
        {chapters.map((chapterId) => {
          const chapter = filtered.filter((r) => r.chapterId === chapterId);
          return (
            <details key={chapterId} open={reveal || open.has(chapterId)}>
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  toggle(chapterId);
                }}
              >
                <strong>
                  {chapterId} · {chapter[0].chapterName}
                </strong>
                <span>
                  {fulfilled(chapter.map((r) => r.reqId))}/{chapter.length} verificados
                </span>
              </summary>
              {[...new Set(chapter.map((r) => r.sectionId))].map((sectionId) => {
                const section = chapter.filter((r) => r.sectionId === sectionId);
                return (
                  <details key={sectionId} open={reveal || open.has(sectionId)}>
                    <summary
                      onClick={(event) => {
                        event.preventDefault();
                        toggle(sectionId);
                      }}
                    >
                      <strong>
                        {sectionId} · {section[0].sectionName}
                      </strong>
                      <span>
                        {fulfilled(section.map((r) => r.reqId))}/{section.length} verificados
                      </span>
                    </summary>
                    {section.map((requirement) => {
                      const item = items.get(requirement.reqId);
                      const assessment = item?.assessment;
                      const help = asvsHelpLinks(requirement);
                      return (
                        <article
                          className="asvs-requirement"
                          key={requirement.reqId}
                          aria-label={requirement.canonicalRef}
                        >
                          <div className="asvs-requirement-heading">
                            <h3>{requirement.canonicalRef}</h3>
                            <span>Nivel mínimo L{requirement.minLevel}</span>
                            <span
                              className="asvs-state"
                              data-state={
                                item?.status.tick
                                  ? 'fulfilled'
                                  : assessment?.state === 'No aplicable'
                                    ? 'excluded'
                                    : 'pending'
                              }
                            >
                              {item?.status.tick && <Check size={18} aria-hidden="true" />}
                              {assessment?.state ?? 'Pendiente'}
                              {item?.status.tick ? ' vigente' : ''}
                            </span>
                          </div>
                          <p
                            className="asvs-description"
                            lang={asvsTranslationProvider ? 'es' : 'en'}
                          >
                            {requirement.description}
                          </p>
                          {asvsTranslationProvider && (
                            <details className="asvs-original">
                              <summary>Ver original oficial en inglés</summary>
                              <p className="asvs-description" lang="en">
                                {originals.get(requirement.reqId)?.description}
                              </p>
                            </details>
                          )}
                          <div className="asvs-actions">
                            <Button
                              variant="secondary"
                              onClick={() => {
                                void navigator.clipboard
                                  .writeText(requirement.canonicalRef)
                                  .then(() =>
                                    setMessage(`Referencia copiada: ${requirement.canonicalRef}`),
                                  )
                                  .catch(() =>
                                    setError(
                                      'No se pudo copiar. Selecciona la referencia para copiarla.',
                                    ),
                                  );
                              }}
                            >
                              Copiar referencia {requirement.canonicalRef}
                            </Button>
                            {help && (
                              <>
                                <a href={help.source} target="_blank" rel="noopener noreferrer">
                                  Fuente oficial ASVS {requirement.canonicalRef}
                                </a>
                                <a href={help.guide} target="_blank" rel="noopener noreferrer">
                                  Guía OWASP por ASVS
                                </a>
                              </>
                            )}
                          </div>
                          <p>
                            Orientación: contrasta el original inglés de {requirement.canonicalRef}{' '}
                            con el alcance, el método y la evidencia antes de evaluar. La traducción
                            española y las guías OWASP son ayudas sujetas a revisión humana; no
                            modifican el requisito ni acreditan cumplimiento.
                          </p>
                          {records
                            .filter(
                              (r) =>
                                r.kind === 'task' &&
                                r.asvsLinks?.some(
                                  (link) =>
                                    link.reqId === requirement.reqId &&
                                    link.catalogVersion === requirement.catalogVersion,
                                ),
                            )
                            .map((task) => (
                              <Button
                                key={task.id}
                                variant="secondary"
                                onClick={() => openRecord(task)}
                              >
                                Tarea ASVS: {task.title}
                                {task.kind === 'task' ? ` · ${task.state}` : ''}
                              </Button>
                            ))}
                          <p>Aplicabilidad: {assessment?.applicability ?? 'Por determinar'}</p>
                          {assessment?.reviewedAt && (
                            <p>
                              Evaluado en L{assessment.evaluatedLevel} ·{' '}
                              {new Date(assessment.reviewedAt).toLocaleString('es-ES')} ·{' '}
                              {assessment.responsible} · Método: {assessment.method}
                            </p>
                          )}
                          {item?.status.stale && (
                            <p className="asvs-stale">
                              Evidencia desactualizada: {item.status.reasons.join(', ')}. Siguiente
                              paso: revisar las fuentes y el alcance y guardar una nueva evaluación.
                            </p>
                          )}
                          {item?.status.partial && (
                            <p className="asvs-partial">
                              Cobertura parcial: {assessment?.scopeDetail}. Alcance pendiente:{' '}
                              {assessment?.pendingScope}. Esta revisión no valida todo el proyecto.
                            </p>
                          )}
                          {assessment?.note && <p>{assessment.note}</p>}
                          {assessment?.decision && (
                            <p>
                              Excluido del denominador por decisión humana:{' '}
                              {assessment.decision.reason}. Referencia:{' '}
                              {assessment.decision.reference}. Responsable:{' '}
                              {assessment.decision.responsible}.
                            </p>
                          )}
                          {!!assessment?.evidence.length && (
                            <ul>
                              {assessment.evidence.map((e) => {
                                const source = records.find((r) => r.id === e.recordId);
                                return (
                                  <li key={e.id}>
                                    {e.reference} · revisión {e.revision}
                                    {e.recordId &&
                                      (source ? (
                                        <Button
                                          variant="secondary"
                                          onClick={() => openRecord(source)}
                                        >
                                          Ver fuente: {source.title}
                                        </Button>
                                      ) : (
                                        ' · Fuente eliminada'
                                      ))}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {assessment && (
                            <div className="row">
                              <Button
                                variant="secondary"
                                disabled={!item?.status.active}
                                onClick={() => {
                                  reviewTrigger.current = document.activeElement as HTMLElement;
                                  setEditing(assessment.id);
                                  setHistoryTarget('');
                                }}
                              >
                                Revisar {requirement.reqId}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => void showHistory(assessment.id)}
                              >
                                <History size={15} aria-hidden="true" />
                                Historial de {requirement.reqId}
                              </Button>
                            </div>
                          )}
                          {assessment && config && editing === assessment.id && (
                            <AsvsReview
                              key={`${assessment.id}:${assessment.version}`}
                              assessment={assessment}
                              config={config}
                              records={records}
                              onCancel={closeReview}
                              onSaved={(result) => {
                                saved(result);
                                closeReview();
                                setHistoryTarget('');
                                setMessage('Revisión ASVS guardada.');
                              }}
                            />
                          )}
                          {historyTarget === assessment?.id && history && (
                            <div
                              className="asvs-history"
                              aria-label={`Historial de ${requirement.reqId}`}
                            >
                              <h4>Historial de evaluación</h4>
                              <ol>
                                {history.items.map((entry) => (
                                  <li key={entry.id}>
                                    <p>
                                      {new Date(entry.at).toLocaleString('es-ES')} · {entry.actor} ·
                                      v{entry.after.version}
                                    </p>
                                    {entry.kind === 'assessment' && (
                                      <>
                                        <p>
                                          {entry.before?.state ?? 'Sin evaluación'} →{' '}
                                          {entry.after.state} ·{' '}
                                          {entry.after.scope === 'project'
                                            ? 'Proyecto'
                                            : 'Cobertura parcial'}{' '}
                                          · L{entry.after.evaluatedLevel}
                                        </p>
                                        <p>{entry.after.note}</p>
                                        <p>
                                          {entry.after.method} · {entry.after.responsible}
                                        </p>
                                        {entry.after.evidence.map((e) => (
                                          <p key={e.id}>
                                            {e.reference} · revisión {e.revision}
                                          </p>
                                        ))}
                                        {entry.after.decision && (
                                          <p>
                                            Decisión: {entry.after.decision.reason} ·{' '}
                                            {entry.after.decision.reference}
                                          </p>
                                        )}
                                      </>
                                    )}
                                  </li>
                                ))}
                              </ol>
                              {history.nextOffset !== null && (
                                <Button
                                  variant="secondary"
                                  onClick={() =>
                                    void showHistory(assessment!.id, history.nextOffset!)
                                  }
                                >
                                  Más historial
                                </Button>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </details>
                );
              })}
            </details>
          );
        })}
      </div>
      <p className="asvs-attribution">
        {asvsCatalog.attribution} ·{' '}
        <a href={asvsCatalog.licenseUrl} target="_blank" rel="noreferrer">
          {asvsCatalog.license}
        </a>
        . Las verificaciones registradas no equivalen a una certificación de OWASP.
      </p>
    </section>
  );
}
