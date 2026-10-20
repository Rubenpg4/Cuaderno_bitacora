<!-- doc:summary: Alcance de la IA por MCP, flujo de revisión y estrategia para reducir contexto enviado. -->

# Acceso de IA mediante MCP

Cada cuaderno permite elegir un perfil MCP [personal o corporativo](perfiles-mcp.md) al crearlo y
cambiarlo en «Ajustes y copias». El personal conserva Claude, Codex y Antigravity. El corporativo
admite solo Claude Code tras comprobar en el equipo que su sesión pertenece a una organización
Team o Enterprise de la política local (`corporate-policy.json`); es una verificación de buena fe,
no una prueba firmada. Cambiar de perfil revoca permisos, extractos y propuestas pendientes.

## Dónde interviene

El usuario confirma la autorización de empresa en `src/Assistants.tsx`. Para Claude, Codex o Antigravity puede abrir una sesión del cuaderno activo con duración configurable (entre 15 minutos y 8 horas; por defecto, una hora) y renovar su vigencia. Cada cliente tiene como máximo una sesión: si ya existe una vigente, el botón pasa a «Renovar sesión para este cuaderno» y `Domain.grant` reutiliza esa sesión (mismo ID, token nuevo en el archivo del conector) con la duración, los ámbitos y el permiso de cierre marcados. «Renovar sesión» en la lista de sesiones activas también sustituye los ámbitos por los marcados en el formulario, que al elegir un cliente con sesión se rellena con sus ámbitos y permiso actuales. El servicio impide conceder o ampliar acceso a otro proyecto. La configuración generada inicia `service/mcp.ts`; el conector habla con `/mcp` en el servicio local. `service/domain.ts` comprueba el proveedor, el cuaderno activo y la vigencia en cada llamada. Al bloquear Bitácora se revocan las sesiones y se retiran los permisos locales.

Este documento describe la arquitectura y la seguridad del acceso MCP. El contrato operativo para los asistentes es la guía canónica (`shared/mcpGuide.ts`, servida por `consultar_guia` y `bitacora://guia`). La skill portátil (`.agents/skills/bitacora-mcp/SKILL.md`) resume el flujo de trabajo. Cuando cambie un contrato, actualiza los tres documentos.

### Herramientas

Cada herramienta publica `title` y anotaciones. Las de propuesta llevan `idempotentHint`: reenviar una propuesta pendiente idéntica devuelve la existente. Las herramientas ASVS solo aparecen con ASVS activo.

| Herramienta | Alcance y respuesta |
| --- | --- |
| `estado_sesion` | Confirma conexión, proveedor, caducidad (`expiresAt`, `expiresInMinutes`), bloqueo previsto por inactividad (`idleLockAt`, `idleLockInMinutes`), proyectos y ámbitos autorizados. No lee contenido. |
| `buscar_contexto` | Busca en títulos y contenido autorizado. Devuelve solo ID, tipo, versión y título; hasta diez por página (cinco por defecto). |
| `leer_elementos` | Lee hasta diez registros por ID. Un registro que cabe entero llega como objeto en `fields`; uno que no cabe, como texto en `excerpt` con `nextExcerptOffset`, que se continúa con su único ID y `excerptOffset`. `nextOffset` pagina otros registros. Rechaza parámetros desconocidos. |
| `consultar_criterios` | Prácticas autorizadas asociadas a una tarea, cinco por página. |
| `filtrar_registros` | Metadatos por proyecto, ámbito (`subprojectId` o `general`), tipo y fecha; en tareas, también estado y prioridad. Diez por página. |
| `resumir_proyecto` | Recuentos por tipo y estado y tareas vencidas, sin textos. |
| `diagnosticar_tareas` | Cinco señales de calidad en tareas abiertas, con recuentos y una página de ID, título, versión, categoría y motivo. |
| `consultar_relaciones` | Registros vinculados en ambos sentidos, solo si ambos son visibles, con `direction` y `relation`: `dependency`, `criterion`, `link` (vínculo de una entrada), `source` (fuente de reunión) u `objective` (con `role`). Diez por página. |
| `proponer_cambios` | Propuesta de creación, actualización o verificación (`check`); no cambia nada hasta que se acepta. |
| `proponer_eliminacion` | Propuesta de borrado con `kind`, `targetId`, `expectedVersion` y `rationale`. |
| `consultar_propuestas` | Propuestas propias, de la más reciente a la más antigua, con `status`, `kind`, `operation`, `targetId` y `title`. Filtra por `status` o `targetId`; hasta veinte por página con `offset`/`nextOffset`. |
| `completar_tarea` | Con permiso de cierre, acepta en una transacción las verificaciones y el cierre propios de una tarea. |
| `consultar_guia` | Guía canónica; no requiere sesión. |
| `consultar_asvs`, `leer_referencias_asvs`, `consultar_criterios_asvs`, `planificar_remediacion_asvs` | Consultas ASVS (véase más abajo). |
| `proponer_evaluacion_asvs`, `proponer_verificacion_asvs`, `proponer_revision_asvs` | Propuestas ASVS pendientes de revisión humana. |

