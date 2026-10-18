import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import { compareAsvsCatalogs } from '../../shared/asvsCoverage.js';
import type { GrantInfo, Snapshot } from '../../shared/model.js';
import type { AsvsCatalogMapping, AsvsRevisionProposal } from '../../shared/asvsTracking.js';
import {
  appendAsvsHistory,
  assertAsvsProject,
  asvsCatalogBaseline,
  asvsOverview,
  catalogMappingSchema,
  configureAsvs,
  sourceRevisionInput,
} from './tracking.js';

export function signalAsvsRevision(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = sourceRevisionInput.parse(input);
  assertAsvsProject(state, request.projectId, activeProjectId);
  const data = state.asvs;
  if (!data || data.config.version !== request.expectedConfigVersion)
    throw Error('La configuración ASVS ha cambiado.');
  const before = data.sourceRevisions?.find((r) => r.reference === request.reference) ?? null;
  if ((before?.version ?? 0) !== request.expectedVersion)
    throw Error('La revisión externa ha cambiado.');
  const referenced = [...data.assessments, ...(data.taskVerifications ?? [])].some((a) =>
    a.evidence.some((e) => !e.recordId && e.reference === request.reference),
  );
  if (!referenced) throw Error('La referencia no respalda una evaluación del cuaderno.');
  if (before?.revision === request.revision) throw Error('Indica una revisión externa distinta.');
  const after = {
    projectId: request.projectId,
    catalogVersion: data.config.catalogVersion,
    reference: request.reference,
    revision: request.revision,
    version: (before?.version ?? 0) + 1,
    reason: request.reason,
    at: new Date().toISOString(),
  };
  const sources = (data.sourceRevisions ??= []);
  if (before) sources[sources.indexOf(before)] = after;
  else sources.push(after);
  appendAsvsHistory(data, { kind: 'source-revision', before, after });
  return asvsOverview(state, { projectId: request.projectId }, activeProjectId);
}

export function authorizeAsvsProject(state: Snapshot, grant: GrantInfo, projectId: string) {
  if (Date.parse(grant.expiresAt) <= Date.now()) throw Error('Sesión MCP caducada.');
  if (grant.scope !== 'projects' || !grant.projectIds.includes(projectId))
    throw Error('ASVS requiere una sesión de proyecto autorizada.');
  assertAsvsProject(state, projectId);
}

export function proposeAsvsRevision(state: Snapshot, grant: GrantInfo, input: unknown) {
  const request = sourceRevisionInput.parse(input);
  authorizeAsvsProject(state, grant, request.projectId);
  signalAsvsRevision(structuredClone(state), request);
  const proposals = (state.asvs!.revisionProposals ??= []);
  const duplicate = proposals.find(
    (p) =>
      p.status === 'pending' &&
      p.provider === grant.provider &&
      JSON.stringify(p.request) === JSON.stringify(request),
  );
  if (duplicate) return { id: duplicate.id, status: duplicate.status };
  const proposal: AsvsRevisionProposal = {
    id: randomUUID(),
    provider: grant.provider,
    request,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  proposals.unshift(proposal);
  return { id: proposal.id, status: proposal.status };
}

export function reviewAsvsRevision(state: Snapshot, input: unknown, activeProjectId?: string) {
  const { id, accept } = z
    .object({ id: z.string().uuid(), accept: z.boolean() })
    .strict()
    .parse(input);
  const proposal = state.asvs?.revisionProposals?.find(
    (p) => p.id === id && p.status === 'pending',
  );
  if (!proposal) throw Error('Propuesta de revisión externa no disponible.');
  assertAsvsProject(state, proposal.request.projectId, activeProjectId);
  if (accept) signalAsvsRevision(state, proposal.request, activeProjectId);
  proposal.status = accept ? 'accepted' : 'rejected';
  return asvsOverview(state, { projectId: proposal.request.projectId }, activeProjectId);
}

const catalogInput = z
  .object({
    projectId: z.string().trim().min(1).max(240),
    expectedConfigVersion: z.number().int().nonnegative().safe(),
    catalogVersion: z.literal(asvsCatalog.version),
  })
  .strict();

export function previewAsvsCatalog(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = catalogInput.parse(input);
  assertAsvsProject(state, request.projectId, activeProjectId);
  const config = state.asvs?.config;
  if (!config || config.version !== request.expectedConfigVersion)
    throw Error('La configuración ASVS ha cambiado.');
  if (config.catalogVersion === asvsCatalog.version)
    throw Error('El catálogo ya está actualizado.');
  if (!config.catalogBaseline)
    throw Error(
      'Falta la base del catálogo anterior. Usa una versión compatible para registrarla antes de actualizar.',
    );
  const diff = compareAsvsCatalogs(config.catalogBaseline, asvsCatalogBaseline());
  // Any change to accepted evaluations, evidence, tasks or pending proposals invalidates confirmation.
  const previewToken = createHash('sha256')
    .update(JSON.stringify([state.asvs, state.records]))
    .digest('hex');
  return { fromVersion: config.catalogVersion, toVersion: asvsCatalog.version, diff, previewToken };
}

export function updateAsvsCatalog(state: Snapshot, input: unknown, activeProjectId?: string) {
  const request = catalogInput
    .extend({
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      confirmed: z.literal(true),
      mappings: z.array(catalogMappingSchema).max(50),
    })
    .strict()
    .parse(input);
  const { previewToken, confirmed, mappings, ...base } = request;
  const preview = previewAsvsCatalog(state, base, activeProjectId);
  if (previewToken !== preview.previewToken)
    throw Error('La vista previa del catálogo ha cambiado. Revísala de nuevo.');
  const data = state.asvs!;
  const before = structuredClone(data.config);
  const oldIds = new Set(before.catalogBaseline!.map((r) => r.reqId));
  const newIds = new Set(asvsCatalog.requirements.map((r) => r.reqId));
  const fromIds = new Set<string>();
  const toIds = new Set<string>();
  for (const mapping of mappings) {
    if (
      !oldIds.has(mapping.from) ||
      !newIds.has(mapping.to) ||
      fromIds.has(mapping.from) ||
      toIds.has(mapping.to)
    )
      throw Error('Correspondencia de catálogo inválida o repetida.');
    fromIds.add(mapping.from);
    toIds.add(mapping.to);
  }
  // Start a new evaluation context. Matching numbers or human mappings never transfer ticks.
  data.config = {
    ...before,
    catalogVersion: asvsCatalog.version,
    catalogSha256: asvsCatalog.sourceSha256,
  };
  const historyLength = data.history.length;
  configureAsvs(
    state,
    {
      ...base,
      level: before.level,
      contextReason: `Actualización humana de ASVS ${before.catalogVersion} a ${asvsCatalog.version}; reevaluar alcance y evidencias.`,
    },
    activeProjectId,
  );
  data.history[historyLength] = {
    id: randomUUID(),
    projectId: request.projectId,
    at: new Date().toISOString(),
    actor: 'Tú',
    kind: 'catalog',
    before,
    after: structuredClone(data.config),
    diff: preview.diff,
    mappings: mappings as AsvsCatalogMapping[],
  };
  return asvsOverview(state, { projectId: request.projectId }, activeProjectId);
}
