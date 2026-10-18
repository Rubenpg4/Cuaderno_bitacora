import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  validDay,
  type McpProfile,
  type Project,
  type RecordItem,
  type Snapshot,
} from '../shared/model.js';
import { objectiveCoverage } from '../shared/objectiveCoverage.js';
import { sameScope } from '../shared/subprojects.js';
import { Domain, blank, initialState } from './domain.js';
import { Vault } from './vault.js';
import { validateAsvsState } from './asvs/tracking.js';

export interface WorkspaceInfo {
  id: string;
  title: string;
}

interface Catalog {
  version: 1;
  workspaces: WorkspaceInfo[];
}

const LEGACY_ID = 'legacy';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidObjectiveReferences(state: Snapshot, projectId: string) {
  return state.records.some((record) => {
    if (record.kind !== 'objective') return false;
    if (record.project !== projectId || !Array.isArray(record.links)) return true;
    const linkIds = new Set<string>();
    const keys = new Set<string>();
    for (const link of record.links) {
      if (
        !link ||
        typeof link.id !== 'string' ||
        typeof link.sourceId !== 'string' ||
        typeof link.reference !== 'string' ||
        !['task', 'entry'].includes(link.sourceKind) ||
        !['trabajo', 'resultado', 'evidencia'].includes(link.role)
      )
        return true;
      const source = state.records.find((candidate) => candidate.id === link.sourceId);
      const key = `${link.sourceKind}:${link.sourceId}:${link.role}`;
      if (
        !link.id ||
        linkIds.has(link.id) ||
        keys.has(key) ||
        !source ||
        source.project !== projectId ||
        source.kind !== link.sourceKind ||
        (link.sourceKind === 'task' && link.role !== 'trabajo') ||
        (link.role === 'evidencia' ? !link.reference?.trim() : !!link.reference?.trim())
      )
        return true;
      linkIds.add(link.id);
      keys.add(key);
    }
    if (
      !record.validation ||
      !['Pendiente', 'Validado'].includes(record.validation.state) ||
      typeof record.validation.date !== 'string' ||
      typeof record.validation.reference !== 'string' ||
      typeof record.validation.responsible !== 'string' ||
      !Array.isArray(record.validation.linkIds)
    )
      return true;
    if (record.validation.state === 'Validado') {
      const { gaps } = objectiveCoverage(record, state.records);
      if (
        gaps.length ||
        !validDay(record.validation.date) ||
        !record.validation.reference?.trim() ||
        !record.validation.responsible?.trim() ||
        record.validation.linkIds.length !== record.links.length ||
        record.validation.linkIds.some((linkId) => !linkIds.has(linkId))
      )
        return true;
    } else if (
      record.validation.date ||
      record.validation.reference ||
      record.validation.responsible ||
      record.validation.linkIds.length
    ) {
      return true;
    }
    return false;
  });
}

