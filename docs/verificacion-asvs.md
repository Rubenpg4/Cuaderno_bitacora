<!-- doc:summary: Diseño de verificación ASVS por cuaderno: catálogo, evaluaciones, evidencias, tareas, permisos y migración. -->
# Verificación ASVS por cuaderno (diseño)

El [catálogo local](catalogo-asvs.md), la configuración opcional, las evaluaciones humanas con historial, las asociaciones a tareas, el ciclo proactivo MCP y el cierre atómico con verificaciones ASVS están implementados. ASVS está desactivado por defecto. La persona puede exigir vínculos concretos al cerrar una tarea; las modalidades y excepciones del diseño completo siguen pendientes. Registrar verificaciones no equivale a una certificación de OWASP.

## Comportamiento implementado

### Informe de trazabilidad y ayuda contextual

**Exportar trazabilidad ASVS** permite seleccionar requisitos del catálogo fijado, tareas vinculadas y referencias de evidencia aceptada. La selección inicial es el nivel objetivo, sin tareas ni evidencias; con ASVS desactivado incluye el catálogo completo e indica cero cobertura activa. La búsqueda solo filtra las opciones visibles. Cambiar requisitos reinicia la selección de tareas/evidencias, y cambiar tareas reinicia la de evidencias. El informe permite incluir u omitir el texto oficial inglés. No exporta notas privadas, responsables, descripción/solución de registros, contenido de fuentes, adjuntos, autorizaciones, historial ni propuestas de ningún proveedor. Las referencias, títulos, alcances, criterios y decisiones elegidos son datos locales: hay que revisar su contenido antes de compartirlo; la exportación no es un detector de secretos escritos en esos campos.

El servicio genera Markdown y CSV con fecha local de Madrid, proyecto, versión y huella SHA-256 del catálogo, versión de configuración, revisión de contexto, nivel y alcance. Distingue recuentos de toda la cobertura del nivel objetivo de recuentos de la selección; incluye requisitos sin evaluar, estados aceptados, alcance pendiente, desactualización, parciales y exclusiones humanas. Los recuentos usan las mismas reglas de `asvsCoverage`: categorías solapadas, denominador tras exclusiones vigentes y cumplimiento global independiente de las tareas. Las tareas elegidas muestran enlaces y verificaciones propias aceptadas, sin convertirse en cumplimiento global. No se inventan excepciones ASVS: se indica que todavía no están implementadas. La evidencia se exporta como referencia y revisión, con ID local cuando corresponde, nunca como contenido de la fuente.

Antes de descargar hay que **Previsualizar informe ASVS** y confirmar **He revisado el contenido del informe ASVS**. La vista muestra literalmente el formato elegido, sin interpretar Markdown/HTML; cambiar selección o formato exige otra revisión. POST humano `/api/asvs-report-preview` recibe `AsvsReportSelection`; POST `/api/asvs-report-export` recibe `selection`, `format` (`md` o `csv`), `reviewed: true` y `expectedDigest`. El servicio regenera el informe y compara su huella, incluyendo la base de vigencia de las fuentes; un cambio de datos, configuración, fecha o selección requiere previsualizar de nuevo. No acepta un cuerpo de informe aportado por el cliente. Ambos endpoints exigen cuaderno desbloqueado, token de interfaz y proyecto activo; no se exponen por MCP. CSV cita todos los campos, duplica comillas, conserva saltos internos y antepone apóstrofo a posibles fórmulas. Markdown codifica puntuación y controles del texto local para presentarlo como datos. El total de las dos vistas previas se limita a 4 MB; si lo supera se solicita reducir la selección. Se reutilizan `service/export.ts`, la descarga web y el diálogo de guardado de escritorio, que admite `.csv`.

