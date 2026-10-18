<!-- doc:summary: Instalación desde cero en un Windows nuevo a partir del repositorio, con datos vacíos y sin copiar secretos. -->
# Instalación en un Windows nuevo

El repositorio solo contiene código, documentación y el catálogo público ASVS. Los cuadernos, vaults, copias y el archivo `connection.json` se guardan fuera del repositorio, en `%LOCALAPPDATA%\Bitacora` (o en `BITACORA_DATA_DIR` si está definido). Por eso una instalación nueva arranca siempre con la base de datos vacía y crea su propio cuaderno al abrirse por primera vez.

## Requisitos

Desde PowerShell, con [winget](https://learn.microsoft.com/windows/package-manager/winget/):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
corepack enable
```

`corepack` activa la versión de pnpm fijada en `package.json`. Cierra y vuelve a abrir la terminal tras instalar Node. Microsoft Edge, que usa Playwright en las pruebas de interfaz, ya viene con Windows.

Solo para la aplicación de escritorio (Tauri) añade Rust y las herramientas de compilación de C++:

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

WebView2 viene instalado en Windows 11.

## Instalar y arrancar

```powershell
git clone <url-del-repositorio> Bitacora
cd Bitacora
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` inicia el servicio local y la interfaz en `http://127.0.0.1:1420`. Para la ventana de escritorio en modo desarrollo usa `pnpm run desktop:dev`; para generar el instalador NSIS, `pnpm run desktop:build` (el instalador queda en `src-tauri/target/release/bundle/nsis/`). El resto de comandos están en [desarrollo y verificación](desarrollo.md).

## Llevar datos de otro equipo

No copies el vault ni la carpeta de datos al repositorio. Para trasladar un cuaderno, exporta una copia cifrada desde «Ajustes y copias» en el equipo antiguo y restáurala en el nuevo por la misma vía. La copia sigue protegida por la contraseña del cuaderno.

## Conectores MCP

La configuración MCP de cada asistente apunta al Node y al `dist-service/mcp.cjs` del equipo donde se creó, así que no sirve la de otro equipo. Crea la sesión de nuevo desde «Asistentes»: la aplicación muestra las rutas de este equipo para copiarlas en la configuración del asistente. `pnpm run dev` y `pnpm run build` generan `mcp.cjs`. Consulta [acceso de IA mediante MCP](mcp.md).

## Antes de publicar cambios

- `git status` no debe mostrar `node_modules/`, `dist*/`, `.tmp/`, `code-backups/`, `.toolchain/`, archivos `.vault`, `.backup`, `.env*` ni `connection.json`; están excluidos en `.gitignore`.
- No subas capturas, logs ni datos de prueba creados con cuadernos reales.
- Las claves opcionales, como `DEEPL_API_KEY` para `pnpm run asvs:translate`, se definen como variables de entorno y nunca en archivos del repositorio.