Las definiciones publicadas ocupan unos 16.300 caracteres con ASVS activo y unos 8.300 sin él. `tests/mcpConnector.test.ts` fija un máximo de 16.500 caracteres. Unos 1.600 los añade el SDK (`$schema` y `execution` en cada herramienta) y no dependen de Bitácora.

### Prompts

| Prompt | Uso |
| --- | --- |
| `guia_uso` | Primeros pasos: comprobar la sesión y consultar la guía. |
| `preparar_martes` | Pide buscar y leer las fuentes necesarias y proponer un informe de reunión que cite cada fuente con `@[tipo:id]` en el texto. |
| `sincronizar_especificaciones` | Pide revisar el repositorio sin datos sensibles y proponer actualizar las especificaciones del proyecto. |

Los prompts son plantillas de petición y no se ejecutan por sí solos.

Cada sesión de proyectos lleva una selección explícita de ámbitos: «General» y/o subproyectos activos del cuaderno abierto. `Domain.grantRecords` aplica ese filtro antes de todas las consultas anteriores, incluidos recuentos, relaciones y estados de propuestas; las prácticas generales son visibles para cualquier ámbito. Las creaciones propuestas deben indicar un destino autorizado con `patch.subprojectId`; un valor vacío o `general` equivale a «General». Las actualizaciones no pueden cambiar el ámbito. ASVS del proyecto requiere el ámbito «General». Véase [Subproyectos](subproyectos.md).

El transporte `/mcp` responde con 401 para sesiones ausentes o caducadas, 405 para métodos distintos de POST, 409 si el conector declara otra versión de protocolo y 400 para entradas o reglas de dominio inválidas. En `/mcp`, un error de validación nombra hasta cinco campos con su motivo («Revisa los campos: recordIds: …»); la interfaz conserva su mensaje resumido. El 401 indica la causa y el paso siguiente: cuaderno bloqueado, sesión caducada, acceso de asistentes desactivado, perfil MCP cambiado u organización de Claude distinta. Esos detalles solo se dan a un token que coincide con una sesión; cualquier otro recibe «Sesión revocada o no reconocida». `Domain.authorize` rechaza todos esos casos antes de leer datos. Los errores de análisis JSON y del sistema se presentan sin fragmentos de la petición ni rutas locales.

`diagnosticar_tareas` evalúa solo los cuadernos incluidos en la sesión vigente. Sus categorías son `sin_siguiente_paso` (campo vacío), `dependencia_pendiente` (alguna tarea previa sin completar), `vencimiento` (fecha superada o en los próximos siete días, contando hoy), `criterio_obligatorio_pendiente` (criterio obligatorio vigente sin resolver, desactualizado o aplicable aún sin asociar) y `cierre_pendiente` (propuesta de cierre pendiente). Excluye tareas completadas, ocurrencias canceladas y, como la revisión semanal, muestra únicamente la siguiente ocurrencia abierta de cada serie. Una tarea puede aparecer en varias categorías. Los recuentos cubren todas las categorías del alcance autorizado; `category` filtra la página de resultados, que usa `nextOffset` para continuar. El motivo no incorpora texto libre, notas ni datos de propuestas; el ID permite consultar el detalle autorizado con `leer_elementos`. El cálculo de vencimientos y dependencias comparte reglas con la revisión semanal.

Las tareas de Hoy y Tablero, así como las incidencias, ideas, decisiones y proyectos en sus vistas y listas, ofrecen **Copiar ID**. También aparece al abrir el registro y en los detalles del día. El ID puede pegarse a un asistente: `leer_elementos` verifica si ese registro está autorizado y devuelve su versión actual. El ID por sí solo no concede acceso.

En Bitácora, las tareas asocian criterios de calidad (`checks`) a partir de las prácticas autorizadas; el dominio impide completar una tarea si contiene requisitos obligatorios pendientes sin resolver. Al trabajar en una tarea existente, el asistente consulta sus criterios antes y después del trabajo con `consultar_criterios` y formula para cada criterio vigente asociado que pueda evaluar, incluso si se asoció manualmente, una propuesta de verificación con `operation: 'check'` (`patch: { practiceId, state: 'Cumplido', note }`), documentando en `note` las evidencias y justificación técnica del cumplimiento. «Cumplido» requiere evidencias concretas; si algún criterio genera dudas o requiere debate, puede proponerse como `Requiere consulta` con motivo o dejarse `Pendiente`. A continuación, el asistente propone la actualización con `targetId`, `expectedVersion`, `patch.state: 'Completada'` y un resumen de la ejecución en `patch.solution`, conservando el requisito original en `patch.description`. Puede ajustar `nextStep` o `blocked` según el resultado. En una sesión con permiso explícito de cierre autónomo, el asistente puede invocar `completar_tarea` con los IDs de sus propuestas de verificación y cierre; el servicio exige que todos los criterios asociados tengan evidencias y aplica el lote de forma atómica. Sin ese permiso, las propuestas siguen sujetas a revisión humana. Para un proyecto autorizado, el asistente puede proponer actualizar `patch.specifications` tras analizar el repositorio (sin incluir secretos, contraseñas ni variables de entorno privadas). Las propuestas aparecen en la revisión de la interfaz agrupadas por tipo de registro.

