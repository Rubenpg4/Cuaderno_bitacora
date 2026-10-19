import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { madridDate, type Entry, type Objective, type Task } from '../shared/model';
import { addDays } from '../shared/recurrence';
import { asvsCatalog } from '../shared/asvsCatalog';
import { asvsDisplayRequirements, asvsTranslationProvider } from '../shared/asvsCatalogEs';
let child: ChildProcess, dir: string, url: string, token: string;
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-e2e-'));
  child = spawn(process.execPath, ['dist-service/server.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, BITACORA_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const connection = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    lines.once('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(Error('Handshake inválido'));
      }
    });
    child.once('exit', () => reject(Error('El servicio no arrancó')));
  });
  token = connection.token;
  url = `http://127.0.0.1:${connection.port}`;
});
test.afterEach(async () => {
  child?.kill();
  await new Promise((r) => child.once('exit', r));
  rmSync(dir, { recursive: true, force: true });
});
async function unlock(page: Page) {
  await page.goto(`${url}/#session=${token}`);
  await page.getByLabel('Nombre del cuaderno').fill('Proyecto conectado');
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba de bitácora segura');
  await page.getByLabel('Repite la contraseña').fill('Prueba de bitácora segura');
  await page.getByRole('button', { name: 'Crear mi bitácora' }).click();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
}
async function call(action: string, data: unknown = {}) {
  const r = await fetch(`${url}/api/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await r.json();
  if (!r.ok) throw Error(json.error);
  return json;
}

async function openBoardGroup(page: Page, title: string) {
  const group = page.locator('.board-day-group').filter({
    has: page.locator('.task-card').filter({ hasText: title }),
  });
  if (!(await group.evaluate((element) => element.hasAttribute('open')))) {
    await group.locator('summary').click();
  }
}

async function asvsIntegrationSetup() {
  const snapshot = await call('snapshot');
  const projectId = snapshot.records.find((r: { kind: string }) => r.kind === 'project').id;
  const overview = await call('asvs-configure', {
    projectId,
    expectedConfigVersion: 0,
    catalogVersion: asvsCatalog.version,
    level: 1,
  });
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [projectId],
    canCompleteTasks: true,
  });
  async function mcp(action: string, input: unknown) {
    const r = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, input }),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  }
  return { projectId, overview, mcp };
}

test('ASVS informe: selecciona contenido, descarga Markdown y CSV y ofrece ayuda accesible', async ({
  page,
}) => {
  await unlock(page);
  const { projectId, overview } = await asvsIntegrationSetup();
  const { blank } = await import('../service/domain');
  const a = overview.items[0].assessment;
  const requirement = asvsCatalog.requirements.find((r) => r.reqId === a.reqId)!;
  const task = await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      project: projectId,
      title: '<img src=x onerror=alert(1)> Tarea sintética',
      description: 'Descripción privada omitida',
      due: addDays(madridDate(), 7),
      asvsLinks: [
        {
          catalogVersion: asvsCatalog.version,
          reqId: a.reqId,
          reason: 'Validar el control',
          scope: 'Servicio',
          criterion: 'Caso sintético',
          method: 'Prueba',
        },
      ],
    },
  });
  await call('asvs-review', {
    projectId,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: 1,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Nota privada omitida',
    method: 'Prueba',
    responsible: 'Responsable privado omitido',
    evidence: [{ reference: 'Referencia sintética seleccionable', revision: 'r1' }],
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Verificación ASVS', exact: true })
    .click();
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.canonicalRef);
  const article = page.getByRole('article', { name: requirement.canonicalRef });
  const help = (await import('../shared/asvsHelp')).asvsHelpLinks(requirement)!;
  await expect(
    article.getByRole('link', { name: `Fuente oficial ASVS ${requirement.canonicalRef}` }),
  ).toHaveAttribute('href', help.source);
  await expect(article.getByRole('link', { name: 'Guía OWASP por ASVS' })).toHaveAttribute(
    'href',
    help.guide,
  );
  await expect(article).toContainText('son ayudas sujetas a revisión humana');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await article
    .getByRole('button', { name: `Copiar referencia ${requirement.canonicalRef}` })
    .click();
  await expect(
    page.getByText(`Referencia copiada: ${requirement.canonicalRef}`, { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(requirement.canonicalRef);
  const report = page.locator('.asvs-report');
  await report.locator('summary').first().click();
  await report.getByRole('button', { name: 'Limpiar selección' }).click();
  await expect(report.getByRole('button', { name: 'Previsualizar informe ASVS' })).toBeDisabled();
  await report.getByLabel('Buscar requisitos para exportar').fill(requirement.canonicalRef);
  await report
    .getByRole('checkbox', {
      name: `${requirement.canonicalRef} · L${requirement.minLevel}`,
      exact: true,
    })
    .check();
  await report.getByRole('button', { name: 'Previsualizar informe ASVS' }).click();
  const preview = report.getByRole('region', { name: 'Vista previa del informe ASVS' });
  await expect(preview).toBeFocused();
  await expect(preview).not.toContainText(task.title);
  await expect(preview).not.toContainText('Referencia sintética seleccionable');
  await expect(preview.getByRole('button', { name: 'Descargar informe ASVS' })).toBeDisabled();
  await report.getByText('Tareas vinculadas (1)', { exact: true }).click();
  await report.getByRole('checkbox', { name: `${task.title} · Por hacer`, exact: true }).check();
  await expect(preview).toHaveCount(0);
  await report.getByText('Referencias de evidencia (1)', { exact: true }).click();
  await report
    .getByRole('checkbox', {
      name: `${a.reqId} · Referencia sintética seleccionable · r1`,
      exact: true,
    })
    .check();
  await report.getByRole('button', { name: 'Previsualizar informe ASVS' }).click();
  await expect(preview).toContainText('Referencia sintética seleccionable');
  await expect(preview.locator('img')).toHaveCount(0);
  for (const omitted of [
    'Nota privada omitida',
    'Descripción privada omitida',
    'Responsable privado omitido',
  ])
    await expect(preview).not.toContainText(omitted);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  expect((await new AxeBuilder({ page }).include('.asvs-report').analyze()).violations).toEqual([]);
  for (const format of ['md', 'csv']) {
    await report.getByLabel('Formato del informe ASVS').selectOption(format);
    await expect(preview.getByRole('button', { name: 'Descargar informe ASVS' })).toBeDisabled();
    await preview
      .getByRole('checkbox', { name: 'He revisado el contenido del informe ASVS' })
      .check();
    const expected = await preview.locator('pre').textContent();
    const waiting = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Descargar informe ASVS' }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^bitacora-asvs-\\d{4}-\\d{2}-\\d{2}\\.${format}$`),
    );
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString().replace(/\r\n/g, '\n')).toBe(
      expected!.replace(/\r\n/g, '\n'),
    );
  }
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).include('.asvs-report').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await preview
    .getByRole('checkbox', { name: 'He revisado el contenido del informe ASVS' })
    .focus();
  await page.keyboard.press('Space');
  await expect(preview.getByRole('button', { name: 'Descargar informe ASVS' })).toBeDisabled();
});

test('ASVS informe: exige revisar de nuevo si cambian los estados tras previsualizar', async ({
  page,
}) => {
  await unlock(page);
  const { projectId, overview } = await asvsIntegrationSetup();
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Verificación ASVS', exact: true })
    .click();
  const report = page.locator('.asvs-report');
  await report.locator('summary').first().click();
  await report.getByRole('button', { name: 'Previsualizar informe ASVS' }).click();
  const preview = report.getByRole('region', { name: 'Vista previa del informe ASVS' });
  await preview
    .getByRole('checkbox', { name: 'He revisado el contenido del informe ASVS' })
    .check();
  const a = overview.items[0].assessment;
  await call('asvs-review', {
    projectId,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: 1,
    state: 'No cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Hallazgo sintético',
    method: 'Prueba',
    responsible: 'Persona',
    evidence: [{ reference: 'Caso', revision: 'r1' }],
  });
  await preview.getByRole('button', { name: 'Descargar informe ASVS' }).click();
  await expect(report.getByRole('alert')).toContainText('El contenido ASVS ha cambiado');
  await expect(preview).toHaveCount(0);
  await report.getByRole('button', { name: 'Previsualizar informe ASVS' }).click();
  await expect(preview).toContainText('No cumplido');
  await expect(preview.getByRole('button', { name: 'Descargar informe ASVS' })).toBeDisabled();
});

