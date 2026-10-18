import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Domain, blank } from '../service/domain';
import { Vault } from '../service/vault';
import { Workspaces } from '../service/workspaces';

const firstPassword = 'contraseña del primer cuaderno';
const secondPassword = 'contraseña del segundo cuaderno';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-workspaces-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cuadernos aislados', () => {
  it('separa las capturas entre cuadernos y rechaza apuntes de otro vault', async () => {
    const workspaces = new Workspaces(dir);
    const first = await workspaces.create('Primero', firstPassword);
    const firstId = first.records.find((record) => record.kind === 'project')!.id;
    const capture = workspaces.domain!.createCapture('Apunte de prueba');
    workspaces.lock();
    const second = await workspaces.create('Segundo', secondPassword);
    const secondId = second.records.find((record) => record.kind === 'project')!.id;
    expect(second.captures).toEqual([]);
    expect(() =>
      workspaces.domain!.transaction(() => {
        (workspaces.domain!.require().captures ??= []).push(capture);
      }),
    ).toThrow('identificador');
    workspaces.lock();
    expect((await workspaces.unlock(firstId, firstPassword)).captures).toContainEqual(capture);
    workspaces.lock();
    expect((await workspaces.unlock(secondId, secondPassword)).captures).toEqual([]);
  });
  it('rechaza vínculos de objetivos ajenos al cuaderno al guardar y reabre los válidos', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Con objetivos', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const domain = workspaces.domain!;
    const task = domain.save('task', { ...blank('task'), title: 'Trabajo', project: id });
    const objective = domain.save('objective', {
      ...blank('objective'),
      title: 'Objetivo',
      project: id,
      links: [{ sourceKind: 'task', sourceId: task.id, role: 'trabajo', reference: '' }],
    });
    expect(() =>
      domain.transaction(() => {
        const stored = domain.require().records.find((record) => record.id === objective.id);
        if (stored?.kind === 'objective') stored.links[0].sourceId = 'otro-cuaderno';
      }),
    ).toThrow('identificador');
    workspaces.lock();
    const reopened = await workspaces.unlock(id, firstPassword);
    const restored = reopened.records.find((record) => record.id === objective.id);
    expect(restored?.kind === 'objective' && restored.links[0].sourceId).toBe(task.id);
    workspaces.lock();
  });

  it('reabre tras borrar una tarea con propuestas rechazadas y pendientes', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Con propuestas', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const domain = workspaces.domain!;
    const task = domain.save('task', { ...blank('task'), title: 'Tarea', project: id });
    domain.settings({ companyAuthorized: true, universityStructure: '' });
    const share = domain.share({
      recordId: task.id,
      provider: 'codex',
      title: 'Extracto',
      excerpt: 'Extracto de prueba',
    });
    const grant = domain.grant('codex', [], 'projects', [id]);
    const auth = domain.authorize(grant.token);
    const propose = (title: string) =>
      domain.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: task.id,
        expectedVersion: task.version,
        patch: { title },
        rationale: 'Prueba',
      });
    const rejected = propose('Título rechazado');
    domain.review(rejected.id, false);
    const pending = propose('Título pendiente');
    domain.deleteTask(task.id, task.version);
    expect(domain.require().shares.some((item) => item.id === share.id)).toBe(false);
    expect(domain.require().proposals.find((proposal) => proposal.id === rejected.id)?.status).toBe(
      'rejected',
    );
    expect(domain.require().proposals.find((proposal) => proposal.id === pending.id)?.status).toBe(
      'rejected',
    );
    workspaces.lock();
    const reopened = await workspaces.unlock(id, firstPassword);
    expect(reopened.records.some((record) => record.id === task.id)).toBe(false);
    expect(reopened.proposals.filter((proposal) => proposal.targetId === task.id)).toHaveLength(2);
    const vaultPath = join(dir, 'workspaces', id, 'bitacora.vault');
    const encryptedBefore = readFileSync(vaultPath);
    expect(() =>
      workspaces.domain!.transaction(() => {
        workspaces.domain!.require().proposals[0].status = 'pending';
      }),
    ).toThrow('identificador');
    expect(readFileSync(vaultPath)).toEqual(encryptedBefore);
    expect(workspaces.domain!.require().proposals[0].status).toBe('rejected');
    workspaces.lock();
    await workspaces.unlock(id, firstPassword);
  });

  it('reabre un cuaderno con apariciones recurrentes válidas', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Con recurrencia', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const series = workspaces.domain!.saveTaskSeries(
      { ...blank('task'), title: 'Revisión', project: id },
      { frequency: 'weekly', start: '2026-09-28', weekdays: [1] },
    );
    workspaces.domain!.reconcileTaskSeries('2026-09-28');
    workspaces.lock();
    const opened = await workspaces.unlock(id, firstPassword);
    expect(opened.taskSeries?.[0].id).toBe(series.id);
    expect(
      opened.records.some(
        (record) => record.kind === 'task' && record.recurrence?.seriesId === series.id,
      ),
    ).toBe(true);
  });

  it('no bloquea el cuaderno por metadatos de recurrencia inconsistentes', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Con serie', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const domain = workspaces.domain!;
    const series = domain.saveTaskSeries(
      { ...blank('task'), title: 'Periódica', project: id },
      { frequency: 'weekly', start: '2026-09-28', weekdays: [1] },
    );
    domain.reconcileTaskSeries();
    const state = domain.require();
    const appearance = state.records.find(
      (record) => record.kind === 'task' && record.recurrence?.seriesId === series.id,
    )!;
    state.records.push({ ...structuredClone(appearance), id: 'duplicada' });
    domain.vault.save(state);
    workspaces.lock();
    const opened = await workspaces.unlock(id, firstPassword);
    expect(workspaces.status().unlocked).toBe(true);
    expect(opened.records.some((record) => record.id === 'duplicada')).toBe(true);
    expect(opened.history.length).toBe(state.history.length);
  });

  it('mantiene el cuaderno abierto si falla la generación de una serie', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Serie pendiente', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const domain = workspaces.domain!;
    const series = domain.saveTaskSeries(
      { ...blank('task'), title: 'Periódica', project: id },
      { frequency: 'weekly', start: '2026-09-28', weekdays: [1] },
    );
    const state = domain.require();
    state.taskSeries!.find((item) => item.id === series.id)!.project = 'otro-cuaderno';
    domain.vault.save(state);
    workspaces.lock();
    const opened = await workspaces.unlock(id, firstPassword);
    expect(workspaces.status().unlocked).toBe(true);
    expect(opened.recurrenceWarning).toContain('cuaderno activo');
    expect(opened.taskSeries?.[0].project).toBe('otro-cuaderno');
  });

  it('guarda el perfil por cuaderno y revoca acceso y propuestas al cambiarlo', async () => {
    const workspaces = new Workspaces(dir);
    const corporate = await workspaces.create('Empresa', firstPassword, 'corporativo');
    const corporateId = corporate.records.find((record) => record.kind === 'project')!.id;
    expect(corporate.mcpProfile).toBe('corporativo');
    workspaces.domain!.settings({ companyAuthorized: true, universityStructure: '' });
    expect(() => workspaces.domain!.grant('claude', [], 'projects', [corporateId])).toThrow(
      'verificar la cuenta',
    );
    expect(() =>
      workspaces.domain!.grant(
        'codex',
        [],
        'projects',
        [corporateId],
        60,
        false,
        undefined,
        'org-empresa',
      ),
    ).toThrow('solo admite Claude');
    const verified = workspaces.domain!.grant(
      'claude',
      [],
      'projects',
      [corporateId],
      60,
      false,
      undefined,
      'org-empresa',
    );
    expect(workspaces.domain!.authorize(verified.token, 'org-empresa').orgId).toBe('org-empresa');
    expect(() => workspaces.domain!.authorize(verified.token)).toThrow('Sesión revocada');
    expect(() => workspaces.domain!.authorize(verified.token, 'org-otra')).toThrow(
      'Sesión revocada',
    );
    workspaces.domain!.setMcpProfile('personal');
    workspaces.domain!.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = workspaces.domain!.grant('codex', [], 'projects', [corporateId]);
    const proposal = workspaces.domain!.propose(workspaces.domain!.authorize(grant.token), {
      operation: 'create',
      kind: 'idea',
      patch: {
        project: corporateId,
        title: 'Propuesta pendiente',
        date: '2026-09-28',
        description: 'Revisar.',
      },
      rationale: 'Prueba de revocación',
    });
    workspaces.domain!.setMcpProfile('corporativo');
    expect(() => workspaces.domain!.authorize(grant.token)).toThrow();
    expect(workspaces.domain!.snapshot().grants).toEqual([]);
    expect(
      workspaces.domain!.require().proposals.find((item) => item.id === proposal.id)?.status,
    ).toBe('rejected');
    expect(workspaces.domain!.require().settings.companyAuthorized).toBe(false);
    workspaces.lock();
    expect((await workspaces.unlock(corporateId, firstPassword)).mcpProfile).toBe('corporativo');
    workspaces.lock();
    expect((await workspaces.create('Personal', secondPassword)).mcpProfile).toBe('personal');
    expect(JSON.parse(readFileSync(join(dir, 'workspaces.json'), 'utf8')).workspaces).toEqual([
      { id: corporateId, title: 'Empresa' },
      { id: workspaces.activeId, title: 'Personal' },
    ]);
  });

  it('rechaza perfiles inválidos antes de crear el cuaderno', async () => {
    const workspaces = new Workspaces(dir);
    await expect(
      workspaces.create('Inválido', firstPassword, 'otro' as 'personal'),
    ).rejects.toThrow('Perfil MCP no válido');
    expect(workspaces.status().projects).toEqual([]);
  });

  it('migra el perfil ausente de un vault anterior a personal', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Anterior', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    const state = workspaces.domain!.require();
    Reflect.deleteProperty(state, 'mcpProfile');
    Reflect.deleteProperty(state, 'mcpProfileVersion');
    workspaces.domain!.vault.save(state);
    workspaces.lock();
    const opened = await workspaces.unlock(id, firstPassword);
    expect(opened.mcpProfile).toBe('personal');
    expect(opened.mcpProfileVersion).toBe(1);
  });

  it('usa archivos y contraseñas independientes y cierra el alcance MCP al cambiar de cuaderno', async () => {
    const workspaces = new Workspaces(dir);
    const first = await workspaces.create('Primer cuaderno', firstPassword);
    const firstId = first.records.find((record) => record.kind === 'project')!.id;
    const task = workspaces.domain!.save('task', {
      ...blank('task'),
      title: 'Solo del primero',
      project: firstId,
    });
    workspaces.domain!.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = workspaces.domain!.grant('codex', [], 'projects', [firstId]);
    const firstDomain = workspaces.domain!;
    expect(() => workspaces.domain!.grant('codex', [], 'projects', ['otro'])).toThrow(
      'cuaderno activo',
    );
    expect(() =>
      workspaces.domain!.save('task', { ...blank('task'), title: 'Intrusa', project: 'otro' }),
    ).toThrow('cuaderno activo');
    expect(() =>
      workspaces.domain!.saveDraft('new:task', { title: 'Intrusa', project: 'otro' }),
    ).toThrow('cuaderno activo');
    expect(() =>
      workspaces.domain!.save('project', { ...blank('project'), title: 'Intruso' }),
    ).toThrow('pantalla de inicio');
    workspaces.lock();
    expect(() => firstDomain.authorize(grant.token)).toThrow();

    const second = await workspaces.create('Segundo cuaderno', secondPassword);
    const secondId = second.records.find((record) => record.kind === 'project')!.id;
    expect(second.records.some((record) => record.id === task.id)).toBe(false);
    expect(() => workspaces.domain!.authorize(grant.token)).toThrow();
    workspaces.lock();
    await workspaces.unlock(secondId, secondPassword);
    expect(workspaces.domain!.snapshot().records.some((record) => record.id === task.id)).toBe(
      false,
    );
    workspaces.lock();
    await workspaces.unlock(firstId, firstPassword);
    expect(workspaces.domain!.snapshot().records.some((record) => record.id === task.id)).toBe(
      true,
    );
    workspaces.lock();
    await expect(workspaces.unlock(firstId, secondPassword)).rejects.toThrow();
    expect(existsSync(join(dir, 'workspaces', firstId, 'bitacora.vault'))).toBe(true);
    expect(existsSync(join(dir, 'workspaces', secondId, 'bitacora.vault'))).toBe(true);
  });

  it('migra un vault antiguo sin mezclar registros y conserva el archivo cifrado original', async () => {
    const legacy = new Domain(new Vault(dir));
    await legacy.unlock(firstPassword);
    const first = legacy.save('project', { ...blank('project'), title: 'Actual' });
    const second = legacy.save('project', { ...blank('project'), title: 'Otro' });
    const firstTask = legacy.save('task', {
      ...blank('task'),
      project: first.id,
      title: 'Privada del actual',
    });
    const secondTask = legacy.save('task', {
      ...blank('task'),
      project: second.id,
      title: 'Privada del otro',
    });
    const globalPractice = legacy.require().records.find((record) => record.kind === 'practice')!;
    legacy.lock();
    const encryptedBefore = readFileSync(join(dir, 'bitacora.vault'));

    const workspaces = new Workspaces(dir);
    expect(workspaces.status().projects).toEqual([{ id: 'legacy', title: 'Cuaderno actual' }]);
    await workspaces.unlock('legacy', firstPassword);
    expect(workspaces.activeId).toBe(first.id);
    expect(workspaces.domain!.snapshot().records.some((record) => record.id === firstTask.id)).toBe(
      true,
    );
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === secondTask.id),
    ).toBe(false);
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === globalPractice.id),
    ).toBe(true);
    workspaces.lock();
    await workspaces.unlock(second.id, firstPassword);
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === secondTask.id),
    ).toBe(true);
    expect(workspaces.domain!.snapshot().records.some((record) => record.id === firstTask.id)).toBe(
      false,
    );
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === globalPractice.id),
    ).toBe(true);
    expect(existsSync(join(dir, 'bitacora.vault'))).toBe(true);
    expect(readFileSync(join(dir, 'bitacora.pre-migration.backup'))).toEqual(encryptedBefore);
    workspaces.lock();
  });

  it('solo elimina un cuaderno cerrado con su contraseña', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Temporal', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    await expect(workspaces.delete(id, firstPassword)).rejects.toThrow('Cierra');
    workspaces.lock();
    await expect(workspaces.delete(id, secondPassword)).rejects.toThrow();
    expect(workspaces.status().projects).toHaveLength(1);
    await expect(workspaces.delete(id, firstPassword)).rejects.toThrow('Espera');
    const another = await workspaces.create('Otro temporal', secondPassword);
    const anotherId = another.records.find((record) => record.kind === 'project')!.id;
    workspaces.lock();
    await workspaces.delete(anotherId, secondPassword);
    expect(workspaces.status().projects.map((project) => project.id)).toEqual([id]);
    expect(existsSync(join(dir, 'workspaces', anotherId))).toBe(false);
  });

  it('migra los registros transversales a un cuaderno propio', async () => {
    const legacy = new Domain(new Vault(dir));
    await legacy.unlock(firstPassword);
    const project = legacy.save('project', { ...blank('project'), title: 'Actual' });
    const generalTask = legacy.save('task', { ...blank('task'), title: 'Trabajo general' });
    legacy.lock();
    const workspaces = new Workspaces(dir);
    await workspaces.unlock('legacy', firstPassword);
    const general = workspaces
      .status()
      .projects.find((entry) => entry.title === 'Trabajo transversal')!;
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === generalTask.id),
    ).toBe(false);
    workspaces.lock();
    await workspaces.unlock(general.id, firstPassword);
    expect(
      workspaces.domain!.snapshot().records.some((record) => record.id === generalTask.id),
    ).toBe(true);
    expect(workspaces.domain!.snapshot().records.some((record) => record.id === project.id)).toBe(
      false,
    );
    workspaces.lock();
  });

  it('detiene la migración si un vínculo cruza proyectos y deja el vault anterior recuperable', async () => {
    const legacy = new Domain(new Vault(dir));
    await legacy.unlock(firstPassword);
    const first = legacy.save('project', { ...blank('project'), title: 'Actual' });
    const second = legacy.save('project', { ...blank('project'), title: 'Otro' });
    const task = legacy.save('task', { ...blank('task'), project: first.id, title: 'Primera' });
    legacy.save('task', {
      ...blank('task'),
      project: second.id,
      title: 'Depende de la primera',
      dependencyIds: [task.id],
    });
    legacy.lock();
    const encryptedBefore = readFileSync(join(dir, 'bitacora.vault'));
    const workspaces = new Workspaces(dir);
    await expect(workspaces.unlock('legacy', firstPassword)).rejects.toThrow('vínculos');
    expect(workspaces.status().projects).toEqual([{ id: 'legacy', title: 'Cuaderno actual' }]);
    expect(readdirSync(join(dir, 'workspaces'))).toEqual([]);
    expect(readFileSync(join(dir, 'bitacora.pre-migration.backup'))).toEqual(encryptedBefore);
  });

  it('reparte el historial de un traslado entre proyectos sin compartir sus versiones', async () => {
    const legacy = new Domain(new Vault(dir));
    await legacy.unlock(firstPassword);
    const first = legacy.save('project', { ...blank('project'), title: 'Actual' });
    const second = legacy.save('project', { ...blank('project'), title: 'Otro' });
    const task = legacy.save('task', {
      ...blank('task'),
      project: first.id,
      title: 'Versión anterior privada',
    });
    legacy.saveDraft(`record:${task.id}`, {
      project: first.id,
      title: 'Borrador anterior privado',
    });
    legacy.save(
      'task',
      { ...task, project: second.id, title: 'Versión nueva privada' },
      task.id,
      task.version,
    );
    legacy.lock();
    const encryptedBefore = readFileSync(join(dir, 'bitacora.vault'));
    const workspaces = new Workspaces(dir);
    await workspaces.unlock('legacy', firstPassword);
    const former = workspaces.domain!.snapshot();
    expect(former.records.some((record) => record.id === task.id)).toBe(false);
    expect(former.history.some((entry) => entry.recordId === task.id)).toBe(true);
    expect(JSON.stringify(former)).toContain('Versión anterior privada');
    expect(JSON.stringify(former)).toContain('Borrador anterior privado');
    expect(JSON.stringify(former)).not.toContain('Versión nueva privada');
    workspaces.lock();
    await workspaces.unlock(second.id, firstPassword);
    const current = workspaces.domain!.snapshot();
    expect(current.records.some((record) => record.id === task.id)).toBe(true);
    expect(current.history.some((entry) => entry.recordId === task.id)).toBe(true);
    expect(JSON.stringify(current)).toContain('Versión nueva privada');
    expect(JSON.stringify(current)).not.toContain('Versión anterior privada');
    expect(JSON.stringify(current)).not.toContain('Borrador anterior privado');
    expect(readFileSync(join(dir, 'bitacora.pre-migration.backup'))).toEqual(encryptedBefore);
    workspaces.lock();
  });

  it('puede cambiar la contraseña de un cuaderno sin afectar a los demás', async () => {
    const workspaces = new Workspaces(dir);
    const first = await workspaces.create('Actual', firstPassword);
    const id = first.records.find((record) => record.kind === 'project')!.id;
    workspaces.changePassword(firstPassword, secondPassword);
    workspaces.lock();
    await workspaces.unlock(id, secondPassword);
    expect(workspaces.activeId).toBe(id);
    workspaces.lock();
    await expect(workspaces.unlock(id, firstPassword)).rejects.toThrow();
    expect(existsSync(join(dir, 'workspaces', id, 'bitacora.vault.previous'))).toBe(false);
  });

  it('no crea un vault vacío si falta el archivo cifrado de un cuaderno existente', async () => {
    const workspaces = new Workspaces(dir);
    const created = await workspaces.create('Actual', firstPassword);
    const id = created.records.find((record) => record.kind === 'project')!.id;
    workspaces.lock();
    const path = join(dir, 'workspaces', id, 'bitacora.vault');
    unlinkSync(path);
    await expect(workspaces.unlock(id, firstPassword)).rejects.toThrow('Falta el vault');
    expect(existsSync(path)).toBe(false);
  });
});
