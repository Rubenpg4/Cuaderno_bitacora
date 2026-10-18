<!-- doc:summary: Mapa de módulos, flujo de datos y contratos entre interfaz, servicio y escritorio. -->

# Arquitectura

## Mapa

| Área              | Archivos principales                                                                                                       | Responsabilidad                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modelo compartido | `shared/model.ts`                                                                                                          | Tipos de registros, estados y funciones de informes y criterios.                                                                                                      |
| Interfaz          | `src/App.tsx`, `src/app/`, `src/views/`, `src/RecordEditor.tsx`, `src/Attachments.tsx`, `src/Assistants.tsx`, `src/api.ts` | Composición, navegación, preparación de datos del calendario, vistas, edición y verificación de criterios por tarea, adjuntos, revisión de propuestas y cliente HTTP. |
| Estilos           | `src/styles.css`, `src/styles/`                                                                                            | Importación ordenada de estilos base, estructura, módulos de componentes, adaptaciones de pantalla y tema.                                                            |
| Dominio           | `service/domain.ts`, `service/records/schemas.ts`, `service/records/attachments.ts`, `service/records/defaults.ts`         | Invariantes, versiones, historial, permisos, propuestas, validación de adjuntos, esquemas Zod y valores iniciales.                                                    |
| Persistencia      | `service/workspaces.ts`, `service/vault.ts`                                                                                | Índice local de cuadernos y un vault SQLite cifrado por proyecto.                                                                                                     |
| Transporte        | `service/server.ts`, `service/mcp.ts`                                                                                      | API HTTP local y herramientas MCP autorizadas.                                                                                                                        |
| Escritorio        | `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`                                                                       | Ventana, proceso del servicio, conexión y guardado de archivos.                                                                                                       |
| Empaquetado       | `scripts/build-service.mjs`, `scripts/prepare-desktop.mjs`                                                                 | Bundle del servicio, WASM y recursos de Tauri.                                                                                                                        |

## Flujo de datos

El [catálogo ASVS](catalogo-asvs.md) es un recurso público local separado de los registros y prácticas. `service/asvs/importCatalog.ts` valida la fuente; `shared/asvs.ts` define referencias y selección y `shared/asvsCatalog.ts` carga el JSON generado. La compilación verifica la fuente y empaqueta catálogo, licencia y atribución. `shared/asvsTracking.ts` define configuración/evaluaciones/historial privados en `Snapshot.asvs`; `service/asvs/tracking.ts` valida revisión humana, fuentes, alcance y vigencia. `Domain` aplica la transacción y `Workspaces` valida aislamiento. La primera escritura ASVS eleva el esquema SQLite de 1 a 2 tras verificar una copia cifrada previa. `AsvsView` se carga al abrir la vista y conserva el catálogo fuera del snapshot. Véase [Verificación ASVS](verificacion-asvs.md).

La interfaz llama a `src/api.ts`, que envía peticiones autenticadas al servidor local. `service/server.ts` delega reglas y escrituras en `Domain`; `Domain` valida los registros, actualiza el historial y guarda el estado mediante `Vault`. El cliente no escribe directamente en SQLite ni en el vault. Tauri inicia el servicio y entrega a la interfaz la conexión local.

Los adjuntos admitidos viajan como Base64 dentro del registro o de su propuesta pendiente y se validan en `service/records/attachments.ts`. Forman parte del mismo documento cifrado, historial y copia del cuaderno. Al aceptar una propuesta MCP, `Domain` escribe el registro y sus adjuntos en una transacción; al rechazarla, no crea el registro. El contexto de lectura MCP omite el contenido de los adjuntos.