test('ASVS seguimiento: revalida fuentes, muestra cobertura y conserva señales descartadas', async ({
  page,
}) => {
  test.setTimeout(60000);
  await unlock(page);
  const { projectId, overview, mcp } = await asvsIntegrationSetup();
  const { blank } = await import('../service/domain');
  const local = await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      project: projectId,
      title: 'Fuente de cobertura sintética',
      result: 'Caso de prueba',
    },
  });
  for (let index = 0; index < 2; index++) {
    const a = overview.items[index].assessment;
    await call('asvs-review', {
      projectId,
      targetId: a.id,
      expectedVersion: a.version,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scope: 'project',
      scopeDetail: '',
      pendingScope: '',
      note: 'Control sintético verificado',
      method: 'Prueba',
      responsible: 'Revisor sintético',
      evidence: index
        ? [{ reference: 'repositorio de prueba', revision: 'commit-1' }]
        : [{ recordId: local.id, reference: 'Caso local', revision: 'v1' }],
    });
  }
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await nav.getByRole('button', { name: 'Verificación ASVS', exact: true }).click();
  await expect(page.getByText('2 de 70 requisitos aplicables verificados')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cobertura y lagunas ASVS' })).toContainText(
    '68 lagunas',
  );
  await call('save', {
    kind: 'entry',
    id: local.id,
    expectedVersion: local.version,
    data: { ...local, result: 'Caso modificado' },
  });
  await page.reload();
  await nav.getByRole('button', { name: 'Verificación ASVS', exact: true }).click();
  await expect(page.getByText('1 de 70 requisitos aplicables verificados')).toBeVisible();
  await page.getByText('Revalidar una revisión externa', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Registrar revisión externa' });
  await expect(
    page.getByText('No vigila repositorios ni archivos externos.', { exact: false }),
  ).toBeVisible();
  await form.getByLabel('Fuente externa a revalidar').selectOption('repositorio de prueba');
  await form.getByLabel('Nueva revisión externa').fill('commit-2');
  await form.getByLabel('Motivo de revalidación').fill('Cambió el módulo evaluado');
  await form.getByRole('button', { name: 'Registrar cambio de revisión' }).click();
  await expect(page.getByText('0 de 70 requisitos aplicables verificados')).toBeVisible();
  await page.getByLabel('Filtrar lagunas ASVS').selectOption('revalidation');
  await expect(page.getByRole('region', { name: 'Cobertura y lagunas ASVS' })).toContainText(
    '2 lagunas',
  );
  await page.getByLabel('Buscar requisito ASVS').fill(overview.items[1].assessment.reqId);
  const article = page.getByRole('article', {
    name: asvsCatalog.requirements.find((r) => r.reqId === overview.items[1].assessment.reqId)!
      .canonicalRef,
    exact: true,
  });
  await expect(article).toContainText('Revisión externa modificada');
  await article
    .getByRole('button', { name: `Historial de ${overview.items[1].assessment.reqId}` })
    .click();
  await expect(article.locator('.asvs-history')).toContainText('commit-1');
  await nav.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const signal = page
    .locator('.review-card')
    .filter({ hasText: 'revalidaciones pendientes' })
    .first();
  await expect(signal).toBeVisible();
  const signalTitle = await signal.locator('h3').innerText();
  await signal.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.getByRole('heading', { name: signalTitle, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminar revisión', exact: true }).click();
  await nav.getByRole('button', { name: 'Verificación ASVS', exact: true }).click();
  await nav.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  await expect(page.getByRole('heading', { name: signalTitle, exact: true })).toHaveCount(0);
  const proposed = await mcp('asvs-revision-propose', {
    projectId,
    expectedConfigVersion: 1,
    expectedVersion: 1,
    reference: 'repositorio de prueba',
    revision: 'commit-3',
    reason: 'Revisión señalada por agente',
  });
  expect(proposed.status).toBe('pending');
  await nav.getByRole('button', { name: 'Verificación ASVS', exact: true }).click();
  await page.reload();
  await nav.getByRole('button', { name: 'Verificación ASVS', exact: true }).click();
  await page.getByText('Revalidar una revisión externa', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Revisión externa propuesta por codex' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar nueva revisión', exact: true }).click();
  await nav.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  await expect(page.getByRole('heading', { name: signalTitle, exact: true })).toBeVisible();
  await page
    .locator('.review-card')
    .filter({ hasText: signalTitle })
    .getByRole('button', { name: 'Abrir requisito ASVS' })
    .click();
  await expect(page.getByLabel('Buscar requisito ASVS')).not.toHaveValue('');
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  expect((await new AxeBuilder({ page }).include('.asvs-view').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('ASVS seguimiento: previsualiza y confirma catálogo sin trasladar ticks ni asociaciones', async ({
  page,
}) => {
  test.setTimeout(60000);
  await unlock(page);
  const { projectId, overview } = await asvsIntegrationSetup();
  const a = overview.items[0].assessment;
  await call('asvs-review', {
    projectId,
    targetId: a.id,
    expectedVersion: 1,
    expectedConfigVersion: 1,
    state: 'Cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Revisión antigua sintética',
    method: 'Prueba',
    responsible: 'Revisor',
    evidence: [{ reference: 'prueba anterior', revision: 'commit-antiguo' }],
  });
  const { blank } = await import('../service/domain');
  const work = await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      project: projectId,
      title: 'Compromiso de catálogo anterior',
      asvsLinks: [
        {
          catalogVersion: asvsCatalog.version,
          reqId: a.reqId,
          reason: 'Control anterior',
          scope: 'Módulo',
          criterion: 'Caso observable',
          method: 'Prueba',
        },
      ],
    },
  });
  const snapshot = await call('snapshot');
  snapshot.asvs.config.catalogVersion = '4.0.3';
  snapshot.asvs.config.catalogSha256 = 'a'.repeat(64);
  snapshot.asvs.config.catalogBaseline[0].contentSha256 = 'b'.repeat(64);
  snapshot.asvs.config.catalogBaseline.push({
    reqId: 'V99.1.1',
    contentSha256: 'c'.repeat(64),
    minLevel: 1,
  });
  for (const i of snapshot.asvs.assessments) i.catalogVersion = '4.0.3';
  for (const h of snapshot.asvs.history) {
    h.after.catalogVersion = '4.0.3';
    if (h.before) h.before.catalogVersion = '4.0.3';
  }
  snapshot.records.find((r: { id: string }) => r.id === work.id).asvsLinks[0].catalogVersion =
    '4.0.3';
  const { Vault } = await import('../service/vault');
  const fixture = new Vault(join(dir, 'predecessor-synthetic'));
  const password = 'Prueba de bitácora segura';
  await fixture.open(password, snapshot);
  const backup = fixture.backup(password).toString('base64');
  fixture.lock();
  await call('restore', { data: backup, password, confirm: 'RESTAURAR' });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Verificación ASVS', exact: true })
    .click();
  await page.getByRole('button', { name: 'Previsualizar actualización de catálogo' }).click();
  await expect(page.getByText('Retirados (1)', { exact: true })).toBeVisible();
  await expect(page.getByText('Cambiados (1)', { exact: true })).toBeVisible();
  const confirm = page.getByRole('button', {
    name: 'Confirmar actualización de catálogo',
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Añadir correspondencia justificada' }).click();
  await page.getByLabel('Referencia anterior 1').fill(a.reqId);
  await page.getByLabel('Referencia nueva 1').fill(a.reqId);
  await page
    .getByLabel('Justificación de correspondencia 1')
    .fill('Correspondencia revisada por contenido, sin copiar evaluación');
  await page
    .getByLabel('Confirmo el cambio de catálogo y la reevaluación sin trasladar ticks')
    .check();
  await confirm.click();
  await expect(page.getByText('0 de 70 requisitos aplicables verificados')).toBeVisible();
  await page.getByText('Evaluaciones de catálogos anteriores', { exact: true }).click();
  await page.getByText(`ASVS 4.0.3 · ${a.reqId} · Cumplido`, { exact: true }).click();
  await expect(
    page.getByText('prueba anterior · revisión commit-antiguo', { exact: true }),
  ).toBeVisible();
  const current = await call('snapshot');
  expect(
    current.records.find((r: { id: string }) => r.id === work.id).asvsLinks[0].catalogVersion,
  ).toBe('4.0.3');
  expect(
    current.asvs.assessments.filter(
      (i: { catalogVersion: string; state: string }) =>
        i.catalogVersion === asvsCatalog.version && i.state === 'Cumplido',
    ),
  ).toHaveLength(0);
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  expect((await new AxeBuilder({ page }).include('.asvs-view').analyze()).violations).toEqual([]);
});

for (const changedEvidence of [false, true]) {
  test(`ASVS cierre: ${changedEvidence ? 'invalida la vista previa si cambia evidencia' : 'revisa prácticas, ASVS y cierre juntos'}`, async ({
    page,
  }) => {
    await unlock(page);
    const { projectId, mcp } = await asvsIntegrationSetup();
    const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
    await call('save', {
      kind: 'practice',
      data: {
        ...(await import('../service/domain')).blank('practice'),
        project: projectId,
        title: 'Prueba de cierre sintética',
        status: 'Recomendación personal',
        mandatory: true,
      },
    });
    const source = await call('save', {
      kind: 'entry',
      data: {
        ...(await import('../service/domain')).blank('entry'),
        project: projectId,
        title: 'Resultado sintético de seguridad',
        result: 'Caso observado',
      },
    });
    const work: Task = await call('save', {
      kind: 'task',
      data: {
        ...(await import('../service/domain')).blank('task'),
        project: projectId,
        title: 'Tarea de cierre ASVS',
        description: 'Requisito original de cierre',
        asvsLinks: [
          {
            catalogVersion: asvsCatalog.version,
            reqId: requirement.reqId,
            reason: 'Control pertinente',
            scope: 'Componente sintético',
            criterion: 'Entrada inválida rechazada',
            method: 'Prueba automatizada',
            mandatory: true,
          },
        ],
      },
    });
    const checks = [];
    for (const check of work.checks)
      checks.push(
        await mcp('propose', {
          kind: 'task',
          operation: 'check',
          targetId: work.id,
          expectedVersion: work.version,
          patch: {
            practiceId: check.practiceId,
            state: 'Cumplido',
            note: 'Caso de prueba de cierre ejecutado',
          },
          rationale: 'Verificado',
        }),
      );
    const asvs = await mcp('asvs-task-propose', {
      projectId,
      taskId: work.id,
      reqId: requirement.reqId,
      expectedTaskVersion: work.version,
      expectedVersion: 0,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: 'Componente sintético',
      pendingScope: 'Resto del proyecto pendiente',
      note: 'Caso de seguridad observado',
      method: 'Prueba automatizada',
      responsible: 'Revisor sintético',
      evidence: [{ recordId: source.id, reference: source.title, revision: 'v1' }],
      rationale: 'Resultado contrastado',
    });
    const close = await mcp('propose', {
      kind: 'task',
      operation: 'update',
      targetId: work.id,
      expectedVersion: work.version,
      patch: { state: 'Completada', solution: 'Control probado con evidencia' },
      rationale: 'Cierre sintético',
    });
    await page.reload();
    await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
    await page.locator('.assistants .tabbar button').last().click();
    await page.getByRole('button', { name: /Tareas/ }).click();
    await page
      .getByRole('button', { name: /Aceptar lote de esta tarea/ })
      .first()
      .click();
    const preview = page.getByRole('dialog', { name: 'Vista previa de aceptación' });
    await expect(preview).toContainText(requirement.canonicalRef);
    await expect(preview).toContainText('Caso de seguridad observado');
    await expect(preview).toContainText(source.title);
    await expect(preview).toContainText('Control probado con evidencia');
    if (changedEvidence)
      await call('save', {
        kind: 'entry',
        id: source.id,
        expectedVersion: source.version,
        data: { ...source, result: 'Resultado modificado externamente' },
      });
    await preview.getByRole('button', { name: `Aceptar ${checks.length + 2} propuestas` }).click();
    await expect(preview).toHaveCount(0);
    const snapshot = await call('snapshot');
    if (changedEvidence) {
      await expect(page.locator('.assistants')).toContainText(
        'ASVS cambió. Revisa la vista previa de nuevo.',
      );
      expect(snapshot.proposals.find((p: { id: string }) => p.id === close.id).status).toBe(
        'pending',
      );
      expect(snapshot.asvs.proposals.find((p: { id: string }) => p.id === asvs.id).status).toBe(
        'pending',
      );
    } else {
      expect(snapshot.records.find((r: { id: string }) => r.id === work.id)).toMatchObject({
        state: 'Completada',
        description: work.description,
        solution: 'Control probado con evidencia',
      });
      expect(snapshot.asvs.proposals.find((p: { id: string }) => p.id === asvs.id).status).toBe(
        'accepted',
      );
      expect((await call('asvs-list', { projectId })).summary.fulfilled).toBe(0);
    }
  });
}

test('ASVS integración: crea, verifica y retira asociaciones desde el editor', async ({ page }) => {
  await unlock(page);
  const { projectId } = await asvsIntegrationSetup();
  const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
  await page.reload();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nueva tarea' });
  await editor.getByLabel('Título', { exact: true }).fill('Tarea con requisito ASVS');
  await editor.getByText('Requisitos ASVS de esta tarea (0)', { exact: true }).click();
  await editor.getByLabel('Referencia ASVS para asociar').fill('v4.0.3-1.2.5');
  await editor.getByRole('button', { name: 'Añadir referencia ASVS' }).click();
  await expect(editor).toContainText('Escribe una referencia existente');
  await editor.getByLabel('Referencia ASVS para asociar').fill(requirement.canonicalRef);
  await editor.getByRole('button', { name: 'Añadir referencia ASVS' }).click();
  await editor.getByLabel('Motivo de pertinencia').fill('Control para el componente sintético');
  await editor.getByLabel('Alcance de la tarea').fill('Componente sintético');
  await editor.getByLabel('Criterio observable').fill('El caso de prueba comprueba la condición');
  await editor.getByLabel('Método previsto de verificación').fill('Prueba automatizada');
  await editor.getByRole('button', { name: 'Crear registro' }).click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Verificación ASVS', exact: true })
    .click();
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.canonicalRef);
  const article = page.getByRole('article', { name: requirement.canonicalRef, exact: true });
  await article.getByRole('button', { name: /Tarea ASVS: Tarea con requisito ASVS/ }).click();
  const reopened = page.getByRole('dialog', { name: 'Editar tarea' });
  await reopened
    .getByText(`Revisar verificación de tarea ${requirement.reqId}`, { exact: true })
    .click();
  await reopened.getByLabel('Estado ASVS de la tarea').selectOption('Cumplido');
  await reopened.getByLabel('Nota de verificación de tarea').fill('Caso sintético ejecutado');
  await reopened.getByLabel('Responsable de verificación de tarea').fill('Revisor sintético');
  await reopened.getByLabel('Evidencia de verificación de tarea').fill('tests/security.test.ts');
  await reopened.getByLabel('Revisión de evidencia de tarea').fill('commit sintético 1');
  await reopened.getByRole('button', { name: 'Guardar verificación de tarea' }).click();
  await expect(
    reopened.getByText('Verificación de tarea: Cumplido', { exact: true }),
  ).toBeVisible();
  expect((await call('asvs-list', { projectId })).summary.fulfilled).toBe(0);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  expect((await new AxeBuilder({ page }).include('.task-asvs-links').analyze()).violations).toEqual(
    [],
  );
  await reopened.getByRole('button', { name: `Retirar ${requirement.reqId}`, exact: true }).click();
  await reopened.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(reopened).toHaveCount(0);
  const task = (await call('snapshot')).records.find(
    (r: { title: string }) => r.title === 'Tarea con requisito ASVS',
  );
  expect(task.asvsLinks).toEqual([]);
  expect(
    (await call('asvs-task-status', { projectId, taskId: task.id }))[0].status.reasons,
  ).toContain('Asociación retirada');
});

test('ASVS integración: revisa dos verificaciones distintas de la misma tarea', async ({
  page,
}) => {
  await unlock(page);
  const { projectId, mcp } = await asvsIntegrationSetup();
  const requirements = asvsCatalog.requirements.filter((r) => r.minLevel === 1).slice(0, 2);
  const task = await call('save', {
    kind: 'task',
    data: {
      ...(await import('../service/domain')).blank('task'),
      project: projectId,
      title: 'Verificación múltiple sintética',
      due: addDays(madridDate(), 1),
      asvsLinks: requirements.map((r) => ({
        catalogVersion: asvsCatalog.version,
        reqId: r.reqId,
        reason: 'Control pertinente',
        scope: 'Componente sintético',
        criterion: 'Entrada inválida rechazada',
        method: 'Prueba automatizada',
      })),
    },
  });
  for (const requirement of requirements)
    await mcp('asvs-task-propose', {
      projectId,
      taskId: task.id,
      reqId: requirement.reqId,
      expectedTaskVersion: task.version,
      expectedVersion: 0,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: 'Componente sintético',
      pendingScope: 'Resto del proyecto pendiente',
      note: 'Caso observado',
      method: 'Prueba automatizada',
      responsible: 'Revisor sintético',
      evidence: [{ reference: 'tests/security.test.ts', revision: 'revisión sintética 1' }],
      rationale: 'Resultado comprobado',
    });
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  for (const r of requirements)
    await page.getByLabel(`Seleccionar ${r.canonicalRef} para lote`).check();
  await page.getByRole('button', { name: 'Revisar lote ASVS (2)' }).click();
  const preview = page.getByRole('dialog', { name: 'Vista previa ASVS' });
  await preview.getByRole('button', { name: 'Aceptar evaluación ASVS (2)' }).click();
  await expect(preview).toHaveCount(0);
  const statuses = await call('asvs-task-status', { projectId, taskId: task.id });
  expect(statuses).toHaveLength(2);
  expect(
    statuses.every((s: { assessment: { state: string } }) => s.assessment.state === 'Cumplido'),
  ).toBe(true);
  expect((await call('asvs-list', { projectId })).summary.fulfilled).toBe(0);
});

test('ASVS integración: revisa tareas propuestas con texto, motivo y duplicados', async ({
  page,
}) => {
  await unlock(page);
  const { projectId, mcp } = await asvsIntegrationSetup();
  const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
  const link = {
    catalogVersion: asvsCatalog.version,
    reqId: requirement.reqId,
    reason: 'Motivo sintético de asociación',
    scope: 'Componente sintético',
    criterion: 'Caso observable',
    method: 'Pruebas automatizadas',
  };
  const patch = {
    project: projectId,
    title: 'Tarea ASVS propuesta',
    phase: 'Implementación',
    priority: 'Alta',
    due: madridDate(),
    description: 'Objetivo, contexto y criterios numerados de prueba',
    nextStep: 'Implementar el caso',
    asvsLinks: [link],
  };
  await call('save', {
    kind: 'task',
    data: {
      ...(await import('../service/domain')).blank('task'),
      ...patch,
      title: 'Tarea similar ASVS',
    },
  });
  const accepted = await mcp('propose', {
    operation: 'create',
    kind: 'task',
    patch,
    rationale: 'Asociar control sintético',
  });
  const rejected = await mcp('propose', {
    operation: 'create',
    kind: 'task',
    patch: { ...patch, title: 'Tarea ASVS rechazada' },
    rationale: 'Propuesta para rechazar',
  });
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await page.getByRole('button', { name: /Tareas/ }).click();
  const card = page.locator('.proposal-card', { hasText: patch.title });
  await card.getByRole('button', { name: 'Aceptar cambios' }).first().click();
  const preview = page.getByRole('dialog', { name: 'Vista previa de aceptación' });
  await expect(preview).toContainText(requirement.description);
  await expect(preview).toContainText(link.reason);
  await expect(preview).toContainText('Tarea similar ASVS');
  await preview.getByRole('button', { name: 'Aceptar 1 propuesta' }).click();
  const rejectCard = page.locator('.proposal-card', { hasText: 'Tarea ASVS rechazada' });
  await rejectCard.locator('.proposal-banner-toggle').click();
  await rejectCard.getByRole('button', { name: 'Rechazar', exact: true }).click();
  const snapshot = await call('snapshot');
  expect(snapshot.proposals.find((p: { id: string }) => p.id === accepted.id).status).toBe(
    'accepted',
  );
  expect(snapshot.proposals.find((p: { id: string }) => p.id === rejected.id).status).toBe(
    'rejected',
  );
  expect(
    snapshot.records.find((r: { title: string }) => r.title === patch.title).asvsLinks,
  ).toEqual([link]);
  expect(snapshot.records.some((r: { title: string }) => r.title === 'Tarea ASVS rechazada')).toBe(
    false,
  );
});

test('ASVS integración: revisa lotes de evaluaciones y exige decisión humana para excluir', async ({
  page,
}) => {
  await unlock(page);
  const { projectId, overview, mcp } = await asvsIntegrationSetup();
  const requirements = overview.items
    .slice(0, 3)
    .map((i: { assessment: { reqId: string } }) =>
      asvsCatalog.requirements.find((r) => r.reqId === i.assessment.reqId)!,
    );
  for (let index = 0; index < 3; index++) {
    const a = overview.items[index].assessment;
    await mcp('asvs-propose', {
      projectId,
      reference: requirements[index].canonicalRef,
      targetId: a.id,
      expectedVersion: a.version,
      expectedConfigVersion: 1,
      state: index === 2 ? 'No aplicable' : 'Cumplido',
      applicability: index === 2 ? 'No aplicable' : 'Aplicable',
      scope: 'project',
      scopeDetail: '',
      pendingScope: '',
      note:
        index === 2 ? 'Mecanismo ausente según análisis sintético' : 'Caso sintético verificado',
      method: 'Prueba automatizada',
      responsible: 'Revisor sintético',
      evidence:
        index === 2
          ? []
          : [{ reference: 'tests/security.test.ts', revision: 'commit sintético 1' }],
      rationale: 'Evaluación sintética con evidencia',
    });
  }
  expect((await call('asvs-list', { projectId })).summary.fulfilled).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  for (const r of requirements.slice(0, 2))
    await page.getByLabel(`Seleccionar ${r.canonicalRef} para lote`).check();
  await page.getByRole('button', { name: 'Revisar lote ASVS (2)' }).click();
  let preview = page.getByRole('dialog', { name: 'Vista previa ASVS' });
  await expect(preview).toContainText('Pendiente');
  await expect(preview).toContainText('Cumplido');
  await expect(preview).toContainText('commit sintético 1');
  await preview.getByRole('button', { name: 'Aceptar evaluación ASVS (2)' }).click();
  await expect(preview).toHaveCount(0);
  expect((await call('asvs-list', { projectId })).summary.fulfilled).toBe(2);
  const exclusion = page.getByRole('article', {
    name: `Propuesta ASVS ${requirements[2].canonicalRef}`,
    exact: true,
  });
  await exclusion.getByRole('button', { name: 'Revisar propuesta ASVS' }).click();
  preview = page.getByRole('dialog', { name: 'Vista previa ASVS' });
  await expect(preview.getByRole('button', { name: 'Aceptar evaluación ASVS (1)' })).toBeDisabled();
  expect((await call('asvs-list', { projectId })).summary.excluded).toBe(0);
  await preview.getByLabel('Apruebo la exclusión de aplicabilidad').check();
  await preview.getByLabel('Referencia de decisión humana').fill('ADR sintético 1');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  expect(
    (await new AxeBuilder({ page }).include('.proposal-preview-dialog').analyze()).violations,
  ).toEqual([]);
  await preview.getByRole('button', { name: 'Aceptar evaluación ASVS (1)' }).click();
  await expect(preview).toHaveCount(0);
  expect((await call('asvs-list', { projectId })).summary.excluded).toBe(1);
});

test('ASVS: activa niveles, navega por teclado, busca, filtra y conserva aislamiento', async ({
  page,
}) => {
  test.setTimeout(60000);
  await unlock(page);
  await expect(
    page.getByRole('button', { name: 'Buenas prácticas', exact: true }).locator('svg'),
  ).toHaveClass(/lucide-list-checks/);
  await expect(
    page.getByRole('button', { name: 'Verificación ASVS', exact: true }).locator('svg'),
  ).toHaveClass(/lucide-shield-check/);
  const navigate = () =>
    page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('button', { name: 'Verificación ASVS' })
      .click();
  await navigate();
  await expect(page.getByLabel('Nivel objetivo ASVS')).toHaveValue('');
  await expect(page.locator('.asvs-tree > details[open]')).toHaveCount(0);
  await page.getByLabel('Nivel objetivo ASVS').selectOption('1');
  await page.getByRole('button', { name: 'Guardar configuración ASVS' }).click();
  await expect(page.getByText('0 de 70 requisitos aplicables verificados')).toBeVisible();
  const chapter = page.locator('.asvs-tree > details').first();
  await chapter.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(chapter).toHaveAttribute('open', '');
  const section = chapter.locator('details').first();
  await expect(section).not.toHaveAttribute('open', '');
  await section.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(section).toHaveAttribute('open', '');
  const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.canonicalRef);
  const article = page.getByRole('article', { name: requirement.canonicalRef, exact: true });
  await expect(article).toBeVisible();
  const displayed = asvsDisplayRequirements.find((r) => r.reqId === requirement.reqId)!;
  await expect(article.locator(':scope > .asvs-description')).toHaveText(displayed.description);
  if (asvsTranslationProvider) {
    await expect(article.locator(':scope > .asvs-description')).toHaveAttribute('lang', 'es');
    await article.getByText('Ver original oficial en inglés', { exact: true }).click();
    await expect(article.locator('.asvs-original .asvs-description')).toHaveText(
      requirement.description,
    );
    await article.getByText('Ver original oficial en inglés', { exact: true }).click();
    await page.getByLabel('Buscar requisito ASVS').fill(displayed.description.slice(0, 40));
    await expect(article).toBeVisible();
    await page.getByLabel('Buscar requisito ASVS').fill(displayed.chapterName);
    await expect(article).toBeVisible();
  }
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.description.slice(0, 40));
  await expect(article).toBeVisible();
  await page.getByLabel('Nivel de consulta').selectOption('3');
  await expect(page.getByLabel('Nivel objetivo ASVS')).toHaveValue('1');
  expect((await call('snapshot')).asvs.config.level).toBe(1);
  await page.getByLabel('Filtrar estado ASVS').selectOption('Cumplido');
  await expect(
    page.getByText('No hay requisitos con estos filtros.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Filtrar estado ASVS').selectOption('all');
  await page.getByLabel('Filtrar aplicabilidad ASVS').selectOption('Aplicable');
  await expect(
    page.getByText('No hay requisitos con estos filtros.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Filtrar aplicabilidad ASVS').selectOption('all');
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.canonicalRef);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  expect((await new AxeBuilder({ page }).include('.asvs-view').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.tmp/asvs-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await expect(
    article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }),
  ).toHaveCSS('background-color', 'rgb(29, 42, 59)');
  expect((await new AxeBuilder({ page }).include('.asvs-view').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(article).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await page.locator('.sidebar').boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/asvs-mobile-dark.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await navigate();
  await expect(page.getByLabel('Nivel objetivo ASVS')).toHaveValue('1');
  await page.getByLabel('Nivel objetivo ASVS').selectOption('2');
  await page.getByRole('button', { name: 'Guardar configuración ASVS' }).click();
  await expect(page.getByText('0 de 253 requisitos aplicables verificados')).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await page.getByRole('button', { name: 'Crear otro cuaderno', exact: true }).click();
  await page.getByLabel('Nombre del cuaderno').fill('Segundo cuaderno ASVS de prueba');
  await page.getByLabel('Contraseña', { exact: true }).fill('Segunda contraseña de prueba ASVS');
  await page.getByLabel('Repite la contraseña').fill('Segunda contraseña de prueba ASVS');
  await page.getByRole('button', { name: 'Crear mi bitácora' }).click();
  await navigate();
  await expect(page.getByLabel('Nivel objetivo ASVS')).toHaveValue('');
  expect((await call('snapshot')).asvs).toBeUndefined();
});

test('ASVS: revisa evidencia, cobertura parcial, exclusión humana e historial', async ({
  page,
}) => {
  test.setTimeout(60000);
  await unlock(page);
  const { blank } = await import('../service/domain');
  const source = await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      title: 'Evidencia local ASVS de prueba',
      result: 'Prueba verificada',
    },
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Verificación ASVS' })
    .click();
  await page.getByLabel('Nivel objetivo ASVS').selectOption('1');
  await page.getByRole('button', { name: 'Guardar configuración ASVS' }).click();
  await expect(page.getByText('0 de 70 requisitos aplicables verificados')).toBeVisible();
  const requirement = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
  await page.getByLabel('Buscar requisito ASVS').fill(requirement.canonicalRef);
  const article = page.getByRole('article', { name: requirement.canonicalRef, exact: true });
  await article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }).click();
  let form = article.getByRole('form');
  await expect(form.getByLabel('Aplicabilidad', { exact: true })).toBeFocused();
  await form.getByLabel('Aplicabilidad', { exact: true }).selectOption('Aplicable');
  await form.getByLabel('Estado de evaluación').selectOption('Cumplido');
  await form.getByLabel('Método de verificación').fill('Prueba automatizada');
  await form.getByLabel('Responsable de revisión').fill('Revisor de prueba');
  await form
    .getByLabel('Justificación y siguiente paso')
    .fill('Se verificó el requisito en el sistema de pruebas.');
  await form.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(form.getByText('Cumplido exige evidencia concreta.')).toBeVisible();
  await form.getByRole('button', { name: 'Añadir evidencia' }).click();
  await form.getByLabel('Fuente 1', { exact: true }).selectOption(source.id);
  await form
    .getByLabel('Referencia concreta 1')
    .fill('tests/security.test.ts — caso satisfactorio');
  await form.getByLabel('Revisión o versión 1').fill('commit de prueba 1');
  await form.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(article.getByText('Cumplido vigente')).toBeVisible();
  await expect(page.getByText('1 de 70 requisitos aplicables verificados')).toBeVisible();
  await expect(
    article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }),
  ).toBeFocused();
  await article.getByRole('button', { name: 'Ver fuente: Evidencia local ASVS de prueba' }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Título del registro', { exact: true }),
  ).toHaveValue('Evidencia local ASVS de prueba');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await article
    .getByRole('button', { name: `Historial de ${requirement.reqId}`, exact: true })
    .click();
  await expect(article.locator('.asvs-history')).toContainText('Pendiente → Cumplido');
  await expect(article.locator('.asvs-history')).toContainText('commit de prueba 1');
  await article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }).click();
  form = article.getByRole('form');
  await form.getByLabel('Alcance evaluado').selectOption('component');
  await form.getByLabel('Componente o alcance cubierto').fill('API de prueba');
  await form.getByLabel('Alcance pendiente del proyecto').fill('Interfaz de prueba');
  await form.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(article.getByText('Cobertura parcial:', { exact: false })).toBeVisible();
  await expect(article.getByText('Cumplido vigente')).toHaveCount(0);
  await expect(page.getByText('0 de 70 requisitos aplicables verificados')).toBeVisible();
  await article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }).click();
  form = article.getByRole('form');
  await form.getByLabel('Aplicabilidad', { exact: true }).selectOption('No aplicable');
  await form
    .getByLabel('Motivo de no aplicabilidad')
    .fill('Componente ausente en el sistema evaluado');
  await form.getByLabel('Referencia de la decisión').fill('ADR de prueba 1');
  await form.getByLabel('Apruebo excluir este requisito del alcance del proyecto.').check();
  await form.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(page.getByText('0 de 69 requisitos aplicables verificados')).toBeVisible();
  await expect(article.getByText('Excluido del denominador', { exact: false })).toBeVisible();
  await page.getByLabel('Nivel objetivo ASVS').selectOption('2');
  await page.getByRole('button', { name: 'Guardar configuración ASVS' }).click();
  await expect(article.getByText('Evidencia desactualizada:', { exact: false })).toBeVisible();
  await expect(page.getByText('0 de 253 requisitos aplicables verificados')).toBeVisible();
  await page.getByLabel('Nivel objetivo ASVS').selectOption('');
  await page.getByRole('button', { name: 'Guardar configuración ASVS' }).click();
  await expect(
    article.getByRole('button', { name: `Revisar ${requirement.reqId}`, exact: true }),
  ).toBeDisabled();
  await article
    .getByRole('button', { name: `Historial de ${requirement.reqId}`, exact: true })
    .click();
  await expect(article.locator('.asvs-history')).toContainText('ADR de prueba 1');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  expect((await new AxeBuilder({ page }).include('.asvs-view').analyze()).violations).toEqual([]);
});

