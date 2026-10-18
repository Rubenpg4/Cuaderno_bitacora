import type { Objective, ObjectiveLink, RecordItem } from './model.js';

export function validObjectiveLink(
  objective: Objective,
  link: ObjectiveLink,
  records: RecordItem[],
) {
  const source = records.find((record) => record.id === link.sourceId);
  if (!source || source.project !== objective.project || source.kind !== link.sourceKind)
    return false;
  if (source.kind === 'task' && source.recurrence?.canceledAt) return false;
  if (link.role === 'trabajo') return true;
  if (source.kind !== 'entry') return false;
  if (link.role === 'resultado') return !!source.result.trim();
  return !!link.reference.trim();
}

export function objectiveCoverage(objective: Objective, records: RecordItem[]) {
  const links = objective.links.filter((link) => validObjectiveLink(objective, link, records));
  const has = (role: ObjectiveLink['role']) => links.some((link) => link.role === role);
  const gaps = [
    !has('trabajo') && 'sin trabajo',
    !has('resultado') && 'sin resultado',
    !has('evidencia') && 'sin evidencia',
    objective.validation.state !== 'Validado' && 'pendiente de validación',
  ].filter((gap): gap is string => !!gap);
  return { links, gaps };
}
