import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { PRIORITIES } from '../shared/model.js';
import { TASK_QUALITY_CATEGORIES } from '../shared/taskQuality.js';
import { asvsRemediationInput } from './asvs/remediation.js';
import { sourceRevisionInput } from './asvs/tracking.js';
import {
  asvsQueryInput,
  asvsReadInput,
  asvsProposeInput,
  asvsTaskProposeInput,
} from './asvs/mcp.js';

/**
 * One connector function: published as an MCP tool and callable from `ejecutar_codigo` under
 * the same name. `input` is a copy for clients; the service validates again with `.strict()`.
 * `output` documents the main response fields for code mode; it is not published to clients.
 */
export interface McpToolSpec {
  name: string;
  action: string;
  title: string;
  description: string;
  input: ZodRawShape;
  output: ZodTypeAny;
  annotations: ToolAnnotations;
  /** Only available while ASVS is active in the notebook. */
  asvs?: true;
  /** Creates a proposal or closes a task; counted against the code-mode write limit. */
  write?: true;
  mapInput?: (input: Record<string, unknown>) => Record<string, unknown>;
}

const readableKinds = z.enum([
  'task',
  'entry',
  'incident',
  'idea',
  'practice',
  'decision',
  'meeting',
  'project',
  'subproject',
  'objective',
]);
const proposalKinds = z.enum([
  'task',
  'entry',
  'incident',
  'idea',
  'practice',
  'decision',
  'meeting',
  'project',
]);
const taskStates = z.enum(['Por hacer', 'En curso', 'En revisión', 'Completada']);
const read = { readOnlyHint: true, openWorldHint: false } satisfies ToolAnnotations;
const proposal = {
  idempotentHint: true,
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

// Response shapes, taken from the `Domain` return values; `passthrough` keeps them open.
const nextOffset = z.number().int().nullable();
const record = {
  id: z.string(),
  kind: readableKinds,
  version: z.number().int(),
  title: z.string(),
};
const page = (item: ZodTypeAny, extra: ZodRawShape = {}) =>
  z.object({ ...extra, items: z.array(item), nextOffset }).passthrough();
/** ASVS context added to record pages while ASVS is active. */
const asvsContext = { asvs: z.record(z.unknown()).optional() };
const readPage = page(
  z
    .object({
      ...record,
      fields: z.record(z.unknown()).optional(),
      excerpt: z.string().optional(),
    })
    .passthrough(),
  { ...asvsContext, nextExcerptOffset: z.number().int().optional() },
);
const proposalResult = z
  .object({ id: z.string(), status: z.enum(['pending', 'accepted', 'rejected']) })
  .passthrough();
const asvsConfig = z.record(z.unknown()).nullable();

export const MCP_TOOLS: McpToolSpec[] = [
  {
    name: 'estado_sesion',
    action: 'session',
    title: 'Estado de la sesión',
    description:
      'Comprueba la sesión: proveedor, caducidad, aviso de bloqueo por inactividad, proyectos y ámbitos autorizados. Llámala al empezar; no lee registros.',
    input: {},
    output: z
      .object({
        connected: z.boolean(),
        provider: z.string(),
        scope: z.string(),
        expiresAt: z.string(),
        expiresInMinutes: z.number(),
        canCompleteTasks: z.boolean(),
        asvs: z.object({ enabled: z.boolean(), guidance: z.string().optional() }),
        projects: z.array(z.object({ id: z.string(), title: z.string() })),
        scopes: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
        idleLockAt: z.string().nullable(),
        idleLockInMinutes: z.number().nullable(),
      })
      .passthrough(),
    annotations: read,
  },
  {
    name: 'buscar_contexto',
    action: 'context',
    title: 'Buscar registros',
    description:
      'Busca registros autorizados por texto o tipo. Devuelve solo ID, tipo, versión y título; lee el contenido con leer_elementos.',
    input: {
      query: z.string().max(200).optional(),
      kind: readableKinds.optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    output: page(z.object(record).passthrough()),
    annotations: read,
  },
  {
    name: 'leer_elementos',
    action: 'read',
    title: 'Leer registros',
    description:
      'Lee hasta 10 registros por ID. Si aparece nextExcerptOffset, continúa ese registro con un solo ID y excerptOffset.',
    input: {
      recordIds: z.array(z.string()).min(1).max(10),
      offset: z.number().int().min(0).optional(),
      excerptOffset: z.number().int().min(0).optional(),
    },
    output: readPage,
    annotations: read,
  },
  {
    name: 'consultar_criterios',
    action: 'criteria',
    title: 'Criterios de una tarea',
    description:
      'Prácticas asociadas a una tarea. Consúltalas antes y después de trabajar en ella.',
    input: { taskId: z.string(), offset: z.number().int().min(0).optional() },
    output: readPage,
    annotations: read,
  },
  {
    name: 'filtrar_registros',
    action: 'filter',
    title: 'Filtrar registros',
    description:
      'Filtra metadatos por proyecto, ámbito (subprojectId o general), tipo, fechas y, en tareas, estado o prioridad.',
    input: {
      kind: readableKinds.optional(),
      projectId: z.string().optional(),
      subprojectId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      state: taskStates.optional(),
      priority: z.enum(PRIORITIES).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    output: page(
      z
        .object({
          ...record,
          projectId: z.string(),
          subprojectId: z.string().optional(),
          due: z.string().optional(),
          state: taskStates.optional(),
          priority: z.enum(PRIORITIES).optional(),
          date: z.string().optional(),
        })
        .passthrough(),
    ),
    annotations: read,
  },
  {
    name: 'resumir_proyecto',
    action: 'summary',
    title: 'Resumen del proyecto',
    description: 'Recuentos por tipo y estado y tareas vencidas de un proyecto, sin textos.',
    input: { projectId: z.string() },
    output: z
      .object({
        project: z.object({ id: z.string(), title: z.string(), version: z.number().int() }),
        counts: z.record(z.number()),
        taskStates: z.record(z.number()),
        overdueTasks: z.number(),
      })
      .passthrough(),
    annotations: read,
  },
  {
    name: 'diagnosticar_tareas',
    action: 'task-quality',
    title: 'Diagnóstico de tareas',
    description:
      'Problemas de calidad de las tareas abiertas: recuentos por categoría y una página con ID, título y motivo.',
    input: {
      projectId: z.string().optional(),
      category: z.enum(TASK_QUALITY_CATEGORIES).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    output: page(
      z
        .object({
          id: z.string(),
          title: z.string(),
          version: z.number().int(),
          category: z.enum(TASK_QUALITY_CATEGORIES),
          reason: z.string(),
        })
        .passthrough(),
      { counts: z.record(z.number()) },
    ),
    annotations: read,
  },
  {
    name: 'consultar_relaciones',
    action: 'relations',
    title: 'Relaciones de un registro',
    description:
      'Registros vinculados a uno dado, en ambos sentidos, con el tipo de relación (dependency, criterion, link, source u objective).',
    input: {
      recordId: z.string(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    output: page(
      z
        .object({
          ...record,
          direction: z.enum(['outgoing', 'incoming']),
          relation: z.enum(['dependency', 'criterion', 'link', 'source', 'objective']),
          role: z.string().optional(),
        })
        .passthrough(),
    ),
    annotations: read,
  },
  {
    name: 'planificar_remediacion_asvs',
    action: 'asvs-remediation',
    title: 'Plan de remediación ASVS',
    description:
      'Lagunas ASVS del nivel objetivo con acción recomendada, tareas existentes y propuestas propias. No crea trabajo ni certifica.',
    input: asvsRemediationInput.shape,
    output: page(
      z
        .object({
          reference: z.string(),
          reqId: z.string(),
          category: z.string(),
          action: z.string(),
          actionGuidance: z.string(),
          existingTasks: z.array(z.record(z.unknown())),
        })
        .passthrough(),
      { config: asvsConfig, total: z.number(), guidance: z.string() },
    ),
    annotations: read,
    asvs: true,
  },
  {
    name: 'proponer_revision_asvs',
    action: 'asvs-revision-propose',
    title: 'Proponer revisión de fuente ASVS',
    description:
      'Señala para confirmación humana una nueva revisión de una fuente externa usada como evidencia ASVS.',
    input: sourceRevisionInput.shape,
    output: proposalResult,
    annotations: { readOnlyHint: false, openWorldHint: false },
    asvs: true,
    write: true,
  },
  {
    name: 'consultar_asvs',
    action: 'asvs-query',
    title: 'Consultar ASVS',
    description:
      'Configuración, recuentos y metadatos ASVS filtrables y paginados; cobertura y capítulos solo con offset 0. Sin textos: usa leer_referencias_asvs.',
    input: asvsQueryInput.shape,
    output: page(
      z
        .object({
          reference: z.string(),
          reqId: z.string(),
          minLevel: z.number(),
          state: z.string(),
          applicability: z.string(),
          pendingProposalCount: z.number(),
        })
        .passthrough(),
      {
        config: asvsConfig,
        catalogVersion: z.string(),
        total: z.number(),
        counts: z.record(z.number()),
      },
    ),
    annotations: read,
    asvs: true,
  },
  {
    name: 'leer_referencias_asvs',
    action: 'asvs-read',
    title: 'Leer requisitos ASVS',
    description:
      'Texto oficial, traducción de ayuda (es), evaluación, tareas y acción recomendada (next) de hasta limit requisitos. taskOffset y proposalOffset continúan la referencia de offset.',
    input: asvsReadInput.shape,
    output: page(
      z
        .object({
          reqId: z.string(),
          canonicalRef: z.string(),
          description: z.string(),
          es: z.unknown(),
          next: z.unknown(),
          evaluation: z.record(z.unknown()).nullable(),
        })
        .passthrough(),
    ),
    annotations: read,
    asvs: true,
  },
  {
    name: 'proponer_evaluacion_asvs',
    action: 'asvs-propose',
    title: 'Proponer evaluación ASVS',
    description:
      'Propone una evaluación ASVS global para revisión humana. Cumplido y No cumplido exigen evidencia; No aplicable solo pide una decisión humana.',
    input: asvsProposeInput.shape,
    output: proposalResult,
    annotations: proposal,
    asvs: true,
    write: true,
  },
  {
    name: 'proponer_cambios',
    action: 'propose',
    title: 'Proponer cambios',
    description:
      'Propone crear (task, entry, incident, idea, practice, decision, meeting), actualizar o verificar (check) un registro; queda pendiente de revisión humana. update y check exigen targetId y expectedVersion vigentes. Para crear o cerrar tareas sigue consultar_guia: criterios de aceptación, prácticas y verificaciones con evidencia.',
    input: {
      operation: z.enum(['create', 'update', 'check']),
      kind: proposalKinds,
      targetId: z.string().optional(),
      expectedVersion: z.number().int().optional(),
      patch: z.record(z.unknown()),
      rationale: z.string().max(2000),
    },
    output: proposalResult,
    annotations: proposal,
    write: true,
  },
  {
    name: 'proponer_eliminacion',
    action: 'propose',
    title: 'Proponer eliminación',
    description:
      'Propone eliminar un duplicado, un registro obsoleto o uno que la persona pidió retirar; nada se borra hasta que lo acepta. Exige targetId, expectedVersion y motivo.',
    input: {
      kind: z.enum(['task', 'entry', 'incident', 'idea', 'practice', 'decision', 'meeting']),
      targetId: z.string(),
      expectedVersion: z.number().int(),
      rationale: z.string().min(1).max(2000),
    },
    output: proposalResult,
    annotations: { ...proposal, destructiveHint: true },
    write: true,
    mapInput: (input) => ({ ...input, operation: 'delete', patch: {} }),
  },
  {
    name: 'consultar_propuestas',
    action: 'proposals',
    title: 'Mis propuestas',
    description:
      'Tus propuestas con estado, tipo, operación, destino y título; filtra por status o targetId y pagina con offset.',
    input: {
      status: z.enum(['pending', 'accepted', 'rejected']).optional(),
      targetId: z.string().optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    output: page(
      z
        .object({
          id: z.string(),
          status: z.enum(['pending', 'accepted', 'rejected']),
          createdAt: z.string(),
          kind: z.string(),
          operation: z.string(),
          targetId: z.string().optional(),
          title: z.string().optional(),
        })
        .passthrough(),
    ),
    annotations: read,
  },
  {
    name: 'completar_tarea',
    action: 'complete-task',
    title: 'Completar tarea',
    description:
      'Con permiso de cierre en la sesión, acepta juntas tus propuestas de verificación y cierre de una tarea. Sin permiso quedan para revisión humana.',
    input: {
      taskId: z.string(),
      closureId: z.string(),
      checkIds: z.array(z.string()).max(100),
      asvsIds: z.array(z.string()).max(50).optional(),
    },
    // The accepted proposals, in the order they were applied.
    output: z.array(z.record(z.unknown())),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    write: true,
  },
  {
    name: 'consultar_criterios_asvs',
    action: 'asvs-task-criteria',
    title: 'Criterios ASVS de una tarea',
    description:
      'Asociaciones ASVS de una tarea con sus verificaciones, versiones y evidencia. Úsalo antes de planificar y al terminar.',
    input: {
      taskId: z.string().uuid(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    output: page(
      z
        .object({
          link: z.record(z.unknown()),
          assessment: z.record(z.unknown()).nullable(),
          expectedVersion: z.number().int(),
        })
        .passthrough(),
      { taskId: z.string(), taskVersion: z.number().int() },
    ),
    annotations: read,
    asvs: true,
  },
  {
    name: 'proponer_verificacion_asvs',
    action: 'asvs-task-propose',
    title: 'Proponer verificación ASVS',
    description:
      'Propone la verificación ASVS de una tarea, no la evaluación global. Cumplido y No cumplido exigen evidencia; no admite No aplicable.',
    input: asvsTaskProposeInput.shape,
    output: proposalResult,
    annotations: proposal,
    asvs: true,
    write: true,
  },
];
