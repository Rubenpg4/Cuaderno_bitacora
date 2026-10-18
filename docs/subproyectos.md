<!-- doc:summary: Diseño de subproyectos dentro de un cuaderno: modelo, gestión, navegación y límites de acceso. -->
# Subproyectos (diseño)

Este documento define una funcionalidad pendiente de implementación. Hoy cada cuaderno contiene un solo registro `project`, un vault y una contraseña; todos sus demás registros tienen `project` igual al ID de ese proyecto. La pantalla lateral abre la ficha del proyecto, pero no ofrece subproyectos. `service/workspaces.ts` comprueba esa estructura al abrir y restaurar un vault. El perfil MCP `personal` o `corporativo` pertenece al cuaderno, y el MCP corporativo está bloqueado según [Perfiles MCP](perfiles-mcp.md).

## Modelo y límites

- Un subproyecto es una unidad de organización **dentro** del proyecto raíz y de su vault. No es otro cuaderno ni tiene contraseña, perfil MCP o configuración de empresa propios. En la primera versión solo hay un nivel: `proyecto raíz → subproyecto`; se rechaza un subproyecto como padre de otro.
- Se añade el tipo de registro `subproject` con ID y versión propios, `project` igual al ID del proyecto raíz, `title`, descripción breve y estado `Activo` o `Archivado`. No se duplica el ID del padre en otro campo. El servicio impide cambiar `project` después de crear el subproyecto.
- Los registros de trabajo conservan `project = ID raíz` y reciben `subprojectId?: string`. Vacío significa «General del proyecto»; un ID indica pertenencia exclusiva a un subproyecto activo del mismo vault. El servicio valida ambos IDs, el tipo del destino y su estado. Los proyectos raíz y los subproyectos no reciben `subprojectId`.
- Los vaults existentes se interpretan con `subprojectId` vacío. Una migración de esquema, al abrir el vault, normaliza registros, borradores, propuestas e historial antiguos sin cambiar su pertenencia al proyecto raíz. Las copias cifradas restauradas pasan por la misma validación. `workspaces.json` sigue conteniendo solo ID y título del cuaderno; no enumera subproyectos antes del desbloqueo.
- El vault del proyecto raíz es la frontera de cifrado. Los subproyectos del mismo vault comparten clave y pueden aparecer juntos en una vista agregada de la persona que desbloqueó el cuaderno. La separación entre subproyectos es lógica y se impone en las consultas, referencias y permisos MCP del servicio; no se presenta como cifrado independiente ni como control entre personas que comparten la contraseña del cuaderno. Si se necesita ese aislamiento, se usan cuadernos distintos.

## Gestión y ciclo de vida

| Operación | Comportamiento previsto |
| --- | --- |
| Crear | Desde el proyecto desbloqueado, con título no vacío y único entre sus subproyectos activos y archivados. El servicio asigna ID, padre y versión; el cliente no puede imponerlos. |
| Editar | Cambia título o descripción con la versión vigente. El cambio se refleja en rutas y etiquetas sin modificar IDs ni registros asociados. |
| Archivar | Conserva registros, historial y vínculos. El subproyecto queda visible bajo «Archivados» y se puede consultar, pero no crear ni editar registros en él ni dirigirle propuestas nuevas. Las propuestas pendientes de ese ámbito se rechazan y sus permisos MCP se revocan. |
| Restaurar | Reactiva un subproyecto archivado con comprobación de versión y política actual; no restablece permisos ni propuestas antiguos. |
| Eliminar | Solo si no contiene registros, borradores, vínculos, propuestas pendientes ni extractos. Exige confirmación explícita y versión vigente. Si tiene contenido, la interfaz ofrece archivar; no reasigna registros silenciosamente. |
| Trasladar | No se permite cambiar el padre ni mover registros entre «General» y subproyectos en la primera versión. Un traslado posterior requerirá una operación transaccional que revalide referencias, permisos, borradores, historial y propuestas. |

La eliminación del cuaderno raíz conserva su flujo actual de contraseña y confirmación, y elimina todo su vault, incluidos los subproyectos. El subproyecto no puede eliminar el proyecto raíz. Las operaciones de gestión se ejecutan en `service/domain.ts` dentro de una transacción, con versión esperada, historial y errores por conflicto; `service/server.ts` solo transporta la petición autenticada. Los campos de control y pertenencia son reservados frente a propuestas MCP.

## Referencias y criterios

- Dependencias de tareas, menciones y vínculos de entradas, y fuentes de reuniones solo pueden apuntar a registros del mismo ámbito (`project` y `subprojectId`). La vista agregada no relaja esta regla. Las consultas de relaciones omiten destinos no autorizados, incluidos sus títulos y recuentos.
- Una práctica en «General» del proyecto se aplica a las tareas generales y de sus subproyectos, según fase y estado. Una práctica de subproyecto solo se aplica a tareas de ese mismo subproyecto. La comprobación de aplicabilidad y las verificaciones `checks` se recalculan en el servicio; una práctica hija nunca se convierte en política del proyecto raíz por aparecer en una vista agregada.
- Borradores, adjuntos, versiones históricas, propuestas y extractos conservan el mismo ámbito que su registro. Las rutas de creación diaria y los filtros de «Hoy», «Tablero», «Lista», «Diario», reuniones y prácticas deben incluirlo; no basta con filtrar las tarjetas visibles al final. Se revisan también recuentos, búsquedas, informes y exportaciones para que respeten el ámbito seleccionado.

## Navegación e interacción

