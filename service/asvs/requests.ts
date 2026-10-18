import { z } from 'zod';
import { ASVS_STATES } from '../../shared/asvsTracking.js';

const text = z.string().max(16000);
const short = z.string().max(240);
const nonempty = short.trim().min(1);
const version = z.number().int().nonnegative().safe();
export const asvsReferenceInput = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    if (!/^[a-z]+:\/\//i.test(value)) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, 'Referencia externa no válida o con credenciales.');
export const asvsReviewInput = z
  .object({
    projectId: nonempty,
    targetId: z.string().uuid(),
    expectedVersion: version,
    expectedConfigVersion: version,
    state: z.enum(ASVS_STATES),
    applicability: z.enum(['Por determinar', 'Aplicable', 'No aplicable']),
    scope: z.enum(['project', 'component', 'task']),
    scopeDetail: text,
    pendingScope: text,
    taskId: nonempty.optional(),
    expectedTaskVersion: version.optional(),
    note: text,
    method: short,
    responsible: short,
    evidence: z
      .array(
        z
          .object({
            recordId: nonempty.optional(),
            reference: asvsReferenceInput,
            revision: nonempty,
          })
          .strict(),
      )
      .max(30),
    decision: z
      .object({
        approved: z.literal(true),
        reason: text.trim().min(1),
        reference: asvsReferenceInput,
        responsible: nonempty,
      })
      .strict()
      .optional(),
  })
  .strict();