La IA puede proponer tareas, entradas, incidencias, ideas, prácticas, decisiones, reuniones y actualizaciones del proyecto activo (los proyectos solo admiten actualización por MCP, nunca creación ni borrado). Las creaciones deben indicar el proyecto activo y las actualizaciones se limitan a sus registros. Las actualizaciones exigen la versión vigente; las comprobaciones exigen además una tarea y una práctica asociada, vigente, aplicable y autorizada. «Cumplido» y «Requiere consulta» requieren una nota con evidencias o motivo. Campos de control, políticas, excepciones y validaciones del tutor quedan reservados a la revisión humana. El servicio valida las propuestas de nuevo al aceptarlas y detecta conflictos de versión.

Los objetivos estructurados se pueden buscar y leer dentro del cuaderno autorizado. Las relaciones muestran sus tareas y entradas vinculadas, así como la relación entrante al consultar una fuente. MCP no admite propuestas de creación o edición de objetivos ni validaciones de objetivos; `canCompleteTasks` sigue limitado a las tareas. Las referencias de evidencia aparecen solo en lecturas selectivas autorizadas, no en resultados de búsqueda o resúmenes. Consulta [Trazabilidad de objetivos](trazabilidad-objetivos.md).

### Propuestas de eliminación

`proponer_eliminacion` guarda una propuesta `operation: 'delete'` sin `patch`; el motivo de `rationale` es obligatorio y se muestra en la revisión. El registro debe ser visible en la sesión y pertenecer a uno de sus ámbitos: una sesión limitada a un subproyecto puede leer las prácticas generales, pero no proponer su eliminación. No se admiten proyectos, subproyectos, objetivos, prácticas obligatorias ni registros de subproyectos archivados. En una aparición de una serie recurrente, aceptar la propuesta cancela esa aparición en lugar de borrarla, con las mismas reglas que en el editor; una aparición completada o ya cancelada no admite la propuesta.

La revisión muestra la propuesta como «Eliminación» y avisa de que aceptarla borra el registro y su historial. Al aceptarla, el servicio aplica en la misma transacción el borrado de la interfaz: retira referencias, dependencias, criterios asociados y extractos, y rechaza las demás propuestas pendientes sobre ese registro. En un lote, las eliminaciones se aplican al final y se excluyen si otra propuesta del lote modifica o elimina el mismo registro. `canCompleteTasks` no acepta eliminaciones. `consultar_propuestas` sigue mostrando el estado de una eliminación aceptada a las sesiones con el ámbito que tenía el registro.

Si un proveedor reenvía una propuesta pendiente con la misma operación, tipo, destino y parche, el servicio devuelve la propuesta existente. Al aceptar varias propuestas sobre un registro, la revisión aplica primero las verificaciones y después el cierre de la tarea; encadena la versión tras cada cambio dentro de una sola transacción. Solo admite una versión anterior cuando el único cambio intermedio fue el paso automático a «En revisión» causado por el cierre incluido en el lote. Los cambios incompatibles sobre un mismo campo y las ediciones externas posteriores se señalan como conflictos. La interfaz excluye esas propuestas de la aceptación en lote y muestra el motivo; la revisión individual conserva la comprobación de versión y avisa cuando una verificación debe aceptarse junto con el cierre.

La revisión individual compara solo los campos que cambiarán; las creaciones muestran sus campos nuevos y las verificaciones indican el criterio, estado y nota. En los campos de texto libre de una actualización, la comparación se hace por palabras (`shared/textDiff.ts`, renderizada por `src/TextDiff.tsx`): el texto sin cambios conserva su color y solo lo eliminado (tachado, rojo) y lo añadido (subrayado, verde) se resaltan, con etiquetas ocultas para lectores de pantalla. Las creaciones, listas, fechas, enumerados y valores no textuales mantienen el valor anterior completo seguido del nuevo; también los textos casi reescritos (menos del 40 % sin cambios) o demasiado largos para compararlos con rapidez. Los adjuntos se resumen por nombre, tipo y tamaño, sin abrir su contenido ni mostrar Base64. Antes de aceptar, una vista previa con la misma presentación agrupa el resultado compatible por registro, muestra las transiciones de estado y explica qué propuestas quedan fuera por conflicto o versión obsoleta. Al confirmar, la interfaz vuelve a consultar el cuaderno y el servicio valida otra vez el lote dentro de una transacción; si el registro cambió, hay que revisar la vista previa actualizada.

