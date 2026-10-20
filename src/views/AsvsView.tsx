import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, History, Settings2, ShieldCheck } from 'lucide-react';
import { asvsCatalog } from '../../shared/asvsCatalog';
import { asvsHelpLinks } from '../../shared/asvsHelp';
import { asvsDisplayRequirements, asvsTranslationProvider } from '../../shared/asvsCatalogEs';
import type { AsvsData, AsvsHistory, AsvsOverview } from '../../shared/asvsTracking';
import type { RecordItem, Task } from '../../shared/model';
import { api } from '../api';
import { Badge, Button, Field, Notice } from '../ui';
import AsvsReview from './AsvsReview';
import AsvsRevalidation from './AsvsRevalidation';
import AsvsCatalogUpdate from './AsvsCatalogUpdate';
import AsvsReport from './AsvsReport';

type HistoryPage = { items: AsvsHistory[]; nextOffset: number | null };
type Item = AsvsOverview['items'][number];
type Requirement = (typeof asvsDisplayRequirements)[number];
type Bucket = 'verified' | 'excluded' | 'progress' | 'attention' | 'unplanned';
type Focus = Exclude<Bucket, 'excluded'> | 'all';

const originals = new Map(asvsCatalog.requirements.map((r) => [r.reqId, r]));
const focusOptions: { key: Focus; label: string; empty: string }[] = [
  {
    key: 'attention',
    label: 'Requiere atención',
    empty:
      'Nada requiere atención: no hay incumplimientos, consultas ni evidencias desactualizadas sin tarea.',
  },
  {
    key: 'unplanned',
    label: 'Sin planificar',
    empty: 'Todos los requisitos pendientes tienen una tarea abierta.',
  },
  {
    key: 'progress',
    label: 'En curso',
    empty: 'Ningún requisito tiene tareas abiertas. Asócialos desde el editor de una tarea.',
  },
  {
    key: 'verified',
    label: 'Verificados',
    empty: 'Todavía no hay requisitos verificados con evidencia vigente.',
  },
  { key: 'all', label: 'Todos', empty: 'No hay requisitos que coincidan con la búsqueda.' },
];

// Buckets are exclusive so the focus counts add up: open work wins over a pending problem.
function bucketOf(item: Item | undefined, openTasks: number): Bucket {
  const assessment = item?.assessment;
  if (item?.status.tick) return 'verified';
  if (item?.status.excluded) return 'excluded';
  if (openTasks) return 'progress';
  if (
    assessment &&
    (assessment.state === 'No cumplido' ||
      assessment.state === 'Requiere consulta' ||
      (item.status.stale && assessment.reviewedAt))
  )
    return 'attention';
  return 'unplanned';
}

function stateBadge(item?: Item) {
  const assessment = item?.assessment;
  if (!assessment) return { label: 'Sin evaluar', tone: '' };
  if (item.status.tick) return { label: 'Verificado', tone: 'green' };
  if (item.status.excluded) return { label: 'No aplicable', tone: '' };
  if (item.status.stale && assessment.reviewedAt) return { label: 'Desactualizado', tone: 'amber' };
  if (assessment.state === 'No cumplido') return { label: 'No cumplido', tone: 'red' };
  if (assessment.state === 'Requiere consulta')
    return { label: 'Requiere consulta', tone: 'amber' };
  if (item.status.partial) return { label: 'Parcial', tone: 'blue' };
  if (assessment.state === 'Pendiente') return { label: 'Sin evaluar', tone: '' };
  return { label: assessment.state, tone: '' };
}

function openTasks(records: RecordItem[], reqId: string) {
  return records.filter(
    (r) =>
      r.kind === 'task' &&
      r.state !== 'Completada' &&
      !r.recurrence?.canceledAt &&
      r.asvsLinks?.some((l) => l.catalogVersion === asvsCatalog.version && l.reqId === reqId),
  ).length;
}

