<!-- doc:summary: Contrato del MVP para relacionar objetivos, trabajo, resultados, evidencias y validación dentro de un cuaderno. -->
# Trazabilidad de objetivos y evidencias

Este documento describe el primer corte disponible. `Project.objective` permanece como texto libre, `Task.solution` como resultado de una tarea y `Entry.evidence` como referencia libre; ninguno establece por sí solo que un objetivo concreto esté acreditado. La validación del tutor en `Project` sigue siendo independiente de la validación de cada objetivo.

## Contrato mínimo

| Concepto | Dato propuesto | Regla |
| --- | --- | --- |
| Objetivo | Registro `Objective` con `id`, `version`, `project`, `title`, `description` y `validation` | El servicio genera el ID y controla la versión. Pertenece a un único cuaderno. No se deduce automáticamente de `Project.objective`. |
| Trabajo | Vínculo `ObjectiveLink` de una `Task` o `Entry` al objetivo, con papel `trabajo` | La tarea puede estar abierta o completada; el estado no acredita resultado ni evidencia. |
| Resultado | Vínculo de una `Entry` con papel `resultado` | La entrada debe tener `result` no vacío. `Task.solution` se muestra como contexto del trabajo, pero no sustituye un resultado vinculado explícitamente. |
| Evidencia | Vínculo de una `Entry` con papel `evidencia` y `reference` no vacía | La referencia identifica dónde comprobar la evidencia. El vínculo no prueba por sí mismo que sea suficiente ni que el contenido exista fuera del vault. |
| Validación | `Objective.validation`: `{ state, date, reference, responsible, linkIds }`; `state` es `Pendiente` o `Validado` | Al validar, una persona registra fecha, referencia, responsable e IDs de los vínculos comprobados. Es una declaración humana, no una certificación de la aplicación. Ningún estado de tarea, texto o propuesta MCP la establece por inferencia. |

`ObjectiveLink` tiene `id` propio generado por el servicio, `objectiveId`, `sourceKind` (`task` o `entry`), `sourceId`, `role` (`trabajo`, `resultado` o `evidencia`) y `reference` solo para evidencia. Los vínculos se guardan dentro del registro `Objective`, de modo que comparten su versión e historial. La clave lógica `(objectiveId, sourceKind, sourceId, role)` es única. Una tarea solo admite `trabajo`; una entrada admite los tres papeles. Un mismo registro puede apoyar varios objetivos mediante vínculos distintos. No se aceptan vínculos a otros tipos de registro en este MVP.

Al editar una tarea o entrada guardada, la interfaz ofrece la selección de objetivos y papeles; el servicio escribe el cambio en el objetivo con comprobación de versión. El editor del objetivo ofrece la operación equivalente. La API devuelve los vínculos mediante el registro del objetivo y la interfaz los presenta desde ambos extremos; persiste una sola copia en `Objective`. El texto de `Entry.evidence` anterior queda intacto y no se convierte automáticamente en vínculo. Los adjuntos existentes de tareas no se interpretan como evidencia del objetivo.

## Cobertura y cambios de fuentes

Una consulta pura por objetivo reúne sus vínculos del cuaderno activo y devuelve los registros de apoyo y estas lagunas independientes: `sin trabajo`, `sin resultado`, `sin evidencia` y `pendiente de validación`. Un resultado cuenta solo si la entrada vinculada sigue existiendo y su `result` no está vacío. Una evidencia cuenta solo si la entrada existe y su vínculo conserva una referencia no vacía. La consulta no convierte cobertura completa en `Validado`. Muestra por separado el estado de validación humana; no calcula un porcentaje de logro ni considera `Completada` una prueba.

Validar exige al menos un vínculo vigente de cada papel, además de fecha, responsable y referencia de validación; el servicio comprueba todo de nuevo al guardar. `linkIds` identifica el conjunto concreto que la persona revisó. Si después se borra o cambia uno de esos vínculos, se elimina su fuente, se edita el `result` de una entrada usada o se cancela una tarea recurrente usada, la transacción devuelve el objetivo a `Pendiente`, conserva la validación previa en el historial y registra el motivo. Así una fuente ausente o modificada no deja una marca de validación vigente. Los cambios de texto de una tarea no invalidan una validación por sí solos, porque la tarea solo aporta trabajo. Eliminar un objetivo borra sus vínculos con él; eliminar una tarea o entrada retira sus vínculos de todos los objetivos afectados, actualiza sus versiones e historial e invalida las validaciones afectadas. Deshacer una edición vuelve a validar los IDs y el contenido de los vínculos antes de guardar.

## Persistencia, autorización y migración

`Objective` está en `shared/model.ts`, `service/records/schemas.ts` y en la creación, edición, borrado e historial de `service/domain.ts`. `ObjectiveLink` está embebido en el objetivo dentro del documento cifrado de `service/vault.ts`; no se guarda un índice sin cifrar. `service/workspaces.ts` comprueba que los vínculos pertenecen al cuaderno activo, también al restaurar una copia. El servicio rechaza IDs inexistentes, tipos o papeles incompatibles, duplicados y referencias entre cuadernos. El cliente solicita vínculos; el servicio asigna sus IDs y versiones, y comprueba las condiciones de validación.

El formato del documento sigue siendo compatible con `schema_version` 1: los vaults anteriores simplemente no tienen registros `Objective`. Se conservan `Project.objective`, `Entry.evidence`, registros, IDs, versiones e historial. En Memoria se mantiene visible el texto legado y se pueden crear objetivos estructurados manualmente. No se inventan relaciones, evidencias ni validaciones a partir de textos antiguos. La restauración comprueba el aislamiento del cuaderno antes de sustituir su estado y admite copias antiguas y nuevas del mismo cuaderno.

MCP puede buscar y leer metadatos, texto y relaciones de objetivos con un permiso vigente para el cuaderno activo; los filtros y las relaciones requieren `scope: projects`. `consultar_relaciones` muestra los vínculos autorizados sin referencias de otros vaults. Las propuestas MCP de creación o actualización de objetivos se rechazan; tampoco `canCompleteTasks` permite validarlos. Las referencias de evidencia no se envían en búsquedas ni resúmenes, pero sí pueden aparecer en una lectura selectiva autorizada. Los adjuntos y contenidos de otros cuadernos permanecen fuera del contexto.

## Vista mínima

En **Memoria**, cada objetivo estructurado muestra título, estado de validación y las lagunas vigentes. La lista de apoyo identifica el papel, fecha, título y referencia cuando procede, y abre el registro original. Un objetivo sin registros muestra las lagunas correspondientes, sin mensaje de éxito por completar tareas. El texto legado de `Project.objective` sigue visible. La exportación de memoria cita IDs y referencias de los registros vinculados y distingue evidencia referenciada de validación humana.

## Rutas y comprobaciones

- **Dominio y servicio:** `shared/objectiveCoverage.ts`, `service/domain.ts`, `service/workspaces.ts`, `service/server.ts`; pruebas en `tests/objectives.test.ts` y `tests/objectives.service.test.ts`.
- **Interfaz:** `src/RecordEditor.tsx`, `src/ObjectiveLinks.tsx` y la vista Memoria en `src/App.tsx`; recorrido en `tests/app.e2e.ts`.
- **Verificación:** `pnpm test`, `pnpm run build` y `pnpm run test:e2e` comprueban respectivamente reglas, compilación y recorrido visible.
