<!-- doc:summary: Subproyectos dentro de un cuaderno: modelo, gestión, navegación, permisos MCP, migración y verificación. -->

# Subproyectos

Cada cuaderno contiene un único registro `project` (el proyecto raíz), un vault y una contraseña. Dentro de él, los registros `subproject` organizan el trabajo en un solo nivel: `proyecto raíz → subproyecto`. Un subproyecto no es otro cuaderno: no tiene contraseña, perfil MCP ni configuración de empresa propios. `workspaces.json` sigue conteniendo solo ID y título del cuaderno y no enumera subproyectos antes del desbloqueo.

## Modelo y límites

- `shared/model.ts` define `Subproject` (`kind: 'subproject'`, `title`, `description`, `status: 'Activo' | 'Archivado'`, `archivedAt`) con `project` igual al ID raíz. No admite `subprojectId`, por lo que no hay subproyectos anidados.
- Los registros de trabajo (tareas, entradas, incidencias, ideas, prácticas, decisiones, reuniones, objetivos y series) conservan `project = ID raíz` y pueden llevar `subprojectId`. Sin valor significan «General del proyecto». Los proyectos raíz y los subproyectos no lo aceptan (`service/records/schemas.ts`).
- `shared/subprojects.ts` reúne las reglas compartidas por servicio, MCP e interfaz: ámbito de un registro (`scopeOf`, `sameScope`), selección de la interfaz (`inSelection`), referencias admisibles (`referenceableFrom`), alcance de prácticas (`practiceReaches`), ruta legible (`scopePath`) y visibilidad MCP (`grantSees`).
- El vault del proyecto raíz es la frontera de cifrado. Los subproyectos comparten clave y la persona que desbloquea ve todo en «Todo el proyecto». La separación es lógica y la imponen el servicio y los permisos MCP; no es cifrado independiente ni control entre personas que comparten la contraseña. Para ese aislamiento se usan cuadernos distintos.

## Gestión y ciclo de vida

Las operaciones están en `service/domain.ts` (`saveSubproject`, `setSubprojectStatus`, `deleteSubproject`), dentro de una transacción con versión esperada, historial y error por conflicto. `service/server.ts` solo las transporta (`/api/subproject-save`, `/api/subproject-status`, `/api/subproject-delete`). La ruta genérica `/api/save` rechaza `kind: 'subproject'` y deshacer no se aplica a subproyectos.

| Operación | Comportamiento                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crear     | Título no vacío y único (sin distinguir mayúsculas) entre activos y archivados. El servicio asigna ID, padre, estado y versión; el cliente solo envía título y descripción.                                                                                                                                                                                                                                                      |
| Editar    | Cambia título o descripción con la versión vigente; no modifica IDs ni registros asociados. Un subproyecto archivado se restaura antes de editarlo.                                                                                                                                                                                                                                                                              |
| Archivar  | Rechaza antes sus propuestas pendientes (las de cierre devuelven la tarea a su estado anterior) y las verificaciones ASVS pendientes de sus tareas, quita el ámbito de las sesiones MCP y revoca las que quedan sin ámbitos. Después su contenido es de solo lectura: el servicio rechaza crear, editar, borrar, revisar criterios o detener series en él, y no genera nuevas apariciones recurrentes ni inicia tareas vencidas. |
| Restaurar | Reactiva el subproyecto con comprobación de versión. No restablece sesiones ni propuestas anteriores.                                                                                                                                                                                                                                                                                                                            |
| Eliminar  | Solo si no tiene registros, series, borradores, propuestas pendientes de creación ni extractos. Exige confirmación (`confirm: 'ELIMINAR'`) y versión vigente; con contenido, la interfaz ofrece archivar.                                                                                                                                                                                                                        |
| Trasladar | No existe. Al actualizar se conserva el `subprojectId` guardado; enviar otro valor produce un error.                                                                                                                                                                                                                                                                                                                             |

La eliminación del cuaderno raíz conserva su flujo de contraseña y confirmación y borra todo su vault, subproyectos incluidos.

## Referencias y criterios

- Dependencias de tareas, tareas y registros vinculados de entradas, fuentes de reuniones, tareas de seguimiento de acuerdos y vínculos de objetivos solo apuntan a registros del mismo ámbito. `Domain.normalize` lo valida al guardar y `Workspaces.validateState` al abrir, restaurar y en cada transacción. La vista agregada no relaja esta regla: el editor filtra sus selectores por el destino del registro y, al cambiar el destino de un registro nuevo, vacía las referencias anteriores.
- Una práctica de «General» se aplica a las tareas generales y a las de todos los subproyectos según fase, etiquetas y estado. Una práctica de subproyecto solo se aplica a tareas de ese subproyecto (`applicable` en `shared/model.ts`). El servicio rechaza asociar manualmente una práctica de otro ámbito.
- Las entradas diarias se guardan por ámbito (`daily:<fecha>:<cuaderno>[:<subproyecto>]`); en «Todo el proyecto» se guardan en «General». Las series recurrentes heredan el ámbito y sus apariciones lo conservan. La tarea de seguimiento de un acuerdo hereda el ámbito de la reunión.

## Navegación e interacción

La pantalla de inicio sigue mostrando solo cuadernos. Tras desbloquear, `src/app/ProjectTree.tsx` muestra en la barra lateral el proyecto raíz como cabecera («Todo el proyecto»), «General» y los subproyectos activos con su número de tareas abiertas, y «Archivados» plegado. La selección (`scope` en `src/App.tsx`) se mantiene al cambiar entre Hoy, Tablero, Lista y las demás vistas y se descarta al bloquear, por inactividad o al cambiar de cuaderno.