function invalidReviewReferences(state: Snapshot, projectId: string): boolean {
  const review = state.weeklyReview;
  const scoped = new Map(state.records.map((record) => [record.id, record]));
  const invalidAgreements = state.records.some((record) => {
    if (record.kind !== 'meeting' || !record.agreementItems) return false;
    const ids = new Set<string>();
    return record.agreementItems.some((agreement) => {
      if (
        !agreement.id ||
        ids.has(agreement.id) ||
        !agreement.text.trim() ||
        typeof agreement.requiresFollowUp !== 'boolean'
      )
        return true;
      ids.add(agreement.id);
      const task = agreement.followUpTaskId && scoped.get(agreement.followUpTaskId);
      return Boolean(
        agreement.followUpTaskId &&
        (!agreement.requiresFollowUp ||
          !task ||
          task.kind !== 'task' ||
          task.project !== projectId),
      );
    });
  });
  if (!review) return invalidAgreements;
  if (
    !Number.isSafeInteger(review.version) ||
    review.version < 1 ||
    !Array.isArray(review.decisions)
  )
    return true;
  const baseline = review.baseline;
  if (baseline) {
    if (
      !validDay(baseline.day) ||
      Number.isNaN(Date.parse(baseline.at)) ||
      !Array.isArray(baseline.recordIds) ||
      !Array.isArray(baseline.tasks) ||
      new Set(baseline.recordIds).size !== baseline.recordIds.length ||
      baseline.recordIds.some((id) => !scoped.has(id)) ||
      new Set(baseline.tasks.map((task) => task.id)).size !== baseline.tasks.length ||
      baseline.tasks.some(
        (task) =>
          scoped.get(task.id)?.kind !== 'task' ||
          !['Por hacer', 'En curso', 'En revisión'].includes(task.state) ||
          !Array.isArray(task.resultEntryIds) ||
          task.resultEntryIds.some((id) => scoped.get(id)?.kind !== 'entry'),
      )
    )
      return true;
  }
  return (
    new Set(review.decisions.map((decision) => decision.key)).size !== review.decisions.length ||
    review.decisions.some(
      (decision) =>
        typeof decision.key !== 'string' ||
        !/^(agreement|evidence|stagnant|asvs):[^:]+:[^:]+$/.test(decision.key) ||
        typeof decision.cause !== 'string' ||
        !['dismissed', 'postponed'].includes(decision.mode) ||
        (decision.mode === 'postponed'
          ? !decision.until || !validDay(decision.until)
          : !!decision.until),
    ) ||
    invalidAgreements
  );
}

/** Subprojects belong to the root, and references never cross scopes inside the vault. */
function invalidScopes(state: Snapshot, projectId: string) {
  const children = new Map(
    state.records
      .filter((record) => record.kind === 'subproject')
      .map((record) => [record.id, record]),
  );
  const titles = new Set<string>();
  for (const child of children.values()) {
    if (child.kind !== 'subproject') return true;
    const title = typeof child.title === 'string' ? child.title.trim().toLocaleLowerCase('es') : '';
    if (
      child.project !== projectId ||
      'subprojectId' in child ||
      !title ||
      titles.has(title) ||
      !['Activo', 'Archivado'].includes(child.status) ||
      (child.status === 'Archivado') !== !!child.archivedAt
    )
      return true;
    titles.add(title);
  }
  const unknownScope = (item: { subprojectId?: unknown } | null | undefined) =>
    !!item &&
    'subprojectId' in item &&
    (typeof item.subprojectId !== 'string' || !children.has(item.subprojectId));
  const byId = new Map(state.records.map((record) => [record.id, record]));
  const crosses = (record: RecordItem, ids: string[] | undefined) =>
    (ids ?? []).some((id) => {
      const target = byId.get(id);
      return target && target.kind !== 'project' && !sameScope(target, record);
    });
  return (
    state.records.some(
      (record) =>
        ((record.kind === 'project' || record.kind === 'subproject') && 'subprojectId' in record) ||
        unknownScope(record) ||
        (record.kind === 'task' && crosses(record, record.dependencyIds)) ||
        (record.kind === 'entry' &&
          crosses(record, [...record.taskIds, ...(record.linkedIds ?? [])])) ||
        (record.kind === 'meeting' &&
          crosses(
            record,
            (record.agreementItems ?? []).flatMap((item) =>
              item.followUpTaskId ? [item.followUpTaskId] : [],
            ),
          )) ||
        (record.kind === 'objective' &&
          crosses(
            record,
            (record.links ?? []).map((link) => link.sourceId),
          )),
    ) ||
    state.history.some((entry) => unknownScope(entry.after) || unknownScope(entry.before)) ||
    Object.values(state.drafts ?? {}).some(unknownScope) ||
    (state.taskSeries ?? []).some(unknownScope) ||
    state.proposals.some(
      (proposal) => proposal.status === 'pending' && unknownScope(proposal.patch),
    )
  );
}

