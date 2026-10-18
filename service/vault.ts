import initSqlJs, { type Database } from 'sql.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Snapshot } from '../shared/model.js';
import { assignLegacyDecisionDates, assignLegacyTaskDates } from './records/dates.js';
import { assignLegacyTaskDependencies } from './records/dependencies.js';
import { assignLegacyTaskSolutions } from './records/solutions.js';
import { validateAsvsState } from './asvs/tracking.js';
const require = createRequire(import.meta.url);
const MAGIC = 'BITACORA-VAULT-1';
interface Envelope {
  magic: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}
function derive(pass: string, salt: Buffer) {
  return scryptSync(pass, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function encrypt(data: Uint8Array, key: Buffer, salt: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(MAGIC));
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      magic: MAGIC,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: enc.toString('base64'),
    }),
  );
}
function decrypt(bytes: Buffer, pass: string) {
  const e = JSON.parse(bytes.toString()) as Envelope;
  if (e.magic !== MAGIC) throw Error('Formato de copia no reconocido.');
  const salt = Buffer.from(e.salt, 'base64');
  if (salt.length !== 16) throw Error('Copia inválida.');
  const key = derive(pass, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    decipher.setAAD(Buffer.from(MAGIC));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    return {
      key,
      salt,
      data: Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]),
    };
  } catch {
    key.fill(0);
    throw Error('Contraseña incorrecta o archivo dañado.');
  }
}
function migrateMcpProfile(state: Snapshot) {
  let changed = false;
  if (state.mcpProfile === undefined) {
    state.mcpProfile = 'personal';
    changed = true;
  }
  if (state.mcpProfileVersion === undefined) {
    state.mcpProfileVersion = 1;
    changed = true;
  }
  if (
    !['personal', 'corporativo'].includes(state.mcpProfile) ||
    !Number.isSafeInteger(state.mcpProfileVersion) ||
    state.mcpProfileVersion < 1
  )
    throw Error('Perfil MCP del cuaderno no válido.');
  return changed;
}
/**
 * Introduces subproject scopes. Old vaults keep every record in «General»; empty scope values
 * are normalized and reviewed MCP excerpts are revoked so no permit gains implicit access.
 */