- `App` construye una copia del snapshot con `inSelection` antes de calcular Hoy, Tablero, Lista, Diario, Martes, Memoria, prácticas, revisión semanal, recuentos y búsqueda. En un subproyecto se incluyen también las prácticas generales que lo alcanzan. Iniciar o detener tareas desde Hoy solo afecta a tareas del ámbito seleccionado y no archivado.
- La barra superior muestra `Proyecto / Subproyecto`, `Proyecto / General` o «Todo el proyecto»; en pantalla estrecha se abrevia con puntos suspensivos y conserva el texto completo en el DOM y en `title`. Con subproyectos, las tarjetas y filas indican su procedencia `Proyecto / Ámbito`.
- «Nuevo registro» usa el ámbito seleccionado. En «Todo el proyecto», el editor pide el destino antes de guardar; en los demás casos muestra el ámbito como contexto, sin desplegable de edición. El informe del martes generado en «Todo el proyecto» parte de «General».
- Un subproyecto archivado muestra un aviso de solo lectura en sus vistas y en el editor; los intentos de escritura devuelven la explicación del servicio.
- `src/app/SubprojectManager.tsx` gestiona crear, editar, archivar, restaurar y eliminar. Se abre desde la barra lateral y desde la ficha del proyecto raíz, que sigue siendo distinta de la gestión.

## Acceso local, MCP y perfil corporativo

Quien desbloquea el cuaderno administra todo su contenido; no hay usuarios ni roles por persona. Las API locales nunca aceptan un `subprojectId` sin validarlo contra el vault abierto, y una referencia ajena responde con un error sin revelar su título.

- Las sesiones MCP llevan `scopes`: «general» y/o IDs de subproyectos activos, elegidos en `src/Assistants.tsx`. Al abrir Asistentes aparecen marcados «General» y, si hay uno seleccionado en la barra lateral, el subproyecto activo en curso. Si el cliente ya tiene una sesión, el formulario muestra sus ámbitos actuales. Si la API no recibe ámbitos, la sesión queda limitada a «General». Crear un subproyecto nuevo no lo añade a sesiones existentes; para incluirlo, márcalo y renueva la sesión desde el botón principal o desde «Renovar sesión», que sustituyen los ámbitos de la sesión por los marcados.
- `grantSees` es el predicado único de visibilidad: el proyecto raíz exige «General»; un subproyecto, su propio ámbito; las prácticas generales son visibles para cualquier sesión del cuaderno. `Domain.grantRecords` lo aplica antes de `buscar_contexto`, `leer_elementos`, `filtrar_registros`, `resumir_proyecto`, `diagnosticar_tareas`, `consultar_relaciones`, `consultar_criterios`, `consultar_propuestas` y `completar_tarea`, incluidos metadatos y recuentos.
- `proponer_eliminacion` exige que el registro pertenezca a un ámbito autorizado de la sesión; las prácticas generales solo pueden proponerse para eliminar desde una sesión con «General».
- `proponer_cambios` exige que una creación indique un destino autorizado (`patch.subprojectId`, vacío para «General»); en actualizaciones y verificaciones `subprojectId` es un campo reservado. Las propuestas de creación o gestión de subproyectos no existen por MCP.
- ASVS del proyecto (consultas, referencias, evaluaciones, remediación y revisiones de fuentes) requiere el ámbito «General»; las verificaciones ASVS de tarea requieren el ámbito de la tarea. Las tareas relacionadas de otros ámbitos se omiten.
- Cada llamada vuelve a comprobar vigencia, perfil, cuaderno activo y ámbitos activos. Bloquear o cambiar de cuaderno revoca todas las sesiones.

Un subproyecto de un cuaderno `corporativo` hereda ese perfil sin posibilidad de rebajarlo a `personal`. La verificación corporativa de Claude Code se aplica también a sus subproyectos: una sesión corporativa con ámbitos sigue exigiendo la organización verificada descrita en [Perfiles MCP](perfiles-mcp.md). Seleccionar un subproyecto no demuestra la identidad de la cuenta de Claude. Los controles adicionales implementados son la revocación al archivar, el historial cifrado de gestión de subproyectos y las pruebas de que consultas y propuestas no cruzan ámbitos. Bitácora no ofrece políticas empresariales remotas de exportación o retención.

## Migración y copias

`migrateSubprojects` (`service/vault.ts`) se ejecuta al abrir y al restaurar una copia sin `subprojectModel: 1`: elimina valores de ámbito vacíos en registros, historial, borradores, propuestas y series, deja todo en «General» sin cambiar su proyecto raíz y revoca los extractos MCP guardados (`shares`) para que ningún permiso anterior adquiera acceso implícito. Los vaults nuevos se crean ya marcados. Las copias restauradas pasan por la misma validación de ámbitos que la apertura.

## Verificación

- `tests/subprojects.test.ts`: modelo y gestión, traslados prohibidos, referencias entre ámbitos, criterios generales y propios, archivo con rechazo de propuestas y revocación, eliminación, persistencia, migración, copias, permisos MCP limitados, propuestas fuera de ámbito y bloqueo corporativo.
- `tests/subprojects.service.test.ts`: rutas HTTP de gestión y transporte MCP con ámbitos.
- `tests/subprojects.e2e.ts`: los cuatro recorridos (crear y entrar, tareas por ámbito, archivar y restaurar, eliminar) en pantalla amplia y estrecha, y el descarte de la selección al bloquear.

La verificación ASVS sigue siendo del proyecto completo: su vista y su informe no se filtran por subproyecto.
