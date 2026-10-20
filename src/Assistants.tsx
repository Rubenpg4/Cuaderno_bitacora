import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Copy,
  Plug,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  X,
  Eye,
  KeyRound,
  FileText,
} from 'lucide-react';
import {
  DEFAULT_IDLE_LOCK,
  IDLE_LOCK_OPTIONS,
  mentionSummaryText,
  type IdleLock,
  type Snapshot,
  type Provider,
  type Kind,
  type Proposal,
} from '../shared/model';
import { asvsActive } from '../shared/asvsTracking';
import portableSkill from '../.agents/skills/bitacora-mcp/SKILL.md?raw';
import { planProposalReview, taskCompletionReviewGroup } from '../shared/proposalReview';
import { GENERAL_SCOPE, findSubproject, grantScopes, subprojectsOf } from '../shared/subprojects';
import {
  attachmentSummary,
  batchPreview,
  isTextChange,
  proposalChanges,
  type PreviewChange,
} from '../shared/proposalPreview';
import { inlineTextDiff } from '../shared/textDiff';
import { mcpConfigBlock, mcpInstallCommand } from '../shared/mcpClientConfig';
import { playProposalSound } from './app/proposalSound';
import { api } from './api';
import { Badge, Button, Empty, Field, Notice } from './ui';
import CopyRecordId from './CopyRecordId';
import { InlineDiff } from './TextDiff';
const AsvsProposals = lazy(() => import('./AsvsProposals'));
const AsvsTaskProposalInfo = lazy(() => import('./AsvsTaskProposalInfo'));
const AsvsProposalChange = lazy(() =>
  import('./AsvsProposalDetails').then((m) => ({ default: m.AsvsProposalChange })),
);

const names = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };
const idleLockLabels: Record<IdleLock, string> = {
  5: '5 minutos',
  15: '15 minutos',
  30: '30 minutos',
  60: '1 hora (predeterminado)',
  120: '2 horas',
  240: '4 horas',
  480: '8 horas',
  never: 'Indefinido',
};
/** Tells whether the client really connected, without showing what it read. */
function lastUse(grant: Snapshot['grants'][number]) {
  if (!grant.lastUsedAt) return 'Sin uso todavía';
  const minutes = Math.round((Date.now() - Date.parse(grant.lastUsedAt)) / 60000);
  const when = minutes < 1 ? 'hace menos de 1 min' : `hace ${minutes} min`;
  return `Último uso ${when} (${grant.lastTool})`;
}
type ClaudeIdentityStatus =
  | { verified: true; orgId: string; orgName: string; subscriptionType: string }
  | { verified: false; error: string; policyPath: string };
const fieldNames: Record<string, string> = {
  title: 'Título',
  body: 'Informe',
  activity: 'Actividad',
  result: 'Resultado',
  learning: 'Aprendizaje',
  state: 'Estado',
  note: 'Evidencia / nota',
  explanation: 'Explicación',
  description: 'Descripción',
  solution: 'Solución',
  nextStep: 'Siguiente paso',
  blocker: 'Bloqueo',
  decision: 'Decisión',
  reason: 'Motivo',
  alternatives: 'Alternativas',
  consequences: 'Consecuencias',
  evidence: 'Evidencia',
  attachments: 'Adjuntos',
  practiceId: 'Criterio',
  phase: 'Fase',
  priority: 'Prioridad',
  objective: 'Objetivo',
  specifications: 'Especificaciones técnicas',
  competency: 'Competencias',
  dependencyIds: 'Depende de estas tareas',
  sourceIds: 'Fuentes de la reunión',
  asvsLinks: 'Requisitos ASVS asociados',
};