Las propuestas pendientes de una misma tarea aparecen dentro de un bloque con el título de la tarea, el número de verificaciones y cierres, y «Aceptar lote de esta tarea». El botón acepta solo ese grupo en una transacción, sin incluir propuestas de otras tareas. Cuando hay verificaciones y un cierre pendientes del mismo proveedor, también se pueden aceptar juntos desde la propuesta individual si el lote es válido. La verificación vinculada al cierre no se presenta como un conflicto de versión independiente; si el grupo completo ya no es válido, su botón de aceptación permanece deshabilitado.

Las propuestas de creación de tareas, incidencias, ideas, decisiones y reuniones pueden incluir `patch.attachments`. Cada elemento indica `name`, `mime` y `data` en Base64; para Markdown puede indicar `text` UTF-8 en lugar de `data`. Se admiten PNG, JPEG, GIF, WebP, `.md` y PDF, hasta diez archivos, 2 MiB por archivo y 8 MiB en total. El servicio comprueba extensión, tipo, contenido y tamaño. La revisión muestra únicamente nombre, tipo y tamaño de los adjuntos; solo la aceptación los incorpora al registro. Las actualizaciones MCP no cambian adjuntos.

Los textos largos que llegan en propuestas se muestran compilados como Markdown en la aplicación. La guía canónica (`shared/mcpGuide.ts`) y la skill portátil piden redactarlos en Markdown limpio: apartados `##`/`###`, listas, casillas, código y tablas sencillas, sin HTML. La comparación de la revisión sigue trabajando sobre el texto Markdown sin compilar.

En las propuestas de entradas, los campos `activity`, `result`, `learning`, `blocker` y `nextStep` admiten menciones `@Título del registro` o `@[tipo:id]` a tareas, incidencias, decisiones e ideas autorizadas del mismo proyecto. Al proponer, el servicio convierte los nombres inequívocos a menciones con ID y conserva los vínculos autorizados para la revisión. Si varios registros comparten el mismo nombre, debe usarse `@[tipo:id]`. Al aceptar, el servicio añade esos IDs a `taskIds` o `linkedIds`; la IA no puede enviar esos campos reservados. Los vínculos aparecen en Diario y Detalles.

Las reuniones propuestas enlazan sus fuentes del mismo modo (decisión «Las reuniones propuestas por MCP enlazan sus fuentes con menciones»). En `body`, `@[tipo:id]` o un `@Título` inequívoco de una entrada, tarea, incidencia, decisión o idea se resuelve al proponer, solo entre los registros visibles en la sesión, del mismo proyecto y del ámbito de la reunión. Una mención canónica a un registro fuera de ese conjunto rechaza la propuesta. El texto guardado muestra `@Título` y los IDs quedan en `Proposal.meetingSourceIds`. La revisión enseña el cambio de «Fuentes de la reunión», y al aceptar se añaden a `sourceIds` tras comprobar que siguen en el proyecto. `sourceIds` sigue siendo reservado.

Las tareas usan seis prioridades ordenadas: **Crítica**, **Muy alta**, **Alta**, **Media**, **Baja** y **Muy baja**. Al proponer una tarea nueva, el asistente debe valorar el impacto, la urgencia y el alcance para elegir una prioridad defendible; no debe crear tareas sin una necesidad concreta ni asignar prioridad por inercia. Reserva Crítica para situaciones excepcionales con impacto inmediato y usa los niveles inferiores según disminuya la urgencia o el impacto. Asigna además la fase correspondiente del ciclo de vida (`Descubrimiento`, `Diseño`, `Implementación`, `Validación` o `Documentación`) y una fecha límite (`due`) razonable.

Al formular la creación de tareas por MCP, el asistente debe evitar descripciones escuetas o de una sola frase. El servicio exige que la propuesta indique explícitamente título, proyecto, fase, prioridad, fecha límite, descripción y siguiente paso; para ideas e incidencias exige título, proyecto, fecha y descripción. La guía del asistente añade un estándar de calidad: objetivo concreto, contexto y comportamiento esperado, y criterios de aceptación numerados y verificables. También exige consultar las prácticas vigentes del proyecto (`consultar_criterios` o filtrando prácticas) e indicar cuáles aplican y cómo, o justificar las que no apliquen. El servicio valida campos y permisos, pero no certifica por sí solo la calidad de la especificación.

### Consultas y propuestas ASVS