test('captura desde cualquier vista, clasifica desde la bandeja y exige desbloqueo', async ({
  page,
}) => {
  await unlock(page);
  for (const view of [
    'Hoy',
    'Revisión semanal',
    'Tablero',
    'Lista',
    'Diario',
    'Martes',
    'Memoria',
    'Buenas prácticas',
  ]) {
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('button', { name: view })
      .click();
    await expect(page.getByRole('button', { name: 'Captura rápida', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Captura rápida' }).click();
  await expect(page.getByRole('dialog', { name: 'Captura rápida' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Apunte' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Apunte' }).fill('Una idea desde cualquier vista');
  await expect(
    page.getByRole('status').filter({ hasText: 'Guardado en el vault cifrado' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Captura rápida', exact: true }).click();
  await page.getByRole('button', { name: 'Bandeja (1)' }).click();
  await expect(page.getByText('Una idea desde cualquier vista', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Idea', exact: true }).click();
  await expect(
    page.getByText('Clasificando un apunte de la bandeja.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect
    .poll(async () => (await call('snapshot')).captures[0].convertedRecordId)
    .toBeTruthy();
  const snapshot = await call('snapshot');
  expect(
    snapshot.records.filter(
      (record: { kind: string; title: string }) =>
        record.kind === 'idea' && record.title === 'Una idea desde cualquier vista',
    ),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await expect(page.getByRole('button', { name: 'Captura rápida: desbloquear' })).toBeVisible();
  await page.getByRole('button', { name: 'Captura rápida: desbloquear' }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeFocused();
});

test('vincula un objetivo desde la tarea y muestra resultado, evidencia y validación en Memoria', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const projectId = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  ).id;
  const work = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), project: projectId, title: 'Preparar prototipo' },
  })) as Task;
  const result = (await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      project: projectId,
      title: 'Revisar prototipo',
      result: 'Resultado comprobado',
    },
  })) as Entry;
  await page.reload();
  await page.getByRole('button', { name: 'Memoria', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  const newObjective = page.getByRole('dialog', { name: 'Nuevo objetivo' });
  await newObjective.getByLabel('Título', { exact: true }).fill('Evaluar prototipo');
  await newObjective.getByLabel('Qué se quiere lograr').fill('Revisar el resultado obtenido.');
  await newObjective.getByRole('button', { name: 'Crear registro' }).click();
  await expect(newObjective).toHaveCount(0);
  const card = page.locator('.objective-card', { hasText: 'Evaluar prototipo' });
  await expect(card).toContainText('sin trabajo');
  await expect(card).toContainText('sin evidencia');

  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar prototipo', exact: true }).click();
  const taskEditor = page.getByRole('dialog', { name: 'Editar tarea' });
  await taskEditor
    .getByLabel('Objetivo', { exact: true })
    .selectOption({ label: 'Evaluar prototipo' });
  await taskEditor.getByRole('button', { name: 'Vincular al objetivo' }).click();
  await expect(taskEditor.getByText('Evaluar prototipo · trabajo')).toBeVisible();
  await taskEditor.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(card).not.toContainText('sin trabajo');
  await card.getByRole('button', { name: 'Evaluar prototipo' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar objetivo' });
  await editor.getByLabel('Registro de apoyo').selectOption(result.id);
  await editor.getByLabel('Qué aporta').selectOption('resultado');
  await editor.getByRole('button', { name: 'Vincular registro' }).click();
  await editor.getByLabel('Registro de apoyo').selectOption(result.id);
  await editor.getByLabel('Qué aporta').selectOption('evidencia');
  await editor.getByLabel('Referencia de evidencia').fill('Informe de revisión');
  await editor.getByRole('button', { name: 'Vincular registro' }).click();
  await editor.getByLabel('Estado').selectOption('Validado');
  await editor.getByLabel('Fecha de validación').fill(madridDate());
  await editor.getByLabel('Responsable').fill('Responsable de prueba');
  await editor.getByLabel('Referencia de validación').fill('Acta de prueba');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editor).toHaveCount(0);
  await expect(card).toContainText('Sin lagunas registradas');
  const saved = (await call('snapshot')).records.find(
    (record: Objective) => record.kind === 'objective',
  ) as Objective;
  expect(saved.validation.state).toBe('Validado');
  expect(saved.links).toHaveLength(3);
  expect(saved.links.find((link) => link.sourceId === work.id)?.role).toBe('trabajo');

  await call('save', {
    kind: 'entry',
    id: result.id,
    expectedVersion: result.version,
    data: { ...result, result: '' },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(page.locator('.objective-card', { hasText: 'Evaluar prototipo' })).toContainText(
    'sin resultado',
  );
});

test('revisión semanal agrupa, abre bloqueos y guarda fecha y siguiente paso', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const dependency = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Preparar acceso', due: addDays(madridDate(), 2) },
  })) as Task;
  const blocked = (await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Integrar servicio',
      due: addDays(madridDate(), -1),
      dependencyIds: [dependency.id],
      nextStep: '',
    },
  })) as Task;
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Preparar informe',
      due: addDays(madridDate(), 10),
      nextStep: '',
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const unblock = page.getByRole('region', { name: 'Desbloquear' });
  const card = unblock.locator('.review-card', { hasText: 'Integrar servicio' });
  await expect(card).toContainText('Vencida');
  await expect(card).toContainText('Sin siguiente paso');
  await expect(page.getByRole('region', { name: 'Planificar' })).toContainText('Preparar informe');
  await card.getByRole('button', { name: /Preparar acceso/ }).click();
  await expect(page.getByRole('dialog', { name: 'Editar tarea' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();

  const newDue = addDays(madridDate(), 5);
  await card.getByLabel('Reprogramar fecha').fill(newDue);
  await card.getByRole('button', { name: 'Guardar fecha' }).click();
  await expect(card.getByLabel('Reprogramar fecha')).toHaveValue(newDue);
  await card.getByLabel('Siguiente paso').fill('Validar la integración');
  await card.getByRole('button', { name: 'Guardar paso' }).click();
  await expect(card.getByLabel('Siguiente paso')).toHaveValue('Validar la integración');
  const saved = (await call('snapshot')).records.find(
    (record: Task) => record.id === blocked.id,
  ) as Task;
  expect(saved).toMatchObject({
    due: newDue,
    nextStep: 'Validar la integración',
    state: blocked.state,
  });

  const currentDependency = (await call('snapshot')).records.find(
    (record: Task) => record.id === dependency.id,
  ) as Task;
  await call('save', {
    kind: 'task',
    data: { ...currentDependency, state: 'Completada' },
    id: dependency.id,
    expectedVersion: currentDependency.version,
  });
  await expect(page.getByRole('region', { name: 'Atender' })).toContainText('Integrar servicio', {
    timeout: 10000,
  });
  await expect(unblock).not.toContainText('Integrar servicio');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/revision-semanal.png', fullPage: true });
});

test('revisión semanal funciona con teclado y en una ventana estrecha', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea de teclado', due: madridDate(), nextStep: '' },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const card = page.locator('.review-card', { hasText: 'Tarea de teclado' });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const title = card.getByRole('button', { name: 'Tarea de teclado' });
  await title.focus();
  await page.keyboard.press('Tab');
  await expect(card.getByLabel('Reprogramar fecha')).toBeFocused();
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Editar tarea' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await card.getByLabel('Siguiente paso').focus();
  await page.keyboard.type('Verificar con teclado');
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: 'Guardar paso' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card.getByLabel('Siguiente paso')).toHaveValue('Verificar con teclado');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/revision-semanal-movil.png' });
});

test('revisión semanal crea seguimiento, pospone una señal y muestra resultados sin evidencia', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const meeting = await call('save', {
    kind: 'meeting',
    data: {
      ...blank('meeting'),
      project: project.id,
      title: 'Reunión de seguimiento',
      closedAt: new Date().toISOString(),
      agreementItems: [{ text: 'Comprobar el informe', requiresFollowUp: true }],
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const followUp = page.getByRole('region', { name: 'Seguimiento' });
  await expect(followUp).toContainText('Comprobar el informe');
  await followUp.getByRole('button', { name: 'Crear tarea desde acuerdo' }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva tarea' })).toBeVisible();
  expect(
    (await call('snapshot')).records.filter((record: { kind: string }) => record.kind === 'task'),
  ).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const linked = await call('snapshot');
  const task = linked.records.find((record: Task) => record.kind === 'task') as Task;
  expect(
    linked.records.find((record: { id: string }) => record.id === meeting.id).agreementItems[0]
      .followUpTaskId,
  ).toBe(task.id);
  await expect(followUp).not.toContainText('Comprobar el informe');

  await call('delete-task', { id: task.id, expectedVersion: task.version });
  await page.reload();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const signal = page
    .getByRole('region', { name: 'Seguimiento' })
    .locator('.review-card', { hasText: 'Comprobar el informe' });
  await expect(signal).toBeVisible();
  await signal.getByRole('button', { name: 'Posponer', exact: true }).click();
  await expect(signal).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Seguimiento' })).not.toContainText(
    'Comprobar el informe',
  );
  await page.getByRole('button', { name: 'Terminar revisión' }).click();
  await expect(page.getByText('Comparando con la revisión del')).toBeVisible();

  await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      project: project.id,
      title: 'Resultado verificado',
      result: 'La prueba pasó',
      contribution: 'Validé',
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  const evidence = page
    .getByRole('region', { name: 'Seguimiento' })
    .locator('.review-card', { hasText: 'Resultado verificado' });
  await expect(evidence).toContainText('no tiene referencia de evidencia');
  await evidence.getByRole('button', { name: 'Abrir entrada' }).click();
  await page.getByRole('dialog').getByLabel('Evidencia o referencia').fill('Informe local');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(evidence).toHaveCount(0);
});

test('el editor de reuniones registra acuerdos individuales y vincula tareas existentes', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const meeting = await call('save', {
    kind: 'meeting',
    data: {
      ...blank('meeting'),
      title: 'Reunión con acuerdos',
      closedAt: new Date().toISOString(),
    },
  });
  const task = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea vinculable' },
  })) as Task;
  await page.reload();
  await page.getByRole('button', { name: 'Martes', exact: true }).click();
  await page
    .locator('.meeting-card', { hasText: 'Reunión con acuerdos' })
    .getByRole('button', { name: 'Revisar' })
    .click();
  const editor = page.getByRole('dialog', { name: 'Editar reunión' });
  await editor.getByRole('button', { name: 'Añadir acuerdo' }).click();
  await editor.getByLabel('Acuerdo 1', { exact: true }).fill('Acordar pruebas de aceptación');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editor).toHaveCount(0);
  const saved = (await call('snapshot')).records.find(
    (record: { id: string }) => record.id === meeting.id,
  );
  expect(saved.agreementItems[0].id).toBeTruthy();
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Seguimiento' })).toContainText(
    'Acordar pruebas de aceptación',
  );

  await page.getByRole('button', { name: 'Martes', exact: true }).click();
  await page
    .locator('.meeting-card', { hasText: 'Reunión con acuerdos' })
    .getByRole('button', { name: 'Revisar' })
    .click();
  await editor.getByLabel('Tarea vinculada al acuerdo 1').selectOption(task.id);
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisión semanal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Seguimiento' })).not.toContainText(
    'Acordar pruebas de aceptación',
  );
});

test('elige y cambia el perfil MCP del cuaderno', async ({ page }) => {
  await page.goto(`${url}/#session=${token}`);
  await page.getByLabel('Nombre del cuaderno').fill('Empresa');
  await page.getByLabel('Perfil MCP del cuaderno').selectOption('corporativo');
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba de bitácora segura');
  await page.getByLabel('Repite la contraseña').fill('Prueba de bitácora segura');
  await page.getByRole('button', { name: 'Crear mi bitácora' }).click();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
  expect((await call('snapshot')).mcpProfile).toBe('corporativo');
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await expect(page.getByText('La conexión MCP está bloqueada', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Ajustes y copias' }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes y copias' });
  await settings.getByLabel('Perfil', { exact: true }).selectOption('personal');
  await settings.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect(settings.getByText('Perfil guardado.', { exact: false })).toBeVisible();
  expect((await call('snapshot')).mcpProfile).toBe('personal');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await expect(page.getByLabel('Cliente')).toBeVisible();
});

test('adjunta Markdown al crear una tarea y permite consultarlo y quitarlo', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nueva tarea' });
  await editor.locator('.attachments').screenshot({ path: 'test-results/adjuntos-oscuro.png' });
  await editor.getByLabel('Título', { exact: true }).fill('Tarea con evidencia');
  await editor.locator('input[type=file]').setInputFiles({
    name: 'evidencia.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Evidencia de prueba'),
  });
  await expect(editor.getByText('evidencia.md')).toBeVisible();
  await editor.getByRole('button', { name: 'Crear registro' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.locator('.week-strip > button[aria-current="date"]').click();
  const dayDetails = page.getByRole('dialog', { name: 'Detalles del día' });
  await dayDetails.locator('.day-details-section.task > summary').click();
  const dayCard = dayDetails.locator('.day-detail-card', { hasText: 'Tarea con evidencia' });
  await dayCard.locator('summary').first().click();
  await expect(dayCard.getByText('evidencia.md')).toBeVisible();
  await dayDetails.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await page.getByRole('button', { name: /Tarea con evidencia/ }).click();
  const reopened = page.getByRole('dialog', { name: 'Editar tarea' });
  await reopened.getByText('Vista previa').click();
  await expect(reopened.locator('.attachment-markdown')).toContainText('# Evidencia de prueba');
  await reopened.getByRole('button', { name: 'Quitar evidencia.md' }).click();
  await reopened.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(reopened).toHaveCount(0);
  const saved = (await call('snapshot')).records.find(
    (record: { title: string }) => record.title === 'Tarea con evidencia',
  );
  expect(saved.attachments).toEqual([]);
});