La pantalla de inicio sigue mostrando **cuadernos/proyectos raíz** y exige desbloquear uno antes de ver sus subproyectos. En la barra lateral del cuaderno abierto aparece el proyecto raíz como cabecera y debajo «General» y los subproyectos, con sangría, estado y contador de tareas. La cabecera ofrece «Todo el proyecto» como vista agregada; cada hijo abre sus propias vistas. «Archivados» aparece plegado y su contenido es de solo lectura. La selección del ámbito se mantiene al cambiar entre Hoy, Tablero, Lista y las demás vistas; al bloquear o cambiar de cuaderno se descarta.

La cabecera de página y el editor muestran la ruta `Proyecto / Subproyecto` o `Proyecto / General`; los resultados de búsqueda y las tarjetas de la vista agregada muestran esa misma procedencia. «Nuevo registro» usa el ámbito seleccionado y permite elegir destino antes de guardar cuando se está en «Todo el proyecto». El editor muestra el destino como contexto; no se cambia con un desplegable de edición ordinaria. En pantallas estrechas, el árbol se conserva dentro del menú lateral y la ruta se puede abreviar visualmente sin ocultar el nombre completo a tecnologías de asistencia. La ficha del proyecto raíz sigue siendo distinta de la gestión de subproyectos.

Flujos que debe poder seguir una persona:

1. Desbloquear un cuaderno, abrir la ficha raíz, crear un subproyecto y entrar en él desde la barra lateral.
2. Crear una tarea en el subproyecto y verla en sus vistas y en «Todo el proyecto», identificada con la ruta padre/hijo; no verla al seleccionar otro subproyecto o «General».
3. Archivar el subproyecto, consultar su contenido histórico, recibir una explicación al intentar escribir y restaurarlo sin recuperar sesiones MCP antiguas.
4. Intentar eliminar un subproyecto con contenido y recibir la opción de archivarlo; eliminar uno vacío tras confirmación.

## Acceso local, MCP y perfil corporativo

Quien desbloquea el cuaderno puede administrar todo su contenido; no existe hoy un modelo de usuarios o roles por persona. Las API locales comprueban sesión, vault activo, ID raíz y ámbito de cada operación. Nunca aceptan un `subprojectId` del cliente sin validarlo contra el vault abierto. Una consulta a un ID ajeno o a una referencia fuera de ámbito devuelve un error sin revelar su título.

Las sesiones MCP nuevas tendrán una selección explícita de ámbitos autorizados: «General» y/o IDs concretos de subproyectos activos del cuaderno abierto. Una sesión limitada a un hijo puede leer y proponer sobre sus registros y las prácticas generales aplicables, pero no sobre otros hijos, registros generales no compartidos ni la ficha raíz completa. La vista «Todo el proyecto» de la interfaz no amplía una sesión MCP. Búsqueda, filtros, resúmenes, `leer_elementos`, relaciones, criterios y propuestas usan el mismo predicado de visibilidad antes de devolver metadatos, texto o recuentos. El servidor deriva el ámbito de un registro existente; las propuestas de creación indican un destino permitido, y las de actualización no pueden cambiarlo. Las propuestas de creación o gestión de subproyectos por MCP no forman parte de esta primera versión.

La migración a esos permisos revoca las sesiones y extractos MCP existentes para evitar que un permiso emitido cuando solo había un ámbito adquiera acceso implícito a nuevos hijos. Crear, archivar o eliminar un subproyecto invalida o reevalúa los permisos afectados; cada llamada comprueba vigencia, versión de política, cuaderno activo y selección de ámbitos. Bloquear o cambiar de cuaderno sigue revocando todo. Las propuestas pendientes de un ámbito archivado o no autorizado no se aplican aunque se hayan creado antes del cambio.

Un subproyecto de un cuaderno `corporativo` hereda ese perfil sin posibilidad de rebajarlo a `personal`. La verificación corporativa de Claude Code se aplica también a todos sus subproyectos. Ni seleccionar un hijo ni confirmar una autorización local demuestran la identidad de la cuenta de Claude; todo permiso corporativo debe superar la verificación descrita en [Perfiles MCP](perfiles-mcp.md). Como controles adicionales, el diseño exige revocar accesos al archivar, registrar en el historial cifrado cambios de ámbito y gestión, y probar que consultas y propuestas no cruzan hijos. Una política empresarial administrada podría restringir exportación o retención en una fase posterior, pero Bitácora no ofrece hoy una identidad corporativa verificable ni una administración remota que permita imponerla; no se anuncia ese control como disponible.

## Contratos de implementación y verificación

La implementación afecta a `shared/model.ts`, `service/records/schemas.ts`, valores iniciales, `service/domain.ts`, `service/workspaces.ts`, `service/vault.ts`, `service/server.ts`, `service/mcp.ts`, `src/api.ts`, `src/App.tsx`, editores y vistas. El servicio es la autoridad para parentela, ámbitos, permisos, versiones y estado archivado. El cliente recibe el árbol y el ámbito efectivo para presentar navegación y acciones, pero no determina acceso por filtrar la interfaz.

Antes de darla por terminada, las pruebas deben cubrir: migración y restauración de vaults anteriores; un solo padre y rechazo de IDs de otro vault; escritura y referencias entre ámbitos; criterios heredados y propios; archivo, restauración y borrado; búsqueda, recuentos, propuestas y permisos MCP limitados; revocación tras cambios y bloqueo; perfil corporativo bloqueado; y los cuatro recorridos de interfaz anteriores en pantalla amplia y estrecha. Ejecutar `pnpm test`, `pnpm run test:e2e` y `pnpm run build` al implementar. Este documento define el contrato, pero no afirma que esos recorridos ya funcionen.