`planificar_remediacion_asvs({ projectId, category?, offset?, limit? })` resume la cobertura del nivel objetivo y pagina hasta diez lagunas con texto español (`es`), siguientes pasos, acción recomendada (`action` y `actionGuidance`), tareas relacionadas/similares y recuento de creaciones propias pendientes. No entrega notas privadas de evaluación ni crea trabajo. El asistente lee referencias/prácticas pertinentes y propone un conjunto acotado mediante `proponer_cambios`, justificando impacto, exposición, evidencia y dependencias de tareas aceptadas. La prioridad queda por determinar y el nivel mínimo ASVS no se interpreta como severidad.

`proponer_revision_asvs({ projectId, expectedConfigVersion, expectedVersion, reference, revision, reason })` propone un cambio de revisión de una fuente externa ya usada como evidencia. La versión del aviso es 0 inicialmente; `leer_referencias_asvs` y `consultar_criterios_asvs` devuelven las revisiones señaladas de sus fuentes. La propuesta permanece pendiente hasta confirmar/rechazar en Verificación ASVS. El permiso de cierre no la acepta. Las herramientas requieren proyecto autorizado y no vigilan código externo ni cambian catálogo/configuración. `consultar_propuestas` incluye estados propios de estos avisos; cambiar perfil rechaza los pendientes.

El ciclo de cada tarea incluye revisión ASVS proactiva cuando está activo. `leer_elementos`,
`consultar_criterios` y la respuesta de creación de una tarea incluyen contexto `asvs`: activación,
nivel objetivo y parámetros para consultar candidatos con `consultar_asvs`. En `leer_elementos` el
contexto aparece una vez por página, junto a `items`, si la página incluye tareas; `criteria.taskId`
nombra la tarea solo cuando hay una. No seleccionan enlaces
por el título ni sustituyen las asociaciones manuales. `consultar_criterios_asvs({ taskId, offset?,
limit? })` devuelve configuración, versión de tarea y asociaciones con sus verificaciones,
evidencias, vigencia y versión esperada (0 inicialmente); pagina hasta diez asociaciones.
Con alcance `selected` no se entrega contexto de proyecto ASVS. Con ASVS desactivado no se revisa
nada de ASVS: `estado_sesion` indica `asvs.enabled: false`, el conector retira las herramientas ASVS
de la lista y su sección de la guía, las respuestas omiten el contexto `asvs` y los `asvsLinks`, y el
servicio rechaza las acciones ASVS, `asvsIds` y `patch.asvsLinks`. Véase
[Verificación ASVS](verificacion-asvs.md).

Antes de planificar, el asistente consulta candidatos del nivel objetivo y referencias pertinentes,
justifica selección/omisión por impacto técnico y propone vínculos y criterios observables en la
especificación. Relaciona requisitos con implementación y prueba/revisión. Al terminar relee versión,
prácticas y ASVS, incluidas asociaciones manuales. La guía y la skill orientan esa selección
heurística; el servicio garantiza autoridad y condiciones de cierre, no que un cliente externo siga
las instrucciones. Una tarea de autenticación revisa controles pertinentes de autenticación; una
tarea sin impacto técnico puede justificar no añadir enlaces. Sin alcance suficiente se solicita
sesión de proyecto sin recurrir a archivos privados.

`proponer_verificacion_asvs` usa `projectId, taskId, reqId, expectedTaskVersion, expectedVersion,
expectedConfigVersion, state, applicability, scopeDetail, pendingScope, note, method, responsible,
evidence, rationale`. Su destino es la verificación de tarea, separado de la evaluación global.
No admite No aplicable, obligatoriedad ni excepciones. Cumplido y No cumplido requieren evidencia.
Las propuestas se reenvían de forma idempotente mientras permanezcan pendientes.

`completar_tarea` añade `asvsIds` opcional a `taskId, closureId, checkIds`. Solo acepta propuestas
propias de verificación de tarea y cierre con permiso explícito y todos los criterios asociados
activos acreditados, incluidos los informativos/manuales. No acepta evaluaciones globales ni
excepciones. Sin permiso, la persona revisa el grupo en Asistentes; POST `/api/review` admite
`{ ids, asvsIds, accept }`. La vista previa muestra tarea, estado final y evidencias ASVS y se
invalida si cambia su base. Configuración, versiones, autoría, referencias y huellas se revalidan
contra el contenido final; cualquier fallo revierte prácticas, ASVS, cierre e historial. Se conserva
`description` y se registra el resultado en `solution`. El cierre humano habitual exige los vínculos
que la persona marcó obligatorios; nunca exige todo el catálogo.