test('muestra solo la próxima aparición en Tablero y Lista y avanza al completarla', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nueva tarea' });
  await editor.getByLabel('Título', { exact: true }).fill('Revisión recurrente');
  await editor.getByLabel('Fecha de finalización').fill(addDays(madridDate(), 1));
  await editor.getByLabel('Repetición').selectOption('weekly');
  await editor.getByRole('button', { name: 'Crear registro' }).click();
  await expect(editor).toHaveCount(0);
  const snapshot = await call('snapshot');
  expect(snapshot.taskSeries).toHaveLength(1);
  expect(
    snapshot.records.filter(
      (record: Task) =>
        record.kind === 'task' && record.recurrence?.seriesId === snapshot.taskSeries[0].id,
    ).length,
  ).toBeGreaterThan(1);
  const occurrences = (snapshot.records as Task[])
    .filter(
      (record) =>
        record.kind === 'task' && record.recurrence?.seriesId === snapshot.taskSeries[0].id,
    )
    .sort((left, right) => left.due.localeCompare(right.due));
  await expect(page.locator('.task-card', { hasText: 'Revisión recurrente' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  const rows = page.locator('.task-list-table-row', { hasText: 'Revisión recurrente' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('time')).toHaveAttribute('dateTime', occurrences[0].due);
  await call('save', {
    kind: 'task',
    id: occurrences[0].id,
    expectedVersion: occurrences[0].version,
    data: { ...occurrences[0], state: 'Completada', completedAt: new Date().toISOString() },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('time')).toHaveAttribute('dateTime', occurrences[1].due);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await expect(page.locator('.task-card', { hasText: 'Revisión recurrente' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Series recurrentes' });
  await manager.locator('summary').first().click();
  await manager.getByLabel('Título de la serie').fill('Revisión actualizada');
  await manager.getByRole('button', { name: 'Guardar serie' }).click();
  await expect(manager.getByText('Revisión actualizada').first()).toBeVisible();
  expect(
    (await call('snapshot')).records.filter(
      (record: Task) => record.kind === 'task' && record.title === 'Revisión actualizada',
    ).length,
  ).toBeGreaterThan(1);
  await manager.locator('summary').first().click();
  page.once('dialog', (dialog) => void dialog.accept());
  await manager.getByRole('button', { name: 'Detener serie' }).click();
  await expect(manager.getByText('Detenida').first()).toBeVisible();
});

test('revisa una creación MCP con adjunto antes de guardar registro y archivo', async ({
  page,
}) => {
  await unlock(page);
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'claude',
    scope: 'projects',
    projectIds: [project.id],
  });
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'propose',
      input: {
        operation: 'create',
        kind: 'idea',
        patch: {
          project: project.id,
          title: 'Idea con archivo',
          date: madridDate(),
          description: 'Idea documentada para la prueba.',
          attachments: [{ name: 'notas.md', mime: 'text/markdown', text: '# Notas de prueba' }],
        },
        rationale: 'Contexto adicional',
      },
    }),
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(
    (await call('snapshot')).records.some(
      (record: { title: string }) => record.title === 'Idea con archivo',
    ),
  ).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await page.getByRole('button', { name: /Ideas/ }).click();
  const proposal = page.locator('.proposal', { hasText: 'Idea con archivo' });
  await proposal.locator('.proposal-banner-toggle').click();
  await expect(proposal).toContainText('notas.md · text/markdown');
  await expect(proposal).not.toContainText('# Notas de prueba');
  await proposal.getByRole('button', { name: 'Aceptar cambios' }).first().click();
  const preview = page.getByRole('dialog', { name: 'Vista previa de aceptación' });
  await expect(preview).toContainText('1 propuesta compatible cambiará 1 registro');
  await expect(preview).not.toContainText('# Notas de prueba');
  await preview.getByRole('button', { name: 'Aceptar 1 propuesta' }).click();
  await expect(proposal).toHaveCount(0);
  const created = (await call('snapshot')).records.find(
    (record: { title: string }) => record.title === 'Idea con archivo',
  );
  expect(created.attachments).toHaveLength(1);
});

test('avisa solo de propuestas nuevas y abre la propuesta exacta con teclado', async ({ page }) => {
  await page.addInitScript(() => {
    const audio = window as typeof window & { proposalSoundCount: number };
    audio.proposalSoundCount = 0;
    Object.defineProperty(window, 'AudioContext', {
      value: class {
        currentTime = 0;
        destination = {};
        createOscillator() {
          return {
            type: '',
            frequency: { value: 0 },
            connect() {},
            start() {},
            stop() {},
            onended: null,
          };
        }
        createGain() {
          return {
            gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {},
          };
        }
        resume() {
          audio.proposalSoundCount++;
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
      },
    });
  });
  const soundCount = () =>
    page.evaluate(
      () => (window as typeof window & { proposalSoundCount: number }).proposalSoundCount,
    );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await unlock(page);
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [project.id],
  });
  async function propose(title: string) {
    const response = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'propose',
        input: {
          operation: 'create',
          kind: 'idea',
          patch: {
            project: project.id,
            title,
            date: madridDate(),
            description: 'Propuesta de prueba para revisión.',
          },
          rationale: 'Verificar el aviso de nuevas propuestas.',
        },
      }),
    });
    expect(response.status).toBe(200);
  }

  await propose('Propuesta anterior');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  const notice = page.getByRole('status').filter({ hasText: 'Nueva propuesta' });
  await expect(notice).toHaveCount(0);
  expect(await soundCount()).toBe(0);

  await propose('Propuesta recién llegada');
  await expect(notice).toContainText('Propuesta recién llegada', { timeout: 12000 });
  expect(await soundCount()).toBe(1);
  const mobilePresentation = await notice.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      center: bounds.left + bounds.width / 2,
      width: bounds.width,
      viewportWidth: innerWidth,
      background: styles.backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number) || [],
      text: styles.color.match(/\d+/g)?.slice(0, 3).map(Number) || [],
    };
  });
  expect(Math.abs(mobilePresentation.center - mobilePresentation.viewportWidth / 2)).toBeLessThan(
    2,
  );
  expect(mobilePresentation.width).toBeGreaterThan(350);
  expect(mobilePresentation.background.every((channel) => channel < 100)).toBe(true);
  expect(mobilePresentation.text.every((channel) => channel > 200)).toBe(true);
  await page.setViewportSize({ width: 1200, height: 844 });
  const desktopPresentation = await notice.boundingBox();
  expect(desktopPresentation!.width).toBeGreaterThan(500);
  expect(Math.abs(desktopPresentation!.x + desktopPresentation!.width / 2 - 600)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await propose('Segunda propuesta');
  await propose('Tercera propuesta');
  await expect.poll(soundCount).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const open = notice.getByRole('button', { name: 'Abrir propuesta' });
  await open.focus();
  await page.keyboard.press('Enter');

  const assistants = page.getByRole('dialog', { name: 'Tus asistentes, tu contexto' });
  const target = assistants.locator('.proposal-card', { hasText: 'Propuesta recién llegada' });
  await expect(target).toBeVisible();
  await expect(target.locator('.proposal-banner-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(target.locator('.proposal-banner-toggle')).toBeFocused();
  await expect(assistants.locator('.proposal-card', { hasText: 'Propuesta anterior' })).toHaveCount(
    1,
  );
  await expect(notice).toContainText('Segunda propuesta');
  await notice.getByRole('button', { name: 'Descartar aviso de propuesta' }).click();
  await expect(notice).toContainText('Tercera propuesta');
  await notice.getByRole('button', { name: 'Descartar aviso de propuesta' }).click();
  await expect(notice).toHaveCount(0);
  await page.waitForTimeout(5500);
  await expect(notice).toHaveCount(0);
  expect(await soundCount()).toBe(2);
  const soundControl = assistants.getByRole('checkbox', {
    name: 'Sonido al recibir propuestas nuevas',
  });
  await soundControl.uncheck();
  await assistants.getByRole('button', { name: 'Probar sonido' }).click();
  await expect.poll(soundCount).toBe(3);
  await propose('Propuesta silenciosa');
  await expect(notice).toContainText('Propuesta silenciosa', { timeout: 12000 });
  expect(await soundCount()).toBe(3);
  await page.reload();
  await page.setViewportSize({ width: 1200, height: 844 });
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await expect(soundControl).not.toBeChecked();
  await soundControl.check();
  await page.evaluate(() => {
    Object.defineProperty(window, 'AudioContext', {
      value: class {
        constructor() {
          throw new Error('Audio bloqueado');
        }
      },
    });
  });
  await propose('Propuesta con audio bloqueado');
  await expect(notice).toContainText('Propuesta con audio bloqueado', { timeout: 12000 });
  await notice.getByRole('button', { name: 'Abrir propuesta' }).click();
  await expect(
    assistants.locator('.proposal-card', { hasText: 'Propuesta con audio bloqueado' }),
  ).toBeVisible();
});

test('acepta en lote cambios compatibles sobre una tarea y separa los incompatibles', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const task = await call('save', {
    kind: 'task',
    data: { ...blank('task'), project: project.id, title: 'Tarea para revisar', due: '2027-12-31' },
  });
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [project.id],
  });
  for (const patch of [
    { title: 'Título revisado' },
    { description: 'Descripción revisada' },
    { title: 'Título incompatible' },
  ]) {
    const response = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'propose',
        input: {
          operation: 'update',
          kind: 'task',
          targetId: task.id,
          expectedVersion: task.version,
          patch,
          rationale: 'Revisión',
        },
      }),
    });
    expect(response.status).toBe(200);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await expect(
    page.getByRole('button', { name: /Aceptar todas las propuestas \(2\)/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Tareas/ }).click();
  const conflicted = page.locator('.proposal', { hasText: 'Título revisado' });
  await conflicted.locator('.proposal-banner-toggle').click();
  await expect(conflicted.getByText(/campo title/)).toBeVisible();
  await page.getByRole('button', { name: /Aceptar todas las propuestas \(2\)/ }).click();
  const preview = page.getByRole('dialog', { name: 'Vista previa de aceptación' });
  await expect(preview).toContainText('2 propuestas compatibles cambiarán 1 registro');
  await expect(preview).toContainText('Título incompatible');
  await expect(preview).toContainText('Descripción revisada');
  await expect(preview).toContainText('cambia de forma incompatible');
  await preview.getByRole('button', { name: 'Aceptar 2 propuestas' }).click();
  await expect(page.locator('.proposal')).toHaveCount(1);
  const updated = (await call('snapshot')).records.find(
    (record: { id: string }) => record.id === task.id,
  );
  expect(updated.title).toBe('Título incompatible');
  expect(updated.description).toBe('Descripción revisada');
  await expect(page.locator('.proposal')).toHaveCount(1);
});

test('agrupa y acepta criterio y cierre de una misma tarea', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const criterion = await call('save', {
    kind: 'practice',
    data: {
      ...blank('practice'),
      project: project.id,
      title: 'Verificar pruebas',
      status: 'Recomendación personal',
      mandatory: true,
    },
  });
  const task = await call('save', {
    kind: 'task',
    data: { ...blank('task'), project: project.id, title: 'Tarea con cierre conjunto' },
  });
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [project.id],
  });
  for (const input of [
    {
      operation: 'check',
      kind: 'task',
      targetId: task.id,
      expectedVersion: task.version,
      patch: { practiceId: criterion.id, state: 'Cumplido', note: 'Pruebas verificadas.' },
      rationale: 'Evidencia',
    },
    {
      operation: 'update',
      kind: 'task',
      targetId: task.id,
      expectedVersion: task.version,
      patch: { state: 'Completada', solution: 'Trabajo verificado.' },
      rationale: 'Cierre',
    },
  ]) {
    const response = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'propose', input }),
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await page.getByRole('button', { name: /Tareas/ }).click();
  const batch = page.locator('.proposal-task-batch');
  await expect(batch).toHaveCount(1);
  await expect(batch).toContainText('Tarea con cierre conjunto');
  await expect(batch).toContainText('2 propuestas de esta tarea · 1 verificación · 1 cierre');
  const verification = page.locator('.proposal-card', { hasText: 'Verificación' });
  await verification.locator('.proposal-banner-toggle').click();
  await expect(verification.getByText('Esta verificación se aceptará junto')).toBeVisible();
  await expect(verification.getByText('El original ha cambiado')).toHaveCount(0);
  await batch.getByRole('button', { name: 'Aceptar lote de esta tarea (2)' }).click();
  const preview = page.getByRole('dialog', { name: 'Vista previa de aceptación' });
  await expect(preview).toContainText('Criterio: Verificar pruebas');
  await expect(preview).toContainText('Por hacer');
  await expect(preview).toContainText('Completada');
  await preview.getByRole('button', { name: 'Aceptar 2 propuestas' }).click();
  await expect(page.locator('.proposal-card')).toHaveCount(0);
  const updated = (await call('snapshot')).records.find(
    (record: { id: string }) => record.id === task.id,
  );
  expect(updated.state).toBe('Completada');
  expect(updated.checks[0]).toMatchObject({ practiceId: criterion.id, state: 'Cumplido' });
  await expect(page.locator('.proposal-card')).toHaveCount(0);
});