export class Workspaces {
  private readonly catalogPath: string;
  private readonly workspacesDir: string;
  private active?: { id: string; domain: Domain };
  private readonly failures = new Map<string, { attempts: number; next: number }>();

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.catalogPath = join(dir, 'workspaces.json');
    this.workspacesDir = join(dir, 'workspaces');
    mkdirSync(this.workspacesDir, { recursive: true, mode: 0o700 });
  }

  get domain() {
    return this.active?.domain;
  }

  get activeId() {
    return this.active?.id;
  }

  private catalog(): Catalog {
    if (!existsSync(this.catalogPath)) return { version: 1, workspaces: [] };
    const value = JSON.parse(readFileSync(this.catalogPath, 'utf8')) as Catalog;
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.workspaces) ||
      value.workspaces.some(
        (entry) => !UUID.test(entry.id) || typeof entry.title !== 'string' || !entry.title.trim(),
      ) ||
      new Set(value.workspaces.map((entry) => entry.id)).size !== value.workspaces.length
    )
      throw Error('El índice de cuadernos no es válido.');
    return value;
  }

  private saveCatalog(catalog: Catalog) {
    const temp = `${this.catalogPath}.tmp`;
    writeFileSync(temp, JSON.stringify(catalog), { mode: 0o600 });
    renameSync(temp, this.catalogPath);
  }

  private workspaceDir(id: string) {
    if (!UUID.test(id)) throw Error('Cuaderno no válido.');
    const path = resolve(this.workspacesDir, id);
    if (!path.startsWith(resolve(this.workspacesDir) + sep)) throw Error('Cuaderno no válido.');
    if (existsSync(path) && !realpathSync(path).startsWith(realpathSync(this.workspacesDir) + sep))
      throw Error('Ruta de cuaderno no válida.');
    return path;
  }

  private checkAttempt(id: string) {
    if (Date.now() < (this.failures.get(id)?.next || 0))
      throw Error('Espera unos segundos antes de volver a intentar.');
  }

  private failedAttempt(id: string) {
    const attempts = (this.failures.get(id)?.attempts || 0) + 1;
    this.failures.set(id, {
      attempts,
      next: Date.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)),
    });
  }

  status() {
    const hasCatalog = existsSync(this.catalogPath);
    const workspaces = this.catalog().workspaces;
    return {
      exists: hasCatalog ? workspaces.length > 0 : existsSync(join(this.dir, 'bitacora.vault')),
      unlocked: !!this.active,
      activeProjectId: this.activeId || null,
      projects:
        hasCatalog || !existsSync(join(this.dir, 'bitacora.vault'))
          ? workspaces
          : [{ id: LEGACY_ID, title: 'Cuaderno actual' }],
    };
  }

  private checkedState(domain: Domain, id: string) {
    const state = domain.require();
    this.validateState(state, id);
    domain.activeProjectId = id;
  }

  validateState(state: Snapshot, id = this.activeId) {
    validateAsvsState(state, id);
    const ids = new Set(state.records.map((record) => record.id));
    if (
      !id ||
      !['personal', 'corporativo'].includes(state.mcpProfile) ||
      !Number.isSafeInteger(state.mcpProfileVersion) ||
      state.mcpProfileVersion < 1 ||
      ids.size !== state.records.length ||
      state.records.filter((record) => record.kind === 'project').length !== 1 ||
      !state.records.some((record) => record.kind === 'project' && record.id === id) ||
      state.records.some((record) => record.kind !== 'project' && record.project !== id) ||
      Object.values(state.drafts || {}).some((draft) => draft.project && draft.project !== id) ||
      (state.captures || []).some(
        (capture) =>
          capture.project !== id ||
          typeof capture.id !== 'string' ||
          !Number.isSafeInteger(capture.version) ||
          capture.version < 1 ||
          typeof capture.text !== 'string' ||
          capture.text.length > 8000 ||
          (capture.linkedRecordId && !ids.has(capture.linkedRecordId)) ||
          (capture.convertedRecordId && !capture.convertedKind),
      ) ||
      new Set((state.captures || []).map((capture) => capture.id)).size !==
        (state.captures || []).length ||
      state.history.some(
        (entry) =>
          entry.after.id !== entry.recordId ||
          (entry.before && entry.before.id !== entry.recordId) ||
          (entry.after.kind === 'project' && entry.after.id !== id) ||
          (entry.before?.kind === 'project' && entry.before.id !== id) ||
          (entry.after.kind !== 'project' && entry.after.project !== id) ||
          (entry.before && entry.before.kind !== 'project' && entry.before.project !== id),
      ) ||
      state.shares.some((share) => !ids.has(share.recordId)) ||
      state.proposals.some(
        (proposal) =>
          (proposal.status === 'pending' && proposal.targetId && !ids.has(proposal.targetId)) ||
          (proposal.projectId && proposal.projectId !== id),
      ) ||
      invalidObjectiveReferences(state, id) ||
      invalidReviewReferences(state, id) ||
      invalidScopes(state, id)
    )
      throw Error('Los datos del cuaderno no corresponden con su identificador.');
  }

  async unlock(id: string, password: string): Promise<Snapshot> {
    if (this.active) throw Error('Cierra el cuaderno actual antes de abrir otro.');
    this.checkAttempt(id);
    if (
      id === LEGACY_ID &&
      !existsSync(this.catalogPath) &&
      existsSync(join(this.dir, 'bitacora.vault'))
    )
      return this.migrateLegacy(password);
    if (!this.catalog().workspaces.some((entry) => entry.id === id))
      throw Error('Cuaderno no encontrado.');
    const path = this.workspaceDir(id);
    if (!existsSync(join(path, 'bitacora.vault')))
      throw Error('Falta el vault cifrado de este cuaderno.');
    const domain = new Domain(new Vault(path), (state) => this.validateState(state, id));
    try {
      await domain.unlock(password);
      this.checkedState(domain, id);
      let recurrenceWarning: string | undefined;
      try {
        domain.reconcileTaskSeries();
      } catch (error) {
        recurrenceWarning = `No se pudieron actualizar las tareas recurrentes: ${(error as Error).message}`;
      }
      this.active = { id, domain };
      this.failures.delete(id);
      return { ...domain.snapshot(), recurrenceWarning };
    } catch (error) {
      domain.lock();
      this.failedAttempt(id);
      throw error;
    }
  }

  async create(title: string, password: string, profile: McpProfile = 'personal') {
    if (this.active) throw Error('Cierra el cuaderno actual antes de crear otro.');
    if (existsSync(join(this.dir, 'bitacora.vault')) && !existsSync(this.catalogPath))
      throw Error('Abre primero el cuaderno actual para migrar sus datos.');
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 240) throw Error('Indica un nombre de hasta 240 caracteres.');
    if (password.length < 12) throw Error('Utiliza al menos 12 caracteres.');
    if (profile !== 'personal' && profile !== 'corporativo') throw Error('Perfil MCP no válido.');
    const id = randomUUID();
    const path = this.workspaceDir(id);
    const domain = new Domain(new Vault(path), (state) => this.validateState(state, id));
    try {
      const now = new Date().toISOString();
      const project = {
        ...blank('project'),
        id,
        kind: 'project',
        title: trimmed,
        project: '',
        version: 1,
        createdAt: now,
        updatedAt: now,
      } as Project;
      const state = initialState();
      state.mcpProfile = profile;
      state.records = [project, ...state.records.map((record) => ({ ...record, project: id }))];
      state.history.unshift({
        id: randomUUID(),
        recordId: id,
        at: now,
        actor: 'Tú',
        before: null,
        after: structuredClone(project),
      });
      this.validateState(state, id);
      await domain.vault.open(password, state);
      domain.state = state;
      domain.activeProjectId = id;
      const catalog = this.catalog();
      catalog.workspaces.push({ id, title: project.title });
      this.saveCatalog(catalog);
      this.active = { id, domain };
      return domain.snapshot();
    } catch (error) {
      domain.lock();
      if (!this.catalog().workspaces.some((entry) => entry.id === id))
        rmSync(path, { recursive: true, force: true });
      throw error;
    }
  }

  syncTitle(project: Project) {
    if (project.id !== this.activeId) throw Error('Proyecto no activo.');
    const catalog = this.catalog();
    const entry = catalog.workspaces.find((item) => item.id === project.id);
    if (!entry) throw Error('Cuaderno no encontrado.');
    if (entry.title === project.title) return;
    entry.title = project.title;
    this.saveCatalog(catalog);
  }

  lock() {
    this.active?.domain.lock();
    this.active = undefined;
  }

  changePassword(current: string, next: string) {
    if (!this.active) throw Error('Desbloquea un cuaderno.');
    const id = this.active.id;
    this.checkAttempt(id);
    try {
      this.active.domain.vault.changePassword(current, next);
      this.failures.delete(id);
      return { ok: true };
    } catch (error) {
      this.failedAttempt(id);
      throw error;
    }
  }

  async delete(id: string, password: string) {
    if (this.active) throw Error('Cierra el cuaderno antes de eliminarlo.');
    const catalog = this.catalog();
    if (!catalog.workspaces.some((entry) => entry.id === id))
      throw Error('Cuaderno no encontrado.');
    const path = this.workspaceDir(id);
    if (!existsSync(join(path, 'bitacora.vault')))
      throw Error('Falta el vault cifrado de este cuaderno.');
    const domain = new Domain(new Vault(path));
    this.checkAttempt(id);
    try {
      await domain.unlock(password);
      this.checkedState(domain, id);
      this.failures.delete(id);
    } catch (error) {
      this.failedAttempt(id);
      throw error;
    } finally {
      domain.lock();
    }
    // Remove the index entry first: the encrypted directory can be cleaned up after a crash.
    catalog.workspaces = catalog.workspaces.filter((entry) => entry.id !== id);
    this.saveCatalog(catalog);
    rmSync(path, { recursive: true, force: true });
    return this.status();
  }

  private async migrateLegacy(password: string): Promise<Snapshot> {
    this.ensureLegacyBackup();
    const legacy = new Domain(new Vault(this.dir));
    try {
      await legacy.unlock(password);
      this.failures.delete(LEGACY_ID);
    } catch (error) {
      this.failedAttempt(LEGACY_ID);
      throw error;
    }
    const original = legacy.require();
    const existingProjects = original.records.filter(
      (record): record is Project => record.kind === 'project',
    );
    if (!existingProjects.length) {
      legacy.lock();
      throw Error('El cuaderno anterior no tiene proyectos. Crea uno en la versión anterior.');
    }
    const hasGeneralRecords = original.records.some(
      (record) => record.kind !== 'project' && record.kind !== 'practice' && !record.project,
    );
    const hasGeneralDrafts = Object.entries(original.drafts || {}).some(
      ([key, draft]) => !key.startsWith('record:') && !draft.project,
    );
    const general = hasGeneralRecords || hasGeneralDrafts ? this.generalProject() : undefined;
    const projects = general ? [...existingProjects, general] : existingProjects;
    const created: string[] = [];
    try {
      for (const project of projects) {
        const state = this.partition(original, project, general?.id);
        this.validateState(state, project.id);
        const path = this.workspaceDir(project.id);
        if (existsSync(path)) throw Error('Ya existe un cuaderno con ese identificador.');
        const domain = new Domain(new Vault(path));
        created.push(path);
        try {
          await domain.vault.open(password, state);
        } finally {
          domain.lock();
        }
      }
      this.saveCatalog({
        version: 1,
        workspaces: projects.map(({ id, title }) => ({ id, title })),
      });
      legacy.lock();
      // The original encrypted vault is retained as a recovery copy for migration.
      const first = existingProjects[0].id;
      return this.unlock(first, password);
    } catch (error) {
      legacy.lock();
      if (!existsSync(this.catalogPath))
        for (const path of created) rmSync(path, { recursive: true, force: true });
      throw error;
    }
  }

  private ensureLegacyBackup() {
    const source = join(this.dir, 'bitacora.vault');
    const destination = join(this.dir, 'bitacora.pre-migration.backup');
    if (existsSync(destination)) return;
    const temp = `${destination}.tmp`;
    try {
      copyFileSync(source, temp);
      chmodSync(temp, 0o600);
      const digest = (path: string) =>
        createHash('sha256').update(readFileSync(path)).digest('hex');
      if (digest(source) !== digest(temp)) throw Error('No se pudo verificar la copia previa.');
      renameSync(temp, destination);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }

  private generalProject(): Project {
    const now = new Date().toISOString();
    return {
      ...blank('project'),
      id: randomUUID(),
      kind: 'project',
      title: 'Trabajo transversal',
      project: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as Project;
  }

  private partition(original: Snapshot, project: Project, generalId?: string): Snapshot {
    const isGeneral = project.id === generalId;
    const owned = (record: RecordItem) =>
      record.id === project.id ||
      (record.kind === 'practice' && !record.project) ||
      (record.kind !== 'project' &&
        (record.project === project.id || (!record.project && isGeneral)));
    const ids = new Set(original.records.filter(owned).map((record) => record.id));
    if (isGeneral) ids.add(project.id);
    const localIds = (references: string[], strict: boolean) => {
      if (strict && references.some((id) => !ids.has(id)))
        throw Error(
          'Hay vínculos entre proyectos. Revísalos en la versión anterior antes de migrar.',
        );
      return references.filter((id) => ids.has(id));
    };
    const sanitize = (source: RecordItem, strict = false): RecordItem => {
      const record = structuredClone(source);
      record.project = record.kind === 'project' ? '' : project.id;
      if (record.kind === 'task') {
        record.dependencyIds = localIds(record.dependencyIds, strict);
      }
      if (record.kind === 'entry') {
        record.taskIds = localIds(record.taskIds, strict);
        record.linkedIds = record.linkedIds && localIds(record.linkedIds, strict);
      }
      if (record.kind === 'meeting') record.sourceIds = localIds(record.sourceIds, strict);
      return record;
    };
    const records = original.records.filter(owned).map((record) => sanitize(record, true));
    if (isGeneral) records.unshift(project);
    const history = original.history.flatMap((entry) => {
      const afterHere = owned(entry.after);
      const beforeHere = !!entry.before && owned(entry.before);
      if (afterHere)
        return [
          {
            ...entry,
            before: beforeHere ? sanitize(entry.before!) : null,
            after: sanitize(entry.after),
          },
        ];
      if (beforeHere)
        return [
          {
            ...entry,
            id: randomUUID(),
            actor: 'Migración: último estado antes del traslado',
            before: null,
            after: sanitize(entry.before!),
          },
        ];
      return [];
    });
    if (isGeneral)
      history.unshift({
        id: randomUUID(),
        recordId: project.id,
        at: project.createdAt,
        actor: 'Migración de datos transversales',
        before: null,
        after: structuredClone(project),
      });
    return {
      ...initialState(),
      records,
      drafts: Object.fromEntries(
        Object.entries(original.drafts || {}).filter(([key, draft]) =>
          key.startsWith('record:')
            ? draft.project
              ? draft.project === project.id
              : ids.has(key.slice(7))
            : draft.project === project.id || (!draft.project && isGeneral),
        ),
      ),
      history,
      shares: [],
      proposals: [],
      grants: [],
      settings: { ...original.settings, companyAuthorized: false },
    };
  }
}
