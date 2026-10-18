import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blank } from '../service/domain';
import { startServer } from '../service/server';

describe('recuperación de una copia cifrada', () => {
  const workspacePassword = 'contraseña del cuaderno de prueba';
  const backupPassword = 'contraseña de la copia de prueba';
  let dir: string;
  let app: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bitacora-backup-restore-'));
    app = await startServer({ dir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function post(path: string, data: unknown = {}) {
    return fetch(`http://127.0.0.1:${app.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${app.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  }

  it('restaura registros e identificadores y rechaza una copia dañada sin alterar el destino', async () => {
    const created = await (
      await post('/api/create-project', {
        title: 'Cuaderno aislado',
        password: workspacePassword,
      })
    ).json();
    const projectId = created.records.find(
      (record: { kind: string }) => record.kind === 'project',
    ).id;
    const task = await (
      await post('/api/save', {
        kind: 'task',
        data: {
          ...blank('task'),
          project: projectId,
          title: 'Registro recuperable',
          description: 'Contenido de prueba',
        },
      })
    ).json();
    const capture = await (
      await post('/api/capture-create', { text: 'Apunte recuperable' })
    ).json();
    const beforeBackup = await (await post('/api/snapshot')).json();
    const backupResponse = await post('/api/backup', { password: backupPassword });
    expect(backupResponse.status).toBe(200);
    const { data } = await backupResponse.json();
    const envelope = JSON.parse(Buffer.from(data, 'base64').toString());
    expect(envelope.magic).toBe('BITACORA-VAULT-1');
    expect(Buffer.from(data, 'base64').toString()).not.toContain('Registro recuperable');
    expect(Buffer.from(data, 'base64').toString()).not.toContain('Apunte recuperable');

    const laterTask = await (
      await post('/api/save', {
        kind: 'task',
        data: { ...blank('task'), project: projectId, title: 'Registro posterior' },
      })
    ).json();
    const restoredResponse = await post('/api/restore', {
      data,
      password: backupPassword,
      confirm: 'RESTAURAR',
    });
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json();
    expect(restored.records).toEqual(beforeBackup.records);
    expect(restored.history).toEqual(beforeBackup.history);
    expect(restored.captures).toContainEqual(capture);
    expect(restored.records).toContainEqual(task);
    expect(restored.records.some((record: { id: string }) => record.id === laterTask.id)).toBe(
      false,
    );

    const destination = await (
      await post('/api/save', {
        kind: 'task',
        data: { ...blank('task'), project: projectId, title: 'Destino intacto' },
      })
    ).json();
    const expected = await (await post('/api/snapshot')).json();
    const vaultPath = join(dir, 'workspaces', projectId, 'bitacora.vault');
    const encryptedBefore = readFileSync(vaultPath);
    const ciphertext = Buffer.from(envelope.data, 'base64');
    ciphertext[0] ^= 1;
    envelope.data = ciphertext.toString('base64');
    const damaged = Buffer.from(JSON.stringify(envelope)).toString('base64');
    const rejected = await post('/api/restore', {
      data: damaged,
      password: backupPassword,
      confirm: 'RESTAURAR',
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain('Contraseña incorrecta o archivo dañado.');
    expect(await (await post('/api/snapshot')).json()).toEqual(expected);
    expect(readFileSync(vaultPath)).toEqual(encryptedBefore);

    expect((await post('/api/lock')).status).toBe(200);
    const reopened = await (
      await post('/api/unlock', { projectId, password: workspacePassword })
    ).json();
    expect(reopened.records).toContainEqual(destination);
    expect(reopened.records).toEqual(expected.records);
  });
});
