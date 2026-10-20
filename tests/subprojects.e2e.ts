import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let child: ChildProcess, dir: string, url: string, token: string;
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-subprojects-e2e-'));
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
async function call(action: string, data: unknown = {}, auth = token, path = `/api/${action}`) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
/** Opens the side navigation on narrow screens, where it lives in the menu. */
async function navigation(page: Page, narrow: boolean) {
  if (!narrow) return;
  const open = await page.locator('.sidebar').evaluate((e) => e.classList.contains('mobile-open'));
  if (!open) await page.getByRole('button', { name: 'Abrir navegación' }).click();
}
const scopeButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}(?: \\(archivado, solo lectura\\))?, `) });

for (const narrow of [false, true]) {
  const label = narrow ? 'pantalla estrecha' : 'pantalla amplia';

  test(`subproyectos: crear, entrar y separar tareas por ámbito (${label})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);

    // 1. Ficha raíz → gestión → crear subproyecto → entrar desde la barra lateral.
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Editar proyecto Proyecto conectado' }).click();
    await page.getByRole('button', { name: 'Gestionar subproyectos' }).click();
    await page.getByLabel('Nombre del subproyecto').fill('API');
    await page.getByRole('button', { name: 'Crear subproyecto' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Subproyecto creado.' })).toBeVisible();
    await page.getByLabel('Nombre del subproyecto').fill('Web');
    await page.getByRole('button', { name: 'Crear subproyecto' }).click();
    await expect(page.locator('.subproject-item')).toHaveCount(2);
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await navigation(page, narrow);
    await scopeButton(page, 'API').click();
    await expect(page.locator('.breadcrumb-scope')).toHaveText('Proyecto conectado / API');
    await expect(page.locator('.breadcrumb-scope')).toHaveAttribute(
      'title',
      'Proyecto conectado / API',
    );

    // 2. Crear una tarea en el subproyecto y verla solo en su ámbito y en la vista agregada.
    await page.getByRole('button', { name: 'Crear mi primera tarea' }).click();
    await expect(page.locator('.scope-context')).toContainText('Proyecto conectado / API');
    await page.getByLabel('Título', { exact: true }).fill('Diseñar contrato REST');
    await page.getByRole('button', { name: 'Crear registro' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.locator('.task-row').filter({ hasText: 'Diseñar contrato REST' });
    await expect(row).toContainText('Proyecto conectado / API');
    await navigation(page, narrow);
    await scopeButton(page, 'General').click();
    await expect(row).toHaveCount(0);
    await navigation(page, narrow);
    await scopeButton(page, 'Web').click();
    await expect(row).toHaveCount(0);
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Todo el proyecto Proyecto conectado' }).click();
    await expect(row).toContainText('Proyecto conectado / API');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // «Todo el proyecto» pide el destino antes de guardar.
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Tablero', exact: true }).click();
    await page.getByRole('button', { name: 'Nueva tarea' }).click();
    await page.getByLabel('Destino').selectOption({ label: 'Proyecto conectado / Web' });
    await page.getByLabel('Título', { exact: true }).fill('Maquetar portada');
    await page.getByRole('button', { name: 'Crear registro' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const snapshot = (await call('snapshot')).body;
    const web = snapshot.records.find(
      (r: { kind: string; title: string }) => r.kind === 'subproject' && r.title === 'Web',
    );
    expect(
      snapshot.records.find((r: { title: string }) => r.title === 'Maquetar portada').subprojectId,
    ).toBe(web.id);
    expect(errors).toEqual([]);
  });

  test(`subproyectos: archivar, consultar, restaurar y eliminar (${label})`, async ({ page }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    const api = (await call('subproject-save', { data: { title: 'API' } })).body;
    const empty = (await call('subproject-save', { data: { title: 'Vacío' } })).body;
    const projectId = api.project;
    await call('save', {
      kind: 'task',
      data: {
        kind: 'task',
        title: 'Versionar endpoints',
        project: projectId,
        subprojectId: api.id,
        phase: 'Diseño',
        type: 'General',
        tags: [],
        priority: 'Media',
        state: 'Por hacer',
        due: '2030-01-10',
        blocked: '',
        nextStep: '',
        description: '',
        solution: '',
        dependencyIds: [],
        checks: [],
      },
    });
    await call('settings', { companyAuthorized: true, universityStructure: '' });
    const grant = (
      await call('grant', {
        provider: 'codex',
        scope: 'projects',
        projectIds: [projectId],
        scopes: [api.id],
      })
    ).body;
    expect((await call('', { action: 'session' }, grant.token, '/mcp')).status).toBe(200);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Un día más, un paso adelante.' }),
    ).toBeVisible();

    // 4. Eliminar con contenido ofrece archivar; un subproyecto vacío se elimina tras confirmar.
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Gestionar subproyectos' }).click();
    await page.getByRole('button', { name: 'Eliminar API' }).click();
    await expect(page.getByText('tiene registros o borradores')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Eliminar Vacío' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Subproyecto eliminado.' }),
    ).toBeVisible();
    expect(
      (await call('snapshot')).body.records.some((r: { id: string }) => r.id === empty.id),
    ).toBe(false);

    // 3. Archivar: revoca el MCP, deja el contenido en solo lectura y explica el motivo.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Archivar «API»' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Subproyecto archivado.' }),
    ).toBeVisible();
    expect((await call('', { action: 'session' }, grant.token, '/mcp')).status).toBe(401);
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await navigation(page, narrow);
    await page.getByText('Archivados (1)').click();
    await scopeButton(page, 'API').click();
    await expect(page.getByText('está archivado: puedes consultar su contenido')).toBeVisible();
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    await page.getByRole('button', { name: 'Versionar endpoints', exact: true }).click();
    await expect(page.getByText('Pertenece a «API», que está archivado')).toBeVisible();
    await page.getByLabel('Título', { exact: true }).fill('Versionar endpoints v2');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('dialog').getByText('solo lectura')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar' }).click();

    // Restaurar no recupera la sesión MCP anterior.
    await navigation(page, narrow);
    await page.getByRole('button', { name: 'Gestionar subproyectos' }).click();
    await page.getByRole('button', { name: 'Restaurar API' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Subproyecto restaurado.' }),
    ).toBeVisible();
    expect((await call('', { action: 'session' }, grant.token, '/mcp')).status).toBe(401);
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByText('está archivado: puedes consultar su contenido')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('barra lateral: cabe en 1080p y 2K escalados aunque haya muchos subproyectos', async ({
  page,
}) => {
  const sidebarFits = () =>
    page.locator('.sidebar').evaluate((e) => e.scrollHeight <= e.clientHeight + 1);
  // 1080p al 125 % y 2K al 150 % descontando la barra de título de la ventana.
  const viewports = [
    { width: 1536, height: 834 },
    { width: 1707, height: 930 },
    { width: 2560, height: 1392 },
  ];
  await unlock(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(await sidebarFits()).toBe(true);
  }

  for (let index = 1; index <= 14; index++) {
    await call('subproject-save', { data: { title: `Módulo ${index}` } });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(await sidebarFits()).toBe(true);
    // ASVS is hidden while disabled, so «Buenas prácticas» is the last main view.
    await expect(
      page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('button', { name: 'Buenas prácticas' }),
    ).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Gestionar subproyectos' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Bloquear bitácora' })).toBeInViewport();
  }

  // Solo la lista de ámbitos se desplaza y el ámbito elegido queda a la vista.
  await page.setViewportSize(viewports[0]);
  const scroller = page.locator('.scope-scroll');
  expect(await scroller.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await expect(scroller).toHaveClass(/more-below/);
  const filter = page.getByLabel('Buscar subproyecto');
  await filter.fill('modulo 14');
  await expect(page.locator('.scope-item')).toHaveCount(1);
  await scopeButton(page, 'Módulo 14').click();
  await filter.fill('');
  await expect(scopeButton(page, 'Módulo 14')).toBeInViewport();

  // El plegado se recuerda en este equipo.
  await page.getByRole('button', { name: 'Plegar subproyectos de Proyecto conectado' }).click();
  await expect(page.locator('.scope-item')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Desplegar subproyectos de Proyecto conectado' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Desplegar subproyectos de Proyecto conectado' }).click();
  await expect(scopeButton(page, 'General')).toBeVisible();

  await page.screenshot({ path: '.tmp/sidebar-1080p.png' });
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.screenshot({ path: '.tmp/sidebar-1080p-dark.png' });
  await page.setViewportSize(viewports[1]);
  await page.screenshot({ path: '.tmp/sidebar-2k-dark.png' });
});

test('subproyectos: la selección se descarta al bloquear', async ({ page }) => {
  await unlock(page);
  await call('subproject-save', { data: { title: 'API' } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un día más, un paso adelante.' })).toBeVisible();
  await scopeButton(page, 'API').click();
  await expect(page.locator('.breadcrumb-scope')).toHaveText('Proyecto conectado / API');
  await page.getByRole('button', { name: 'Bloquear bitácora' }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba de bitácora segura');
  await page.getByRole('button', { name: 'Desbloquear bitácora' }).click();
  await expect(page.locator('.breadcrumb-scope')).toHaveText('Todo el proyecto');
});