function percent(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

export default function AsvsView({
  projectId,
  records,
  openRecord,
  data,
  onChanged,
}: {
  projectId: string;
  records: RecordItem[];
  openRecord: (record: RecordItem) => void;
  data?: AsvsData;
  onChanged: () => void;
}) {
  const [overview, setOverview] = useState<AsvsOverview>();
  const [targetLevel, setTargetLevel] = useState('');
  const [contextReason, setContextReason] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focus, setFocus] = useState<Focus>('all');
  const [query, setQuery] = useState('');
  const [chapterOpen, setChapterOpen] = useState<Record<string, boolean>>({});
  const [requirementOpen, setRequirementOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState('');
  const [historyTarget, setHistoryTarget] = useState('');
  const [history, setHistory] = useState<HistoryPage>();
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
  function closeReview() {
    setEditing('');
    reviewTrigger.current?.focus();
  }
  function changeFocus(next: Focus) {
    setFocus(next);
    setChapterOpen({});
    setRequirementOpen({});
  }
  function changeQuery(next: string) {
    setQuery(next);
    setChapterOpen({});
    setRequirementOpen({});
  }

  useEffect(() => {
    let disposed = false;
    const revision = savedRevision.current;
    api<AsvsOverview>('asvs-list', { projectId })
      .then((result) => {
        if (disposed || revision !== savedRevision.current) return;
        setOverview(result);
        if (initialized.current) return;
        initialized.current = true;
        setTargetLevel(String(result.config?.level ?? ''));
        setSettingsOpen(!result.config?.level);
        // Start where the work is: problems without a task, otherwise the whole catalog.
        const urgent = result.items.some(
          (item) =>
            item.status.active &&
            bucketOf(item, openTasks(records, item.assessment.reqId)) === 'attention',
        );
        setFocus(urgent ? 'attention' : 'all');
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
    if (!offset && historyTarget === targetId) {
      setHistoryTarget('');
      return;
    }
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
  function copyReference(reference: string) {
    void navigator.clipboard
      .writeText(reference)
      .then(() => setMessage(`Referencia copiada: ${reference}`))
      .catch(() => setError('No se pudo copiar. Selecciona la referencia para copiarla.'));
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

  const level = config?.level ?? null;
  const summary = overview.summary;
  const items = new Map(
    overview.items
      .filter((item) => item.assessment.catalogVersion === asvsCatalog.version)
      .map((item) => [item.assessment.reqId, item]),
  );
  const nextSteps = new Map(overview.gaps.map((gap) => [gap.reqId, gap.nextStep]));
  const linkedTasks = new Map<string, Task[]>();
  for (const record of records) {
    if (record.kind !== 'task' || record.recurrence?.canceledAt) continue;
    for (const link of record.asvsLinks ?? [])
      if (link.catalogVersion === asvsCatalog.version)
        linkedTasks.set(link.reqId, [...(linkedTasks.get(link.reqId) ?? []), record]);
  }
  const inScope = asvsDisplayRequirements.filter((r) => !level || r.minLevel <= level);
  const buckets = new Map(
    inScope.map((r) => [
      r.reqId,
      bucketOf(
        items.get(r.reqId),
        (linkedTasks.get(r.reqId) ?? []).filter((task) => task.state !== 'Completada').length,
      ),
    ]),
  );
  const focusCounts = Object.fromEntries(
    focusOptions.map(({ key }) => [
      key,
      key === 'all' ? inScope.length : inScope.filter((r) => buckets.get(r.reqId) === key).length,
    ]),
  ) as Record<Focus, number>;
  const activeFocus: Focus = level ? focus : 'all';
  const normalized = query.trim().toLowerCase();
  const filtered = inScope.filter(
    (r) =>
      (activeFocus === 'all' || buckets.get(r.reqId) === activeFocus) &&
      (!normalized ||
        `${r.reqId} ${r.canonicalRef} ${r.chapterName} ${r.sectionName} ${r.description} ${originals.get(r.reqId)?.description}`
          .toLowerCase()
          .includes(normalized)),
  );
  const chapters = [...new Set(filtered.map((r) => r.chapterId))];
  const narrowed = !!normalized || activeFocus !== 'all';
  const pendingRevisions = (data?.revisionProposals ?? []).filter(
    (p) => p.status === 'pending',
  ).length;
  const previousItems = overview.items.filter(
    (item) => item.assessment.catalogVersion !== asvsCatalog.version,
  );
  const highlights = [
    [summary.failed, 'no cumplidos'],
    [summary.stale, 'desactualizados'],
    [summary.consultation, 'requieren consulta'],
    [summary.partial, 'parciales'],
    [summary.excluded, 'no aplicables'],
  ]
    .filter(([count]) => count)
    .map(([count, label]) => `${count} ${label}`);
  const verifiedPercent = percent(summary.fulfilled, summary.denominator);

  function renderDetail(requirement: Requirement, item: Item | undefined) {
    const assessment = item?.assessment;
    const help = asvsHelpLinks(requirement);
    const tasks = linkedTasks.get(requirement.reqId) ?? [];
    const nextStep = level ? nextSteps.get(requirement.reqId) : undefined;
    return (
      <div className="asvs-req-body">
        <p className="asvs-description" lang={asvsTranslationProvider ? 'es' : 'en'}>
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
        {nextStep && (
          <p className="asvs-next">
            <strong>Siguiente paso:</strong> {nextStep}
          </p>
        )}
        <dl className="asvs-facts">
          <div>
            <dt>Nivel mínimo</dt>
            <dd>L{requirement.minLevel}</dd>
          </div>
          <div>
            <dt>Aplicabilidad</dt>
            <dd>{assessment?.applicability ?? 'Por determinar'}</dd>
          </div>
          {assessment?.reviewedAt && (
            <div>
              <dt>Última evaluación</dt>
              <dd>
                {assessment.state} en L{assessment.evaluatedLevel} ·{' '}
                {new Date(assessment.reviewedAt).toLocaleDateString('es-ES')} ·{' '}
                {assessment.responsible} · {assessment.method}
              </dd>
            </div>
          )}
          {assessment?.note && (
            <div>
              <dt>Nota</dt>
              <dd>{assessment.note}</dd>
            </div>
          )}
        </dl>
        {item?.status.stale && assessment?.reviewedAt && (
          <p className="asvs-stale">
            Evidencia desactualizada: {item.status.reasons.join(', ')}. Revisa las fuentes y el
            alcance y guarda una nueva evaluación.
          </p>
        )}
        {item?.status.partial && (
          <p className="asvs-partial">
            Cobertura parcial: {assessment?.scopeDetail}. Alcance pendiente:{' '}
            {assessment?.pendingScope}.
          </p>
        )}
        {assessment?.decision && (
          <p className="asvs-partial">
            Excluido del denominador por decisión humana: {assessment.decision.reason}. Referencia:{' '}
            {assessment.decision.reference}. Responsable: {assessment.decision.responsible}.
          </p>
        )}
        {!!assessment?.evidence.length && (
          <div className="asvs-block">
            <h4>Evidencias</h4>
            <ul>
              {assessment.evidence.map((e) => {
                const source = records.find((r) => r.id === e.recordId);
                return (
                  <li key={e.id}>
                    {e.reference} · revisión {e.revision}
                    {e.recordId &&
                      (source ? (
                        <Button variant="ghost" onClick={() => openRecord(source)}>
                          Ver fuente: {source.title}
                        </Button>
                      ) : (
                        ' · Fuente eliminada'
                      ))}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!!tasks.length && (
          <div className="asvs-block">
            <h4>Tareas vinculadas</h4>
            <div className="asvs-actions">
              {tasks.map((task) => (
                <Button key={task.id} variant="secondary" onClick={() => openRecord(task)}>
                  {task.title} · {task.state}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="asvs-actions">
          {assessment && (
            <Button
              disabled={!item?.status.active}
              ariaLabel={`Evaluar ${requirement.reqId}`}
              onClick={() => {
                reviewTrigger.current = document.activeElement as HTMLElement;
                setEditing(assessment.id);
                setHistoryTarget('');
              }}
            >
              Evaluar
            </Button>
          )}
          {assessment && (
            <Button
              variant="secondary"
              ariaLabel={`Historial de ${requirement.reqId}`}
              onClick={() => void showHistory(assessment.id)}
            >
              <History size={15} aria-hidden="true" /> Historial
            </Button>
          )}
          <Button
            variant="secondary"
            ariaLabel={`Copiar referencia ${requirement.canonicalRef}`}
            onClick={() => copyReference(requirement.canonicalRef)}
          >
            <Copy size={15} aria-hidden="true" /> Copiar referencia
          </Button>
          {help && (
            <>
              <a href={help.source} target="_blank" rel="noopener noreferrer">
                Texto oficial
              </a>
              <a href={help.guide} target="_blank" rel="noopener noreferrer">
                Guía OWASP
              </a>
            </>
          )}
        </div>
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
              setMessage('Evaluación ASVS guardada.');
            }}
          />
        )}
        {assessment && historyTarget === assessment.id && history && (
          <div className="asvs-history" aria-label={`Historial de ${requirement.reqId}`}>
            <h4>Historial de evaluación</h4>
            <ol>
              {history.items.map((entry) => (
                <li key={entry.id}>
                  <p>
                    {new Date(entry.at).toLocaleString('es-ES')} · {entry.actor} · v
                    {entry.after.version}
                  </p>
                  {entry.kind === 'assessment' && (
                    <>
                      <p>
                        {entry.before?.state ?? 'Sin evaluación'} → {entry.after.state} ·{' '}
                        {entry.after.scope === 'project' ? 'Proyecto' : 'Cobertura parcial'} · L
                        {entry.after.evaluatedLevel}
                      </p>
                      {entry.after.note && <p>{entry.after.note}</p>}
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
                          Decisión: {entry.after.decision.reason} · {entry.after.decision.reference}
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
                onClick={() => void showHistory(assessment.id, history.nextOffset!)}
              >
                Más historial
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="asvs-view" aria-label="Verificación ASVS">
      <header className="asvs-head">
        <p>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            OWASP ASVS {asvsCatalog.version} ·{' '}
            <strong>{level ? `Nivel objetivo L${level}` : 'Desactivado en este cuaderno'}</strong>
          </span>
        </p>
        <button
          type="button"
          className="button secondary"
          aria-expanded={settingsOpen}
          aria-controls="asvs-settings"
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <Settings2 size={15} aria-hidden="true" /> Ajustes y herramientas
        </button>
      </header>

      {level ? (
        <div className="asvs-progress">
          <div className="asvs-progress-line">
            <strong role="status">
              {summary.fulfilled} de {summary.denominator} requisitos aplicables verificados
            </strong>
            <span>{verifiedPercent} %</span>
          </div>
          <div className="asvs-bar" aria-hidden="true">
            <span style={{ width: `${verifiedPercent}%` }} />
          </div>
          {!summary.denominator && <p>Sin requisitos aplicables evaluables.</p>}
          {!!highlights.length && <p className="muted">{highlights.join(' · ')}</p>}
        </div>
      ) : (
        <Notice>
          ASVS está desactivado. Elige un nivel objetivo en Ajustes para hacer seguimiento; mientras
          tanto puedes consultar el catálogo completo.
        </Notice>
      )}

      {pendingRevisions > 0 && (
        <Notice>
          <div className="asvs-inline-notice">
            <span>
              {pendingRevisions === 1
                ? 'Hay una revisión externa propuesta por un asistente pendiente de confirmar.'
                : `Hay ${pendingRevisions} revisiones externas propuestas por asistentes pendientes de confirmar.`}
            </span>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
              Revisar propuestas
            </Button>
          </div>
        </Notice>
      )}

      {settingsOpen && (
        <section className="asvs-panel" id="asvs-settings" aria-labelledby="asvs-settings-title">
          <h2 id="asvs-settings-title">Ajustes y herramientas ASVS</h2>
          <div className="asvs-settings">
            <Field label="Nivel objetivo ASVS">
              <select value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)}>
                <option value="">Desactivado</option>
                <option value="1">L1 — 70 requisitos</option>
                <option value="2">L2 — 253 requisitos</option>
                <option value="3">L3 — 345 requisitos</option>
              </select>
            </Field>
            <Button disabled={busy} onClick={() => void configure()}>
              Guardar configuración ASVS
            </Button>
          </div>
          <details className="asvs-tool">
            <summary>Cambio de contexto del sistema evaluado</summary>
            <Field
              label="Cambio de contexto"
              hint="Rellénalo solo si ha cambiado el sistema evaluado y guarda la configuración. Las evaluaciones anteriores quedan desactualizadas."
            >
              <input
                maxLength={16000}
                value={contextReason}
                onChange={(e) => setContextReason(e.target.value)}
                placeholder="Motivo de una nueva revisión de contexto"
              />
            </Field>
          </details>
          <p className="muted">
            Desactivar oculta ASVS en todo el cuaderno y para los asistentes MCP, y suspende los
            bloqueos de cierre. Se conservan evaluaciones, historial y vínculos; se reactiva en
            Ajustes y copias.
          </p>
          {config && (
            <AsvsRevalidation
              data={data}
              overview={overview}
              onSaved={saved}
              open={pendingRevisions > 0}
            />
          )}
          {config && (
            <AsvsReport
              key={`${projectId}:${config.version}`}
              overview={overview}
              records={records}
              data={data}
            />
          )}
          {(previousItems.length > 0 || data?.history.some((h) => h.kind === 'catalog')) && (
            <details className="asvs-tool">
              <summary>Evaluaciones de catálogos anteriores</summary>
              <p>
                Se conservan los estados y evidencias históricos. No cuentan en el catálogo activo.
              </p>
              {previousItems.map(({ assessment }) => (
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
              {data?.history.map(
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
        </section>
      )}

      <div className="asvs-toolbar">
        {level && (
          <div
            className="practice-status-tabs asvs-focus"
            role="group"
            aria-label="Enfoque de requisitos ASVS"
          >
            {focusOptions.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={activeFocus === key ? 'active' : ''}
                aria-pressed={activeFocus === key}
                onClick={() => changeFocus(key)}
              >
                {label} <span className="tab-pill-count">{focusCounts[key]}</span>
              </button>
            ))}
          </div>
        )}
        <Field label="Buscar requisito ASVS">
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Referencia o texto, en español o inglés"
          />
        </Field>
      </div>
      {error && <Notice error>{error}</Notice>}
      {message && (
        <p className="asvs-message" role="status">
          {message}
        </p>
      )}
      {narrowed && filtered.length > 0 && (
        <p className="asvs-results muted" role="status">
          {filtered.length} {filtered.length === 1 ? 'requisito' : 'requisitos'}
        </p>
      )}
      {!filtered.length && (
        <Notice>
          {normalized
            ? 'No hay requisitos que coincidan con la búsqueda en este enfoque.'
            : focusOptions.find((option) => option.key === activeFocus)?.empty}
        </Notice>
      )}

      <div className="asvs-tree">
        {chapters.map((chapterId) => {
          const chapter = filtered.filter((r) => r.chapterId === chapterId);
          const all = inScope.filter((r) => r.chapterId === chapterId);
          const verified = all.filter((r) => buckets.get(r.reqId) === 'verified').length;
          const expanded = chapterOpen[chapterId] ?? narrowed;
          return (
            <section className="asvs-chapter" key={chapterId} data-open={expanded}>
              <h2>
                <button
                  type="button"
                  className="asvs-chapter-head"
                  aria-expanded={expanded}
                  onClick={() =>
                    setChapterOpen((current) => ({ ...current, [chapterId]: !expanded }))
                  }
                >
                  <ChevronRight size={16} aria-hidden="true" className="asvs-chevron" />
                  <span className="asvs-chapter-name">
                    {chapterId} · {chapter[0].chapterName}
                  </span>
                  {narrowed && <Badge>{chapter.length}</Badge>}
                  <span className="asvs-chapter-count">
                    {level ? `${verified}/${all.length} verificados` : `${all.length} requisitos`}
                  </span>
                  {level && (
                    <span className="asvs-bar small" aria-hidden="true">
                      <span style={{ width: `${percent(verified, all.length)}%` }} />
                    </span>
                  )}
                </button>
              </h2>
              {expanded &&
                [...new Set(chapter.map((r) => r.sectionId))].map((sectionId) => {
                  const section = chapter.filter((r) => r.sectionId === sectionId);
                  return (
                    <div className="asvs-section" key={sectionId}>
                      <h3>
                        {sectionId} · {section[0].sectionName}
                      </h3>
                      {section.map((requirement) => {
                        const item = items.get(requirement.reqId);
                        const badge = stateBadge(item);
                        const taskCount = linkedTasks.get(requirement.reqId)?.length ?? 0;
                        const open =
                          requirementOpen[requirement.reqId] ??
                          (filtered.length === 1 ||
                            normalized === requirement.reqId.toLowerCase() ||
                            normalized === requirement.canonicalRef.toLowerCase());
                        return (
                          <article
                            className="asvs-req"
                            key={requirement.reqId}
                            aria-label={requirement.canonicalRef}
                            data-open={open}
                          >
                            <button
                              type="button"
                              className="asvs-req-head"
                              aria-expanded={open}
                              onClick={() =>
                                setRequirementOpen((current) => ({
                                  ...current,
                                  [requirement.reqId]: !open,
                                }))
                              }
                            >
                              <span className="asvs-req-id">{requirement.reqId}</span>
                              <span
                                className="asvs-req-text"
                                lang={asvsTranslationProvider ? 'es' : 'en'}
                              >
                                {requirement.description}
                              </span>
                              <span className="asvs-req-meta">
                                {taskCount > 0 && (
                                  <Badge>
                                    {taskCount} {taskCount === 1 ? 'tarea' : 'tareas'}
                                  </Badge>
                                )}
                                <Badge tone={badge.tone}>
                                  {badge.tone === 'green' && <Check size={13} aria-hidden="true" />}
                                  {badge.label}
                                </Badge>
                              </span>
                            </button>
                            {open && renderDetail(requirement, item)}
                          </article>
                        );
                      })}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
      <p className="asvs-attribution muted">
        {asvsCatalog.attribution} ·{' '}
        <a href={asvsCatalog.licenseUrl} target="_blank" rel="noreferrer">
          {asvsCatalog.license}
        </a>
        .{' '}
        {asvsTranslationProvider
          ? 'Traducción con DeepL: el original inglés es la referencia. '
          : 'Traducción española pendiente: se muestra el original inglés. '}
        Registrar verificaciones no equivale a una certificación de OWASP.
      </p>
    </section>
  );
}