export function migrateSubprojects(state: Snapshot) {
  if (state.subprojectModel === 1) return false;
  const clean = (item: { subprojectId?: unknown } | null | undefined) => {
    if (item && 'subprojectId' in item && !item.subprojectId) delete item.subprojectId;
  };
  for (const record of state.records) clean(record);
  for (const entry of state.history) {
    clean(entry.before);
    clean(entry.after);
  }
  for (const draft of Object.values(state.drafts ?? {})) clean(draft);
  for (const proposal of state.proposals) clean(proposal.patch);
  for (const series of state.taskSeries ?? []) clean(series);
  state.shares = [];
  state.subprojectModel = 1;
  return true;
}
export class Vault {
  private db?: Database;
  private key?: Buffer;
  private salt?: Buffer;
  readonly path: string;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'bitacora.vault');
  }
  get exists() {
    return existsSync(this.path);
  }
  get unlocked() {
    return !!this.db;
  }
  async open(pass: string, initial: Snapshot) {
    if (this.unlocked) throw Error('La bitácora ya está abierta.');
    if (!this.exists && pass.length < 12) throw Error('Utiliza al menos 12 caracteres.');
    const SQL = await initSqlJs({
      locateFile: () => process.env.BITACORA_WASM || require.resolve('sql.js/dist/sql-wasm.wasm'),
    });
    let data: Buffer | undefined;
    if (this.exists) {
      const result = decrypt(readFileSync(this.path), pass);
      this.key = result.key;
      this.salt = result.salt;
      data = result.data;
    } else {
      this.salt = randomBytes(16);
      this.key = derive(pass, this.salt);
    }
    try {
      this.db = new SQL.Database(data);
      this.db.run(
        'CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, document TEXT NOT NULL)',
      );
      if (!this.db.exec('SELECT id FROM app_state').length) this.save(initial);
      const state = this.read();
      const profileChanged = migrateMcpProfile(state);
      const datesChanged = assignLegacyTaskDates(state);
      const decisionsChanged = assignLegacyDecisionDates(state);
      const dependenciesChanged = assignLegacyTaskDependencies(state);
      const solutionsChanged = assignLegacyTaskSolutions(state);
      const subprojectsChanged = migrateSubprojects(state);
      if (
        subprojectsChanged ||
        profileChanged ||
        datesChanged ||
        decisionsChanged ||
        dependenciesChanged ||
        solutionsChanged
      )
        this.save(state);
      return state;
    } catch (e) {
      this.lock();
      data?.fill(0);
      throw e;
    }
  }
  read(): Snapshot {
    if (!this.db) throw Error('Desbloquea Bitácora.');
    const row = this.db.exec('SELECT schema_version, document FROM app_state WHERE id=1')[0]
      ?.values[0];
    if (!row || ![1, 2].includes(Number(row[0]))) throw Error('Versión de datos incompatible.');
    const state = JSON.parse(String(row[1])) as Snapshot;
    if (row[0] === 1 && state.asvs !== undefined) throw Error('Esquema ASVS incompatible.');
    validateAsvsState(state);
    return state;
  }
  save(state: Snapshot) {
    if (!this.db || !this.key || !this.salt) throw Error('Desbloquea Bitácora.');
    validateAsvsState(state);
    const previous = this.db.exec('SELECT schema_version, document FROM app_state WHERE id=1')[0]
      ?.values[0];
    const schemaVersion = state.asvs || previous?.[0] === 2 ? 2 : 1;
    if (schemaVersion === 2 && previous?.[0] === 1 && this.exists) this.ensureAsvsRecovery();
    const tmp = this.path + '.tmp';
    try {
      this.db.run('INSERT OR REPLACE INTO app_state VALUES (1,?,?)', [
        schemaVersion,
        JSON.stringify({ ...state, grants: [] }),
      ]);
      const bytes = this.db.export();
      let encrypted: Buffer;
      try {
        encrypted = encrypt(bytes, this.key, this.salt);
      } finally {
        bytes.fill(0);
      }
      writeFileSync(tmp, encrypted, { mode: 0o600 });
      if (this.exists)
        writeFileSync(this.path + '.previous', readFileSync(this.path), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (error) {
      // Keep the in-memory database aligned with the unchanged encrypted file.
      if (previous)
        this.db.run('INSERT OR REPLACE INTO app_state VALUES (1,?,?)', [previous[0], previous[1]]);
      else this.db.run('DELETE FROM app_state WHERE id=1');
      if (existsSync(tmp)) unlinkSync(tmp);
      throw error;
    }
  }
  private ensureAsvsRecovery() {
    const destination = this.path + '.pre-asvs.backup';
    const source = readFileSync(this.path);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    if (existsSync(destination)) {
      // A retry must not trust a damaged or foreign recovery copy.
      const envelope = JSON.parse(readFileSync(destination, 'utf8')) as Envelope;
      if (envelope.magic !== MAGIC || envelope.salt !== this.salt!.toString('base64'))
        throw Error('Copia previa ASVS incompatible.');
      const cipher = createDecipheriv('aes-256-gcm', this.key!, Buffer.from(envelope.iv, 'base64'));
      cipher.setAAD(Buffer.from(MAGIC));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const decoded = Buffer.concat([
        cipher.update(Buffer.from(envelope.data, 'base64')),
        cipher.final(),
      ]);
      decoded.fill(0);
      return;
    }
    const temp = destination + '.tmp';
    try {
      writeFileSync(temp, source, { mode: 0o600 });
      if (digest(source) !== digest(readFileSync(temp)))
        throw Error('No se pudo verificar la copia previa ASVS.');
      renameSync(temp, destination);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  backup(pass: string) {
    if (!this.db) throw Error('Desbloquea Bitácora.');
    if (pass.length < 12) throw Error('La contraseña de copia debe tener 12 caracteres.');
    const salt = randomBytes(16),
      key = derive(pass, salt),
      data = this.db.export();
    try {
      return encrypt(data, key, salt);
    } finally {
      key.fill(0);
      data.fill(0);
    }
  }
  changePassword(current: string, next: string) {
    if (!this.db || !this.key) throw Error('Desbloquea Bitácora.');
    if (next.length < 12) throw Error('Utiliza al menos 12 caracteres.');
    const verified = decrypt(readFileSync(this.path), current);
    verified.key.fill(0);
    verified.data.fill(0);
    const salt = randomBytes(16);
    const key = derive(next, salt);
    const data = this.db.export();
    const temp = `${this.path}.tmp`;
    try {
      writeFileSync(temp, encrypt(data, key, salt), { mode: 0o600 });
      // A previous copy encrypted with the old password must not remain usable.
      for (const suffix of ['.previous', '.pre-asvs.backup']) {
        try {
          unlinkSync(`${this.path}${suffix}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      renameSync(temp, this.path);
      this.key.fill(0);
      this.key = key;
      this.salt = salt;
    } catch (error) {
      key.fill(0);
      try {
        unlinkSync(temp);
      } catch {}
      throw error;
    } finally {
      data.fill(0);
    }
  }
  async restore(bytes: Buffer, pass: string) {
    if (!this.db) throw Error('Desbloquea Bitácora antes de restaurar.');
    const decoded = decrypt(bytes, pass);
    try {
      const SQL = await initSqlJs({
        locateFile: () => process.env.BITACORA_WASM || require.resolve('sql.js/dist/sql-wasm.wasm'),
      });
      const temp = new SQL.Database(decoded.data);
      try {
        const row = temp.exec('SELECT schema_version,document FROM app_state WHERE id=1')[0]
          ?.values[0];
        if (!row || ![1, 2].includes(Number(row[0]))) throw Error('Copia incompatible.');
        const state = JSON.parse(String(row[1])) as Snapshot;
        if (row[0] === 1 && state.asvs !== undefined) throw Error('Esquema ASVS incompatible.');
        if (
          !Array.isArray(state.records) ||
          !Array.isArray(state.history) ||
          !Array.isArray(state.shares) ||
          !Array.isArray(state.proposals) ||
          !state.settings
        )
          throw Error('Copia inválida.');
        state.grants = [];
        state.settings.companyAuthorized = false;
        migrateMcpProfile(state);
        assignLegacyTaskDates(state);
        assignLegacyDecisionDates(state);
        assignLegacyTaskDependencies(state);
        assignLegacyTaskSolutions(state);
        migrateSubprojects(state);
        validateAsvsState(state);
        return state;
      } finally {
        temp.close();
      }
    } finally {
      decoded.key.fill(0);
      decoded.data.fill(0);
    }
  }
  lock() {
    this.db?.close();
    this.db = undefined;
    this.key?.fill(0);
    this.key = undefined;
    this.salt = undefined;
  }
}