Cada requisito permite **Copiar referencia**, abrir su capítulo inglés en la versión oficial `v5.0.0` y consultar el [índice de guías OWASP por ASVS](https://cheatsheetseries.owasp.org/IndexASVS.html). Las rutas de capítulos se comprobaron en el [directorio oficial de la versión](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en); las guías pueden evolucionar y no sustituyen el estándar fijado. La orientación española se identifica como ayuda sujeta a revisión humana; el original inglés permanece disponible y sus huellas siguen siendo la autoridad. Copiar o abrir ayuda no altera evaluaciones, nivel ni estados.

Contratos: `shared/asvsReport.ts`, `shared/asvsHelp.ts`, `service/asvs/report.ts` y `src/views/AsvsReport.tsx`. Pruebas: `tests/asvsReport.test.ts`, `tests/asvsReport.service.test.ts` y recorridos «ASVS informe» de `tests/app.e2e.ts`, con selección, privacidad, sintaxis activa, descargas, invalidación, teclado, accesibilidad y pantalla estrecha.

### Revalidación, catálogo y remediación

La cobertura usa todos los requisitos del nivel objetivo como total, incluidos los que carecen de evaluación. El denominador resta únicamente No aplicable aprobado y vigente. El resumen y su tabla por capítulo muestran Cumplido vigente global, No cumplido, Pendiente, Requiere consulta, exclusiones, evidencia desactualizada y cobertura parcial. Los estados declarados pueden solaparse con desactualización o alcance parcial; no se suman como categorías excluyentes. Con ASVS desactivado no hay cobertura activa. Los filtros no alteran este resumen del nivel objetivo y ninguna propuesta pendiente cuenta como cumplimiento.

**Cobertura y lagunas ASVS** pagina diez requisitos y permite abrir requisitos y tareas aceptadas. Distingue requisitos sin tarea abierta, trabajo en curso y revalidaciones pendientes. La revisión semanal agrupa por capítulo y causa para evitar cientos de tarjetas; abrir la vista no crea registros. Posponer/descartar se conserva en el vault y, para ASVS, también al confirmar un nuevo corte mientras la causa sea la misma. Cambiar fuente, revisión, evaluación, nivel, contexto o trabajo asociado puede producir una causa nueva.

**Revalidar una revisión externa** permite señalar una nueva revisión fija de una referencia ya usada como evidencia. POST humano `/api/asvs-source-revision` exige versiones de configuración y aviso (0 inicialmente), referencia, revisión y motivo. Solo desactualiza las evaluaciones/verificaciones que usan esa referencia externa; conserva evidencias e historial y rechaza nuevas revisiones basadas en una revisión externa anterior a la señalada. El aviso no modifica el estado declarado ni acredita la nueva revisión. Bitácora detecta cambios sustantivos y eliminación de fuentes locales registradas; no vigila repositorios, commits ni archivos externos. Un cambio general de sistema continúa usando Cambio de contexto.

La configuración guarda opcionalmente una base compacta del catálogo empaquetado (ID, huella y nivel), compatible con copias anteriores sin ese campo. Actualizar desde otra versión requiere POST `/api/asvs-catalog-preview` y después `/api/asvs-catalog-update` con confirmación humana, token de la vista previa vigente y correspondencias opcionales justificadas. Se muestran añadidos, retirados, cambios de texto/huella o nivel y contenido sin cambios. Se conserva la versión anterior con estados, evidencias, asociaciones e historial; todas las evaluaciones de la versión nueva empiezan Pendiente y las correspondencias nunca trasladan ticks ni decisiones. Una modificación del cuaderno invalida la vista previa. Solo se puede elegir el catálogo empaquetado; no se descargan ni admiten catálogos aportados por MCP. Si una versión antigua desconocida carece de base, se bloquea la actualización y se solicita registrarla con una versión compatible: no se inventan diferencias del catálogo ausente. Los vínculos antiguos se muestran como históricos y requieren revisión humana para retirar/reasociar compromisos al nuevo catálogo.

`planificar_remediacion_asvs` devuelve cobertura total/por capítulo y páginas de hasta diez lagunas sin notas ni evidencias privadas de evaluación. Sugiere reusar tareas vinculadas o similares por referencia, revisar creaciones propias pendientes o considerar trabajo nuevo. Los IDs de propuestas nunca son dependencias. El orden atiende primero incumplimientos declarados y revalidaciones, pero la prioridad queda por determinar: impacto, exposición, evidencia y dependencias deben justificarse en la propuesta acotada de tareas mediante `proponer_cambios`. El nivel mínimo ASVS no indica severidad. `proponer_revision_asvs` conserva avisos pendientes en `revisionProposals`; solo la confirmación humana en Verificación ASVS puede aceptarlos. `canCompleteTasks` no acepta avisos, cambios de catálogo ni evaluaciones globales.

Contratos adicionales: `shared/asvsCoverage.ts`, `service/asvs/revalidation.ts`, `service/asvs/remediation.ts` y `Domain.weeklySignals`/POST `/api/weekly-signals`. `sourceRevisions` e historial `source-revision` conservan los cambios externos declarados; el historial `catalog` conserva comparación y correspondencias. Las copias/restauración validan sus versiones y pertenencia. Pruebas: `tests/asvsFollowUp.test.ts`, `tests/asvsFollowUp.service.test.ts` y recorridos «ASVS seguimiento» en `tests/app.e2e.ts`.

La vista **Verificación ASVS** permite guardar Desactivado, L1, L2 o L3 en el cuaderno activo. Capítulos y secciones comienzan contraídos; muestran identificador, nombre y recuentos. El catálogo se presenta en español mediante una traducción local generada con DeepL; cada requisito permite desplegar el original oficial íntegro en inglés. Si la traducción aún no está generada, se indica y se muestra inglés. La búsqueda por referencia, descripción en ambos idiomas o título español revela las ramas coincidentes. La traducción no modifica huellas, evaluaciones ni su vigencia; consulta el [catálogo local](catalogo-asvs.md). Los filtros de nivel acumulativo, estado y aplicabilidad son temporales: no cambian configuración ni evaluaciones. Es posible explorar todos los niveles con ASVS desactivado; las revisiones están entonces inactivas y el historial sigue disponible.

Activar crea únicamente evaluaciones pendientes de los requisitos seleccionados (70/253/345). Subir o bajar el nivel conserva los datos anteriores. La interfaz distingue estado declarado, evidencia desactualizada, cobertura parcial y exclusión humana. Solo un **Cumplido** vigente de **todo el proyecto** muestra tick y entra en el numerador. Una revisión de componente o tarea exige describir qué cubre y qué alcance queda pendiente; no valida globalmente el requisito ni altera `Task.checks` o las condiciones existentes de cierre. Desactivar no borra evaluaciones ni criterios comprometidos en tareas abiertas, y suspende el cumplimiento activo ASVS.

La revisión registra nota, método, responsable escrito, fecha y actor local generados por el servicio, nivel/contexto evaluados, referencia y huella del requisito y evidencias. **Cumplido** requiere aplicabilidad determinada y evidencia concreta. Cada evidencia exige referencia y revisión/versionado; las locales solo admiten tareas, entradas, incidencias o decisiones del cuaderno activo y permiten abrir su registro fuente desde la vista. Las externas son texto, no se descargan ni ejecutan, y las URL con credenciales se rechazan. El responsable aporta trazabilidad, no identidad corporativa acreditada.

**No aplicable** exige una aprobación explícita en la interfaz, motivo, referencia de decisión y responsable. Es una decisión sobre todo el proyecto, se muestra aparte y se excluye del denominador solo mientras siga vigente. No hay excepciones de cumplimiento implementadas. Volver a Aplicable exige una revisión Pendiente; la decisión anterior permanece en historial. Un cambio de contexto requiere motivo, incrementa su revisión y desactualiza las evaluaciones. Subir nivel desactualiza revisiones realizadas a un nivel inferior, incluidas exclusiones.

Las huellas de evidencia usan SHA-256 sobre JSON de una tupla versionada `asvs-evidence-v1`, tipo y campos sustantivos en orden fijo: tarea/incidencia (descripción, solución, adjuntos), entrada (actividad, resultado, evidencia), decisión (decisión, motivo, evidencia, adjuntos). La huella de alcance de tarea usa descripción, tipo, etiquetas y adjuntos. Título, prioridad, día y estado no invalidan por sí solos evidencia. Eliminar una fuente la desactualiza sin borrar su historial. Las referencias externas requieren una nueva revisión de contexto si cambia el sistema; no hay vigilancia automática.

Contratos de evaluación: `shared/asvsTracking.ts`, `service/asvs/tracking.ts`, `Domain.asvsConfigure/asvsReview/asvsList/asvsHistory` y POST autenticado `/api/asvs-configure`, `/api/asvs-review`, `/api/asvs-list`, `/api/asvs-history`. Configurar exige `expectedConfigVersion` (0 cuando falta); revisar exige versión de configuración y evaluación, más versión de tarea para alcance de tarea. El historial devuelve páginas de 10 revisiones, antes/después, evidencias y decisión. Los esquemas estrictos rechazan campos calculados y referencias ajenas.

### Asociaciones, verificación de tareas y MCP implementados

Cada enlace admite `mandatory?: boolean`, informativo por defecto para mantener compatibilidad.
La persona lo decide con **Exigir Vx.x.x al cerrar la tarea** en el editor. MCP no puede crear,
rebajar ni retirar obligatoriedad: las propuestas de enlaces conservan los compromisos humanos.
Con nivel activo, el cierre normal exige Cumplido, aplicabilidad determinada, evidencia y vigencia
para los enlaces obligatorios del nivel. Los no asociados no bloquean y desactivar suspende estos
bloqueos sin borrar compromisos. Las tareas históricas completadas no se reabren; el próximo cierre
tras reabrir usa la configuración vigente. No se han implementado excepciones ASVS.

`consultar_criterios_asvs` pagina asociaciones manuales, configuración/versiones y verificaciones con
vigencia/evidencias. Las lecturas y preparación de tareas devuelven activación/nivel y cómo consultar
candidatos. La guía canónica y la skill portátil piden selección pertinente antes del plan y revisión
de cada criterio al terminar. La selección heurística del asistente nunca decide obligatoriedad,
nivel ni No aplicable. Escenarios y límites se describen en [MCP](mcp.md).

`proponer_verificacion_asvs` crea propuestas con `destination: task`; su versión inicial de
verificación es 0 y no crea evaluación aceptada hasta revisión. Se mantienen separadas de las
propuestas globales de `proponer_evaluacion_asvs`, incluso cuando estas evalúan alcance parcial.
El cierre humano puede aceptar prácticas, verificaciones de tarea y cierre en POST `/api/review`
con `ids` y `asvsIds`. `completar_tarea` permite el mismo lote de propuestas propias solo con
`canCompleteTasks`, todos los criterios asociados activos acreditados y cierre limitado a estado y
solución. Ni las exclusiones globales ni las excepciones autorizan por inferencia un cierre autónomo.
Se proyecta el contenido final antes de revisar evidencia, se comprueban versiones y proveedores y
todo se aplica o revierte conjuntamente. La transición propia a En revisión permite rebasing de una
única versión; un cambio externo obliga a releer. La vista previa invalida cambios en configuración,
verificaciones, propuestas o fuentes. Completar conserva descripción y actualiza solución; no
cambia evaluación, ticks ni recuentos globales. Pruebas cubren fallo a mitad del lote/persistencia,
reenvíos, versiones, fuentes, proveedor ajeno, criterios manuales omitidos y falta de permiso.

`Task.asvsLinks` es opcional; tareas antiguas sin ASVS conservan su formato. Cada asociación guarda `catalogVersion`, `reqId`, motivo (`reason`), alcance (`scope`), criterio observable (`criterion`) y método previsto (`method`). El servicio normaliza a un ID conocido de la versión fijada; rechaza duplicados, textos vacíos, versiones ajenas y campos reservados. La configuración debe existir, aunque puede estar desactivada. El editor permite añadir/editar/retirar hasta 50 referencias; la vista ASVS abre tareas relacionadas con sus estados. Las relaciones forman parte de la versión e historial de la tarea, sin crear checks de prácticas.

Las verificaciones de tarea viven en `Snapshot.asvs.taskVerifications`, con historial `task-verification`. POST `/api/asvs-task-review` exige versiones de tarea, configuración y verificación (0 para la primera), evidencia para Cumplido y alcance pendiente del proyecto. No cambia la evaluación global ni permite excluir requisitos de proyecto. `/api/asvs-task-status` recalcula vigencia; cambios sustantivos de tarea, asociaciones o evidencias y retirada de asociación dejan la verificación pendiente de revisión, conservando estado declarado e historial. Borrar fuentes mantiene la trazabilidad como desactualizada. La huella de tarea conserva compatibilidad cuando no hay asociaciones y añade las asociaciones cuando existen. Copias/restauración incluyen vínculos, verificaciones y propuestas y validan referencias y cuaderno antes de escribir.

`consultar_asvs` devuelve configuración, recuentos y metadatos filtrados por nivel acumulativo, capítulo, sección, estado aceptado, aplicabilidad y vigencia; pagina hasta diez requisitos sin sus textos/evidencias. `leer_referencias_asvs` lee una referencia concreta por página, con texto íntegro oficial, versión, jerarquía, evaluación/evidencias, propuestas propias pendientes y tareas relacionadas paginadas por separado. Referencias sin versión se resuelven solo contra la versión fijada; configuración ausente, versión no disponible o referencia ambigua/inexistente/distinta requieren aclaración.

`proponer_cambios` permite `patch.asvsLinks` en creación/actualización de tareas, con sesión de proyecto. El asistente consulta configuración, requisito, prácticas y trabajo similar y adapta la tarea al contexto autorizado. La vista previa muestra requisito, motivo, alcance, criterio, método y posibles tareas relacionadas. Solo la aceptación crea tarea y asociaciones en la misma transacción; rechazar no crea vínculos. Reenvíos pendientes son idempotentes.

`proponer_evaluacion_asvs` conserva en `Snapshot.asvs.proposals` referencia/huella, versiones esperadas, estado anterior, alcance y base de evidencias locales. Admite Cumplido, No cumplido, Pendiente y Requiere consulta; exige nota/hallazgo, método y responsable y evidencia para resultados positivos/negativos. No aplicable solo solicita una decisión humana: no admite `decision` ni aprobación del cliente MCP. En Asistentes, la vista previa muestra requisito, estados anterior/nuevo, alcance, fuentes y versiones. POST humano `/api/asvs-review-proposals` permite aceptar/rechazar; aceptar No aplicable exige aprobación explícita y referencia de decisión humana. Solo aceptar cambia el tick. Lotes de evaluaciones distintas se aplican atómicamente revalidando configuración, versiones y huellas de fuentes; dos propuestas sobre la misma evaluación son incompatibles. `canCompleteTasks` no permite aceptarlas ni validar el proyecto. Cambiar perfil rechaza también propuestas ASVS pendientes.

Estas herramientas exigen `scope: projects` del cuaderno autorizado; sesiones de extractos seleccionados no conceden contexto ASVS global. `consultar_propuestas` incluye solo estados de propuestas propias. Pruebas: `tests/asvsIntegration.test.ts`, `tests/asvsIntegration.service.test.ts` y recorridos «ASVS integración» en `tests/app.e2e.ts`.

`Snapshot.asvs` contiene `dataVersion: 1`, configuración, evaluaciones e historial, sin insertar el catálogo público en cada snapshot. Ausencia significa desactivado y no se añade al abrir vaults antiguos. La primera escritura eleva `app_state.schema_version` a 2 y antes crea/verifica una copia cifrada `.pre-asvs.backup` de esquema 1. Un fallo conserva archivo y estado anterior; reintentar verifica la autenticidad de la copia existente. La aplicación admite esquemas 1/2 y versiones antiguas que solo aceptan 1 rechazan el nuevo documento. Las copias/restauraciones incluyen historial y evaluaciones y validan su cuaderno antes de sustituir datos. Restaurar esquema 1 desactiva ASVS sin rebajar un destino que ya usa esquema 2. Cambiar contraseña elimina copias automáticas cifradas con la contraseña anterior, incluida la previa a ASVS.

La vigencia se calcula en cada consulta usando fuentes, nivel y contexto actuales. Un catálogo desconocido se conserva como base no disponible y bloquea nuevas revisiones; nunca se sustituye por semejanza. Las pruebas están en `tests/asvs.test.ts`, `tests/asvs.service.test.ts` y los recorridos ASVS de `tests/app.e2e.ts` (teclado, búsqueda, filtros, historial, accesibilidad, móvil y temas). Las secciones siguientes conservan el diseño de la integración completa; las APIs, entidades y reglas pendientes no son capacidades actuales.

## Alcance y contratos actuales

`Project` no tiene campos ASVS: la configuración vive en `Snapshot.asvs`. `Task.checks` contiene instantáneas de prácticas (`Check`), no evaluaciones de seguridad del proyecto; su esquema admite hasta 200 elementos. `service/domain.ts` gobierna versiones, campos reservados, excepciones, propuestas y cierre. No se amplía ese límite para convertir el catálogo ASVS en prácticas automáticas.

Cada cuaderno contiene un proyecto raíz, validado en `service/workspaces.ts`. `Snapshot` se guarda como documento en `app_state`, con esquema 1 sin ASVS o 2 tras su primera escritura, dentro del vault cifrado de `service/vault.ts`. Las propuestas genéricas admiten `create`, `update` y `check`; las evaluaciones MCP ASVS usan otro contrato. Las APIs/herramientas disponibles se enumeran arriba. Las entidades del diseño siguiente orientan trabajo pendiente; las asociaciones actuales viven en la tarea y sus verificaciones/propuestas en `Snapshot.asvs`.

La integración cubre ese único proyecto, sin presuponer subproyectos, usuarios autenticados por persona ni políticas corporativas remotas. El usuario que desbloquea el cuaderno toma las decisiones humanas; el responsable escrito de una revisión aporta trazabilidad, pero no prueba identidad corporativa.

## Catálogo y selección acumulativa

Se fija el [CSV oficial en la etiqueta v5.0.0](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv), no la rama de desarrollo. La [referencia oficial](https://owasp.org/projects/asvs?tab=main) recomienda identificar también la versión del requisito.

La comprobación del CSV con un analizador que respeta campos entrecomillados y saltos de línea produjo 345 IDs únicos. Su SHA-256, calculado sobre los bytes UTF-8 del archivo consultado, es `98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680`. La importación verifica esa huella antes de escribir el catálogo generado; una discrepancia se revisa, no se sustituuye silenciosamente el catálogo.

| Nivel elegido | Regla de selección | Requisitos acumulados |
| --- | --- | --- |
| L1 | `L <= 1` | 70 |
| L2 | `L <= 2` | 253 |
| L3 | `L <= 3` | 345 |

El catálogo será un recurso público empaquetado, independiente del vault y sin llamadas externas durante su uso. Cada requisito conservará `catalogVersion`, `reqId` (por ejemplo, `V2.2.1`), `canonicalRef` (`v5.0.0-2.2.1`), capítulo, sección, descripción íntegra, `minLevel` y huella de su contenido. La clave estable será `(catalogVersion, reqId)`; no se reutilizan identidades entre versiones.

Seleccionar por nivel mínimo no basta para determinar cumplimiento. Algunos textos introducen condiciones más exigentes para niveles superiores. Cada evaluación registra `evaluatedLevel`: una comprobación de L1 nunca se convierte automáticamente en una comprobación de L2. La interfaz mostrará el texto íntegro y el nivel evaluado; el catálogo no intenta convertir esas condiciones en reglas automáticas ni traducirlas perdiendo matices. La importación conservará atribución y licencia de la fuente.

## Entidades propuestas

`shared/asvs.ts` contendrá los tipos y cálculos puros. El nuevo campo opcional `Snapshot.asvs` agrupará datos privados del único proyecto raíz, con `dataVersion`, `config`, `assessments`, `taskLinks`, `taskVerifications`, `proposals` e `history`. No añade un nuevo `Kind` al CRUD genérico ni modifica `Practice`, `Check` o `Objective`.

| Entidad | Identidad y contenido | Autoridad |
| --- | --- | --- |
| `AsvsConfig` | `projectId`, versión, versión y huella de catálogo, `level: null \| 1 \| 2 \| 3`, `enforcement: informativa \| obligatoria`, `contextRevision` y motivo del contexto de evaluación | Solo el usuario cambia configuración; `null` significa desactivada. |
| `AsvsAssessment` | ID, versión, proyecto, clave de requisito, aplicabilidad, estado, nota, evidencias, nivel y revisión de contexto evaluados, decisión humana y excepción opcionales | Evaluación del proyecto, independiente de las tareas. |
| `AsvsTaskLink` | ID, versión, proyecto, tarea y clave de requisito | Vincula trabajo con requisitos; no demuestra cumplimiento. Un enlace por pareja tarea/requisito. |
| `AsvsTaskVerification` | ID, versión, proyecto, ID de enlace, estado, nota, evidencias, nivel/contexto evaluados, huella del alcance de la tarea y decisión humana/excepción opcionales | Verificación del requisito para esa tarea. No altera la evaluación de proyecto. |
| `AsvsEvidence` | ID generado por el servicio; referencia local a registro y huella de contenido relevante, o referencia externa textual con revisión identificada | El servicio valida propiedad y tipo de referencia. Nunca descarga ni ejecuta una referencia. |
| `AsvsProposal` / historial | ID, proveedor, destino, versiones esperadas, parche permitido, motivo y estado pendiente/aceptado/rechazado; historial de antes/después, actor y fecha | Registro separado; la aceptación siempre es humana. |

Los IDs, versiones, fechas, huellas, actor efectivo y marcas calculadas pertenecen al servicio. No se admiten duplicados de proyecto/requisito ni de enlace/verificación. Toda referencia local debe pertenecer al vault activo; ni un UUID ni el texto del cliente acredita esa pertenencia. Las evidencias pueden apuntar a tareas, entradas, incidencias o decisiones; sus adjuntos conservan los límites y la validación existentes. Las referencias externas solo contienen una ruta o URL y una revisión verificable, sin credenciales ni contenido descargado.

La aplicabilidad de proyecto es `Por determinar`, `Aplicable` o `No aplicable`; se inicia en `Por determinar` con estado `Pendiente`. Una evaluación positiva o negativa requiere `Aplicable`. Una decisión `No aplicable` de proyecto se refleja en sus tareas vinculadas sin fabricar verificaciones cumplidas. Una tarea puede tener una exclusión humana de alcance sin excluir el requisito del proyecto.

`No aplicable` exige motivo no vacío, responsable, fecha y referencia de decisión humana; esa decisión cambia aplicabilidad y estado conjuntamente. Volver a `Aplicable` restablece `Pendiente` y conserva la decisión anterior en historial. Las exclusiones de aplicabilidad y excepciones se revisan al cambiar el contexto o subir el nivel. Nunca se deducen del lenguaje de una nota, de completar una tarea ni de una propuesta del asistente.

## Estados, evidencias y transiciones

Se usan `Pendiente`, `Cumplido`, `No cumplido`, `No aplicable` y `Requiere consulta`, con una marca independiente `stale` y una lista de motivos calculadas por el servicio. La marca no sustituye el estado histórico. Solo `Cumplido` vigente y activo muestra tick; `No aplicable` tiene una señal propia.

| Transición | Condición verificable |
| --- | --- |
| Inicial → `Pendiente` | Requisito seleccionado, sin evaluación. Puede no tener tareas. |
| → `Cumplido` | Nota, al menos una evidencia concreta y revisión humana; se registra nivel/contexto actual y las huellas de las fuentes. |
| → `No cumplido` | Nota concreta sobre la carencia y revisión humana; se conserva la evidencia disponible. |
| → `Requiere consulta` | Se expresa la duda y el siguiente paso; no habilita cierre obligatorio. |
| → `No aplicable` | Decisión humana justificada y vigente en el ámbito correspondiente. |
| Evaluado → `Pendiente` | Reinicio explícito de revisión; la versión previa y evidencias permanecen en historial. |
| Evidencia vigente → desactualizada | Cambia catálogo, nivel exigido, contexto o contenido relevante de una fuente; se elimina una fuente o falta una revisión necesaria. No cambia automáticamente el estado declarado. |

Para fuentes locales se calcula una huella determinista de campos sustantivos por tipo: descripción/solución/adjuntos de tarea o incidencia, actividad/resultado/evidencia de entrada y decisión/motivo/evidencia de decisión. Cambiar solo prioridad, día o estado de tarea no invalida por sí mismo una evidencia. Para la verificación de tarea también se incluye su alcance: descripción, tipo, etiquetas y adjuntos. Cambiar solución sí invalida evidencias que la usan. Al implementar se fijará la serialización canónica y su versión y se probará cada campo incluido/excluido.

La vigencia requiere misma identidad y huella de requisito, mismo `contextRevision`, fuentes existentes con huellas coincidentes y `evaluatedLevel >= config.level`. Las decisiones de aplicabilidad y excepciones tienen su propia base de nivel/contexto. Una referencia externa no permite detectar cambios automáticamente: se exige identificar revisión y declarar una nueva revisión de contexto cuando cambie el sistema evaluado. No se anuncia vigilancia externa.

Reevaluar vuelve a capturar evidencias y base vigentes tras revisión; no basta quitar `stale` ni restaurar una nota. Restaurar una versión histórica de tarea o evidencia recalcula la vigencia actual y nunca modifica automáticamente una evaluación del proyecto.

## Activación, cambio de nivel y cierre

| Acción humana | Resultado |
| --- | --- |
| Activar L1/L2/L3 | Fija catálogo, nivel y modalidad; crea evaluaciones pendientes que falten. No asocia todo el catálogo a todas las tareas. |
| Subir nivel | Añade requisitos seleccionados; conserva estados y evidencia anteriores. Las evaluaciones con nivel insuficiente quedan desactualizadas, incluidas las de requisitos de menor nivel con condiciones superiores. |
| Bajar nivel | Conserva todo el historial. Requisitos fuera del nivel quedan inactivos; dejan de contar y bloquear. Una evaluación del mismo contexto realizada a nivel superior puede seguir vigente. |
| Desactivar | Suspende vista de cumplimiento activo y bloqueos ASVS, conservando datos e historial. No convierte pendientes en cumplidos ni en no aplicables. |
| Reactivar | Recupera datos y recalcula vigencia. No reinicia ni convalida evidencias automáticamente. |
| Cambiar modalidad/contexto | Modalidad solo afecta a bloqueos; cambiar contexto incrementa su revisión e invalida evaluaciones, exclusiones y excepciones basadas en la anterior. |
| Cambiar catálogo | Acción humana explícita y nueva base de revisión; nunca actualizar en segundo plano ni reutilizar estados por similitud de texto. |

La modalidad inicial es `informativa`. La obligatoriedad solo afecta a requisitos seleccionados vinculados a la tarea. En modalidad `obligatoria`, el servicio exige para cerrar cada enlace activo una verificación `Cumplido` vigente, una exclusión humana `No aplicable` vigente o una excepción humana vigente con motivo y referencia de autorización. `Por determinar`, ausencia de verificación, evidencia desactualizada, `Pendiente`, `No cumplido` y `Requiere consulta` bloquean sin esa excepción. Los requisitos no asociados nunca bloquean una tarea, aunque sigan pendientes en el proyecto.

Una excepción permite cerrar la tarea; no convierte el requisito en cumplido, no muestra tick ni incrementa cumplimiento global. El cierre mantiene también todas las condiciones actuales de prácticas, dependencias, bloqueos y solución. En una operación que cambie solución y cierre, se valida el estado final proyectado: no se utiliza una verificación de la solución anterior. Un cierre fallido revierte todos los cambios.

Activar, subir nivel o asociar un requisito no reabre tareas completadas: conserva su revisión histórica e indica lagunas actuales. Reabrir una tarea somete su próximo cierre a la configuración vigente. Las apariciones recurrentes comienzan sin verificaciones ASVS heredadas; esta primera integración tampoco copia enlaces desde plantillas de series. No se modifica la recurrencia existente.

El resumen del proyecto cuenta requisitos únicos seleccionados por estado efectivo y desactualización, incluso sin tareas; evita sumar verificaciones duplicadas por tarea. Se muestra cuántos están sin aplicabilidad determinada, excluidos y exceptuados. El porcentaje, si se presenta, usa cumplidos vigentes entre seleccionados menos exclusiones humanas vigentes; con denominador cero indica «sin requisitos aplicables evaluables», no 100 %. Un proyecto solo puede mostrar «todos los requisitos aplicables verificados» si no quedan dudas de aplicabilidad, fallos, pendientes o evidencias desactualizadas. Es una evaluación registrada, no una certificación.

## API local propuesta

Se conserva POST autenticado bajo `/api/`, sesión desbloqueada, proyecto activo, origen permitido y transacción de dominio. Las siguientes acciones son nuevas y requieren esquemas estrictos en el servicio; el `save` genérico rechazará campos ASVS para evitar vías alternativas.

| Acción | Entrada mínima | Resultado y reglas |
| --- | --- | --- |
| `asvs-catalog` | Versión, filtro opcional de nivel/capítulo, `offset`, `limit` | Metadatos públicos paginados y texto del requisito solicitado; catálogo empaquetado. |
| `asvs-summary` / `asvs-list` | `projectId`, filtros de estado/vigencia/tarea y paginación | Configuración, recuentos y metadatos o lecturas selectivas; sin rellenar todo el catálogo en cada snapshot. |
| `asvs-configure` | Proyecto, `expectedConfigVersion`, catálogo, nivel, modalidad y motivo del cambio de contexto si procede | Solo usuario; versión inicial 0 si el campo está ausente. Devuelve configuración efectiva y efectos sobre vigencia. |
| `asvs-link-task` / `asvs-unlink-task` | Proyecto, tarea, clave de requisito, versiones de tarea/configuración y de enlace al eliminar | Solo usuario; genera enlace y verificación pendiente para un requisito seleccionado activo, o elimina el enlace activo. Conserva historial y rechaza destinos ajenos o repetidos. Eliminar un enlace obligatorio exige motivo humano. |
| `asvs-review` | Destino de evaluación/verificación, versiones de destino/configuración/tarea cuando corresponda, estado, nota, referencias y decisión/excepción si procede | Revisión humana directa sobre un destino existente, evidencias normalizadas y validación de aplicabilidad/autoridad. El servicio genera identidad al activar o asociar. |
| `asvs-review-proposal` | ID de propuesta, aceptar/rechazar y versiones vigentes | Solo usuario; comprueba de nuevo evidencias, versiones y ámbito antes de aplicar. |

Todas las escrituras devuelven versiones actuales; conflictos devuelven error sin sobrescribir y exigen releer. Cambios de configuración y de evaluación tienen versiones independientes, pero cada revisión/cierre comprueba ambas. Desactivar no permite editar verificaciones activas; se puede consultar su historial. Eliminaciones de tareas quitan enlaces activos, conservan historial y desactualizan evidencias de proyecto que usaban esa fuente, sin crear referencias activas inválidas. Propuestas pendientes contra destinos eliminados se rechazan.

Listados y lecturas privadas admiten `limit` de 1 a 10, `offset >= 0`, orden estable por referencia canónica e ID y `nextOffset: null` al terminar. El snapshot puede entregar los datos privados existentes; la creación de configuración no incrusta textos completos del catálogo en cada tarea. Límites iniciales: 345 evaluaciones para este catálogo, hasta 345 enlaces por tarea, 10 evidencias por evaluación/verificación, nota/motivo/referencia de hasta 16000 caracteres y responsable de hasta 240. Nuevas versiones de catálogo deben declarar y validar su límite explícito; no se truncan listas.

## MCP y revisión de propuestas

MCP tendrá consultas específicas de resumen/listado y lectura selectiva ASVS. Requieren `scope: projects`, cuaderno activo y permiso vigente. El catálogo público no otorga acceso a datos privados; una sesión `selected` no recibe evaluaciones ni recuentos del proyecto. Los filtros por tarea y las evidencias locales solo revelan fuentes autorizadas. No se envían adjuntos, secretos ni referencias privadas en búsquedas o resúmenes. Bloqueo, caducidad, revocación y perfil corporativo conservan sus restricciones actuales.

Una herramienta específica `proponer_verificacion_asvs` podrá proponer únicamente estado evaluable (`Pendiente`, `Cumplido`, `No cumplido`, `Requiere consulta`), nota y referencias sobre un destino existente autorizado. Requerirá `targetId`, versiones de destino/configuración y tarea si corresponde, y `rationale`. La respuesta devolverá ID y estado `pending`; una consulta específica mostrará solo propuestas propias. Esas propuestas separadas se almacenan cifradas y se revisan en la interfaz.

El servicio rechaza en propuestas MCP activación, nivel, modalidad, catálogo, revisión de contexto, aplicabilidad, `No aplicable`, asociaciones obligatorias, excepciones, autorización, identidad, versiones generadas, huellas y actor. La revisión humana no autoriza un parche que ya incluya campos prohibidos: hay que realizar la decisión con su acción humana específica. Una propuesta positiva sin evidencia no se acepta; una fuente cambiada después de proponer obliga a releer y presentar una nueva propuesta.

`canCompleteTasks` permite aceptar conjuntamente verificaciones de prácticas, verificaciones ASVS de tarea y cierre. No permite aceptar evaluaciones globales, aprobar cumplimiento del proyecto ni establecer exclusiones. `completar_tarea` comprueba todos los criterios asociados activos contra el estado final del cierre; si falta evidencia vigente deja pendiente el lote sin aceptaciones parciales. Los contratos de `consultar_criterios`, `operation: check` y `checkIds` siguen refiriéndose a prácticas; `asvsIds` identifica propuestas de verificación de tarea.

## Persistencia, compatibilidad y restauración

Ausencia de `Snapshot.asvs` significa desactivado, sin evaluaciones ni enlaces. Abrir vaults antiguos no genera catálogo, enlaces, políticas ni verificaciones; conservará registros y sus versiones. Las prácticas y los cierres actuales mantendrán su comportamiento mientras ASVS esté desactivado.

La primera escritura de datos ASVS elevará el esquema del documento SQLite a 2 para que las versiones anteriores de la aplicación rechacen el vault en lugar de descartar campos desconocidos al guardar. El sobre cifrado y su algoritmo permanecen iguales. La nueva aplicación admitirá esquemas 1 y 2, con migración idempotente y validación antes de persistir; `dataVersion` identifica la estructura ASVS dentro del documento. No basta añadir el campo a TypeScript: hay que ajustar las lecturas, escrituras y restauraciones de `Vault` que hoy fijan la versión 1.

Antes de elevar el esquema se crea y verifica una copia cifrada de recuperación del estado anterior, sin cambiar la contraseña ni exportar JSON plano. Ante fallo de migración se conserva el original y no se publica un estado parcial. Volver a una aplicación antigua requiere recuperar esa copia anterior; perdería los cambios posteriores y nunca debe intentarse abriendo y reescribiendo el esquema nuevo.

`Workspaces.validateState` comprobará proyecto, unicidad, claves del catálogo, estados, enlaces, evidencias locales, propuestas pendientes e historial ASVS en apertura, transacción y restauración. Un catálogo desconocido conserva los datos históricos, marca su base como no disponible y bloquea nuevas evaluaciones/cierres obligatorios; exige una versión compatible, sin descargar sustitutos ni omitir requisitos.

Las copias cifradas incluyen configuración, evaluaciones, evidencias referenciadas, propuestas e historial; el catálogo público se recupera del paquete de la versión correspondiente. Restaurar comprueba esquema e identidad del cuaderno y rechaza datos cruzados antes de sustituir el destino. Copias de esquema 1 se restauran desactivadas; copias de esquema 2 se validan y recalcula su vigencia. Sesiones MCP se revocan como en el flujo actual. Las propuestas restauradas conservan condición pendiente y se revalidan contra la base restaurada al revisarlas. El índice público de cuadernos no recibe nivel, evaluación, evidencia ni historial.

## Decisiones del diseño y siguiente paso

Estas son decisiones propuestas de arquitectura, sujetas a revisión funcional; no son políticas ya activadas en ningún cuaderno. Responsable funcional: usuario del cuaderno. Responsable de su implementación y pruebas: agente o persona que ejecute cada paso.

| Decisión | Motivo | Siguiente paso |
| --- | --- | --- |
| Catálogo público fijo y evaluaciones privadas separadas de prácticas | Superar el límite de checks sin mezclar cumplimiento de tarea/proyecto ni introducir servicios externos. | P1: empaquetar y validar catálogo y tipos. |
| Configuración apagada e informativa inicialmente | Conservar comportamiento previo y hacer explícita la elección humana de bloquear cierres. | P2–P3: migración y reglas de configuración/cierre. |
| Vigencia independiente del estado y condicionada por nivel/contexto/fuentes | Conservar trazabilidad sin mostrar cumplimiento basado en evidencias antiguas. | P3: cálculo puro, transiciones y validación transaccional. |
| Evaluación global y decisiones ASVS sujetas a revisión humana; verificaciones de tarea con permiso explícito de cierre | Separar alcance de tarea/proyecto y evitar convertir propuestas en políticas. | P4: herramientas, listas de campos y revisión. |
| Esquema 2 al persistir ASVS | Evitar pérdida silenciosa con una aplicación anterior. | P2: recuperación, compatibilidad y restauración. |

## Matriz requisito → paso → verificación

Los casos siguientes son especificaciones de pruebas futuras; no se afirma que estén implementados o ejecutados. La revisión de diseño comprueba que cada resultado tiene entidad, autoridad y transición definidas arriba.

| Requisito de aceptación | Paso y dependencia | Prueba o revisión prevista |
| --- | --- | --- |
| 1. Entidades, API y transiciones | P1 tipos/catálogo; P2 persistencia después de P1; P3 dominio después de P2 | Revisar las tablas de entidades/API; probar activar cada nivel, subir, bajar, apagar y reactivar conservando estados e historial. Versiones obsoletas no escriben. |
| 2. Selección acumulativa y condiciones internas | P1 | Probar 70/253/345 IDs únicos del CSV fijado y su huella; campos multilínea no añaden requisitos. Una evidencia L1 de `V2.2.1` queda desactualizada en L2. |
| 3. Estados, vigencia, tick y no aplicabilidad | P3; P5 interfaz después de P3–P4 | Probar los cinco estados, tick solo positivo vigente, cambios/eliminación de fuentes, contexto y nivel; rechazar `No aplicable` sin decisión humana. Probar fuente externa sin revisión y denominador cero. |
| 4. Autoridad humana y alcance MCP | P4 API/MCP después de P3 | Pruebas de dominio/servicio: campos reservados, `selected`, otro vault, caducidad, perfil corporativo y revocación. Rechazar aceptación ASVS por `canCompleteTasks`; impedir cierre con ASVS obligatorio pendiente y aceptar cierre tras revisión humana vigente. |
| 5. Compatibilidad, aislamiento, copias y restauración | P2 y regresiones tras P4 | Vault antiguo abre sin ASVS; migración idempotente, fallo conserva original, esquema 2 rechazado por lector antiguo. Copia/restauración conserva datos e historia; fuente/enlace/propuesta de otro cuaderno se rechazan sin cambiar destino. |
| Separar tarea y evaluación global | P3 | Completar dos tareas vinculadas no cambia `AsvsAssessment`; un requisito sin tarea permanece pendiente global pero no bloquea cierres. Excepción de tarea no cuenta como cumplimiento. |
| Cierre consistente y recuperación | P3–P4 | Cambio de solución invalida su evidencia; cierre valida candidato final. Un lote fallido no acepta verificaciones ni cierre parcialmente; historial de tarea completada no se reabre al subir nivel. |
| Recorrido completo | P5 y P6 integración después de P1–P5 | Activar en un cuaderno aislado, asociar requisito, documentar evidencia, revisar, cerrar tarea, comprobar evaluación global independiente; subir nivel y ver desactualización; apagar/reactivar y restaurar copia. E2E en pantalla amplia/estrecha y teclado. |

P6 actualizará documentación de comportamiento real, guía MCP y mapa de cambios al implementar. Las suites previstas son `tests/asvs.test.ts`, `tests/asvs.service.test.ts`, las regresiones de dominio, cuadernos y copias existentes, y recorridos en `tests/app.e2e.ts`. Se ejecutarán `pnpm test`, `pnpm run test:e2e`, `pnpm run docs:sync` y `pnpm run build` en esa implementación. ASVS-01 entrega este contrato; no modifica comportamiento ni declara conformidad ASVS de Bitácora.

## Revisión del contrato

La revisión documental contrastó estos escenarios con las reglas anteriores, sin ejecutar funcionalidades ASVS todavía inexistentes:

| Escenario revisado | Resultado del contrato |
| --- | --- |
| Activar L1 en un vault antiguo | Configuración explícita, esquema 2 y 70 evaluaciones pendientes; cero asociaciones automáticas. El vault sin activación conserva el comportamiento previo. |
| Subir de L1 a L2 con una verificación positiva de L1 | Se seleccionan 253 requisitos; la verificación conserva su estado histórico y queda desactualizada por nivel insuficiente. No muestra tick ni permite cierre obligatorio. |
| Bajar de L3 a L1 y desactivar/reactivar | Se conserva historial; fuera de nivel queda inactivo. La vigencia se recalcula al reactivar, sin transformar estados. |
| Cerrar una tarea con una excepción humana | Puede cerrar si cumple las demás reglas; la evaluación global sigue independiente y la excepción no cuenta como cumplimiento. |
| MCP propone cumplimiento y tiene permiso de cierre | La propuesta ASVS permanece pendiente hasta revisión humana; el permiso existente solo acepta prácticas y cierre si ASVS ya está revisado y vigente. |
| Cambiar solución al cerrar o restaurar evidencia antigua | El servicio debe evaluar el candidato final y recalcular huellas; nunca acepta evidencia de otra solución por conservar el mismo ID. |
| Restaurar copia con vínculos de otro cuaderno | Se rechaza antes de sustituir el destino; no se filtran ni se convierten en fuentes autorizadas. |

La comprobación de la fuente oficial confirmó los recuentos y la huella indicados. La coherencia documental exige que P1–P6 implementen después esas reglas y pruebas; superar las comprobaciones actuales del repositorio solo valida su base existente.