test('impide aceptar una vista previa cuando el registro cambia antes de confirmar', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const task = await call('save', {
    kind: 'task',
    data: { ...blank('task'), project: project.id, title: 'Tarea vigente', due: '2027-12-31' },
  });
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await call('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [project.id],
  });
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'propose',
      input: {
        operation: 'update',
        kind: 'task',
        targetId: task.id,
        expectedVersion: task.version,
        patch: { title: 'Título propuesto' },
        rationale: 'Revisión',
      },
    }),
  });
  expect(response.status).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.locator('.assistants .tabbar button').last().click();
  await page.getByRole('button', { name: /Tareas/ }).click();
  await page.getByRole('button', { name: 'Aceptar cambios' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Vista previa de aceptación' })).toBeVisible();
  await call('save', {
    kind: 'task',
    data: { ...task, description: 'Edición posterior' },
    id: task.id,
    expectedVersion: task.version,
  });
  await page
    .getByRole('dialog', { name: 'Vista previa de aceptación' })
    .getByRole('button', { name: 'Aceptar 1 propuesta' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Vista previa de aceptación' })).toHaveCount(0);
  await expect(
    page.getByText('Los registros cambiaron. Revisa la vista previa de nuevo.'),
  ).toBeVisible();
  const current = (await call('snapshot')).records.find(
    (record: { id: string }) => record.id === task.id,
  );
  expect(current.title).toBe('Tarea vigente');
});

test('copiar ID usa el registro correcto en Hoy, Tablero y Diario', async ({ page }) => {
  await unlock(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const { blank } = await import('../service/domain');
  const task = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea para copiar' },
  })) as Task;
  const incident = await call('save', {
    kind: 'incident',
    data: { ...blank('incident'), title: 'Incidencia para copiar' },
  });
  const idea = await call('save', {
    kind: 'idea',
    data: { ...blank('idea'), title: 'Idea para copiar' },
  });
  await page.reload();

  await page
    .locator('.task-row')
    .filter({ hasText: task.title })
    .getByRole('button', { name: 'Copiar ID', exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(task.id);

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  const taskCard = page.locator('.task-card').filter({ hasText: task.title });
  await taskCard.getByRole('button', { name: 'Copiar ID', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(task.id);
  const incidentCard = page.locator('.task-card').filter({ hasText: incident.title });
  await incidentCard.getByRole('button', { name: 'Copiar ID', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(incident.id);

  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Ideas', exact: true }).click();
  await page
    .locator('.timeline-item')
    .filter({ hasText: idea.title })
    .getByRole('button', { name: 'Copiar ID', exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(idea.id);
});

test('Lista muestra todo el proyecto y permite buscar, filtrar y ordenar por varios criterios', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  for (const data of [
    {
      title: 'Alfa alta',
      priority: 'Alta',
      state: 'Por hacer',
      phase: 'Diseño',
      due: '2026-10-01',
    },
    {
      title: 'Beta baja',
      priority: 'Baja',
      state: 'Por hacer',
      phase: 'Diseño',
      due: '2026-10-01',
    },
    {
      title: 'Cerrada antigua',
      priority: 'Media',
      state: 'Completada',
      phase: 'Validación',
      due: '2026-01-01',
    },
  ]) {
    await call('save', { kind: 'task', data: { ...blank('task'), ...data } });
  }
  await page.reload();

  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav.getByRole('button', { name: 'Lista' })).toBeVisible();
  const navLabels = (await nav.locator('button').allTextContents()).map((label) => label.trim());
  expect(navLabels.indexOf('Lista')).toBe(navLabels.indexOf('Tablero') + 1);
  expect(navLabels.indexOf('Diario')).toBe(navLabels.indexOf('Lista') + 1);
  await nav.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.getByLabel('Orden principal').click();
  await page.screenshot({ path: '.tmp/sort-options-dark.png' });
  await page.keyboard.press('Escape');
  const table = page.getByRole('table', { name: 'Tareas del proyecto' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('button', { name: 'Cerrada antigua', exact: true })).toBeVisible();
  await expect(page.getByText('3 de 3 tareas')).toBeVisible();

  const rows = table.locator('.task-list-table-row');
  await page.getByLabel('Orden principal').selectOption('title');
  await expect(rows.first()).toContainText('Alfa alta');
  await page.getByLabel('Orden principal').selectOption('due');
  await expect(rows.first()).toContainText('Cerrada antigua');
  await page.getByLabel('Nuevo criterio secundario').selectOption('priority');
  await page.getByRole('button', { name: 'Añadir criterio' }).click();
  await expect(page.getByLabel('Orden principal').locator('option[value="priority"]')).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Orden secundario 2').locator('option[value="due"]')).toHaveCount(0);
  await expect(
    page.getByLabel('Nuevo criterio secundario').locator('option[value="priority"]'),
  ).toHaveCount(0);
  await expect(rows.nth(1)).toContainText('Alfa alta');
  await expect(rows.nth(2)).toContainText('Beta baja');
  await page.getByRole('button', { name: 'Cambiar dirección de Prioridad' }).click();
  await expect(rows.nth(1)).toContainText('Beta baja');
  await page.getByLabel('Nuevo criterio secundario').selectOption('phase');
  await page.getByRole('button', { name: 'Añadir criterio' }).click();
  await expect(
    page.getByLabel('Orden secundario 3').locator('option[value="priority"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Quitar orden por Fase' }).click();
  await expect(
    page.getByLabel('Nuevo criterio secundario').locator('option[value="phase"]'),
  ).toHaveCount(1);
  await table.getByRole('button', { name: 'Ordenar por Prioridad' }).click();
  await expect(rows.first()).toContainText('Beta baja');
  await table.getByRole('button', { name: 'Ordenar por Fecha' }).click();
  await expect(rows.first()).toContainText('Cerrada antigua');

  await page.getByLabel('Buscar tareas').fill('Alfa');
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('1 de 3 tareas')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar búsqueda y filtros' }).first().click();

  const filters = page.getByRole('region', { name: 'Filtros de tareas' });
  await filters.locator('.task-filters-toggle').click();
  await filters
    .getByRole('group', { name: 'Estado' })
    .getByRole('button', { name: 'Completada' })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(
    filters.getByRole('button', { name: 'Quitar filtro Estado: Completada' }),
  ).toBeVisible();
  await page.reload();
  await nav.getByRole('button', { name: 'Lista' }).click();
  await expect(rows).toHaveCount(1);
  await filters.getByRole('button', { name: 'Quitar filtro Estado: Completada' }).click();
  await expect(rows).toHaveCount(3);
  await filters.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await expect(rows).toHaveCount(2);
  await filters.getByRole('button', { name: 'Quitar fecha desde' }).click();
  await expect(rows).toHaveCount(3);

  await table.getByRole('button', { name: 'Cerrada antigua', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => table.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.task-list-sort-tools')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
});
test('la solución de una tarea se edita sin modificar su descripción', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Separar requisito y solución');
  await page.getByLabel('Descripción', { exact: true }).fill('Requisito inicial');
  await page.getByLabel('Solución', { exact: true }).fill('Implementación verificada');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const saved = (await call('snapshot')).records.find(
    (record: Task) => record.title === 'Separar requisito y solución',
  ) as Task;
  expect(saved).toMatchObject({
    description: 'Requisito inicial',
    solution: 'Implementación verificada',
  });
});
test('los campos multilínea del popup crecen, se reducen y conservan el acceso a los controles', async ({
  page,
}) => {
  await unlock(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  const description = dialog.getByLabel('Descripción', { exact: true });
  const height = () => description.evaluate((element) => element.getBoundingClientRect().height);
  const initialHeight = await height();
  await description.fill('Línea uno\nLínea dos\nLínea tres\nLínea cuatro\nLínea cinco');
  await expect.poll(height).toBeGreaterThan(initialHeight);
  await description.fill('Texto breve');
  await expect.poll(height).toBeLessThan(initialHeight + 1);

  await description.fill('Texto que se ajusta al ancho de la ventana. '.repeat(80));
  await expect.poll(height).toBeGreaterThan(initialHeight);
  await expect.poll(height).toBeLessThanOrEqual(281);
  await expect
    .poll(() => description.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await dialog.getByLabel('Título', { exact: true }).fill('Comprobar altura de campos');
  await dialog.getByRole('button', { name: 'Crear registro' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Lista' })
    .click();
  await page
    .getByRole('table', { name: 'Tareas del proyecto' })
    .getByRole('button', { name: 'Comprobar altura de campos', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Editar tarea' });
  const existing = edit.getByLabel('Descripción', { exact: true });
  await expect
    .poll(() => existing.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await existing.fill('Una línea');
  await expect
    .poll(() => existing.evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThanOrEqual(initialHeight + 1);
  await existing.focus();
  await expect(existing).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(edit.getByLabel('Solución', { exact: true })).toBeFocused();
});
test('el tema se conserva al reabrir y al bloquear la bitácora', async ({ page }) => {
  await page.goto(`${url}/#session=${token}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`${url}/#session=${token}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Activar modo claro' })).toBeVisible();

  await page.getByLabel('Nombre del cuaderno').fill('Proyecto conectado');
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba de bitácora segura');
  await page.getByLabel('Repite la contraseña').fill('Prueba de bitácora segura');
  await page.getByRole('button', { name: 'Crear mi bitácora' }).click();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Activar modo claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await expect(page.getByRole('button', { name: 'Activar modo oscuro' })).toBeVisible();
  await page.goto(`${url}/#session=${token}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('recorrido completo: proyecto, tarea, diario, martes y memoria', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await unlock(page);
  await page.getByRole('button', { name: 'Editar proyecto Proyecto conectado' }).click();
  await page.getByLabel('Objetivo', { exact: true }).fill('Diseñar una integración trazable');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Crear mi primera tarea' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Comparar alternativas de autenticación');
  await page.getByLabel('Estado', { exact: true }).selectOption('En curso');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByLabel('¿En qué has avanzado?')
    .fill('He comparado dos alternativas y preparado un diagrama inicial.');
  await page
    .getByLabel('Resultado', { exact: true })
    .fill('Alternativas documentadas con ventajas y límites.');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await expect(
    page.getByText('He comparado dos alternativas y preparado un diagrama inicial.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Martes', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar reunión', exact: true }).click();
  await expect(page.getByLabel('Informe', { exact: true })).toContainText(
    'Alternativas documentadas',
  );
  await page.getByLabel('Acuerdos', { exact: true }).fill('Confirmar permisos con el equipo');
  await page.getByLabel('Cerrar reunión y usar este periodo como punto de partida').check();
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Memoria', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar y exportar' }).click();
  await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeDisabled();
  await page
    .getByLabel('He revisado este contenido para su destinatario y puedo compartirlo.')
    .check();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.screenshot({ path: 'test-results/bitacora-hoy.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('requisitos obligatorios y revisión de versiones', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva práctica', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Revisión de seguridad previa');
  await page.getByLabel('Estado de la práctica').selectOption('Recomendación personal');
  await page.getByLabel('Requisito obligatorio').check();
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Entregar diseño');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openBoardGroup(page, 'Entregar diseño');
  await page.getByRole('button', { name: /Entregar diseño/ }).click();
  const taskEditor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(taskEditor).toBeVisible();
  await expect(page.getByRole('region', { name: 'Editar tarea en el tablero' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Criterios de calidad' })).toHaveCount(0);
  const criteriaSection = taskEditor.locator('.criteria-section');
  await expect(criteriaSection).toHaveAttribute('open');
  await expect(criteriaSection.locator('summary').first()).toContainText('pendientes');
  await expect(criteriaSection.locator('.check-editor-details[open]')).toHaveCount(0);
  await page.getByLabel('Estado', { exact: true }).selectOption('Completada');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Hay requisitos obligatorios pendientes' }),
  ).toBeVisible();
  const criterion = page
    .locator('.check-editor')
    .filter({ hasText: 'Revisión de seguridad previa' });
  await expect(criterion).toContainText('Pendiente');
  await criterion.getByRole('checkbox', { name: 'Cumplido: Revisión de seguridad previa' }).check();
  await expect(criterion).toContainText('Cumplido');
  await criterion.locator('.check-editor-details > summary').click();
  await expect(criteriaSection.locator('.check-editor-details[open]')).toHaveCount(1);
  await criterion.getByLabel('Motivo o evidencia (opcional)').fill('Revisión PR-15');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page
      .locator('.kanban-column')
      .filter({
        has: page.getByRole('heading', { name: /Completada/ }),
      })
      .locator('.task-card')
      .filter({ hasText: 'Entregar diseño' }),
  ).toHaveCount(1);
  await openBoardGroup(page, 'Entregar diseño');
  await expect(
    page
      .locator('.kanban-column')
      .filter({ has: page.getByRole('heading', { name: /Completada/ }) })
      .getByRole('heading', { name: 'Entregar diseño' }),
  ).toBeVisible();
});

test('historial de tareas: consulta todas las versiones y restaura una antigua', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const dependency = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Dependencia futura', due: '2099-01-01' },
  })) as Task;
  let current = (await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea con historial',
      description: 'Borrador original',
      dependencyIds: [dependency.id],
    },
  })) as Task;
  for (let version = 2; version <= 14; version++)
    current = (await call('save', {
      kind: 'task',
      data: { ...current, description: `Cambio ${version}` },
      id: current.id,
      expectedVersion: current.version,
    })) as Task;
  await page.reload();
  await page.getByRole('button', { name: 'Ampliar detalles de Tarea con historial' }).click();
  await page.getByText('Historial de versiones (14)').click();
  const history = page.locator('.task-history');
  await expect(history.locator('.task-history-version')).toHaveCount(10);
  await history.getByRole('button', { name: 'Mostrar versiones anteriores' }).click();
  await expect(history.locator('.task-history-version')).toHaveCount(14);
  await history.locator('.task-history-version').last().click();
  await expect(history.getByRole('region', { name: 'Cambios de la versión 1' })).toContainText(
    'Borrador original',
  );
  await page.screenshot({ path: 'test-results/bitacora-history.png', fullPage: true });
  await history.getByRole('button', { name: 'Restaurar v1' }).click();
  await expect(history).toContainText('Se creará una nueva versión');
  await history.getByRole('button', { name: 'Confirmar restauración' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const restored = (await call('snapshot')).records.find(
    (record: Task) => record.id === current.id,
  ) as Task;
  expect(restored).toMatchObject({ version: 15, description: 'Borrador original' });
});

test('dependencias y verificación de criterios desde la tarea', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva práctica', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Comprobar entregable');
  await page.getByLabel('Estado de la práctica').selectOption('Recomendación personal');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Preparar entregable');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Enviar entregable');
  await page.locator('.record-form .task-picker > summary').click();
  await page
    .locator('.record-form .task-picker')
    .getByRole('checkbox', { name: /Preparar entregable/ })
    .check();
  await page.getByRole('button', { name: 'Crear registro' }).click();

  const dependent = page.locator('.task-card').filter({ hasText: 'Enviar entregable' });
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(dependent).toContainText('Espera tareas previas');
  await dependent.click();
  await page.getByLabel('Estado', { exact: true }).selectOption('En curso');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Completa primero' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Editar tarea' })
    .getByRole('button', { name: 'Cerrar' })
    .click();

  await page.locator('.task-card').filter({ hasText: 'Preparar entregable' }).click();
  await page.getByLabel('Estado', { exact: true }).selectOption('Completada');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await dependent.click();
  await page.getByLabel('Estado', { exact: true }).selectOption('En curso');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await dependent.click();
  const editor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(editor.locator('.criteria-section')).toHaveAttribute('open');
  const check = editor.locator('.check-editor').filter({ hasText: 'Comprobar entregable' });
  await check.getByRole('checkbox', { name: 'Cumplido: Comprobar entregable' }).check();
  await expect(check).toContainText('Cumplido');
  await editor.screenshot({ path: 'test-results/criterios-editor.png' });
  await check.locator('.check-editor-details > summary').click();
  await check.getByLabel('Motivo o evidencia (opcional)').fill('Revisión registrada');
  await check.getByLabel('Verificación', { exact: true }).selectOption('No aplicable');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editor).toHaveCount(0);
  const snapshot = await call('snapshot');
  const saved = snapshot.records.find(
    (record: Task) => record.title === 'Enviar entregable',
  ) as Task;
  expect(saved.state).toBe('En curso');
  expect(
    saved.checks.find((criterion) => criterion.title === 'Comprobar entregable'),
  ).toMatchObject({
    state: 'No aplicable',
    note: 'Revisión registrada',
  });
});

test('el selector de dependencias recupera tareas antiguas y @ vincula tareas en entradas', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const oldTask = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Revisión histórica' },
  })) as Task;
  for (let index = 1; index <= 12; index++) {
    await call('save', {
      kind: 'task',
      data: { ...blank('task'), title: `Tarea reciente ${index}` },
    });
  }
  await page.reload();

  await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  const dependencies = page.locator('.record-form .task-picker').first();
  await expect(dependencies).not.toHaveAttribute('open');
  await dependencies.locator('summary').click();
  await expect(dependencies.getByRole('checkbox')).toHaveCount(10);
  await expect(dependencies.getByRole('checkbox', { name: /Revisión histórica/ })).toHaveCount(0);
  await dependencies.getByLabel('Buscar tareas de las que depende').fill('revision historica');
  await dependencies.getByRole('checkbox', { name: /Revisión histórica/ }).check();
  await dependencies.getByLabel('Buscar tareas de las que depende').fill('sin coincidencias');
  await expect(dependencies.getByRole('checkbox', { name: /Revisión histórica/ })).toBeChecked();
  await page.getByLabel('Título', { exact: true }).fill('Entrega dependiente');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const savedTask = (await call('snapshot')).records.find(
    (record: Task) => record.title === 'Entrega dependiente',
  ) as Task;
  expect(savedTask.dependencyIds).toEqual([oldTask.id]);

  await page.locator('.daily-composer > details > summary').click();
  await expect(page.getByRole('group', { name: 'Tareas vinculadas' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Otros registros vinculados' })).toHaveCount(0);
  const activity = page.getByRole('textbox', { name: '¿En qué has avanzado?' });
  await activity.fill('Avance vinculado a @');
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Tarea' })
    .click();
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Revisión histórica' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  const entry = (await call('snapshot')).records.find(
    (record: { kind: string; daily?: boolean }) => record.kind === 'entry' && record.daily,
  );
  expect(entry.taskIds).toContain(oldTask.id);
  await activity.fill('Avance sin vínculo');
  await expect
    .poll(async () => {
      const updated = (await call('snapshot')).records.find(
        (record: { kind: string; daily?: boolean }) => record.kind === 'entry' && record.daily,
      );
      return updated.taskIds;
    })
    .toEqual([]);
});

test('la entrada diaria enlaza registros con @ y permite abrirlos desde la mención', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const incident = await call('save', {
    kind: 'incident',
    data: { ...blank('incident'), title: 'Error de acceso', description: 'Falla el inicio' },
  });
  const decision = await call('save', {
    kind: 'decision',
    data: { ...blank('decision'), title: 'Acceso local' },
  });
  const idea = await call('save', {
    kind: 'idea',
    data: { ...blank('idea'), title: 'Pantalla de acceso' },
  });
  await page.reload();

  const editor = page.getByRole('textbox', { name: '¿En qué has avanzado?' });
  await editor.fill('Investigué @');
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Incidencia' })
    .click();
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Error de acceso' })
    .click();
  const result = page.getByRole('textbox', { name: 'Resultado', exact: true });
  await result.fill('Elegí @');
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Decisión' })
    .click();
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Acceso local' })
    .click();
  const learning = page.getByRole('textbox', { name: 'Aprendizaje' });
  await learning.fill('Aprendí de @');
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Idea' })
    .click();
  await page
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Pantalla de acceso' })
    .click();
  const mention = editor.locator('.entry-mention');
  await expect(mention).toContainText('@Error de acceso');
  await mention.hover();
  await expect(mention.locator('.entry-mention-card')).toContainText('Falla el inicio');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  const entry = (await call('snapshot')).records.find(
    (record: { kind: string; daily?: boolean }) => record.kind === 'entry' && record.daily,
  );
  expect(entry.activity).toContain(`@[incident:${incident.id}]`);
  expect(entry.result).toContain(`@[decision:${decision.id}]`);
  expect(entry.learning).toContain(`@[idea:${idea.id}]`);
  expect(entry.linkedIds).toEqual([incident.id, decision.id, idea.id]);

  await call('save', {
    kind: 'incident',
    data: { ...incident, title: 'Error de acceso actualizado' },
    id: incident.id,
    expectedVersion: incident.version,
  });
  await page.reload();
  const restored = page
    .getByRole('textbox', { name: '¿En qué has avanzado?' })
    .locator('.entry-mention');
  await expect(restored).toContainText('@Error de acceso actualizado');
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  const journalMention = page.locator('.journal-card > p .entry-mention');
  await journalMention.hover();
  await expect(journalMention.locator('.entry-mention-card')).toContainText('Falla el inicio');
  await expect(page.locator('.journal-links .entry-mention')).toHaveCount(3);
  await expect(page.locator('.journal-links')).toContainText('Acceso local');
  await expect(page.locator('.journal-links')).toContainText('Pantalla de acceso');
  await journalMention.click({ modifiers: ['Control'] });
  await expect(page.getByRole('dialog')).toContainText('Editar incidencia');
});

test('el editor prioriza la entrada guardada frente a un borrador de una versión anterior', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const task = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea vinculada' },
  })) as Task;
  const entry = await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      title: 'Avance del día',
      activity: `Avancé en la tarea ${task.id}`,
    },
  });
  const draftKey = `record:${entry.id}`;
  await call('save-draft', { key: draftKey, data: entry });
  await call('save', {
    kind: 'entry',
    data: { ...entry, activity: `Avancé en @[task:${task.id}]` },
    id: entry.id,
    expectedVersion: entry.version,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.locator('.journal-card').filter({ hasText: 'Avance del día' }).click();
  const activity = page.getByRole('textbox', { name: '¿En qué has avanzado?' });
  await expect(activity).toContainText('@Tarea vinculada');
  await expect(activity).not.toContainText(task.id);
  await expect(page.getByText('Hay un borrador de una versión anterior.')).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador anterior' }).click();
  await expect.poll(async () => (await call('snapshot')).drafts?.[draftKey]).toBeUndefined();
  await expect(activity).toContainText('@Tarea vinculada');
});

test('el tablero mueve estados y fechas mediante arrastre', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Tarea arrastrable');
  const dueInput = page.getByLabel('Fecha de finalización');
  await expect(dueInput).toHaveValue(madridDate());
  await dueInput.fill('');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(dueInput).toBeFocused();
  await dueInput.fill(madridDate());
  await page.getByRole('button', { name: 'Crear registro' }).click();

  const card = page.locator('.task-card').filter({ hasText: 'Tarea arrastrable' });
  await openBoardGroup(page, 'Tarea arrastrable');
  const inProgress = page.locator('.kanban-column').filter({
    has: page.getByRole('heading', { name: /En curso/ }),
  });
  await card.dragTo(inProgress);
  await expect(
    inProgress.locator('.task-card').filter({ hasText: 'Tarea arrastrable' }),
  ).toHaveCount(1);
  await openBoardGroup(page, 'Tarea arrastrable');
  await expect(inProgress.getByRole('heading', { name: 'Tarea arrastrable' })).toBeVisible();

  await page.getByRole('button', { name: 'Mover fechas' }).click();
  const target = new Date(`${madridDate()}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() + 2);
  const targetDay = target.toISOString().slice(0, 10);
  if (targetDay.slice(0, 7) !== madridDate().slice(0, 7)) {
    await page
      .getByRole('region', { name: 'Calendario mensual' })
      .getByRole('button', { name: 'Mes siguiente' })
      .click();
  }
  const dateButton = page.getByRole('region', { name: 'Calendario mensual' }).getByRole('button', {
    name: new RegExp(
      `^${new Date(`${targetDay}T12:00:00`).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })},`,
    ),
  });
  await card.dragTo(dateButton);
  await openBoardGroup(page, 'Tarea arrastrable');
  await expect(card).toContainText('Quedan 2 días');
  await page.screenshot({ path: 'test-results/bitacora-tablero.png', fullPage: true });
  await dateButton.click();
  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  await expect(details).toContainText('Tarea arrastrable');
  await expect(page.getByRole('button', { name: 'Tablero', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Cerrar' }).click();
  const nextDay = new Date(`${targetDay}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() - 1);
  const nextDayIso = nextDay.toISOString().slice(0, 10);
  if (nextDayIso.slice(0, 7) !== targetDay.slice(0, 7)) {
    await page
      .getByRole('region', { name: 'Calendario mensual' })
      .getByRole('button', { name: 'Mes anterior' })
      .click();
  }
  await openBoardGroup(page, 'Tarea arrastrable');
  await card.dragTo(
    page.getByRole('region', { name: 'Calendario mensual' }).getByRole('button', {
      name: new RegExp(
        `^${new Date(`${nextDayIso}T12:00:00`).toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })},`,
      ),
    }),
  );
  await openBoardGroup(page, 'Tarea arrastrable');
  await expect(card).toContainText('Queda 1 día');
  const snapshot = await call('snapshot');
  expect(
    snapshot.records.find((record: Task) => record.title === 'Tarea arrastrable'),
  ).toMatchObject({
    state: 'Por hacer',
    due: nextDayIso,
  });

  if (nextDayIso.slice(0, 7) !== madridDate().slice(0, 7)) {
    await page
      .getByRole('region', { name: 'Calendario mensual' })
      .getByRole('button', { name: 'Mes anterior' })
      .click();
  }
  const todayButton = page.getByRole('region', { name: 'Calendario mensual' }).getByRole('button', {
    name: new RegExp(
      `^${new Date(`${madridDate()}T12:00:00`).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })},`,
    ),
  });
  await openBoardGroup(page, 'Tarea arrastrable');
  await card.dragTo(todayButton);
  await openBoardGroup(page, 'Tarea arrastrable');
  await expect(card).toContainText('Vence hoy');
  await expect(
    inProgress.locator('.task-card').filter({ hasText: 'Tarea arrastrable' }),
  ).toHaveCount(1);
  const snapAfterToday = await call('snapshot');
  expect(
    snapAfterToday.records.find((record: Task) => record.title === 'Tarea arrastrable'),
  ).toMatchObject({
    state: 'En curso',
    due: madridDate(),
  });
});

test('modificar la fecha de una tarea desde su editor en el tablero adapta su estado reactivamente', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Tarea reprogramable');
  await page.getByRole('button', { name: 'Crear registro' }).click();

  const card = page.locator('.task-card').filter({ hasText: 'Tarea reprogramable' });
  await openBoardGroup(page, 'Tarea reprogramable');
  const inProgress = page.locator('.kanban-column').filter({
    has: page.getByRole('heading', { name: /En curso/ }),
  });
  await card.dragTo(inProgress);
  await expect(
    inProgress.locator('.task-card').filter({ hasText: 'Tarea reprogramable' }),
  ).toHaveCount(1);

  // Abrir editor de la tarea
  await openBoardGroup(page, 'Tarea reprogramable');
  await inProgress.locator('.task-card-main').filter({ hasText: 'Tarea reprogramable' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(dialog).toBeVisible();

  // Modificar fecha a futuro (+5 días)
  const target = new Date(`${madridDate()}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() + 5);
  const futureDay = target.toISOString().slice(0, 10);
  const dueInput = page.getByLabel('Fecha de finalización');
  await dueInput.fill(futureDay);

  // El estado debe haber cambiado automáticamente a "Por hacer"
  const stateSelect = page.getByLabel('Estado');
  await expect(stateSelect).toHaveValue('Por hacer');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).not.toBeVisible();

  // En el tablero debe haberse movido reactivamente a "Por hacer"
  const todoColumn = page.locator('.kanban-column').filter({
    has: page.getByRole('heading', { name: /Por hacer/ }),
  });
  await openBoardGroup(page, 'Tarea reprogramable');
  await expect(
    todoColumn.locator('.task-card').filter({ hasText: 'Tarea reprogramable' }),
  ).toHaveCount(1);
  await expect(
    inProgress.locator('.task-card').filter({ hasText: 'Tarea reprogramable' }),
  ).toHaveCount(0);
});

test('el tablero agrupa tareas por día y comienza con los grupos contraídos', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  for (const [title, due] of [
    ['Primera del día', '2099-01-01'],
    ['Segunda del día', '2099-01-01'],
    ['Otro día', '2099-01-02'],
  ]) {
    await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Fecha de finalización').fill(due);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }

  const column = page.locator('.kanban-column').filter({
    has: page.getByRole('heading', { name: /Por hacer/ }),
  });
  const groups = column.locator('.board-day-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('summary')).toContainText('2');
  await expect(groups.nth(1).locator('summary')).toContainText('1');
  await expect(groups.nth(0)).not.toHaveAttribute('open');
  await expect(column.getByRole('heading', { name: 'Primera del día' })).not.toBeVisible();

  await groups.nth(0).locator('summary').click();
  await expect(column.getByRole('heading', { name: 'Primera del día' })).toBeVisible();
  await expect(column.getByRole('heading', { name: 'Segunda del día' })).toBeVisible();
  await expect(column.getByRole('heading', { name: 'Otro día' })).not.toBeVisible();
  await groups.nth(0).locator('summary').click();
  await expect(column.getByRole('heading', { name: 'Primera del día' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(groups.nth(0)).toHaveAttribute('open');
  await expect(groups.nth(1)).toHaveAttribute('open');
  await page.getByRole('button', { name: 'Contraer todo' }).click();
  await expect(groups.nth(0)).not.toHaveAttribute('open');
  await expect(groups.nth(1)).not.toHaveAttribute('open');
});

test('hace auto-scroll vertical hacia el calendario al arrastrar una tarea con scroll y preserva el arrastre lateral', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Tarea auto-scroll');
  await page.getByRole('button', { name: 'Crear registro' }).click();

  const card = page.locator('.task-card').filter({ hasText: 'Tarea auto-scroll' });
  await openBoardGroup(page, 'Tarea auto-scroll');
  await expect(card).toBeVisible();

  // Abrir calendario de fechas
  await page.getByRole('button', { name: 'Mover fechas' }).click();
  const calendar = page.getByRole('region', { name: 'Calendario mensual' });
  await expect(calendar).toBeVisible();

  // Desplazar la vista hacia abajo (simulando tablero con scroll)
  await page.evaluate(() => window.scrollTo(0, 300));
  const scrolledY = await page.evaluate(() => window.scrollY);
  expect(scrolledY).toBeGreaterThanOrEqual(100);

  // Iniciar arrastre de la tarea
  await page.evaluate(() => {
    const cardEl = Array.from(document.querySelectorAll('.task-card')).find((el) =>
      el.textContent?.includes('Tarea auto-scroll'),
    );
    const dt = new DataTransfer();
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    cardEl?.dispatchEvent(ev);
  });
  await expect(card).toHaveClass(/dragging/);

  // Simular evento dragover en zona superior (clientY cerca del borde superior)
  await page.evaluate(() => {
    window.dispatchEvent(new DragEvent('dragover', { clientY: 50, bubbles: true }));
  });

  // El auto-scroll debe desplazar la ventana hacia arriba hacia el calendario
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 4000 })
    .toBeLessThan(50);

  // Finalizar arrastre de prueba
  await page.evaluate(() => {
    const cardEl = Array.from(document.querySelectorAll('.task-card')).find((el) =>
      el.textContent?.includes('Tarea auto-scroll'),
    );
    cardEl?.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  });

  // Comprobar que el arrastre lateral entre columnas sigue funcionando con normalidad
  const inProgress = page.locator('.kanban-column').filter({
    has: page.getByRole('heading', { name: /En curso/ }),
  });
  await card.dragTo(inProgress);
  await expect(
    inProgress.locator('.task-card').filter({ hasText: 'Tarea auto-scroll' }),
  ).toHaveCount(1);
  await openBoardGroup(page, 'Tarea auto-scroll');
  await expect(inProgress.getByRole('heading', { name: 'Tarea auto-scroll' })).toBeVisible();
});

test('la semana y el mes muestran varias tareas del mismo día', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  await call('save', {
    kind: 'practice',
    data: {
      ...blank('practice'),
      title: 'Criterio de prueba',
      status: 'Recomendación personal',
    },
  });
  const titles = ['Preparar plan', 'Revisar diseño', 'Validar pruebas', 'Enviar resumen'];
  for (const title of titles) {
    await page.getByRole('button', { name: 'Añadir tarea' }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Crear registro' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  const selectedWeekDay = page.locator('.week-strip > button[aria-current="date"]');
  await expect(selectedWeekDay.locator('.week-task-title')).toHaveText(titles[0]);
  await expect(selectedWeekDay.locator('.week-task-summary b')).toHaveText('+3');
  await expect(selectedWeekDay.locator('.calendar-note-count.task')).toHaveText('4');
  await selectedWeekDay.click();
  const weekDetails = page.getByRole('dialog', { name: 'Detalles del día' });
  for (const title of titles) await expect(weekDetails).toContainText(title);
  await weekDetails.getByRole('button', { name: 'Cerrar' }).click();
  await expect(selectedWeekDay).toHaveAttribute('aria-current', 'date');

  await page.getByRole('button', { name: 'Ampliar calendario al mes' }).click();
  const calendar = page.getByRole('region', { name: 'Calendario mensual' });
  const selectedMonthDay = calendar.locator('.month-days > button[aria-current="date"]');
  await expect(selectedMonthDay.locator('.month-task')).toHaveCount(2);
  await expect(selectedMonthDay.locator('.month-task-more')).toHaveText('+2 más');
  await expect(selectedMonthDay.locator('.calendar-note-count.task')).toHaveText('4');
  await expect(selectedMonthDay).toHaveAttribute('aria-label', /4 tareas/);
  await calendar.getByRole('button', { name: 'Mes siguiente' }).click();
  await expect(calendar.locator('.month-days > button[aria-current="date"]')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(calendar.locator('.month-days > button[aria-current="date"]')).toBeVisible();
  await selectedMonthDay.click();
  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  const tasksSection = details.locator('.day-details-section.task');
  await expect(tasksSection).not.toHaveAttribute('open');
  await expect(tasksSection.locator('.day-section-summary')).toContainText('4 abiertas');
  await expect(tasksSection.locator('.day-section-summary')).toContainText('Preparar plan');
  await tasksSection.locator('summary').first().click();
  await expect(tasksSection).toHaveAttribute('open', '');
  const firstTask = tasksSection.locator('.day-detail-card').first();
  await expect(firstTask).not.toHaveAttribute('open', '');
  await expect(firstTask.locator('summary')).toContainText('En curso · Prioridad media');
  await firstTask.locator('summary').click();
  await expect(firstTask).toHaveAttribute('open', '');
  await expect(firstTask.getByText('Criterios de calidad')).toBeVisible();
  await firstTask.locator('summary').click();
  await tasksSection.locator('summary').first().click();
  await expect(tasksSection).not.toHaveAttribute('open', '');
  await expect(tasksSection.locator('.day-section-summary')).toContainText('Preparar plan');
  await expect(firstTask.locator('summary')).not.toBeVisible();
  await tasksSection.locator('summary').first().click();
  for (const title of titles)
    await expect(tasksSection.locator('.day-detail-card', { hasText: title })).toBeVisible();
  await details.screenshot({ path: 'test-results/bitacora-detalles-dia.png' });
  await details.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Contraer calendario' }).click();
  await expect(selectedWeekDay.locator('.week-task-summary b')).toHaveText('+3');

  const snapshot = await call('snapshot');
  expect(
    snapshot.records
      .filter((record: Task) => record.kind === 'task')
      .map((record: Task) => record.due),
  ).toEqual(Array(4).fill(madridDate()));
});

test('Hoy abre criterios en la tarea y permite borrar desde ambas vistas', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Crear mi primera tarea' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Primera tarea');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await page.getByRole('button', { name: /Primera tarea.*En curso/ }).click();
  const editor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(editor.locator('.criteria-section > summary')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar tarea' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ampliar detalles de Primera tarea' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Segunda tarea');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Borrar tarea Segunda tarea' }).click();
  await expect(page.getByRole('button', { name: 'Borrar tarea Segunda tarea' })).toHaveCount(0);
});

test('Hoy y Tablero combinan filtros de tareas y permiten limpiarlos', async ({ page }) => {
  await unlock(page);
  for (const [title, type, priority] of [
    ['Revisar propuesta', 'Revisión', 'Alta'],
    ['Preparar diagrama', 'Diseño', 'Baja'],
  ]) {
    await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Tipo de tarea').fill(type);
    await page.getByRole('dialog').getByLabel('Prioridad', { exact: true }).selectOption(priority);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }
  const today = page.getByRole('region', { name: 'Filtros de tareas' });
  await today.locator('.task-filters-toggle').click();
  const todayTypes = today.getByRole('group', { name: 'Tipo' });
  await todayTypes.getByRole('button', { name: 'Revisión' }).click();
  await todayTypes.getByRole('button', { name: 'Diseño' }).click();
  await expect(todayTypes.getByRole('button', { name: 'Diseño' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: /Preparar diagrama.*En curso/ })).toBeVisible();
  await todayTypes.getByRole('button', { name: 'Diseño' }).click();
  await today
    .getByRole('group', { name: 'Prioridad' })
    .getByRole('button', { name: 'Alta', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /Revisar propuesta.*En curso/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preparar diagrama.*En curso/ })).toHaveCount(0);
  await today.locator('.task-filters-clear').click();
  await expect(page.getByRole('button', { name: /Preparar diagrama.*En curso/ })).toBeVisible();

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const board = page.getByRole('region', { name: 'Filtros de tareas' });
  await board.locator('.task-filters-toggle').click();
  await board.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Diseño' }).click();
  await board
    .getByRole('group', { name: 'Prioridad' })
    .getByRole('button', { name: 'Baja', exact: true })
    .click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toHaveCount(0);
  await board.getByLabel('Fechas').selectOption('range');
  await board.getByLabel('Desde', { exact: true }).fill('2099-01-01');
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toHaveCount(0);
  await board.locator('.task-filters-clear').click();
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toBeVisible();
});

test('el tablero permite combinar varias fases y estados y conserva la selección', async ({
  page,
}) => {
  await unlock(page);
  for (const [title, phase, state] of [
    ['Diseñar flujo', 'Diseño', 'Por hacer'],
    ['Construir flujo', 'Implementación', 'En curso'],
  ]) {
    await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Fase', { exact: true }).selectOption(phase);
    await page.getByLabel('Estado', { exact: true }).selectOption(state);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const filters = page.getByRole('region', { name: 'Filtros de tareas' });
  await filters.locator('.task-filters-toggle').click();
  const phases = filters.getByRole('group', { name: 'Fase' });
  const states = filters.getByRole('group', { name: 'Estado' });
  await phases.getByRole('button', { name: 'Diseño' }).click();
  await phases.getByRole('button', { name: 'Implementación' }).click();
  await states.getByRole('button', { name: 'Por hacer' }).click();
  await states.getByRole('button', { name: 'En curso' }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Diseñar flujo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Construir flujo' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  const saved = page.getByRole('region', { name: 'Filtros de tareas' });
  await expect(
    saved.getByRole('group', { name: 'Estado' }).getByRole('button', { name: 'En curso' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await saved.getByRole('group', { name: 'Fase' }).getByRole('button', { name: 'Diseño' }).click();
  await expect(page.getByRole('heading', { name: 'Diseñar flujo' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Construir flujo' })).toBeVisible();
});

test('prioridad y bloqueos admiten varias opciones; etiquetas muestran diez y buscan coincidencias', async ({
  page,
}) => {
  await unlock(page);
  const tags = Array.from({ length: 12 }, (_, index) => `etiqueta ${index + 1}`);
  for (const [title, priority, blocked, taskTags] of [
    ['Tarea libre', 'Alta', '', tags.join(', ')],
    ['Tarea bloqueada', 'Baja', 'Falta acceso', 'extra'],
  ]) {
    await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByRole('dialog').getByLabel('Prioridad', { exact: true }).selectOption(priority);
    await page.getByLabel('Etiquetas (separadas por comas)').fill(taskTags);
    if (blocked) await page.getByLabel('Bloqueo actual').fill(blocked);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const filters = page.getByRole('region', { name: 'Filtros de tareas' });
  await filters.locator('.task-filters-toggle').click();
  const priorities = filters.getByRole('group', { name: 'Prioridad' });
  const blockages = filters.getByRole('group', { name: 'Bloqueos' });
  await priorities.getByRole('button', { name: 'Alta', exact: true }).click();
  await priorities.getByRole('button', { name: 'Baja', exact: true }).click();
  await blockages.getByRole('button', { name: 'Con bloqueo' }).click();
  await blockages.getByRole('button', { name: 'Sin bloqueo' }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Tarea libre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarea bloqueada' })).toBeVisible();
  await blockages.getByRole('button', { name: 'Sin bloqueo' }).click();
  await expect(page.getByRole('heading', { name: 'Tarea libre' })).toHaveCount(0);
  await blockages.getByRole('button', { name: 'Sin bloqueo' }).click();

  const labels = filters.getByRole('group', { name: 'Etiquetas' });
  await expect(labels.getByRole('button')).toHaveCount(10);
  await labels.getByRole('searchbox', { name: 'Buscar etiquetas' }).fill('ETIQUETA 12');
  await labels.getByRole('button', { name: 'etiqueta 12' }).click();
  await expect(page.getByRole('heading', { name: 'Tarea libre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarea bloqueada' })).toHaveCount(0);
  await labels.getByRole('searchbox', { name: 'Buscar etiquetas' }).fill('extra');
  await expect(labels.getByRole('button', { name: 'etiqueta 12' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await labels.getByRole('button', { name: 'extra' }).click();
  await expect(page.getByRole('heading', { name: 'Tarea bloqueada' })).toBeVisible();
});

test('el tablero destaca tareas vencidas abiertas y restablece el alcance de fechas al recargar', async ({
  page,
}) => {
  await unlock(page);
  const yesterday = new Date(`${madridDate()}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const past = yesterday.toISOString().slice(0, 10);

  for (const [title, state] of [
    ['Pendiente vencida', 'Por hacer'],
    ['En marcha vencida', 'En curso'],
    ['Revisión vencida', 'En revisión'],
    ['Terminada antigua', 'Completada'],
  ] as const) {
    await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Estado', { exact: true }).selectOption(state);
    await page.getByLabel('Fecha de finalización').fill(past);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const board = page.getByRole('region', { name: 'Filtros de tareas' });
  await expect(board.getByLabel('Fechas')).toHaveValue('upcoming');
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  for (const title of ['Pendiente vencida', 'En marcha vencida', 'Revisión vencida']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.locator('.task-card').filter({ hasText: title })).toContainText(
      'Cambia la fecha o completa la tarea',
    );
  }
  await expect(page.locator('.board-overdue-notice')).toContainText(
    '3 tareas vencidas sin completar',
  );
  await expect(page.getByRole('heading', { name: 'Terminada antigua' })).toHaveCount(0);

  await board.getByLabel('Fechas').selectOption('all');
  await openBoardGroup(page, 'Terminada antigua');
  await expect(page.getByRole('heading', { name: 'Terminada antigua' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(
    page.getByRole('region', { name: 'Filtros de tareas' }).getByLabel('Fechas'),
  ).toHaveValue('upcoming');
  await expect(page.getByRole('heading', { name: 'Revisión vencida' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Terminada antigua' })).toHaveCount(0);
});

test('los filtros de tareas se guardan en el equipo y persisten tras recargar hasta limpiarlos manualmente', async ({
  page,
}) => {
  await unlock(page);
  for (const [title, type, priority] of [
    ['Revisar propuesta', 'Revisión', 'Alta'],
    ['Preparar diagrama', 'Diseño', 'Baja'],
  ]) {
    await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Tipo de tarea').fill(type);
    await page.getByRole('dialog').getByLabel('Prioridad', { exact: true }).selectOption(priority);
    await page.getByRole('button', { name: 'Crear registro' }).click();
  }

  const today = page.getByRole('region', { name: 'Filtros de tareas' });
  await today.locator('.task-filters-toggle').click();
  await today
    .getByRole('group', { name: 'Tipo' })
    .getByRole('button', { name: 'Revisión' })
    .click();
  await expect(page.getByRole('button', { name: /Revisar propuesta.*En curso/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preparar diagrama.*En curso/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const board = page.getByRole('region', { name: 'Filtros de tareas' });
  await board.locator('.task-filters-toggle').click();
  await board.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Diseño' }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toHaveCount(0);

  // Recarga la página y comprueba que los filtros siguen activos
  await page.reload();

  // En Hoy sigue filtrado por Revisión
  const todayAfterReload = page.getByRole('region', { name: 'Filtros de tareas' });
  await expect(page.getByRole('button', { name: /Revisar propuesta.*En curso/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preparar diagrama.*En curso/ })).toHaveCount(0);

  // En Tablero sigue filtrado por Diseño
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  const boardAfterReload = page.getByRole('region', { name: 'Filtros de tareas' });
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toHaveCount(0);

  // Se quitan únicamente de forma manual
  await boardAfterReload.locator('.task-filters-clear').click();
  await openBoardGroup(page, 'Revisar propuesta');
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toBeVisible();

  // Al recargar de nuevo, Tablero sigue limpio
  await page.reload();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByRole('heading', { name: 'Revisar propuesta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preparar diagrama' })).toBeVisible();
});

test('la constancia diaria aparece en Diario y se reanuda sin duplicarse', async ({ page }) => {
  await unlock(page);
  await page.getByLabel('¿En qué has avanzado?').fill('Primer avance del día');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await expect(page.getByText('Primer avance del día', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('¿En qué has avanzado?')).toHaveText('Primer avance del día');
  await page.getByLabel('¿En qué has avanzado?').fill('Avance actualizado');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  const snapshot = await call('snapshot');
  const daily = snapshot.records.filter(
    (record: { kind: string; daily?: boolean }) => record.kind === 'entry' && record.daily,
  );
  expect(daily).toHaveLength(1);
  expect(daily[0].activity).toBe('Avance actualizado');
  await page.getByRole('button', { name: 'Añadir otro avance' }).click();
  await page.getByLabel('¿En qué has avanzado?').fill('Avance adicional');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en tu equipo' })).toBeVisible();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('¿En qué has avanzado?')).toHaveText('Avance actualizado');
  const entries = (await call('snapshot')).records.filter(
    (record: { kind: string }) => record.kind === 'entry',
  );
  expect(entries).toHaveLength(2);
  expect(entries.filter((record: { daily?: boolean }) => record.daily)).toHaveLength(1);
});

test('el popup de entradas usa las preguntas de Hoy y conserva la edición', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const task = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Preparar entrega' },
  })) as Task;
  await page.reload();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva entrada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deja constancia de tu día' });
  await expect(dialog.getByLabel('¿En qué has avanzado?')).toBeVisible();
  await expect(dialog.getByLabel('Resultado', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Título del registro')).toBeHidden();
  await expect(dialog.getByRole('group', { name: 'Tareas vinculadas' })).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: 'Otros registros vinculados' })).toHaveCount(0);
  await dialog.getByLabel('¿En qué has avanzado?').fill('Avance desde el popup con @');
  await dialog
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Tarea' })
    .click();
  await dialog
    .getByRole('listbox', { name: 'Vincular registro' })
    .getByRole('option', { name: 'Preparar entrega' })
    .click();
  await dialog.getByText('Más detalles de la entrada').click();
  await dialog.getByLabel('Título del registro').fill('Entrada del diario');
  await dialog.getByRole('button', { name: 'Crear registro' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /Entrada del diario/ }).click();
  const editor = page.getByRole('dialog', { name: 'Deja constancia de tu día' });
  await expect(editor.getByLabel('¿En qué has avanzado?')).toContainText('Avance desde el popup');
  await expect(editor.getByRole('group', { name: 'Tareas vinculadas' })).toHaveCount(0);
  await expect(editor.getByRole('group', { name: 'Otros registros vinculados' })).toHaveCount(0);
  await editor.getByLabel('Resultado', { exact: true }).fill('Resultado actualizado');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editor).toHaveCount(0);
  const entries = (await call('snapshot')).records.filter(
    (record: { kind: string }) => record.kind === 'entry',
  );
  expect(entries).toHaveLength(1);
  expect(entries[0].result).toBe('Resultado actualizado');
  expect(entries[0].taskIds).toEqual([task.id]);
});

test('recupera texto incompleto de Hoy tras navegar y recargar', async ({ page }) => {
  await unlock(page);
  await page.getByLabel('Resultado', { exact: true }).fill('Resultado pendiente de completar');
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('Resultado', { exact: true })).toHaveText(
    'Resultado pendiente de completar',
  );
  expect(
    (await call('snapshot')).records.filter((record: { kind: string }) => record.kind === 'entry'),
  ).toHaveLength(0);
});

test('recupera un formulario de tarea incompleto y lo limpia al crear', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Pendiente de nombrar');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Pendiente de nombrar');
  await page.getByLabel('Título', { exact: true }).fill('Tarea recuperada');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.locator('form.record-form')).toHaveCount(0);
  expect((await call('snapshot')).drafts).toEqual({});
});

test('incidencia y solución aparecen en sus días; calendario mensual permite navegar', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Ampliar calendario al mes' }).click();
  const calendar = page.getByRole('region', { name: 'Calendario mensual' });
  await expect(calendar.locator('.calendar-month')).toHaveCount(1);
  await calendar.getByRole('button', { name: 'Mes siguiente' }).click();
  await calendar.getByRole('button', { name: 'Mes anterior' }).click();
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Problema de integración');
  await page.getByLabel('Descripción', { exact: true }).fill('La conexión falla');
  const day = await page.getByLabel('Día de la incidencia').inputValue();
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator(
      '.week-strip > button[aria-current="date"] .calendar-note-count.incident.unresolved',
    ),
  ).toHaveText('1');
  await expect(
    calendar.locator(
      '.month-days > button[aria-current="date"] .calendar-note-count.incident.unresolved',
    ),
  ).toHaveText('1');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Revisar integración');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  const selectedWeekDay = page.locator('.week-strip > button[aria-current="date"]');
  const selectedMonthDay = calendar.locator('.month-days > button[aria-current="date"]');
  await expect(selectedWeekDay.locator('.calendar-note-count.task')).toHaveText('1');
  await expect(selectedWeekDay.locator('.calendar-note-count.incident.unresolved')).toHaveText('1');
  await expect(selectedMonthDay.locator('.calendar-note-count.task')).toHaveText('1');
  await expect(selectedMonthDay.locator('.calendar-note-count.incident.unresolved')).toHaveText(
    '1',
  );
  await page.getByRole('button', { name: /Problema de integración/ }).click();
  await page.getByLabel('Solución', { exact: true }).fill('Actualizar la configuración');
  const resolution = new Date(`${day}T12:00:00`);
  resolution.setDate(resolution.getDate() + 2);
  const resolvedDay = [
    resolution.getFullYear(),
    String(resolution.getMonth() + 1).padStart(2, '0'),
    String(resolution.getDate()).padStart(2, '0'),
  ].join('-');
  await page.getByLabel('Día de resolución').fill(resolvedDay);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Problema de integración/ })).toContainText(
    'La conexión falla',
  );
  if (resolvedDay.slice(0, 7) !== day.slice(0, 7)) {
    await calendar.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  await calendar
    .getByRole('button', {
      name: new RegExp(
        `^${resolution.toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })},`,
      ),
    })
    .click();
  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  const incident = details.locator('.day-details-section.incident');
  await expect(incident).not.toHaveAttribute('open');
  await expect(incident.locator('.day-section-summary')).toContainText('1 solucionada');
  await expect(incident.locator('.day-detail-summary')).toContainText('Se resolvió este día');
  await expect(incident.locator('.day-detail-summary')).toContainText(
    'Actualizar la configuración',
  );
  await incident.locator('.day-section-summary').click();
  await incident.locator('.day-detail-summary').click();
  await expect(incident.getByText('Solución', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Incidencias', exact: true }).click();
  await expect(page.getByText('Actualizar la configuración')).toBeVisible();
});

test('crea los cuatro tipos con sus datos mínimos y señala los campos obligatorios', async ({
  page,
}) => {
  await unlock(page);
  const cases = [
    { action: 'Registrar incidencia', kind: 'incident', dateLabel: 'Día de la incidencia' },
    { action: 'Registrar decisión', kind: 'decision', dateLabel: 'Día de la decisión' },
    { action: 'Registrar idea', kind: 'idea', dateLabel: 'Día de la idea' },
  ];
  for (const { action, kind, dateLabel } of cases) {
    await page.getByRole('button', { name: action }).click();
    const form = page.locator('form.record-form');
    await expect(form.getByText('Título *', { exact: true })).toBeVisible();
    await expect(form.getByText(`${dateLabel} *`, { exact: true })).toBeVisible();
    await expect(form.getByLabel('Título', { exact: true })).toHaveAttribute('required', '');
    await expect(form.getByLabel(dateLabel)).toHaveAttribute('required', '');
    if (kind === 'incident') {
      await expect(form.getByText('Día de resolución', { exact: true })).toBeVisible();
      await expect(form.getByLabel('Día de resolución')).not.toHaveAttribute('required', '');
      await form.getByLabel('Solución', { exact: true }).fill('Resuelta');
      await expect(form.getByText('Día de resolución *', { exact: true })).toBeVisible();
      await form.getByLabel('Solución', { exact: true }).fill('');
    }
    const title = `Registro mínimo ${kind}`;
    await form.getByLabel('Título', { exact: true }).fill(title);
    await form.getByRole('button', { name: 'Crear registro' }).click();
    await expect(form).toHaveCount(0);
    expect((await call('snapshot')).records).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind, title })]),
    );
  }
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  const form = page.locator('form.record-form');
  await expect(form.getByText('Título *', { exact: true })).toBeVisible();
  await expect(form.getByText('Fecha de finalización *', { exact: true })).toBeVisible();
  await form.getByLabel('Título', { exact: true }).fill('Tarea mínima');
  await form.getByRole('button', { name: 'Crear registro' }).click();
  await expect(form).toHaveCount(0);
  expect((await call('snapshot')).records).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'task', title: 'Tarea mínima' })]),
  );
});

test('Hoy registra decisiones e ideas en el día elegido y las muestra en Diario', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Registrar decisión' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Elegir formato de datos');
  await page.getByLabel('Decisión', { exact: true }).fill('Usar JSON');
  const day = await page.getByLabel('Día de la decisión').inputValue();
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('button', { name: /Elegir formato de datos/ })).toBeVisible();

  await page.getByRole('button', { name: 'Registrar idea' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Buscar por etiquetas');
  await page.getByLabel('Descripción', { exact: true }).fill('Añadir un filtro rápido');
  await expect(page.getByLabel('Día de la idea')).toHaveValue(day);
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('button', { name: /Buscar por etiquetas/ })).toBeVisible();

  await expect(
    page.locator('.week-strip').getByRole('button', { name: /1 decisión, 1 idea/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ampliar calendario al mes' }).click();
  const calendar = page.getByRole('region', { name: 'Calendario mensual' });
  const markedDay = calendar.getByRole('button', { name: /1 decisión, 1 idea/ });
  await expect(markedDay).toContainText('Elegir formato de datos');
  await expect(markedDay).toContainText('Buscar por etiquetas');
  await expect(markedDay.locator('.calendar-note-count')).toHaveCount(2);
  await markedDay.click();
  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  await expect(details.locator('.day-details-section.decision .day-detail-summary')).toContainText(
    'Usar JSON',
  );
  await expect(details.locator('.day-details-section.idea .day-detail-summary')).toContainText(
    'Añadir un filtro rápido',
  );
  await details.getByRole('button', { name: 'Cerrar' }).click();
  await page.screenshot({ path: 'test-results/bitacora-calendario-notas.png', fullPage: true });

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Mover fechas' }).click();
  await expect(
    page.getByRole('region', { name: 'Calendario mensual' }).locator('.calendar-note-count'),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Decisiones de arquitectura' }).click();
  await expect(page.getByRole('button', { name: /Elegir formato de datos/ })).toBeVisible();
  await page.getByRole('button', { name: 'Ideas', exact: true }).click();
  await expect(page.getByRole('button', { name: /Buscar por etiquetas/ })).toBeVisible();
});
test('permite borrar una incidencia desde su editor y la retira de las vistas', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Incidencia temporal');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await page.getByRole('button', { name: /Incidencia temporal/ }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Borrar incidencia' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Borrar incidencia' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Incidencia temporal/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  await page.getByRole('button', { name: 'Incidencias', exact: true }).click();
  await expect(page.getByText('Incidencia temporal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await expect(page.getByText('Incidencia temporal')).toHaveCount(0);
});

test('permite borrar entradas, decisiones e ideas desde sus editores', async ({ page }) => {
  await unlock(page);
  const cases = [
    { kind: 'entry', tab: 'Entradas', label: 'entrada', title: 'Entrada temporal' },
    {
      kind: 'decision',
      tab: 'Decisiones de arquitectura',
      label: 'decisión',
      title: 'Decisión temporal',
    },
    { kind: 'idea', tab: 'Ideas', label: 'idea', title: 'Idea temporal' },
  ] as const;
  for (const item of cases) {
    await call('save', {
      kind: item.kind,
      data: {
        ...(await import('../service/domain')).blank(item.kind),
        title: item.title,
        ...(item.kind === 'entry' ? { daily: true, activity: 'Avance temporal' } : {}),
      },
    });
  }
  await page.reload();
  await page.getByRole('button', { name: 'Diario', exact: true }).click();
  for (const item of cases) {
    await page.getByRole('button', { name: item.tab, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(item.title) }).click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: `Borrar ${item.label}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: `Borrar ${item.label}` }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(item.title) })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('¿En qué has avanzado?')).toHaveText('');
});

test('solo borra el cuaderno elegido desde su pantalla de inicio', async ({ page }) => {
  await unlock(page);
  await call('save', {
    kind: 'task',
    data: {
      ...(await import('../service/domain')).blank('task'),
      title: 'Tarea conservada',
    },
  });
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await page.getByRole('button', { name: 'Crear otro cuaderno' }).click();
  await page.getByLabel('Nombre del cuaderno').fill('Proyecto temporal');
  await page.getByLabel('Contraseña', { exact: true }).fill('Otra contraseña de prueba');
  await page.getByLabel('Repite la contraseña').fill('Otra contraseña de prueba');
  await page.getByRole('button', { name: 'Crear mi bitácora' }).click();
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await page.getByLabel('Cuaderno').selectOption({ label: 'Proyecto temporal' });
  await page.getByRole('button', { name: 'Eliminar este cuaderno' }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('Otra contraseña de prueba');
  await page.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR');
  await page.getByRole('button', { name: 'Eliminar cuaderno', exact: true }).click();
  await expect(page.getByLabel('Cuaderno').locator('option')).toHaveCount(1);
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba de bitácora segura');
  await page.getByRole('button', { name: 'Desbloquear bitácora' }).click();
  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Expandir todo' }).click();
  await expect(page.getByText('Tarea conservada')).toBeVisible();
});
test('permite borrar una reunión registrada desde su editor', async ({ page }) => {
  await unlock(page);
  await call('save', {
    kind: 'meeting',
    data: { ...(await import('../service/domain')).blank('meeting'), title: 'Reunión temporal' },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Martes', exact: true }).click();
  const meeting = page.locator('.meeting-card').filter({ hasText: 'Reunión temporal' });
  await meeting.getByRole('button', { name: 'Revisar' }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Borrar reunión' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Borrar reunión' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(meeting).toHaveCount(0);
});
test('puede abrir una sesión MCP para el cuaderno activo', async ({ page }) => {
  await unlock(page);
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.getByLabel('Cliente').selectOption('codex');
  await page.getByLabel('Permitir que este asistente complete tareas').check();
  await page.getByRole('button', { name: 'Crear sesión para este cuaderno' }).click();
  await expect(page.getByText('Cuaderno: Proyecto conectado.', { exact: false })).toBeVisible();
  const snapshot = await call('snapshot');
  expect(snapshot.grants).toContainEqual(
    expect.objectContaining({
      provider: 'codex',
      scope: 'projects',
      projectIds: [project.id],
      canCompleteTasks: true,
    }),
  );
  // A second click on the same client renews its session instead of opening another one.
  await page.getByRole('button', { name: 'Renovar sesión para este cuaderno' }).click();
  await expect(page.getByText('Sesión renovada hasta', { exact: false })).toBeVisible();
  expect(
    (await call('snapshot')).grants.filter((g: { provider: string }) => g.provider === 'codex'),
  ).toHaveLength(1);
  await page.getByLabel('Cliente').selectOption('claude');
  await page.getByRole('button', { name: 'Crear sesión para este cuaderno' }).click();
  const config = JSON.parse(await page.locator('pre.config').innerText());
  expect(config.mcpServers.bitacora.env).toEqual({
    BITACORA_PROVIDER: 'claude',
    BITACORA_DATA_DIR: dir,
  });
  expect(JSON.stringify(config)).not.toContain('BITACORA_GRANT_TOKEN');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  await page.getByRole('button', { name: 'Copiar skill portátil (SKILL.md)' }).click();
  const { readFileSync } = await import('node:fs');
  const copiedSkill = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedSkill.replace(/\r\n/g, '\n')).toBe(
    readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8').replace(/\r\n/g, '\n'),
  );
});

test('MCP propone eliminar una entrada y solo se borra al aceptar', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const entry = await call('save', {
    kind: 'entry',
    data: { ...blank('entry'), project: project.id, title: 'Entrada repetida' },
  });
  await call('settings', { companyAuthorized: true, universityStructure: '' });
  await call('grant', { provider: 'codex', scope: 'projects', projectIds: [project.id] });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test-delete', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist-service/mcp.cjs')],
      env: {
        ...(process.env as Record<string, string>),
        BITACORA_DATA_DIR: dir,
        BITACORA_PROVIDER: 'codex',
      },
    }),
  );
  const proposal = await client.callTool({
    name: 'proponer_eliminacion',
    arguments: {
      kind: 'entry',
      targetId: entry.id,
      expectedVersion: entry.version,
      rationale: 'Duplica la entrada de ayer',
    },
  });
  expect(proposal.isError).not.toBe(true);
  await client.close();
  expect((await call('snapshot')).records.some((r: { id: string }) => r.id === entry.id)).toBe(
    true,
  );

  await page.reload();
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page
    .locator('.tabbar')
    .getByRole('button', { name: /Propuestas/ })
    .click();
  await page.getByRole('button', { name: /Entradas/ }).click();
  const card = page.locator('.proposal').filter({ hasText: 'Entrada repetida' });
  await expect(card.getByText('Eliminación', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Aceptar eliminación' }).click();
  await page
    .getByRole('dialog', { name: 'Vista previa de aceptación' })
    .getByRole('button', { name: 'Aceptar 1 propuesta' })
    .click();
  await expect(page.locator('.proposal')).toHaveCount(0);
  expect((await call('snapshot')).records.some((r: { id: string }) => r.id === entry.id)).toBe(
    false,
  );
});

test('MCP desde los tres clientes: solo el cuaderno activo y propuestas revisadas', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const project = (await call('snapshot')).records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  await call('lock');
  const privateSnapshot = await call('create-project', {
    title: 'Proyecto privado',
    password: 'Contraseña privada de prueba',
  });
  const privateProject = privateSnapshot.records.find(
    (record: { kind: string }) => record.kind === 'project',
  );
  const privateTask = await call('save', {
    kind: 'task',
    data: { ...blank('task'), project: privateProject.id, title: 'Tarea privada' },
  });
  await call('lock');
  await call('unlock', { projectId: project.id, password: 'Prueba de bitácora segura' });
  await page.reload();
  const task = await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      project: project.id,
      title: 'Tarea autorizada',
      description: 'Detalle de la tarea autorizada',
    },
  });
  const linkedEntry = await call('save', {
    kind: 'entry',
    data: {
      ...blank('entry'),
      project: project.id,
      title: 'Entrada vinculada',
      taskIds: [task.id],
    },
  });
  await call('settings', { companyAuthorized: true, universityStructure: 'Objetivos' });
  await call('asvs-configure', {
    projectId: project.id,
    expectedConfigVersion: 0,
    catalogVersion: asvsCatalog.version,
    level: 1,
  });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  for (const provider of ['claude', 'codex', 'antigravity']) {
    const grant = await call('grant', { provider, scope: 'projects', projectIds: [project.id] });
    const client = new Client({ name: `test-${provider}`, version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist-service/mcp.cjs')],
      env: {
        ...(process.env as Record<string, string>),
        BITACORA_DATA_DIR: dir,
        BITACORA_PROVIDER: provider,
        BITACORA_GRANT_TOKEN: 'incorrecto',
      },
    });
    await client.connect(transport);
    const session = await client.callTool({ name: 'estado_sesion', arguments: {} });
    const asvsPage = await client.callTool({
      name: 'consultar_asvs',
      arguments: { projectId: project.id, level: 1, limit: 2 },
    });
    expect(asvsPage.isError).not.toBe(true);
    const asvsReference = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
    const asvsRead = await client.callTool({
      name: 'leer_referencias_asvs',
      arguments: { projectId: project.id, references: [asvsReference.reqId] },
    });
    expect(asvsRead.isError).not.toBe(true);
    expect(JSON.stringify(asvsRead)).toContain(asvsReference.canonicalRef);
    const invalidAsvs = await client.callTool({
      name: 'proponer_evaluacion_asvs',
      arguments: {
        projectId: project.id,
        reference: asvsReference.canonicalRef,
        targetId: '00000000-0000-4000-8000-000000000000',
        expectedVersion: 1,
        expectedConfigVersion: 1,
        state: 'Cumplido',
        applicability: 'Aplicable',
        scope: 'project',
        scopeDetail: '',
        pendingScope: '',
        note: 'Caso sintético',
        method: 'Prueba',
        responsible: 'Revisor sintético',
        evidence: [],
        rationale: 'Debe rechazar el destino inválido',
      },
    });
    expect(invalidAsvs.isError).toBe(true);
    expect(JSON.stringify(session)).toContain('Proyecto conectado');
    if (provider === 'claude') {
      const legacyEnv = { ...(process.env as Record<string, string>) };
      delete legacyEnv.BITACORA_PROVIDER;
      legacyEnv.BITACORA_DATA_DIR = dir;
      legacyEnv.BITACORA_GRANT_TOKEN = grant.token;
      const legacy = new Client({ name: 'test-claude-legacy', version: '1.0.0' });
      await legacy.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve('dist-service/mcp.cjs')],
          env: legacyEnv,
        }),
      );
      expect((await legacy.callTool({ name: 'estado_sesion', arguments: {} })).isError).not.toBe(
        true,
      );
      await legacy.close();
    }
    const filtered = await client.callTool({
      name: 'filtrar_registros',
      arguments: { kind: 'task', projectId: project.id },
    });
    expect(JSON.stringify(filtered)).toContain(task.id);
    expect(JSON.stringify(filtered)).not.toContain(privateTask.id);
    const summary = await client.callTool({
      name: 'resumir_proyecto',
      arguments: { projectId: project.id },
    });
    expect(
      JSON.parse((summary as { content: { text: string }[] }).content[0].text).counts.task,
    ).toBe(1);
    const relations = await client.callTool({
      name: 'consultar_relaciones',
      arguments: { recordId: task.id },
    });
    expect(JSON.stringify(relations)).toContain(linkedEntry.id);
    expect(JSON.stringify(relations)).not.toContain(privateTask.id);
    const result = await client.callTool({
      name: 'buscar_contexto',
      arguments: { query: 'Tarea autorizada' },
    });
    expect(JSON.stringify(result)).toContain('Tarea autorizada');
    expect(JSON.stringify(result)).not.toContain('Detalle de la tarea autorizada');
    expect(JSON.stringify(result)).not.toContain('Tarea privada');
    const selected = await client.callTool({
      name: 'leer_elementos',
      arguments: { recordIds: [task.id, privateTask.id] },
    });
    expect(JSON.stringify(selected)).toContain('Detalle de la tarea autorizada');
    expect(JSON.stringify(selected)).not.toContain('Tarea privada');
    const proposal = await client.callTool({
      name: 'proponer_cambios',
      arguments: {
        operation: 'create',
        kind: 'entry',
        patch: {
          title: `Avance de ${provider}`,
          project: project.id,
          activity: 'Trabajo documentado',
        },
        rationale: 'Registro diario',
      },
    });
    expect(proposal.isError).not.toBe(true);
    await call('renew-grant', { id: grant.id });
    expect((await client.callTool({ name: 'estado_sesion', arguments: {} })).isError).not.toBe(
      true,
    );
    const renewed = await call('grant', {
      provider,
      scope: 'projects',
      projectIds: [project.id],
    });
    expect(renewed).toMatchObject({ id: grant.id, renewed: true });
    expect((await client.callTool({ name: 'estado_sesion', arguments: {} })).isError).not.toBe(
      true,
    );
    await call('revoke-grant', { id: renewed.id });
    expect((await client.callTool({ name: 'buscar_contexto', arguments: {} })).isError).toBe(true);
    await client.close();
  }
  await page.getByRole('button', { name: 'Asistentes', exact: false }).click();
  await page.getByRole('button', { name: /Propuestas/ }).click();
  await page.getByRole('button', { name: /Entradas/ }).click();
  await expect(page.locator('.proposal')).toHaveCount(3);
  await page.getByRole('button', { name: 'Aceptar cambios' }).first().click();
  await page
    .getByRole('dialog', { name: 'Vista previa de aceptación' })
    .getByRole('button', { name: 'Aceptar 1 propuesta' })
    .click();
  await expect(page.locator('.proposal')).toHaveCount(2);
  const snapshot = await call('snapshot');
  expect(snapshot.records.filter((r: any) => r.kind === 'entry')).toHaveLength(2);
});
test('criterios accesibles en el editor móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page.getByRole('button', { name: 'Crear mi primera tarea' }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva tarea' })).toBeVisible();
  await expect(page.locator('.criteria-section > summary')).toBeVisible();
  await page.locator('.criteria-section > summary').click();
  await expect(page.getByText('Las tareas nuevas reciben automáticamente')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/bitacora-mobile.png', fullPage: true });
});
test('copia cifrada y bloqueo revocan acceso', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Ajustes y copias' }).click();
  await page
    .getByLabel('Contraseña de la copia (mínimo 12 caracteres)')
    .fill('contraseña de copia segura');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia cifrada' }).click();
  const dl = await event;
  expect(dl.suggestedFilename()).toMatch(/\.backup$/);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await expect(page.getByRole('button', { name: 'Desbloquear bitácora' })).toBeVisible();
});

test('cambia la contraseña del cuaderno sin perder sus registros', async ({ page }) => {
  await unlock(page);
  const task = await call('save', {
    kind: 'task',
    data: { ...(await import('../service/domain')).blank('task'), title: 'Tarea conservada' },
  });
  await page.getByRole('button', { name: 'Ajustes y copias' }).click();
  await page.getByLabel('Contraseña actual').fill('Prueba de bitácora segura');
  await page.getByLabel('Nueva contraseña (mínimo 12 caracteres)').fill('Nueva contraseña segura');
  await page.getByLabel('Repite la nueva contraseña').fill('Nueva contraseña segura');
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  await expect(page.getByText('Contraseña del cuaderno actualizada.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('Nueva contraseña segura');
  await page.getByRole('button', { name: 'Desbloquear bitácora' }).click();
  expect(
    (await call('snapshot')).records.some((record: { id: string }) => record.id === task.id),
  ).toBe(true);
});

test('el detalle del día identifica visualmente el estado y retraso en tareas e incidencias antes de desplegarlas', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();
  const pastDay = new Date(`${today}T12:00:00Z`);
  pastDay.setUTCDate(pastDay.getUTCDate() - 3);
  const pastDayIso = pastDay.toISOString().slice(0, 10);

  // Una dependencia pendiente conserva la tarea en «Por hacer».
  const dependency = (await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Dependencia pendiente', due: '2099-01-01' },
  })) as Task;
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea normal por hacer',
      state: 'Por hacer',
      due: today,
      dependencyIds: [dependency.id],
    },
  });
  // Tarea en curso para hoy
  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea activa en curso', state: 'En curso', due: today },
  });
  // Tarea completada para hoy
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea ya completada',
      state: 'Completada',
      due: today,
      completedAt: today,
    },
  });
  // Incidencia sin resolver para hoy
  await call('save', {
    kind: 'incident',
    data: { ...blank('incident'), title: 'Incidencia abierta', date: today },
  });
  // Incidencia resuelta para hoy
  await call('save', {
    kind: 'incident',
    data: {
      ...blank('incident'),
      title: 'Incidencia solucionada',
      date: today,
      solution: 'Solución aplicada',
      resolvedDate: today,
    },
  });

  await page.reload();

  // Abrir detalles del día desde la tira semanal
  const todayButton = page.locator('.week-strip > button[aria-current="date"]');
  await todayButton.click();

  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  await expect(details).toBeVisible();

  // Comprobar cabecera de la sección de tareas antes de desplegar
  const taskSection = details.locator('.day-details-section.task');
  await expect(taskSection).not.toHaveAttribute('open');
  const taskHeader = taskSection.locator('.day-section-summary');
  await expect(taskHeader.locator('.badge', { hasText: '1 por hacer' })).toBeVisible();
  await expect(taskHeader.locator('.badge', { hasText: '1 en curso' })).toBeVisible();
  await expect(taskHeader.locator('.badge', { hasText: '1 completada' })).toBeVisible();

  // Comprobar cabecera de la sección de incidencias antes de desplegar
  const incidentSection = details.locator('.day-details-section.incident');
  await expect(incidentSection).not.toHaveAttribute('open');
  const incidentHeader = incidentSection.locator('.day-section-summary');
  await expect(incidentHeader.locator('.badge', { hasText: '1 sin resolver' })).toBeVisible();
  await expect(incidentHeader.locator('.badge', { hasText: '1 resuelta' })).toBeVisible();

  // Desplegar sección de tareas y comprobar tarjetas colapsadas
  await taskHeader.click();
  await expect(taskSection).toHaveAttribute('open', '');

  const todoCard = taskSection.locator('.day-detail-card', { hasText: 'Tarea normal por hacer' });
  await expect(todoCard).not.toHaveAttribute('open');
  await expect(todoCard.locator('.badge', { hasText: 'Por hacer' })).toBeVisible();

  const inProgressCard = taskSection.locator('.day-detail-card', {
    hasText: 'Tarea activa en curso',
  });
  await expect(inProgressCard).not.toHaveAttribute('open');
  await expect(inProgressCard.locator('.badge', { hasText: 'En curso' })).toBeVisible();

  const completedCard = taskSection.locator('.day-detail-card', { hasText: 'Tarea ya completada' });
  await expect(completedCard).not.toHaveAttribute('open');
  await expect(completedCard.locator('.badge', { hasText: 'Completada' })).toBeVisible();

  // Desplegar sección de incidencias y comprobar tarjetas colapsadas
  await incidentHeader.click();
  await expect(incidentSection).toHaveAttribute('open', '');

  const unresolvedCard = incidentSection.locator('.day-detail-card', {
    hasText: 'Incidencia abierta',
  });
  await expect(unresolvedCard).not.toHaveAttribute('open');
  await expect(unresolvedCard.locator('.badge', { hasText: 'Sin resolver' })).toBeVisible();

  const resolvedCard = incidentSection.locator('.day-detail-card', {
    hasText: 'Incidencia solucionada',
  });
  await expect(resolvedCard).not.toHaveAttribute('open');
  await expect(resolvedCard.locator('.badge', { hasText: 'Resuelta' })).toBeVisible();

  await details.getByRole('button', { name: 'Cerrar' }).click();

  // Comprobar también un día pasado con tarea con retraso
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea vencida con retraso',
      state: 'Por hacer',
      due: pastDayIso,
    },
  });
  await page.reload();

  await page.getByRole('button', { name: 'Ampliar calendario al mes' }).click();
  const calendar = page.getByRole('region', { name: 'Calendario mensual' });
  if (pastDayIso.slice(0, 7) !== today.slice(0, 7)) {
    await calendar.getByRole('button', { name: 'Mes anterior' }).click();
  }
  const pastDayButton = calendar.getByRole('button', {
    name: new RegExp(
      `^${new Date(`${pastDayIso}T12:00:00`).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })},`,
    ),
  });
  await pastDayButton.click();

  const pastDetails = page.getByRole('dialog', { name: 'Detalles del día' });
  await expect(pastDetails).toBeVisible();
  const pastTaskSection = pastDetails.locator('.day-details-section.task');
  const pastTaskHeader = pastTaskSection.locator('.day-section-summary');
  await expect(pastTaskHeader.locator('.badge', { hasText: '1 con retraso' })).toBeVisible();

  await pastTaskHeader.click();
  const overdueCard = pastTaskSection.locator('.day-detail-card', {
    hasText: 'Tarea vencida con retraso',
  });
  await expect(overdueCard).not.toHaveAttribute('open');
  await expect(overdueCard.locator('.badge', { hasText: 'Con retraso' })).toBeVisible();
  await expect(overdueCard).toHaveClass(/is-overdue/);

  await pastDetails.getByRole('button', { name: 'Cerrar' }).click();
});