Los objetivos son registros del cuaderno con vínculos embebidos hacia tareas y entradas. `shared/objectiveCoverage.ts` calcula lagunas sin inferir validación a partir del estado de una tarea. `service/domain.ts` genera los IDs de vínculos, valida fuentes y papeles, y deja pendiente una validación si cambia una fuente usada. `service/workspaces.ts` comprueba los vínculos al abrir o restaurar un vault. La pantalla Memoria y el editor muestran los mismos registros mediante `src/App.tsx`, `src/RecordEditor.tsx` y `src/ObjectiveLinks.tsx`; el contrato está en [Trazabilidad de objetivos](trazabilidad-objetivos.md).

Cada cuaderno tiene un directorio `workspaces/<id>/` y un `bitacora.vault` propio. `workspaces.json` contiene únicamente ID y título para ofrecer la selección antes de introducir la contraseña; el contenido y las credenciales permanecen cifrados. Solo hay un `Domain` desbloqueado a la vez. El servicio valida que el vault contenga exactamente el proyecto seleccionado y sus registros, y rechaza registros, restauraciones y permisos MCP de otro proyecto. El cambio de cuaderno exige bloquear el actual.

Dentro del vault, los registros `subproject` agrupan trabajo en un solo nivel y los demás registros indican su ámbito con `subprojectId` opcional. `shared/subprojects.ts` define las reglas de ámbito que comparten `Domain` (validación, archivo y permisos MCP), `Workspaces` (validación al abrir y restaurar) y la interfaz (`src/app/ProjectTree.tsx`, `src/app/SubprojectManager.tsx` y el filtrado de `src/App.tsx`). El contrato está en [Subproyectos](subproyectos.md).

Al eliminar un registro, sus propuestas pendientes se rechazan. Las propuestas ya resueltas se conservan como historial y pueden seguir apuntando al identificador eliminado; al abrir el cuaderno solo se exige que el destino de una propuesta pendiente siga existiendo. Las transacciones de un cuaderno activo comprueban las mismas condiciones antes de guardar y revierten la operación si el estado resultante no las cumple.

El vault contiene una tabla `app_state` con `schema_version` y el documento de estado. Al abrir por primera vez una instalación anterior, `Workspaces` verifica una copia cifrada previa (`bitacora.pre-migration.backup`), divide sus proyectos en vaults separados, conserva el vault antiguo para recuperación y crea el índice después de escribir los nuevos vaults. Los registros transversales forman un cuaderno «Trabajo transversal» si existen; las prácticas transversales se copian a cada cuaderno. El historial de un registro trasladado se divide por la propiedad de cada versión y se corta el enlace entre versiones de cuadernos distintos. Si una dependencia o vínculo activo une proyectos distintos, la migración se detiene y deja intacto el vault anterior para que se revise ese vínculo. Se revocan permisos y extractos MCP; las propuestas pendientes se deben volver a crear en el cuaderno correspondiente. Las versiones de registros se usan para detectar conflictos de edición.

## Puntos de cambio

El [mapa de cambios](mapa-cambios.md) indica las rutas de entrada y las comprobaciones cercanas para cada flujo.

- Al añadir campos o tipos de registro, revisa `shared/model.ts`, los esquemas de `service/records/schemas.ts`, `blank()` en `service/records/defaults.ts`, los valores iniciales de `src/defaults.ts`, los editores y las pruebas de dominio.
- Al cambiar una ruta HTTP, revisa `service/server.ts`, `src/api.ts`, las llamadas de interfaz y pruebas de servicio.
- Al cambiar el ciclo de vida de cuadernos, revisa `service/workspaces.ts`, la migración, el índice, la pantalla de inicio y las pruebas de aislamiento.
- Al cambiar MCP, revisa `service/mcp.ts`, autorización y visibilidad en `service/domain.ts` y `grantSees` en `shared/subprojects.ts`, la configuración expuesta en `src/Assistants.tsx` y pruebas de permisos.
- Al añadir un tipo de referencia entre registros, valida que no cruce ámbitos en `Domain.normalize` y en `invalidScopes` de `service/workspaces.ts`.
- Al cambiar empaquetado o ejecución de escritorio, revisa la configuración Tauri y los scripts de `scripts/`.
