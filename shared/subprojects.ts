import type { GrantInfo, Practice, RecordItem, Subproject } from './model.js';

/** Identificador de ámbito MCP para los registros sin subproyecto («General del proyecto»). */
export const GENERAL_SCOPE = 'general';

/** Selección de la interfaz: todo el proyecto, «General» o el ID de un subproyecto. */
export type ScopeSelection = 'all' | typeof GENERAL_SCOPE | string;

type Scoped = { subprojectId?: string };

export function scopeOf(record: Scoped) {
  return record.subprojectId || '';
}

export function sameScope(a: Scoped, b: Scoped) {
  return scopeOf(a) === scopeOf(b);
}

export function subprojectsOf(records: RecordItem[]) {
  return records
    .filter((record): record is Subproject => record.kind === 'subproject')
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

export function findSubproject(records: RecordItem[], id: string | undefined) {
  if (!id) return undefined;
  return records.find(
    (record): record is Subproject => record.kind === 'subproject' && record.id === id,
  );
}

export function isArchivedScope(records: RecordItem[], record: Scoped) {
  return findSubproject(records, record.subprojectId)?.status === 'Archivado';
}

/** Una práctica general alcanza a todo el proyecto; una de subproyecto, solo a ese hijo. */
export function practiceReaches(practice: Practice, record: Scoped) {
  return !practice.subprojectId || practice.subprojectId === record.subprojectId;
}

/** Registros que la interfaz muestra para la selección actual. */
export function inSelection(record: RecordItem, selection: ScopeSelection) {
  if (record.kind === 'project' || record.kind === 'subproject' || selection === 'all') return true;
  if (selection === GENERAL_SCOPE) return !record.subprojectId;
  if (record.kind === 'practice' && !record.subprojectId) return true;
  return record.subprojectId === selection;
}

/** Registros que pueden referenciarse desde un registro del ámbito indicado. */
export function referenceableFrom(record: RecordItem, origin: Scoped) {
  if (record.kind === 'project' || record.kind === 'subproject') return true;
  if (record.kind === 'practice') return practiceReaches(record, origin);
  return sameScope(record, origin);
}

/** Ruta legible `Proyecto / Subproyecto` o `Proyecto / General`. */
export function scopePath(records: RecordItem[], record: Scoped & { project?: string }) {
  const root = records.find((item) => item.kind === 'project');
  const child = findSubproject(records, record.subprojectId);
  return `${root?.title || 'Proyecto'} / ${child?.title || 'General'}`;
}

export function grantScopes(grant: Pick<GrantInfo, 'scopes'>) {
  return grant.scopes ?? [GENERAL_SCOPE];
}

/** Ámbitos de una sesión que siguen vigentes: «General» y subproyectos activos del cuaderno. */
export function effectiveGrantScopes(grant: Pick<GrantInfo, 'scopes'>, records: RecordItem[]) {
  return grantScopes(grant).filter(
    (scope) => scope === GENERAL_SCOPE || findSubproject(records, scope)?.status === 'Activo',
  );
}

/** Predicado único de visibilidad MCP para registros de un cuaderno. */
export function grantSees(
  grant: Pick<GrantInfo, 'scopes' | 'projectIds'>,
  record: RecordItem,
  records: RecordItem[],
) {
  const scopes = effectiveGrantScopes(grant, records);
  if (record.kind === 'project')
    return grant.projectIds.includes(record.id) && scopes.includes(GENERAL_SCOPE);
  if (!grant.projectIds.includes(record.project)) return false;
  if (record.kind === 'subproject') return scopes.includes(record.id);
  // General practices apply to every child, so a child session needs to read them.
  if (record.kind === 'practice' && !record.subprojectId) return scopes.length > 0;
  return scopes.includes(record.subprojectId || GENERAL_SCOPE);
}