test('Hoy sincroniza tareas a En curso y las devuelve a Por hacer al salir de la vista', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();

  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea sincronizada hoy', state: 'Por hacer', due: today },
  });

  await page.reload();

  const card = page.locator('.task-row').filter({ hasText: 'Tarea sincronizada hoy' });
  await expect(card.locator('.badge', { hasText: 'En curso' })).toBeVisible();

  const targetDay = new Date(`${today}T12:00:00Z`);
  targetDay.setUTCDate(targetDay.getUTCDate() + (targetDay.getUTCDay() === 0 ? -1 : 1));
  const targetIso = targetDay.toISOString().slice(0, 10);

  const targetButton = page.locator(
    `.week-strip > button[aria-label*="${new Date(`${targetIso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}"]`,
  );
  await card.dragTo(targetButton);

  await expect(
    page.locator('.task-row:not(.upcoming)', { hasText: 'Tarea sincronizada hoy' }),
  ).toHaveCount(0);

  const snapshot = await call('snapshot');
  const task = snapshot.records.find((r: Task) => r.title === 'Tarea sincronizada hoy');
  expect(task).toMatchObject({
    state: 'Por hacer',
    due: targetIso,
  });
});

test('Hoy muestra próximas tareas con distintivo de fecha al no quedar pendientes', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();

  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const future = new Date(`${today}T12:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 5);
  const futureIso = future.toISOString().slice(0, 10);

  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea de hoy', state: 'Por hacer', due: today },
  });
  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea para mañana', state: 'Por hacer', due: tomorrowIso },
  });
  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea futura', state: 'Por hacer', due: futureIso },
  });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toHaveCount(0);
  await expect(page.locator('.task-row', { hasText: 'Tarea de hoy' })).toBeVisible();

  const todayTask = (await call('snapshot')).records.find((r: Task) => r.title === 'Tarea de hoy');
  await call('save', {
    kind: 'task',
    id: todayTask.id,
    expectedVersion: todayTask.version,
    data: { ...todayTask, state: 'Completada', completedAt: `${today}T10:00:00Z` },
  });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toBeVisible();
  await expect(
    page.getByText(
      'Has completado las tareas de hoy y las retrasadas. Puedes anticipar trabajo de las siguientes jornadas:',
    ),
  ).toBeVisible();

  const tomorrowRow = page.locator('.upcoming-tasks-section .task-row', {
    hasText: 'Tarea para mañana',
  });
  await expect(tomorrowRow).toBeVisible();
  await expect(tomorrowRow.locator('.upcoming-date-chip')).toHaveText('Para mañana');

  const futureRow = page.locator('.upcoming-tasks-section .task-row', { hasText: 'Tarea futura' });
  await expect(futureRow).toBeVisible();
  await expect(futureRow.locator('.upcoming-date-chip')).toBeVisible();

  await tomorrowRow.getByRole('button', { name: 'Ampliar detalles de Tarea para mañana' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  await tomorrowRow.getByRole('button', { name: 'Mover Tarea para mañana a hoy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tarea movida al' })).toBeVisible();

  const updatedSnapshot = await call('snapshot');
  const movedTask = updatedSnapshot.records.find((r: Task) => r.title === 'Tarea para mañana');
  expect(movedTask.due).toBe(today);
});

test('Hoy muestra tareas retrasadas y espera a completarlas antes de mostrar las próximas', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  for (const [title, due] of [
    ['Tarea retrasada', yesterday.toISOString().slice(0, 10)],
    ['Tarea de hoy pendiente', today],
    ['Tarea de mañana oculta', tomorrow.toISOString().slice(0, 10)],
  ]) {
    await call('save', {
      kind: 'task',
      data: { ...blank('task'), title, state: 'Por hacer', due },
    });
  }
  await page.reload();

  const overdueRow = page.locator('.focus-section .task-row', { hasText: 'Tarea retrasada' });
  await expect(overdueRow).toBeVisible();
  await expect(overdueRow.locator('.overdue-date-chip')).toHaveText('Con retraso');
  await expect(overdueRow.locator('.badge', { hasText: 'En curso' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toHaveCount(0);

  for (const title of ['Tarea de hoy pendiente', 'Tarea retrasada']) {
    const current = (await call('snapshot')).records.find((record: Task) => record.title === title);
    await call('save', {
      kind: 'task',
      id: current.id,
      expectedVersion: current.version,
      data: { ...current, state: 'Completada', completedAt: `${today}T10:00:00Z` },
    });
    await page.reload();
    if (title === 'Tarea de hoy pendiente') {
      await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toHaveCount(
        0,
      );
    }
  }

  await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toBeVisible();
  await expect(
    page.locator('.upcoming-tasks-section .task-row', { hasText: 'Tarea de mañana oculta' }),
  ).toBeVisible();
});

test('Hoy muestra próximas tareas cuando no hay tareas asignadas para hoy', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();

  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  await call('save', {
    kind: 'task',
    data: { ...blank('task'), title: 'Tarea adelantada', state: 'Por hacer', due: tomorrowIso },
  });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Próximas tareas programadas' })).toBeVisible();
  await expect(page.getByText('No tienes tareas programadas para hoy.')).toBeVisible();
  await expect(
    page.getByText(
      'Puedes anticipar trabajo y mantener el ritmo con las tareas programadas para los días siguientes:',
    ),
  ).toBeVisible();

  const taskRow = page.locator('.upcoming-tasks-section .task-row', {
    hasText: 'Tarea adelantada',
  });
  await expect(taskRow).toBeVisible();
  await expect(taskRow.locator('.upcoming-date-chip')).toHaveText('Para mañana');
});

test('Hoy muestra el selector con indicador naranja para tareas en revisión', async ({ page }) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();

  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea en revisión en Hoy',
      state: 'En revisión',
      due: today,
    },
  });
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea completada en Hoy',
      state: 'Completada',
      due: today,
    },
  });
  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: 'Tarea por hacer en Hoy',
      state: 'Por hacer',
      due: today,
    },
  });

  await page.reload();

  const reviewRow = page.locator('.task-row', { hasText: 'Tarea en revisión en Hoy' });
  await expect(reviewRow).toBeVisible();
  const reviewIcon = reviewRow.locator('.state-icon.review');
  await expect(reviewIcon).toBeVisible();
  await expect(reviewIcon.locator('svg')).toBeVisible();
  await expect(reviewRow.locator('.badge.amber')).toHaveText('En revisión');

  const doneRow = page.locator('.task-row', { hasText: 'Tarea completada en Hoy' });
  await expect(doneRow).toBeVisible();
  const doneIcon = doneRow.locator('.state-icon.done');
  await expect(doneIcon).toBeVisible();
  await expect(doneIcon.locator('svg')).toBeVisible();

  const todoRow = page.locator('.task-row', { hasText: 'Tarea por hacer en Hoy' });
  await expect(todoRow).toBeVisible();
  const todoIcon = todoRow.locator('.state-icon');
  await expect(todoIcon).not.toHaveClass(/review/);
  await expect(todoIcon).not.toHaveClass(/done/);
  await expect(todoIcon.locator('svg')).toHaveCount(0);
});

test('Detalles del día ajusta títulos y textos largos sin desbordar las tarjetas', async ({
  page,
}) => {
  await unlock(page);
  const { blank } = await import('../service/domain');
  const today = madridDate();

  const longTitle =
    'Aislamiento de cuadernos por proyecto con credenciales individuales y sesión MCP en el entorno local extendido para pruebas de desbordamiento horizontal';
  const longDescription =
    'Esta es una descripción extremadamente larga diseñada para verificar que los textos extensos no provocan ningún desbordamiento horizontal en las tarjetas de la vista de detalles del día ni ocultan el icono chevron o las etiquetas.';

  await call('save', {
    kind: 'task',
    data: {
      ...blank('task'),
      title: longTitle,
      description: longDescription,
      state: 'Completada',
      due: today,
    },
  });

  await page.reload();

  const todayButton = page.locator('.week-strip > button[aria-current="date"]');
  await todayButton.click();

  const details = page.getByRole('dialog', { name: 'Detalles del día' });
  await expect(details).toBeVisible();

  const taskSection = details.locator('.day-details-section.task');
  const taskHeader = taskSection.locator('.day-section-summary');
  await taskHeader.click();
  await expect(taskSection).toHaveAttribute('open', '');

  const card = taskSection.locator('.day-detail-card', { hasText: 'Aislamiento de cuadernos' });
  await expect(card).toBeVisible();

  const cardBox = await card.boundingBox();
  const sectionBox = await taskSection.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(sectionBox).not.toBeNull();
  if (cardBox && sectionBox) {
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(sectionBox.x + sectionBox.width + 1);
  }

  const chevron = card.locator('.day-detail-summary .day-detail-chevron');
  await expect(chevron).toBeVisible();
  const chevronBox = await chevron.boundingBox();
  expect(chevronBox).not.toBeNull();
  if (chevronBox && cardBox) {
    expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }

  await expect(card.locator('.badge', { hasText: 'Completada' })).toBeVisible();

  const preview = card.locator('.day-detail-preview');
  await expect(preview).toBeVisible();

  await card.locator('.day-detail-summary').click();
  await expect(card).toHaveAttribute('open', '');
  const body = card.locator('.day-detail-body');
  await expect(body).toBeVisible();
  const bodyBox = await body.boundingBox();
  expect(bodyBox).not.toBeNull();
  if (bodyBox && cardBox) {
    expect(bodyBox.x + bodyBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }

  await page.setViewportSize({ width: 375, height: 667 });
  const mobileCardBox = await card.boundingBox();
  const mobileChevronBox = await chevron.boundingBox();
  expect(mobileCardBox).not.toBeNull();
  expect(mobileChevronBox).not.toBeNull();
  if (mobileChevronBox && mobileCardBox) {
    expect(mobileChevronBox.x + mobileChevronBox.width).toBeLessThanOrEqual(
      mobileCardBox.x + mobileCardBox.width + 1,
    );
  }
  await expect(card.locator('.badge', { hasText: 'Completada' })).toBeVisible();
});

test('soporte de criterios en borrador, filtrado en buenas prácticas y flujo de maduración', async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();

  await expect(page.getByRole('button', { name: /Políticas vigentes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Borradores/ })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva práctica', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Criterio experimental');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Borradores/ }).click();
  const draftCard = page.locator('.practice-card').filter({ hasText: 'Criterio experimental' });
  await expect(draftCard).toBeVisible();
  await expect(draftCard).toHaveClass(/is-draft/);
  await expect(draftCard.locator('.badge', { hasText: 'Borrador' }).first()).toBeVisible();

  await page.getByRole('button', { name: /Políticas vigentes/ }).click();
  await expect(
    page.locator('.practice-card').filter({ hasText: 'Criterio experimental' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Tarea sin borrador');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openBoardGroup(page, 'Tarea sin borrador');
  await page.getByRole('button', { name: /Tarea sin borrador/ }).click();
  const taskEditor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(taskEditor).toBeVisible();
  const criteriaSection = taskEditor.locator('.criteria-section');
  await criteriaSection.locator('summary').first().click();
  await expect(
    criteriaSection.locator('.check-editor').filter({ hasText: 'Criterio experimental' }),
  ).toHaveCount(0);
  await taskEditor.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();
  await page.getByRole('button', { name: /Borradores/ }).click();
  await page.locator('.practice-card').filter({ hasText: 'Criterio experimental' }).click();
  const practiceEditor = page.getByRole('dialog', { name: 'Editar práctica' });
  await expect(practiceEditor).toBeVisible();
  await page.getByLabel('Estado de la práctica').selectOption('Recomendación personal');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Políticas vigentes/ }).click();
  await expect(
    page.locator('.practice-card').filter({ hasText: 'Criterio experimental' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Tablero', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Tarea con recomendación activa');
  await page.getByRole('button', { name: 'Crear registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openBoardGroup(page, 'Tarea con recomendación activa');
  await page.getByRole('button', { name: /Tarea con recomendación activa/ }).click();
  const newTaskEditor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(newTaskEditor.locator('.criteria-section')).toHaveAttribute('open');
  await expect(
    newTaskEditor.locator('.check-editor').filter({ hasText: 'Criterio experimental' }),
  ).toHaveCount(1);
  await newTaskEditor.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Buenas prácticas', exact: true }).click();
  await page.locator('.practice-card').filter({ hasText: 'Criterio experimental' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Borrar política o criterio/ }).click();
  await expect(
    page.locator('.practice-card').filter({ hasText: 'Criterio experimental' }),
  ).toHaveCount(0);
});
