<!-- doc:summary: Comandos reales de desarrollo, compilación, pruebas y empaquetado. -->
# Desarrollo y verificación

## Requisitos y comandos

El proyecto usa pnpm 11.25.0 (fijado en `package.json`) y `pnpm-lock.yaml`, Node para el servicio, TypeScript/React/Vite para la interfaz y Rust/Tauri 2 para escritorio. Instala pnpm 11.25.0 y usa Node 22 o posterior compatible con las dependencias.

| Objetivo | Comando | Nota |
| --- | --- | --- |
| Instalar dependencias | `pnpm install --frozen-lockfile` | Usa el lockfile sin modificarlo. |
| Desarrollo web con servicio | `pnpm run dev` | Genera el conector MCP, inicia el servicio y luego Vite en `127.0.0.1:1420`. |
| Acceso directo de desarrollo | `powershell -ExecutionPolicy Bypass -File scripts/crear-acceso-directo.ps1` | Crea `Bitácora` en el escritorio. Ver [acceso directo local](#acceso-directo-local). |
| Compilación | `pnpm run build` | Verifica docs, catálogo ASVS, formato y tipos; genera frontend y servicio. |
| Regenerar catálogo ASVS | `pnpm run asvs:generate` | Importa el CSV público local con huella fijada, sin red ni acceso al vault. |
| Traducir catálogo ASVS | `pnpm run asvs:translate` | Usa DeepL y `DEEPL_API_KEY` para generar español desde textos públicos; requiere red solo para generar. |
| Comprobar catálogo ASVS | `pnpm run asvs:check` | Verifica integridad y generación reproducible; incluido en build. |
| Aplicar formato | `pnpm run format` | Formatea código y configuración con Prettier. |
| Comprobar formato | `pnpm run format:check` | Valida el formato; también se ejecuta en la compilación. |
| Pruebas de dominio y servicio | `pnpm test` | Vitest en `tests/*.test.ts`. |
| Pruebas de interfaz | `pnpm run test:e2e` | Playwright usa Microsoft Edge y dos trabajadores con datos aislados por prueba; requiere navegador instalado. |
| Desarrollo de escritorio | `pnpm run desktop:dev` | Requiere toolchain de Tauri/Rust. |
| Instalador de escritorio | `pnpm run desktop:build` | Empaqueta servicio y aplicación. |
| Formato Rust | `cargo fmt --manifest-path src-tauri/Cargo.toml` | Requiere el componente `rustfmt`. |
| Auditar dependencias | `pnpm run deps:audit` | Revisa avisos y firmas del registro. Requiere red. |
| Comprobar documentación | `pnpm run docs:check` | Valida índices y enlaces locales. |
| Regenerar índices | `pnpm run docs:sync` | Actualiza los bloques de índice. |

El servidor guarda los datos fuera del repositorio en `BITACORA_DATA_DIR` si está definido y, en caso contrario, bajo el directorio de datos local `Bitacora`. El índice `workspaces.json` solo contiene ID y título; cada vault cifrado se guarda en `workspaces/<id>/`. Una instalación anterior conserva el vault raíz como copia de recuperación tras migrar. En pruebas usa un directorio aislado. No abras datos reales para verificar una modificación.

## Acceso directo local

`scripts/crear-acceso-directo.ps1` crea `Bitácora` en el escritorio con el icono `public/favicon.ico`. El acceso directo ejecuta `scripts/lanzador.ps1`, que:

- Usa la versión compilada (`dist/` y `dist-service/server.cjs`). Si faltan o son anteriores a `src`, `service`, `shared`, `public` o la configuración, ejecuta solo `vite build` y `scripts/build-service.mjs`; la verificación completa sigue siendo `pnpm run build`.
- Arranca el servicio oculto con `BITACORA_PARENT_PID` apuntando al lanzador, lee `{port, token}` de su salida y abre `http://127.0.0.1:<port>/#session=<token>` en una ventana `--app` de Brave con perfil propio (`%LOCALAPPDATA%\Bitacora\brave-perfil`).
- Espera a que se cierre la última ventana y termina; el servicio detecta la salida del lanzador en unos 2 s y se cierra de forma ordenada (bloquea el vault y borra `service.lock` y `connection.json`). Si el lanzador muere a la fuerza, ocurre lo mismo.
- Si ya hay un servicio activo, trae al frente la ventana existente en lugar de abrir otra, porque el token no se guarda en disco. Si el servicio pertenece a otra aplicación, avisa y no arranca otro.
- Con `-Dev` arranca `pnpm dev` y abre `127.0.0.1:1420`; al cerrar la ventana detiene el árbol de procesos.

La interfaz no registra service worker y el manifiesto usa `display: browser`, de modo que Brave no ofrece instalarla como PWA independiente: una instalación así se abriría sin servicio ni token. El nombre y el icono de la ventana salen de `public/manifest.webmanifest` y `public/favicon.ico`.

## Antes de terminar un cambio

1. Ejecuta la prueba más cercana a la lógica modificada, por ejemplo `pnpm test tests/domain.test.ts`; amplía a `pnpm test` si el cambio cruza módulos.
2. Ejecuta `pnpm run build` para cambios de código. Incluye `docs:check` y `format:check`, por lo que no hace falta repetirlos. Para cambios solo documentales, ejecuta `pnpm run docs:check` y `pnpm run format:check` si editaste un archivo sujeto a Prettier.
3. Usa `pnpm run test:e2e` si cambia un recorrido visible o la interacción de la interfaz. Durante el desarrollo puedes seleccionar casos con `pnpm exec playwright test --grep "texto del caso"`; ejecuta la suite completa al terminar un cambio amplio de interfaz.
4. Describe resultado, comprobaciones ejecutadas y cualquier límite de verificación.