function previewValue(field: string, value: unknown, records: Snapshot['records']): string {
  if (field === 'asvsLinks' && Array.isArray(value))
    return (
      value
        .map(
          (link) =>
            `${link.reqId} (ASVS ${link.catalogVersion}) · ${link.reason} · Alcance: ${link.scope} · Criterio: ${link.criterion} · Método: ${link.method}`,
        )
        .join('\n') || 'Ninguno'
    );
  if (field === 'attachments') return attachmentSummary(value);
  if (field === 'project' && typeof value === 'string')
    return records.find((record) => record.id === value)?.title || 'Cuaderno actual';
  if ((field === 'dependencyIds' || field === 'sourceIds') && Array.isArray(value))
    return (
      value.map((id) => records.find((record) => record.id === id)?.title || id).join(', ') ||
      'Ninguna'
    );
  if (field.startsWith('check:') && value && typeof value === 'object') {
    const check = value as { state?: unknown; note?: unknown };
    return `${String(check.state || 'Pendiente')}${check.note ? ` · ${String(check.note)}` : ''}`;
  }
  if (Array.isArray(value)) return value.join(', ') || 'Ninguno';
  if (value == null || value === '') return 'Vacío';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function previewField(field: string, records: Snapshot['records']): string {
  if (field === 'delete') return 'Eliminación';
  if (!field.startsWith('check:')) return fieldNames[field] || field;
  const id = field.slice('check:'.length);
  const practice = records.find((record) => record.id === id);
  return `Criterio: ${practice?.title || 'Criterio asociado'}`;
}

/** Text edits highlight only the changed words; other values keep the full before/after. */
function ChangeValue({
  change,
  kind,
  showBefore,
  records,
}: {
  change: PreviewChange;
  kind: Kind;
  showBefore: boolean;
  records: Snapshot['records'];
}) {
  const display = (value: unknown) =>
    kind === 'entry' && typeof value === 'string' && value
      ? mentionSummaryText(value, records)
      : previewValue(change.field, value, records);
  const before = display(change.before);
  const after = display(change.after);
  const segments = showBefore && isTextChange(change) ? inlineTextDiff(before, after) : undefined;
  if (segments) return <InlineDiff segments={segments} />;
  return (
    <>
      {showBefore && <del>{before}</del>}
      <ins>{after}</ins>
    </>
  );
}

const KIND_ORDER: Kind[] = [
  'task',
  'entry',
  'incident',
  'idea',
  'practice',
  'decision',
  'meeting',
  'project',
];

const kindSectionLabels: Record<Kind, string> = {
  task: 'Tareas',
  entry: 'Entradas',
  incident: 'Incidencias',
  idea: 'Ideas',
  practice: 'Buenas prácticas',
  decision: 'Decisiones de arquitectura',
  meeting: 'Reuniones',
  project: 'Proyectos',
  subproject: 'Subproyectos',
  objective: 'Objetivos',
};

const kindDescriptions: Record<Kind, string> = {
  task: 'Propuestas de creación, actualización o comprobación de tareas.',
  entry: 'Propuestas de avances y registros diarios de actividad.',
  incident: 'Propuestas de incidencias y soluciones técnicas.',
  idea: 'Propuestas de ideas y oportunidades de mejora.',
  practice: 'Propuestas de criterios y buenas prácticas.',
  decision: 'Propuestas de decisiones técnicas y de arquitectura.',
  meeting: 'Propuestas de actas y acuerdos de reunión.',
  project: 'Propuestas de especificaciones y datos de proyectos.',
  subproject: 'Los subproyectos se gestionan desde la barra lateral.',
  objective: 'Los objetivos se editan desde Memoria.',
};

function completionAsvsIds(proposals: Proposal[], snapshot: Snapshot) {
  if (!asvsActive(snapshot.asvs)) return [];
  return (snapshot.asvs?.proposals ?? [])
    .filter(
      (p) =>
        p.status === 'pending' &&
        p.destination === 'task' &&
        proposals.some(
          (closure) =>
            closure.kind === 'task' &&
            closure.patch.state === 'Completada' &&
            closure.targetId === p.request.taskId &&
            closure.provider === p.provider,
        ),
    )
    .map((p) => p.id);
}

function completionAsvsBasis(snapshot: Snapshot, ids: string[], closures: Proposal[]) {
  const taskIds = closures
    .filter((p) => p.kind === 'task' && p.patch.state === 'Completada')
    .map((p) => p.targetId);
  if (!taskIds.length) return '';
  const proposals = ids.map((id) => snapshot.asvs?.proposals?.find((p) => p.id === id));
  const sources = new Set([
    ...taskIds,
    ...proposals.flatMap((p) => [
      p?.request.taskId,
      ...(p?.sourceFingerprints.map((s) => s.recordId) ?? []),
    ]),
    ...(snapshot.asvs?.taskVerifications ?? [])
      .filter((a) => taskIds.includes(a.taskId))
      .flatMap((a) => a.evidence.map((e) => e.recordId)),
  ]);
  return JSON.stringify([
    snapshot.asvs?.config,
    snapshot.asvs?.taskVerifications,
    proposals,
    snapshot.records.filter((r) => sources.has(r.id)),
  ]);
}

export default function Assistants({
  snapshot,
  refresh,
  focusProposalId,
  currentSubprojectId,
  proposalSoundEnabled,
  toggleProposalSound,
}: {
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  focusProposalId?: string;
  currentSubprojectId?: string;
  proposalSoundEnabled: boolean;
  toggleProposalSound: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('claude'),
    [canCompleteTasks, setCanCompleteTasks] = useState(false),
    [durationOption, setDurationOption] = useState<string>('60'),
    [customMinutes, setCustomMinutes] = useState<number>(60),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [selectedProjects] = useState<string[]>(() =>
      snapshot.records.filter((record) => record.kind === 'project').map((record) => record.id),
    ),
    // Starts with «General» plus the subproject open in the sidebar, if any.
    [selectedScopes, setSelectedScopes] = useState<string[]>(() =>
      currentSubprojectId ? [GENERAL_SCOPE, currentSubprojectId] : [GENERAL_SCOPE],
    ),
    [config, setConfig] = useState(''),
    [installCommand, setInstallCommand] = useState(''),
    [activeTab, setActiveTab] = useState<'connect' | 'proposals'>(() =>
      snapshot.proposals.some((p) => p.status === 'pending') ||
      (asvsActive(snapshot.asvs) && snapshot.asvs?.proposals?.some((p) => p.status === 'pending'))
        ? 'proposals'
        : 'connect',
    ),
    [openTypes, setOpenTypes] = useState<Record<string, boolean>>({}),
    [openProposals, setOpenProposals] = useState<Record<string, boolean>>({}),
    [reviewSelection, setReviewSelection] = useState<{
      proposals: Proposal[];
      label: string;
      asvsIds: string[];
      asvsBasis: string;
    } | null>(null),
    [claudeIdentity, setClaudeIdentity] = useState<ClaudeIdentityStatus | null>(null);

  const corporate = snapshot.mcpProfile === 'corporativo';
  const idleLock = snapshot.idleLock ?? DEFAULT_IDLE_LOCK;
  function checkClaudeIdentity() {
    setClaudeIdentity(null);
    void api<ClaudeIdentityStatus>('claude-identity')
      .then(setClaudeIdentity)
      .catch((e: Error) =>
        setClaudeIdentity({ verified: false, error: e.message, policyPath: '' }),
      );
  }
  useEffect(() => {
    if (!corporate) return;
    setProvider('claude');
    checkClaudeIdentity();
  }, [corporate]);
  // Each client keeps one session; its scopes and permission prefill the form for renewal.
  const providerGrant = snapshot.grants.find(
    (grant) => grant.provider === provider && grant.scope === 'projects',
  );
  useEffect(() => {
    if (!providerGrant) return;
    setSelectedScopes(grantScopes(providerGrant));
    setCanCompleteTasks(providerGrant.canCompleteTasks === true);
  }, [provider]);
  const projects = snapshot.records.filter((record) => record.kind === 'project');
  const activeChildren = subprojectsOf(snapshot.records).filter(
    (child) => child.status === 'Activo',
  );
  // A permit only covers the scopes ticked here; new children are never added implicitly.
  const grantedScopes = selectedScopes.filter(
    (scope) => scope === GENERAL_SCOPE || activeChildren.some((child) => child.id === scope),
  );
  const scopeTitle = (scope: string) =>
    scope === GENERAL_SCOPE
      ? 'General'
      : (findSubproject(snapshot.records, scope)?.title ?? 'Subproyecto retirado');
  const pending = snapshot.proposals.filter((p) => p.status === 'pending');
  const asvsEnabled = asvsActive(snapshot.asvs);
  // Disabled ASVS is not reviewed: pending ASVS proposals stay stored but hidden.
  const asvsPending = asvsEnabled
    ? (snapshot.asvs?.proposals?.filter((p) => p.status === 'pending') ?? [])
    : [];
  useEffect(() => {
    if (asvsPending.some((p) => p.id === focusProposalId)) setActiveTab('proposals');
  }, [focusProposalId]);
  const effectiveDuration = durationOption === 'custom' ? customMinutes : Number(durationOption);

  const focusedProposal = pending.find((proposal) => proposal.id === focusProposalId);
  useEffect(() => {
    if (!focusedProposal) return;
    setActiveTab('proposals');
    setOpenTypes((current) => ({ ...current, [focusedProposal.kind]: true }));
    setOpenProposals((current) => ({ ...current, [focusedProposal.id]: true }));
  }, [focusedProposal?.id, focusedProposal?.kind]);
  useEffect(() => {
    if (!focusedProposal || activeTab !== 'proposals') return;
    if (!openTypes[focusedProposal.kind] || !openProposals[focusedProposal.id]) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`proposal-${focusedProposal.id}`);
      card?.querySelector<HTMLElement>('.proposal-banner-toggle')?.focus({ preventScroll: true });
      card?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedProposal?.id, focusedProposal?.kind, activeTab, openTypes, openProposals]);

  function hasConflict(p: Proposal) {
    if (!p.targetId) return false;
    const original = snapshot.records.find((r) => r.id === p.targetId);
    return !original || original.version !== p.expectedVersion;
  }

  const presentKinds = [
    ...KIND_ORDER.filter((kind) => pending.some((p) => p.kind === kind)),
    ...pending
      .map((p) => p.kind)
      .filter((kind, idx, arr) => !KIND_ORDER.includes(kind) && arr.indexOf(kind) === idx),
  ];
  const globalPlan = planProposalReview(pending, snapshot.records);
  const acceptableGlobal = globalPlan.ordered;

  function toggleType(kind: string) {
    setOpenTypes((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  function toggleProposal(id: string) {
    setOpenProposals((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function run(fn: () => Promise<unknown>) {
    setError('');
    setMessage('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function selectReview(proposals: Proposal[], label: string) {
    const asvsIds = completionAsvsIds(proposals, snapshot);
    setReviewSelection({
      proposals,
      label,
      asvsIds,
      asvsBasis: completionAsvsBasis(snapshot, asvsIds, proposals),
    });
  }

  async function confirmReview() {
    if (!reviewSelection) return;
    await run(async () => {
      const current = await api<Snapshot>('snapshot');
      if (
        completionAsvsBasis(current, reviewSelection.asvsIds, reviewSelection.proposals) !==
          reviewSelection.asvsBasis ||
        completionAsvsIds(reviewSelection.proposals, current).join() !==
          reviewSelection.asvsIds.join()
      ) {
        setReviewSelection(null);
        await refresh();
        throw Error('ASVS cambió. Revisa la vista previa de nuevo.');
      }
      const selected = reviewSelection.proposals.map((proposal) =>
        current.proposals.find((item) => item.id === proposal.id && item.status === 'pending'),
      );
      if (selected.some((proposal) => !proposal)) {
        setReviewSelection(null);
        await refresh();
        throw Error('Las propuestas cambiaron. Revisa la vista previa de nuevo.');
      }
      const latest = batchPreview(selected as Proposal[], current.records);
      const shown = batchPreview(reviewSelection.proposals, snapshot.records);
      if (
        latest.ordered.map((proposal) => proposal.id).join() !==
          shown.ordered.map((proposal) => proposal.id).join() ||
        JSON.stringify(latest.groups) !== JSON.stringify(shown.groups)
      ) {
        setReviewSelection(null);
        await refresh();
        throw Error('Los registros cambiaron. Revisa la vista previa de nuevo.');
      }
      if (!latest.ordered.length) throw Error('No quedan propuestas compatibles para aceptar.');
      try {
        if (latest.ordered.length === 1 && !reviewSelection.asvsIds.length)
          await api('review', { id: latest.ordered[0].id, accept: true });
        else
          await api('review', {
            ids: latest.ordered.map((proposal) => proposal.id),
            asvsIds: reviewSelection.asvsIds,
            accept: true,
          });
      } catch (err) {
        setReviewSelection(null);
        await refresh();
        throw err;
      }
      setReviewSelection(null);
      setMessage(
        `${latest.ordered.length + reviewSelection.asvsIds.length} propuesta(s) aceptada(s).`,
      );
    });
  }

  async function rejectOne(id: string) {
    await run(async () => {
      await api('review', { id, accept: false });
      setMessage('Propuesta rechazada.');
    });
  }

  async function createGrant() {
    await run(async () => {
      const g = await api<{
        nodePath: string;
        mcpPath: string;
        dataDir: string;
        expiresAt: string;
        renewed: boolean;
      }>('grant', {
        provider,
        projectIds: selectedProjects,
        scope: 'projects',
        scopes: grantedScopes,
        durationMinutes: effectiveDuration,
        canCompleteTasks,
      });
      setConfig(mcpConfigBlock(provider, g));
      setInstallCommand(mcpInstallCommand(provider, g) ?? '');
      setMessage(
        `Sesión ${g.renewed ? 'renovada' : 'creada'} hasta las ${new Date(g.expiresAt).toLocaleTimeString('es-ES')}. Se revoca al bloquear Bitácora.`,
      );
    });
  }

  return (
    <div className="assistants">
      <div className="tabbar">
        <button
          className={activeTab === 'connect' ? 'active' : ''}
          onClick={() => setActiveTab('connect')}
        >
          <Plug size={16} /> Conexiones y contexto
        </button>
        <button
          className={activeTab === 'proposals' ? 'active' : ''}
          onClick={() => setActiveTab('proposals')}
        >
          <Eye size={16} /> Propuestas <Badge>{pending.length + asvsPending.length}</Badge>
        </button>
      </div>
      {activeTab === 'connect' ? (
        <>
          {corporate && !claudeIdentity?.verified ? (
            <section className="form-section">
              <Notice>
                Este cuaderno tiene perfil corporativo. Solo puede conectarse Claude Code con sesión
                iniciada en una organización Team o Enterprise permitida por la política local. La
                conexión MCP está bloqueada hasta comprobarlo; puedes cambiar el perfil en Ajustes y
                copias.
              </Notice>
              <p className="muted">
                {claudeIdentity
                  ? claudeIdentity.error
                  : 'Comprobando la cuenta de Claude Code en este equipo…'}
              </p>
              {claudeIdentity?.policyPath && (
                <p className="muted">
                  {`La política se define en ${claudeIdentity.policyPath} con el formato {"claudeOrgIds": ["<orgId>"]}. Obtén el orgId con «claude auth status».`}
                </p>
              )}
              <Button variant="secondary" onClick={checkClaudeIdentity}>
                Comprobar de nuevo
              </Button>
            </section>
          ) : (
            <>
              {claudeIdentity?.verified && corporate ? (
                <Notice>
                  {`Perfil corporativo: Claude Code tiene sesión en ${claudeIdentity.orgName} (${claudeIdentity.subscriptionType}). Es una comprobación local en este equipo; la sesión se revoca si Claude Code cambia de organización.`}
                </Notice>
              ) : (
                <Notice>
                  Las IA usan tus suscripciones en sus clientes oficiales. El contexto leído se
                  envía al proveedor. Bitácora no utiliza API de pago ni puede consultar tu cuota
                  restante.
                </Notice>
              )}
              <label className="checkbox authorization">
                <input
                  type="checkbox"
                  checked={snapshot.settings.companyAuthorized}
                  onChange={(e) =>
                    void run(() =>
                      api('settings', {
                        ...snapshot.settings,
                        companyAuthorized: e.target.checked,
                      }),
                    )
                  }
                />
                <span>
                  <strong>La empresa autoriza este uso de IA externa</strong>
                  <small>
                    Registra esta decisión solo después de confirmarla. Desactivarla revoca todas
                    las sesiones.
                  </small>
                </span>
              </label>
              <Field
                label="Bloqueo por inactividad"
                hint="Tiempo sin usar la interfaz antes de bloquear el cuaderno. Al bloquearse, a mano o por inactividad, se revocan las sesiones MCP."
              >
                <select
                  value={String(idleLock)}
                  onChange={(e) =>
                    void run(() =>
                      api('idle-lock', {
                        idleLock: e.target.value === 'never' ? 'never' : Number(e.target.value),
                      }),
                    )
                  }
                >
                  {IDLE_LOCK_OPTIONS.map((option) => (
                    <option key={option} value={String(option)}>
                      {idleLockLabels[option]}
                    </option>
                  ))}
                </select>
              </Field>
              {idleLock === 'never' && (
                <Notice error>
                  Sin bloqueo por inactividad, el cuaderno y sus sesiones MCP siguen abiertos hasta
                  que pulses Bloquear o cierres Bitácora. No dejes el equipo desatendido.
                </Notice>
              )}
              <div className="form-grid">
                <Field label="Cliente">
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value as Provider);
                      setConfig('');
                    }}
                  >
                    {Object.entries(names)
                      .filter(([v]) => !corporate || v === 'claude')
                      .map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Duración de la sesión">
                  <select
                    value={durationOption}
                    onChange={(e) => setDurationOption(e.target.value)}
                  >
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="60">1 hora (recomendado)</option>
                    <option value="120">2 horas</option>
                    <option value="240">4 horas</option>
                    <option value="480">8 horas</option>
                    <option value="custom">Personalizada…</option>
                  </select>
                </Field>
                {durationOption === 'custom' && (
                  <Field label="Minutos (entre 15 y 480)">
                    <input
                      type="number"
                      min={15}
                      max={480}
                      value={customMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCustomMinutes(Number.isNaN(val) ? 15 : Math.max(15, Math.min(480, val)));
                      }}
                    />
                  </Field>
                )}
              </div>
              <section className="form-section">
                <h3>Cuaderno para {names[provider]}</h3>
                <p className="muted">
                  La sesión MCP solo podrá consultar los registros del cuaderno abierto. Se revocará
                  al bloquearlo.
                </p>
                {projects.map((project) => (
                  <div
                    className="row spread"
                    key={project.id}
                    style={{ alignItems: 'center', marginBottom: 4 }}
                  >
                    <span>{project.title}</span>
                    <CopyRecordId id={project.id} title={project.title} />
                  </div>
                ))}
                {activeChildren.length > 0 && (
                  <fieldset className="scope-grants">
                    <legend>Ámbitos autorizados</legend>
                    <p className="muted">
                      La sesión solo verá y propondrá cambios en los ámbitos marcados. Las prácticas
                      generales se comparten con los subproyectos elegidos.
                    </p>
                    {[GENERAL_SCOPE, ...activeChildren.map((child) => child.id)].map((scope) => (
                      <label className="checkbox" key={scope}>
                        <input
                          type="checkbox"
                          checked={grantedScopes.includes(scope)}
                          onChange={(event) =>
                            setSelectedScopes((current) =>
                              event.target.checked
                                ? [...current.filter((item) => item !== scope), scope]
                                : current.filter((item) => item !== scope),
                            )
                          }
                        />
                        <span>{scopeTitle(scope)}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="checkbox authorization">
                  <input
                    type="checkbox"
                    checked={canCompleteTasks}
                    onChange={(event) => setCanCompleteTasks(event.target.checked)}
                  />
                  <span>
                    <strong>Permitir que este asistente complete tareas</strong>
                    <small>
                      Podrá aceptar sus propias verificaciones y el cierre de una tarea sin revisión
                      en la interfaz, solo si aporta evidencias para todos sus criterios. Este
                      permiso termina al caducar o revocar la sesión.
                    </small>
                  </span>
                </label>
                <Button
                  disabled={
                    !selectedProjects.length ||
                    !grantedScopes.length ||
                    !snapshot.settings.companyAuthorized
                  }
                  onClick={() => void createGrant()}
                >
                  <KeyRound size={16} />{' '}
                  {providerGrant
                    ? 'Renovar sesión para este cuaderno'
                    : 'Crear sesión para este cuaderno'}
                </Button>
              </section>
              {config && (
                <section className="form-section">
                  <h3>Configuración del cliente</h3>
                  <p>
                    {`Añade este bloque una sola vez a la configuración MCP de ${names[provider]}. Las sesiones nuevas usarán el permiso vigente. Para que aparezca en una conversación ya abierta, reinicia la conexión MCP o abre una conversación nueva.`}
                  </p>
                  <Notice>
                    Bitácora guarda el permiso temporal fuera del repositorio y lo retira al
                    bloquear o revocar la sesión. Mantén privada la carpeta de datos local.
                  </Notice>
                  <pre className="config">{config}</pre>
                  <div className="row">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(config)
                          .then(() => setMessage('Configuración copiada.'))
                      }
                    >
                      <Copy size={16} /> Copiar configuración
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(portableSkill)
                          .then(() =>
                            setMessage(
                              'Skill portátil copiada. Pégala en .agents/skills/bitacora-mcp/SKILL.md o .claude/skills/ en tu proyecto.',
                            ),
                          )
                      }
                    >
                      <FileText size={16} /> Copiar skill portátil (SKILL.md)
                    </Button>
                  </div>
                  {installCommand && (
                    <>
                      <p>
                        {`O instálalo con un solo comando en la terminal; queda disponible en todos los proyectos de ${names[provider]}:`}
                      </p>
                      <pre className="config" aria-label="Comando de instalación">
                        {installCommand}
                      </pre>
                      <div className="row">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(installCommand)
                              .then(() => setMessage('Comando copiado.'))
                          }
                        >
                          <Copy size={16} /> Copiar comando
                        </Button>
                      </div>
                    </>
                  )}
                </section>
              )}
              <section className="form-section">
                <details>
                  <summary>Solución de problemas de conexión</summary>
                  <dl className="mcp-troubleshooting">
                    <dt>«Bitácora no está abierta» o «Bitácora no responde»</dt>
                    <dd>
                      Abre la aplicación y desbloquea el cuaderno; después repite la consulta.
                    </dd>
                    <dt>«No hay una sesión MCP para este cliente» o «Sesión caducada»</dt>
                    <dd>Crea o renueva la sesión de ese cliente en esta pantalla.</dd>
                    <dt>«Bitácora está bloqueada»</dt>
                    <dd>
                      El cuaderno se bloqueó, a mano o por inactividad, y revocó las sesiones.
                      Desbloquéalo y renueva la sesión. Las llamadas del asistente no cuentan como
                      actividad.
                    </dd>
                    <dt>«El conector MCP y Bitácora son de versiones distintas»</dt>
                    <dd>Reinicia el cliente MCP o abre una conversación nueva tras actualizar.</dd>
                    <dt>Las herramientas no aparecen en el cliente</dt>
                    <dd>
                      Comprueba que el bloque o el comando de configuración se aplicó y abre una
                      conversación nueva. «Último uso» en Sesiones activas confirma si el cliente
                      llegó a conectar.
                    </dd>
                  </dl>
                </details>
              </section>
              <section className="form-section">
                <h3>Sesiones activas</h3>
                {snapshot.grants.map((g) => (
                  <div className="share-item" key={g.id}>
                    <span>
                      {names[g.provider]}
                      <small>
                        {`Cuaderno: ${g.projectIds
                          .map((id) => projects.find((p) => p.id === id)?.title)
                          .filter(Boolean)
                          .join(', ')}. `}
                        {activeChildren.length > 0 || grantScopes(g).length > 1
                          ? `Ámbitos: ${grantScopes(g).map(scopeTitle).join(', ')}. `
                          : ''}
                        Caduca a las {new Date(g.expiresAt).toLocaleTimeString('es-ES')}
                        {g.canCompleteTasks ? ' · Puede completar tareas' : ''}
                        {` · ${lastUse(g)}`}
                      </small>
                    </span>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Button
                        variant="secondary"
                        disabled={!grantedScopes.length}
                        onClick={() =>
                          void run(async () => {
                            const renewed = await api<{ id: string; expiresAt: string }>(
                              'renew-grant',
                              {
                                id: g.id,
                                durationMinutes: effectiveDuration,
                                scopes: grantedScopes,
                              },
                            );
                            setMessage(
                              `Sesión renovada hasta las ${new Date(renewed.expiresAt).toLocaleTimeString('es-ES')}. Se revoca al bloquear Bitácora.`,
                            );
                          })
                        }
                      >
                        <Clock size={16} /> Renovar sesión
                      </Button>
                      <Button
                        variant="ghost danger"
                        onClick={() => void run(() => api('revoke-grant', { id: g.id }))}
                      >
                        Revocar sesión
                      </Button>
                    </div>
                  </div>
                ))}
                {!snapshot.grants.length && (
                  <p className="muted">Ningún cliente tiene acceso actualmente.</p>
                )}
              </section>
              <section className="form-section">
                <h3>Petición para el martes</h3>
                <p className="prompt-example">
                  «Busca las fuentes autorizadas de los proyectos marcados y lee solo los registros
                  necesarios. Prepara avances, bloqueos, consultas de calidad y próximos pasos con
                  referencias. Envía el resultado como propuesta para que lo revise en la app».
                </p>
                <p className="muted">
                  Usa un espacio de trabajo separado y restringe las herramientas de archivos y
                  terminal del cliente. Los permisos MCP no limitan esas herramientas.
                </p>
              </section>
              <section className="form-section">
                <h3>Especificaciones de proyecto</h3>
                <p className="prompt-example">
                  «Conecta con Bitácora y usa el ID de proyecto para consultar su versión con
                  leer_elementos. Revisa este repositorio (arquitectura, dependencias y
                  documentación, sin datos sensibles) y propón actualizar sus especificaciones con
                  proponer_cambios».
                </p>
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <div className="proposal-sound-options">
            <label className="checkbox proposal-sound-control">
              <input
                type="checkbox"
                checked={proposalSoundEnabled}
                onChange={toggleProposalSound}
              />
              Sonido al recibir propuestas nuevas
            </label>
            <Button onClick={playProposalSound}>Probar sonido</Button>
          </div>
          {!pending.length && !asvsPending.length && (
            <Empty title="Todo revisado">
              Las propuestas de tus asistentes aparecerán aquí. Nunca se aplican automáticamente.
            </Empty>
          )}
          {pending.length > 0 && (
            <>
              <div className="proposals-global-bar">
                <div className="proposals-global-info">
                  <h3>Revisión de propuestas</h3>
                  <p>
                    {pending.length}{' '}
                    {pending.length === 1 ? 'propuesta pendiente' : 'propuestas pendientes'} en{' '}
                    {presentKinds.length}{' '}
                    {presentKinds.length === 1 ? 'tipo de registro' : 'tipos de registro'}.
                  </p>
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <Button
                    disabled={!acceptableGlobal.length}
                    onClick={() => selectReview(pending, 'todas las propuestas')}
                  >
                    <CheckCheck size={16} /> Aceptar todas las propuestas ({acceptableGlobal.length}
                    )
                  </Button>
                </div>
              </div>

              {presentKinds.map((kind) => {
                const proposalsForKind = pending.filter((p) => p.kind === kind);
                const proposalBatches: Proposal[][] = [];
                for (const proposal of proposalsForKind) {
                  const batch =
                    kind === 'task' && proposal.targetId
                      ? proposalBatches.find((items) => items[0].targetId === proposal.targetId)
                      : undefined;
                  if (batch) batch.push(proposal);
                  else proposalBatches.push([proposal]);
                }
                const acceptableForKind = planProposalReview(
                  proposalsForKind,
                  snapshot.records,
                ).ordered;
                const isTypeOpen = !!openTypes[kind];

                return (
                  <section className="proposal-group" key={kind}>
                    <div className="proposal-group-banner">
                      <button
                        type="button"
                        className="proposal-group-toggle"
                        aria-expanded={isTypeOpen}
                        onClick={() => toggleType(kind)}
                      >
                        <span className="toggle-icon">
                          {isTypeOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </span>
                        <div className="proposal-group-text">
                          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                            <strong>{kindSectionLabels[kind] || kind}</strong>
                            <Badge tone="blue">{proposalsForKind.length}</Badge>
                          </div>
                          <p className="proposal-group-desc">{kindDescriptions[kind]}</p>
                        </div>
                      </button>
                      <div className="proposal-group-actions">
                        <Button
                          variant="secondary"
                          disabled={!acceptableForKind.length}
                          onClick={() =>
                            selectReview(
                              proposalsForKind,
                              (kindSectionLabels[kind] || kind).toLowerCase(),
                            )
                          }
                        >
                          <CheckCheck size={14} /> Aceptar todas ({acceptableForKind.length})
                        </Button>
                      </div>
                    </div>

                    {isTypeOpen && (
                      <div className="proposal-group-content">
                        {proposalBatches.map((batch) => {
                          const asvsCount = completionAsvsIds(batch, snapshot).length;
                          const taskBatch = kind === 'task' && batch.length + asvsCount > 1;
                          const taskRecord = snapshot.records.find(
                            (record) => record.id === batch[0].targetId,
                          );
                          const batchPlan = taskBatch
                            ? planProposalReview(batch, snapshot.records)
                            : undefined;
                          const canAcceptBatch = batchPlan?.ordered.length === batch.length;
                          const checksCount = batch.filter((p) => p.operation === 'check').length;
                          const closuresCount = batch.filter(
                            (p) => p.patch.state === 'Completada',
                          ).length;
                          return (
                            <div
                              className={taskBatch ? 'proposal-task-batch' : 'proposal-single'}
                              key={batch[0].targetId || batch[0].id}
                            >
                              {taskBatch && (
                                <div className="proposal-task-batch-header">
                                  <div>
                                    <strong>{taskRecord?.title || 'Tarea'}</strong>
                                    <p>
                                      {batch.length + asvsCount} propuestas de esta tarea ·{' '}
                                      {checksCount}{' '}
                                      {checksCount === 1 ? 'verificación' : 'verificaciones'} ·{' '}
                                      {closuresCount} {closuresCount === 1 ? 'cierre' : 'cierres'}
                                      {asvsCount > 0 ? ` · ${asvsCount} verificaciones ASVS` : ''}
                                    </p>
                                  </div>
                                  <Button
                                    disabled={!canAcceptBatch}
                                    onClick={() => selectReview(batch, 'este lote de tarea')}
                                  >
                                    <CheckCheck size={16} /> Aceptar lote de esta tarea (
                                    {batch.length + asvsCount})
                                  </Button>
                                </div>
                              )}
                              {batch.map((p) => {
                                const original = snapshot.records.find((r) => r.id === p.targetId);
                                const conflict = hasConflict(p);
                                const reviewGroup = taskCompletionReviewGroup(p, pending);
                                const reviewGroupPlan = reviewGroup.length
                                  ? planProposalReview(reviewGroup, snapshot.records)
                                  : undefined;
                                const canAcceptGroup =
                                  reviewGroup.length > 1 &&
                                  reviewGroupPlan?.ordered.length === reviewGroup.length;
                                const canAccept = reviewGroup.length ? canAcceptGroup : !conflict;
                                const batchConflict = globalPlan.conflicts.get(p.id);
                                const requiresBatch = conflict && canAcceptGroup;
                                const acceptLabel = canAcceptGroup
                                  ? `Aceptar criterios y completar tarea (${reviewGroup.length})`
                                  : p.operation === 'delete'
                                    ? 'Aceptar eliminación'
                                    : 'Aceptar cambios';
                                const isProposalOpen = !!openProposals[p.id];
                                const proposalDescription =
                                  p.rationale ||
                                  (typeof p.patch.solution === 'string'
                                    ? p.patch.solution
                                    : typeof p.patch.description === 'string'
                                      ? p.patch.description
                                      : 'Propuesta de cambios');

                                return (
                                  <article
                                    className="proposal proposal-card"
                                    id={`proposal-${p.id}`}
                                    key={p.id}
                                  >
                                    <div className="proposal-banner">
                                      <button
                                        type="button"
                                        className="proposal-banner-toggle"
                                        aria-expanded={isProposalOpen}
                                        onClick={() => toggleProposal(p.id)}
                                      >
                                        <span className="toggle-icon">
                                          {isProposalOpen ? (
                                            <ChevronDown size={16} />
                                          ) : (
                                            <ChevronRight size={16} />
                                          )}
                                        </span>
                                        <div className="proposal-banner-text">
                                          <div
                                            className="row spread"
                                            style={{
                                              alignItems: 'center',
                                              gap: 8,
                                              marginBottom: 2,
                                            }}
                                          >
                                            <strong className="proposal-title">
                                              {String(
                                                p.patch.title ||
                                                  original?.title ||
                                                  'Nueva propuesta',
                                              )}
                                            </strong>
                                            <div
                                              className="row"
                                              style={{ gap: 6, alignItems: 'center' }}
                                            >
                                              <Badge tone="gray">
                                                {p.operation === 'create'
                                                  ? 'Creación'
                                                  : p.operation === 'check'
                                                    ? 'Verificación'
                                                    : p.operation === 'delete'
                                                      ? 'Eliminación'
                                                      : 'Actualización'}
                                              </Badge>
                                              <Badge>{names[p.provider]}</Badge>
                                            </div>
                                          </div>
                                          <p className="proposal-desc">{proposalDescription}</p>
                                        </div>
                                      </button>
                                      {(!taskBatch || !canAcceptBatch) && (
                                        <div className="proposal-banner-actions">
                                          <Button
                                            variant="secondary"
                                            disabled={!canAccept}
                                            onClick={() =>
                                              selectReview(
                                                reviewGroup.length > 1 ? reviewGroup : [p],
                                                acceptLabel.toLowerCase(),
                                              )
                                            }
                                          >
                                            <Check size={14} /> {acceptLabel}
                                          </Button>
                                        </div>
                                      )}
                                    </div>

                                    {isProposalOpen && (
                                      <div className="proposal-details">
                                        {batchConflict && (
                                          <p className="muted">
                                            Aceptación en lote: {batchConflict}
                                          </p>
                                        )}
                                        {requiresBatch && (
                                          <p className="muted">
                                            Esta verificación se aceptará junto con el cierre de la
                                            tarea.
                                          </p>
                                        )}
                                        {p.operation === 'delete' && (
                                          <Notice error>
                                            {original?.kind === 'task' && original.recurrence
                                              ? 'Al aceptar se cancela esta aparición de la serie.'
                                              : 'Al aceptar, el registro y su historial se eliminan definitivamente, como al borrarlo desde su editor.'}
                                          </Notice>
                                        )}
                                        <dl className="diff">
                                          {proposalChanges(p, original).map((change) => (
                                            <div key={change.field}>
                                              <dt>
                                                {previewField(change.field, snapshot.records)}
                                              </dt>
                                              <dd>
                                                <ChangeValue
                                                  change={change}
                                                  kind={p.kind}
                                                  showBefore={p.operation !== 'create'}
                                                  records={snapshot.records}
                                                />
                                              </dd>
                                            </div>
                                          ))}
                                        </dl>
                                        {conflict && !canAcceptGroup && (
                                          <Notice error>
                                            El original ha cambiado. Rechaza esta propuesta y
                                            solicita otra sobre un registro actualizado.
                                          </Notice>
                                        )}
                                        <div className="row" style={{ marginTop: 12 }}>
                                          {(!taskBatch || !canAcceptBatch) && (
                                            <Button
                                              disabled={!canAccept}
                                              onClick={() =>
                                                selectReview(
                                                  reviewGroup.length > 1 ? reviewGroup : [p],
                                                  acceptLabel.toLowerCase(),
                                                )
                                              }
                                            >
                                              <Check size={16} /> {acceptLabel}
                                            </Button>
                                          )}
                                          <Button
                                            variant="secondary"
                                            onClick={() => void rejectOne(p.id)}
                                          >
                                            <X size={16} /> Rechazar
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              <p className="muted">
                Los cambios aceptados se pueden deshacer desde el historial del registro. Las
                creaciones se conservan para mantener sus referencias. Las eliminaciones aceptadas
                no se pueden deshacer.
              </p>
            </>
          )}
        </>
      )}
      {error && <Notice error>{error}</Notice>}
      {activeTab === 'proposals' && asvsPending.length > 0 && (
        <Suspense fallback={<p>Cargando propuestas ASVS…</p>}>
          <AsvsProposals snapshot={snapshot} refresh={refresh} focusProposalId={focusProposalId} />
        </Suspense>
      )}
      {message && <Notice>{message}</Notice>}
      {reviewSelection &&
        (() => {
          const preview = batchPreview(reviewSelection.proposals, snapshot.records);
          return (
            <div className="proposal-preview-backdrop" role="presentation">
              <section
                className="proposal-preview-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Vista previa de aceptación"
              >
                <h3>Antes de aceptar {reviewSelection.label}</h3>
                <p>
                  {preview.ordered.length + reviewSelection.asvsIds.length}{' '}
                  {preview.ordered.length + reviewSelection.asvsIds.length === 1
                    ? 'propuesta compatible cambiará'
                    : 'propuestas compatibles cambiarán'}{' '}
                  {preview.groups.length} {preview.groups.length === 1 ? 'registro' : 'registros'}.
                </p>
                {preview.conflicts.size > 0 && (
                  <Notice error>
                    {reviewSelection.proposals
                      .filter((proposal) => preview.conflicts.has(proposal.id))
                      .map((proposal) => (
                        <p key={proposal.id}>
                          {String(
                            proposal.patch.title ||
                              snapshot.records.find((record) => record.id === proposal.targetId)
                                ?.title ||
                              'Propuesta',
                          )}
                          : {preview.conflicts.get(proposal.id)}
                        </p>
                      ))}
                  </Notice>
                )}
                <div className="proposal-preview-records">
                  {reviewSelection.proposals
                    .filter(
                      (p) => asvsEnabled && p.kind === 'task' && p.patch.state === 'Completada',
                    )
                    .map((closure) => {
                      const task = snapshot.records.find(
                        (r) => r.kind === 'task' && r.id === closure.targetId,
                      );
                      if (!task || task.kind !== 'task') return null;
                      return (task.asvsLinks ?? [])
                        .filter(
                          (link) =>
                            !reviewSelection.asvsIds.some((id) =>
                              snapshot.asvs?.proposals?.some(
                                (p) =>
                                  p.id === id &&
                                  p.request.taskId === task.id &&
                                  p.before.reqId === link.reqId,
                              ),
                            ),
                        )
                        .map((link) => {
                          const current = snapshot.asvs?.taskVerifications?.find(
                            (a) => a.taskId === task.id && a.reqId === link.reqId,
                          );
                          return (
                            <section key={`${task.id}:${link.reqId}`}>
                              <strong>
                                {link.reqId} · {link.mandatory ? 'Obligatorio' : 'Informativo'}
                              </strong>
                              <p>
                                Verificación registrada: {current?.state ?? 'Pendiente'} ·{' '}
                                {link.criterion}
                              </p>
                              <p>
                                Evidencias:{' '}
                                {current?.evidence
                                  .map((e) => `${e.reference} (${e.revision})`)
                                  .join('; ') || 'Sin evidencia'}
                              </p>
                              <p>La vigencia se comprueba contra el cierre final.</p>
                            </section>
                          );
                        });
                    })}
                  {reviewSelection.asvsIds.map((id) => {
                    const proposal = snapshot.asvs?.proposals?.find((p) => p.id === id);
                    if (!proposal) return null;
                    return (
                      <section
                        key={id}
                        aria-label={`Verificación ASVS del cierre ${proposal.reference}`}
                      >
                        <strong>Verificación ASVS de la tarea</strong>
                        <Suspense fallback={<p>{proposal.reference}</p>}>
                          <AsvsProposalChange proposal={proposal} snapshot={snapshot} />
                        </Suspense>
                      </section>
                    );
                  })}
                  {reviewSelection.proposals
                    .filter(
                      (p) => asvsEnabled && p.kind === 'task' && Array.isArray(p.patch.asvsLinks),
                    )
                    .map((proposal) => (
                      <Suspense key={proposal.id} fallback={<p>Cargando asociaciones ASVS…</p>}>
                        <AsvsTaskProposalInfo proposal={proposal} snapshot={snapshot} />
                      </Suspense>
                    ))}
                  {preview.groups.map((group, index) => (
                    <section key={index}>
                      <strong>{group.title}</strong>
                      <dl className="diff">
                        {group.changes.map((change) => (
                          <div key={change.field}>
                            <dt>{previewField(change.field, snapshot.records)}</dt>
                            <dd>
                              <ChangeValue
                                change={change}
                                kind={group.kind}
                                showBefore={change.before !== undefined}
                                records={snapshot.records}
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <Button disabled={!preview.ordered.length} onClick={() => void confirmReview()}>
                    Aceptar {preview.ordered.length + reviewSelection.asvsIds.length}{' '}
                    {preview.ordered.length + reviewSelection.asvsIds.length === 1
                      ? 'propuesta'
                      : 'propuestas'}
                  </Button>
                  <Button variant="secondary" onClick={() => setReviewSelection(null)}>
                    Volver
                  </Button>
                </div>
              </section>
            </div>
          );
        })()}
    </div>
  );
}
