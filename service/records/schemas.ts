import { z } from 'zod';
import { attachmentInputSchema, MAX_ATTACHMENTS } from './attachments.js';
import { asvsTaskLinkSchema } from '../asvs/links.js';
import {
  CATEGORIES,
  PHASES,
  STATES,
  CHECK_STATES,
  PRACTICE_STATES,
  PRIORITIES,
  SUBPROJECT_STATES,
  MAX_NEW_TASK_DEPENDENCIES,
  validDay,
} from '../../shared/model.js';

export const text = z.string().max(16000);
export const short = z.string().max(240);
const day = z.string().refine((v) => !v || validDay(v), 'Fecha inválida');
const fields = { title: short.min(1), project: short };
// Work records may belong to a subproject; project and subproject records may not.
const scoped = { ...fields, subprojectId: short.optional() };
const checkSchema = z
  .object({
    practiceId: short,
    practiceVersion: z.number().int().positive(),
    title: short,
    explanation: text,
    source: text,
    mandatory: z.boolean(),
    state: z.enum(CHECK_STATES),
    note: text,
    authorization: text,
    exceptionReason: text,
  })
  .strict();
export const schemas = {
  task: z
    .object({
      ...scoped,
      kind: z.literal('task'),
      attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).optional(),
      phase: z.enum(PHASES),
      type: short,
      tags: z.array(short).max(30),
      priority: z.enum(PRIORITIES),
      state: z.enum(STATES),
      due: day.refine(Boolean, 'Asigna un día a la tarea.'),
      blocked: text,
      nextStep: text,
      description: text,
      solution: text,
      dependencyIds: z.array(short).max(50),
      checks: z.array(checkSchema).max(200),
      asvsLinks: z.array(asvsTaskLinkSchema).max(50).optional(),
      completedAt: z.string().optional(),
      recurrence: z
        .object({
          seriesId: short,
          occurrenceDate: day.refine(Boolean),
          canceledAt: z.string().optional(),
          cancellationReason: z.enum(['rule', 'manual']).optional(),
          overriddenFields: z.array(short),
        })
        .strict()
        .optional(),
    })
    .strict(),
  entry: z
    .object({
      ...scoped,
      kind: z.literal('entry'),
      daily: z.boolean().optional(),
      date: day.refine(Boolean),
      taskIds: z.array(short).max(50),
      linkedIds: z.array(short).max(100).optional(),
      activity: text,
      result: text,
      learning: text,
      nextStep: text,
      blocker: text,
      competency: text,
      evidence: text,
      original: text,
      contribution: z.enum(['Investigué', 'Propuse', 'Implementé', 'Validé']),
    })
    .strict(),
  incident: z
    .object({
      ...scoped,
      kind: z.literal('incident'),
      attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).optional(),
      date: day.refine(Boolean),
      description: text,
      solution: text,
      resolvedDate: day,
    })
    .strict(),
  idea: z
    .object({
      ...scoped,
      kind: z.literal('idea'),
      attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).optional(),
      date: day.refine(Boolean),
      description: text,
    })
    .strict(),
  practice: z
    .object({
      ...scoped,
      kind: z.literal('practice'),
      category: z.enum(CATEGORIES),
      explanation: text,
      source: text,
      owner: short,
      status: z.enum(PRACTICE_STATES),
      mandatory: z.boolean(),
      pinned: z.boolean(),
      phases: z.array(z.enum(PHASES)).max(5),
      tags: z.array(short).max(30),
    })
    .strict(),
  decision: z
    .object({
      ...scoped,
      kind: z.literal('decision'),
      attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).optional(),
      date: day.refine(Boolean),
      problem: text,
      alternatives: text,
      decision: text,
      reason: text,
      consequences: text,
      evidence: text,
    })
    .strict(),
  meeting: z
    .object({
      ...scoped,
      kind: z.literal('meeting'),
      attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).optional(),
      from: z.string().datetime(),
      to: z.string().datetime(),
      body: text,
      agreements: text,
      agreementItems: z
        .array(
          z
            .object({
              id: short.optional(),
              text: text.min(1),
              requiresFollowUp: z.boolean(),
              followUpTaskId: short.optional(),
            })
            .strict(),
        )
        .max(100)
        .optional(),
      sourceIds: z.array(short).max(1000),
      closedAt: z.string().datetime().optional(),
    })
    .strict(),
  project: z
    .object({
      ...fields,
      kind: z.literal('project'),
      objective: text,
      specifications: text.default(''),
      competency: text,
      tutor: short,
      validationDate: day,
      validationReference: text,
    })
    .strict(),
  subproject: z
    .object({
      ...fields,
      kind: z.literal('subproject'),
      title: short.trim().min(1),
      description: text.default(''),
      status: z.enum(SUBPROJECT_STATES),
      archivedAt: z.string().datetime().optional(),
    })
    .strict(),
  objective: z
    .object({
      ...scoped,
      kind: z.literal('objective'),
      description: text,
      links: z
        .array(
          z
            .object({
              id: short.optional(),
              sourceKind: z.enum(['task', 'entry']),
              sourceId: short,
              role: z.enum(['trabajo', 'resultado', 'evidencia']),
              reference: text,
            })
            .strict(),
        )
        .max(200),
      validation: z
        .object({
          state: z.enum(['Pendiente', 'Validado']),
          date: day,
          reference: text,
          responsible: short,
          linkIds: z.array(short).max(200),
        })
        .strict(),
    })
    .strict(),
};
export const proposalSchema = z
  .object({
    operation: z.enum(['create', 'update', 'check', 'delete']),
    kind: z.enum([
      'task',
      'entry',
      'incident',
      'idea',
      'practice',
      'decision',
      'meeting',
      'project',
    ]),
    targetId: short.optional(),
    expectedVersion: z.number().int().positive().optional(),
    patch: z.record(z.unknown()),
    rationale: z.string().max(2000),
  })
  .strict();
export const taskLinksSchema = z
  .object({
    newDependencies: z
      .array(
        z
          .object({
            title: short.trim().min(1, 'Escribe el título de la tarea previa.'),
            due: day.refine(Boolean, 'Asigna un día a la tarea previa.'),
            priority: z.enum(PRIORITIES),
          })
          .strict(),
      )
      .max(MAX_NEW_TASK_DEPENDENCIES)
      .default([]),
    blocks: z
      .array(z.object({ id: short, expectedVersion: z.number().int().positive() }).strict())
      .max(50)
      .default([]),
  })
  .strict();
