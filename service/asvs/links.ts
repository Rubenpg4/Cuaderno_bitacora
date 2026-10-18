import { z } from 'zod';
import { ASVS_VERSION, parseAsvsReference, resolveAsvsReference } from '../../shared/asvs.js';
import { asvsCatalog } from '../../shared/asvsCatalog.js';
import type { AsvsTaskLink } from '../../shared/asvsTracking.js';
import type { Snapshot, Task } from '../../shared/model.js';

const detail = z.string().trim().min(1).max(16000);
export const asvsTaskLinkSchema = z
  .object({
    catalogVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    reqId: z.string().min(1).max(240),
    reason: detail,
    scope: detail,
    criterion: detail,
    method: detail,
    mandatory: z.boolean().optional(),
  })
  .strict();

export function validateTaskLinks(
  state: Snapshot,
  task: Task,
  restoring = false,
): AsvsTaskLink[] | undefined {
  if (task.asvsLinks === undefined) return;
  const links = z.array(asvsTaskLinkSchema).max(50).parse(task.asvsLinks);
  if (!links.length) return [];
  if (!state.asvs || state.asvs.config.projectId !== task.project)
    throw Error('Configura ASVS en el cuaderno antes de asociar requisitos.');
  const keys = new Set<string>();
  return links.map((link) => {
    if (link.catalogVersion !== ASVS_VERSION) {
      const previous = state.records.find((r): r is Task => r.kind === 'task' && r.id === task.id);
      const historic =
        (state.asvs!.config.catalogVersion === link.catalogVersion &&
          state.asvs!.config.catalogBaseline?.some((r) => r.reqId === link.reqId)) ||
        state.asvs!.history.some(
          (h) =>
            h.kind === 'catalog' &&
            h.before.catalogVersion === link.catalogVersion &&
            h.before.catalogBaseline?.some((r) => r.reqId === link.reqId),
        );
      if (
        !historic ||
        !parseAsvsReference(link.reqId, link.catalogVersion) ||
        (!restoring &&
          !previous?.asvsLinks?.some((l) => JSON.stringify(l) === JSON.stringify(link)))
      )
        throw Error('La referencia pertenece a otra versión ASVS.');
      const key = `${link.catalogVersion}:${link.reqId}`;
      if (keys.has(key)) throw Error('No repitas referencias ASVS en la tarea.');
      keys.add(key);
      return link;
    }
    if (link.catalogVersion !== state.asvs!.config.catalogVersion)
      throw Error('La referencia pertenece a otra versión ASVS.');
    const requirement = resolveAsvsReference(asvsCatalog, link.reqId);
    if (!requirement) throw Error('Referencia ASVS inexistente o de otra versión.');
    if (keys.has(requirement.reqId)) throw Error('No repitas referencias ASVS en la tarea.');
    keys.add(requirement.reqId);
    return { ...link, reqId: requirement.reqId };
  });
}

export function linkedAsvsTasks(state: Snapshot, reqId: string) {
  return state.records.filter(
    (record): record is Task =>
      record.kind === 'task' &&
      record.project === state.asvs?.config.projectId &&
      !!record.asvsLinks?.some(
        (link) => link.reqId === reqId && link.catalogVersion === state.asvs?.config.catalogVersion,
      ),
  );
}