Con `scope: projects`, `consultar_asvs` lee configuración, recuentos y páginas de hasta diez metadatos, con filtros de nivel acumulativo, capítulo, sección, estado aceptado, aplicabilidad y vigencia. La cobertura y los capítulos solo llegan en la primera página (`offset: 0`); las siguientes conservan configuración y recuentos del filtro. `leer_referencias_asvs` lee hasta `limit` referencias por página (diez como máximo y siempre al menos una) dentro de un límite de 11.800 caracteres, con texto, versión, jerarquía, evaluación/evidencias aceptadas, propuestas propias pendientes y tareas relacionadas. Añade `es` (capítulo, sección y descripción traducidos con DeepL como ayuda; el inglés sigue siendo la autoridad y la base de las huellas) y `next`, una acción concreta (`plan-or-evaluate`, `plan-fix`, `continue-task`, `revalidate`, `consult`, `await-review`, `excluded`, `none` o `inactive`) con su explicación, para reducir llamadas exploratorias. Las referencias restantes continúan con `offset/nextOffset`; las relaciones de una referencia, con `taskOffset/nextTaskOffset` y `proposalOffset/nextProposalOffset`, que leen solo la referencia de `offset`. Las referencias sin versión usan exclusivamente la versión fijada por el cuaderno; referencias ambiguas, inexistentes o de otra versión exigen aclaración. El alcance de extractos seleccionados no permite acceder a este contexto global.

Para proponer trabajo ASVS, el asistente consulta requisito, configuración, prácticas vigentes y tareas similares. `patch.asvsLinks` en una tarea admite `{ catalogVersion, reqId, reason, scope, criterion, method }` sin obligatoriedad ni evaluación implícita. La vista previa muestra requisito, motivo y posibles tareas relacionadas; solo la aceptación crea tarea y asociaciones en una transacción.

`proponer_evaluacion_asvs` usa versiones esperadas de evaluación/configuración/tarea, referencia fijada, alcance, nota o hallazgo, método, responsable y evidencias `{ reference, revision, recordId? }`. Cumplido y No cumplido requieren evidencia; las dudas se expresan como Requiere consulta. No aplicable solo solicita una decisión humana: no admite `decision` del asistente y necesita aprobación explícita y referencia de decisión en la interfaz. Las propuestas quedan en `Snapshot.asvs.proposals`; el estado aceptado permanece separado hasta la revisión. La aceptación humana revalida versiones y huellas y permite lotes atómicos de evaluaciones distintas. MCP no puede activar ASVS, cambiar configuración ni aceptar estas propuestas; `canCompleteTasks` tampoco concede ese permiso. `consultar_propuestas` muestra los estados propios ASVS. Consulta [Verificación ASVS](verificacion-asvs.md) para los contratos de persistencia y vigencia.

### Tareas de programación guiadas por especificaciones

Una tarea de programación recibida por ID comienza con `leer_elementos` y `consultar_criterios`. Con acceso autorizado al repositorio, el agente localiza el flujo y los contratos afectados en `shared/`, `service/`, `src/` o `src-tauri/` antes de diseñar el cambio. La lectura del repositorio no amplía el permiso MCP ni autoriza leer el vault. La especificación describe el resultado nuevo y la compatibilidad que se preserva, sin intentar reconstruir retrospectivamente el sistema.

La descripción de una tarea técnica debe permitir seguir este ciclo:

1. **Especificar:** objetivo y resultado observable; escenarios o requisitos; contexto técnico y contratos vigentes; límites de compatibilidad; criterios de aceptación numerados y una comprobación prevista para cada uno. Separar hechos comprobados, supuestos y decisiones pendientes.
2. **Aclarar y planificar:** resolver las decisiones imprescindibles antes de fijar el diseño. Elegir una solución acorde con la arquitectura y las convenciones existentes. Si falta un detalle no esencial, explicitar el supuesto y cómo se verificará.
3. **Desglosar y revisar:** ordenar los pasos y sus dependencias cuando haya varias historias, módulos o riesgos. Relacionar requisitos con pasos y evidencias. Antes de implementar, comprobar que ningún criterio queda sin cobertura y que plan y tareas respetan los límites de la especificación.
4. **Implementar y converger:** comparar el resultado con cada criterio, ejecutar las pruebas y la compilación pertinentes, actualizar la documentación afectada según `AGENTS.md` y registrar la evidencia. Si el trabajo descubre un cambio necesario de alcance, reconciliar especificación, plan y pruebas. Solo se propone un registro `decision` cuando el trabajo fija una elección duradera de arquitectura o diseño con alternativas reales y consecuencias fuera de la tarea, o cuando la persona lo pide; indica motivo, responsable y siguiente paso. El resto se documenta en la descripción o la solución de la tarea.

En un cambio acotado basta una descripción breve con criterios, un plan corto y la verificación pertinente. Un cambio amplio o ambiguo requiere el desglose y la trazabilidad anteriores. Ningún caso obliga a instalar Spec Kit o Kiro ni a generar documentos duplicados. Las solicitudes no técnicas conservan una estructura apropiada a su propósito.

Ejemplos sintéticos para revisar la calidad de la tarea antes de proponerla:

| Alcance | Requisito y límite | Criterio observable y evidencia prevista |
| --- | --- | --- |
| Corrección acotada | Al editar el título de una tarea, los espacios exteriores se eliminan; se conserva el texto interior y la validación actual de longitud. | Guardar `  Informe  ` produce `Informe` y un título demasiado largo sigue rechazado; pruebas de edición y validación cubren ambos casos y `pnpm run build` pasa. |
| Función amplia | Permitir exportar las tareas visibles de un proyecto a CSV sin ampliar permisos ni cambiar la respuesta JSON existente. Desglosar autorización, serialización e interfaz en pasos dependientes. | Cada fila del CSV pertenece al proyecto autorizado, los campos se escapan correctamente y la API JSON conserva su contrato; pruebas de servicio e interfaz y `pnpm run build` respaldan los criterios. |

El flujo adapta las ideas de [GitHub Spec Kit: inicio rápido](https://github.com/github/spec-kit/blob/main/docs/quickstart.md), [adopción en proyectos existentes](https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md) y [Kiro Specs](https://kiro.dev/docs/specs/) al contrato de Bitácora. Estas referencias orientan el método; la guía canónica servida por `consultar_guia` y la skill portátil contienen las instrucciones operativas.

En las propuestas de creación de tareas, el asistente puede además identificar y vincular dependencias opcionales hacia tareas existentes del mismo proyecto a través del campo `patch.dependencyIds`. El servicio valida que las tareas previas existan, pertenezcan al proyecto autorizado y no generen dependencias circulares. La interfaz de revisión de propuestas en Bitácora muestra de forma legible los títulos de las tareas previas vinculadas antes de su aceptación; al aceptar la propuesta, los identificadores validados se incorporan al campo «Depende de estas tareas (opcional)» (`dependencyIds`) de la tarea creada.

## Uso de contexto y tokens

Una propuesta MCP que pide completar una tarea cambia su estado a «En revisión» mientras espera aceptación, humana o mediante `completar_tarea` en una sesión con permiso explícito. Si se rechaza y la tarea no cambió entretanto, recupera su estado anterior.

Empieza con una búsqueda concreta y un límite pequeño. Usa los IDs y títulos para elegir las fuentes y llama a `leer_elementos` solo para las que aporten información al resultado. Pasa `offset` únicamente cuando `nextOffset` no sea `null`. Si aparece `nextExcerptOffset`, solicita el fragmento siguiente con un solo ID y `excerptOffset`, únicamente si necesitas más texto. Para criterios, consulta una tarea específica y continúa solo si faltan fuentes relevantes. Evita repetir lecturas ya presentes en la conversación. Las instrucciones generales del conector son breves; la guía completa se obtiene con `consultar_guia` cuando hace falta.

La búsqueda filtra en el servicio, pero envía únicamente metadatos al cliente de IA. La sesión entrega títulos y campos de trabajo actuales del cuaderno abierto y sus tareas, entradas, incidencias, ideas, prácticas, decisiones, reuniones y objetivos estructurados. Los demás proyectos están en vaults cerrados y sus referencias no aparecen en vínculos, dependencias, criterios ni fuentes. Se excluyen historial, vault, autorizaciones de criterios, justificaciones de excepción y datos de validación del proyecto. Las propuestas de creación siguen pendientes de revisión humana. El límite de 12.000 caracteres controla el tamaño del texto de una respuesta; no es una cifra exacta de tokens, ya que la tokenización depende del modelo y el cliente añade su propio contexto y las definiciones de herramientas.

Las herramientas MCP de Bitácora no limitan otras herramientas de archivos, terminal o red del cliente de IA. Su configuración debe respetar por separado la autorización disponible para los datos reales.

## Conexión de Claude, Codex y Antigravity

La pantalla de Asistentes genera una configuración estable para Claude, Codex y Antigravity con `BITACORA_PROVIDER`, la ruta del conector y la carpeta de datos local. Al crear una sesión, el servicio guarda el permiso temporal en `mcp-grant-claude.json`, `mcp-grant-codex.json` o `mcp-grant-antigravity.json`, según el cliente, dentro de esa carpeta y fuera del repositorio. El conector lee el permiso vigente en cada llamada; renovar la sesión no requiere cambiar el bloque de configuración ni copiar un token. Cada cliente mantiene una única sesión; crearla de nuevo la renueva y reescribe su archivo con un token nuevo, que el conector lee en la siguiente llamada. Revocar esa sesión, desactivar la autorización, bloquear la aplicación o cerrar el servicio retira el archivo; el servicio también verifica vigencia y alcance en cada petición. El archivo temporal debe permanecer privado para el usuario local.

Claude, Codex y Antigravity cargan las definiciones de herramientas al iniciar una conversación o recargar la configuración MCP (`config.toml` para Codex, `mcp_config.json` para Antigravity). Si el servidor ya estaba cargado, las llamadas existentes leen el permiso renovado sin reiniciar. `estado_sesion` sirve para comprobar la conexión sin enviar contenido del cuaderno. Las llamadas MCP no cuentan como actividad (decisión «La actividad MCP no retrasa el bloqueo por inactividad»): el cuaderno se bloquea si la interfaz sigue sin uso durante el tiempo elegido en Asistentes (15 minutos por defecto), y `estado_sesion` devuelve `idleLockAt` e `idleLockInMinutes` para que el asistente avise a tiempo. Con «Indefinido» ambos valen `null` y solo cuenta la caducidad de la sesión. Consulta [Bloqueo por inactividad](seguridad.md#bloqueo-por-inactividad).

Además del bloque, Asistentes ofrece un comando de instalación para los clientes con CLI (`shared/mcpClientConfig.ts`): `claude mcp add bitacora --scope user -e … -- <node> <mcp.cjs>` y `codex mcp add bitacora --env … -- <node> <mcp.cjs>`, con la sintaxis de la ayuda de cada CLI. Las variables van como argumentos separados entre comillas, no como JSON, para que funcione igual en PowerShell, cmd y shells POSIX. Antigravity no tiene CLI y usa solo el bloque. El comando no contiene tokens.

Cada sesión guarda su último uso (`lastUsedAt` y `lastTool`, el nombre de la herramienta de una lista cerrada, nunca parámetros ni contenido). La lista de sesiones activas muestra «Sin uso todavía» o «Último uso hace N min (herramienta)», lo que confirma si el cliente llegó a conectar.

El conector y el servicio comparten `MCP_PROTOCOL_VERSION` (`shared/mcpProtocol.ts`), que se sube cuando cambia la forma de una respuesta o una entrada. El servicio la publica en `connection.json` y el conector la envía en `X-Bitacora-Mcp-Protocol`. Si no coinciden, el conector no llama o el servicio responde 409 sin ejecutar la acción, y el asistente recibe «reinicia el cliente MCP». Los conectores anteriores a la versión 2 no envían la cabecera y no se detectan. La versión del servidor MCP se deriva de la misma constante.

### Solución de problemas de conexión

| Mensaje del conector | Causa | Paso siguiente |
| --- | --- | --- |
| «Bitácora no está abierta» | No existe `connection.json`. | Abrir la aplicación y desbloquear el cuaderno. |
| «Bitácora no responde» o «no respondió a tiempo» | El servicio se cerró o tardó más de diez segundos. | Comprobar que sigue abierta y repetir. |
| «No hay una sesión MCP para este cliente» | Falta el archivo de permiso del cliente (bloqueo, revocación o nunca creada). | Crear o renovar la sesión en Asistentes. |
| «Bitácora está bloqueada» | Bloqueo manual o por inactividad. | Desbloquear y renovar la sesión. |
| «Sesión caducada» o «Sesión revocada o no reconocida» | La sesión venció o se sustituyó. | Renovar la sesión en Asistentes. |
| «El conector MCP y Bitácora son de versiones distintas» | Cliente con un conector anterior tras actualizar. | Reiniciar el cliente MCP o abrir otra conversación. |
| «BITACORA_PROVIDER no es válido» | Configuración copiada de forma incompleta. | Copiar de nuevo el bloque o el comando de Asistentes. |

Asistentes muestra la misma tabla resumida en «Solución de problemas de conexión».

Las configuraciones anteriores de Claude con `BITACORA_GRANT_TOKEN` siguen admitidas. Sustituirlas por el bloque nuevo evita copiar el token al crear o renovar sesiones.

Cualquier cliente conectado puede consultar la guía técnica canónica en cualquier momento llamando a `consultar_guia` o leyendo el recurso `bitacora://guia`. Para proyectos externos donde se desee activar proactivamente el contexto con `$bitacora-mcp`, la pantalla de Asistentes ofrece el botón **Copiar skill portátil (SKILL.md)** para colocarlo en `.agents/skills/bitacora-mcp/SKILL.md` o en `.claude/skills/`. El botón copia íntegramente la fuente mantenida en `.agents/skills/bitacora-mcp/SKILL.md`; no hay una segunda versión incrustada en la aplicación. La invocación no crea ni renueva permisos: primero hay que configurar el servidor MCP y abrir la sesión desde Asistentes. Para dejar de usar ese contexto, indícalo en la conversación o abre otra.

La skill incluye un procedimiento para entradas diarias: comprobar la fecha y los duplicados, contrastar una o dos entradas anteriores y los hechos del día mediante MCP, redactar con evidencias y dejar la creación o actualización como propuesta pendiente de revisión humana.
