<!-- doc:summary: Reglas, datos y verificación de las series de tareas recurrentes. -->
# Tareas recurrentes

Bitácora permite crear series semanales o mensuales desde «Nueva tarea» y administrarlas en «Lista → Series recurrentes» o desde una aparición. La serie es distinta de cada tarea generada: completar, editar o cancelar una aparición no cambia las demás. El servicio local es la autoridad de la regla y de la generación; la interfaz solo solicita operaciones autenticadas.

## Calendario y generación

Las reglas utilizan días civiles `YYYY-MM-DD` de `Europe/Madrid`. Inicio y fin opcional son inclusivos. Una serie semanal elige uno o varios días distintos de lunes a domingo. Si el inicio cae fuera de esos días, la primera aparición será el siguiente día elegido. La regla mensual elige un día entre 1 y 31; en meses más cortos se usa el último día disponible y en el mes siguiente se vuelve al día elegido. Por ejemplo, el día 31 produce el 28 de febrero de 2027, el 29 de febrero de 2028 y el 31 de marzo en ambos años. Se rechazan fechas y parámetros inválidos.

Al desbloquear el cuaderno y al solicitar una instantánea, el servicio genera todas las apariciones faltantes desde el inicio de la regla hasta 90 días después de hoy, inclusive, o hasta el fin si llega antes. Al avanzar el día, la siguiente lectura repone la ventana. Si Bitácora estuvo cerrada, las apariciones vencidas se recuperan: no se marcan como completadas por el mero transcurso del tiempo. La generación procesa lotes de hasta 100 apariciones por transacción y guarda el último día examinado. Si una serie acumula más de 10 000 apariciones pendientes en una reconciliación, devuelve un error visible en vez de saltar fechas.

Un fallo de generación de una serie muestra un aviso después de desbloquear, pero no impide acceder al resto del cuaderno. El servicio conserva las tareas y el historial existentes para permitir revisar la serie sin alterar otros registros.

La clave lógica `(seriesId, occurrenceDate)` identifica cada aparición. `occurrenceDate` es su fecha de calendario original y no cambia si se reprograma `due`. La reconciliación comprueba esa clave antes de crear una tarea; reabrir, releer o restaurar el cuaderno no crea otra aparición para la misma serie y fecha. El servicio asigna un UUID y una versión propios a cada tarea.

## Datos y edición

`Snapshot.taskSeries` contiene las series dentro del vault cifrado. Cada `TaskSeries` tiene ID, versión, proyecto, regla, plantilla, criterios asociados, cursor de generación y estado de detención. `Snapshot.taskSeriesHistory` registra las versiones de la serie. Las tareas antiguas carecen de `recurrence` y siguen siendo ordinarias. Cada tarea generada guarda un vínculo reservado con `seriesId` y `occurrenceDate`, además de sus propios estado, fecha, solución, criterios e historial. El servicio impide que una tarea ordinaria o propuesta MCP invente o modifique ese vínculo.

Una aparición copia título, fase, tipo, etiquetas, prioridad, bloqueo, siguiente paso, descripción y dependencias de la plantilla. Comienza «Por hacer», con fecha prevista igual a la aparición, solución vacía y criterios pendientes nuevos. Las prácticas vigentes y aplicables se añaden en el servicio; los criterios asociados a la serie también se copian como verificaciones **nuevas**, nunca con respuestas, notas ni excepciones de otra aparición. Los adjuntos no se duplican: se añaden a cada tarea por separado. Si una dependencia o criterio deja de ser válido, la generación falla con un error visible en lugar de omitir instancias.

Editar una aparición marca como anulados los campos heredados que cambiaron; la fecha prevista, el estado, la solución, las verificaciones y la finalización siempre pertenecen solo a ella. Cambiar la plantilla actualiza campo por campo las apariciones futuras sin completar y no anuladas. Las apariciones de hoy, pasadas, completadas o en revisión no se reescriben. Un cambio de regla se aplica desde mañana: las futuras pendientes excluidas se cancelan lógicamente, conservando ID e historial; si una regla posterior vuelve a incluirlas, se reactiva la misma tarea. Una cancelación manual se conserva; esta versión no ofrece reactivarla desde la interfaz. Las tareas canceladas no se cuentan ni se muestran como pendientes, aunque permanecen en el vault y en el recuento de su serie.

«Detener serie» conserva las apariciones de hoy y las anteriores, cancela las futuras pendientes y archiva la serie. Las tareas completadas y en revisión permanecen intactas. «Cancelar aparición» afecta solo a la tarea elegida y conserva su historial y referencias; una aparición completada no se puede cancelar. Una serie detenida se consulta en «Lista», pero esta versión no ofrece reactivarla. El borrado definitivo de una serie o de sus apariciones vinculadas tampoco está disponible.

En «Tablero» y en la tabla de tareas de «Lista» se muestra solo la aparición no completada con la fecha prevista más cercana de cada serie. Al completarla, aparece la siguiente. Las apariciones restantes siguen guardadas y se pueden consultar en las demás vistas; la gestión de series en «Lista» conserva sus recuentos completos. La selección ocurre antes de aplicar búsqueda, filtros o intervalo de fechas, de modo que estos no adelantan una aparición posterior.

## Contratos y comprobaciones

La lógica de fechas está en `shared/recurrence.ts`; los tipos en `shared/model.ts`; la validación y las operaciones en `service/domain.ts` y `service/records/schemas.ts`; la API en `service/server.ts`; la gestión de interfaz en `src/RecordEditor.tsx`, `src/TaskRecurrenceFields.tsx` y `src/views/TaskSeriesManager.tsx`. Los vaults y copias anteriores no necesitan convertir tareas ordinarias en series. Las series se limitan al cuaderno y proyecto activos; el servicio valida versiones y campos reservados. MCP no administra series en esta versión.

`tests/recurrence.test.ts` cubre límites semanales y mensuales, recuperación de vencidas, idempotencia al reabrir y mover fechas, independencia de instancias, propagación de plantilla, cancelación y reactivación por cambio de regla y detención. `tests/app.e2e.ts` incluye la creación semanal desde el formulario y su visualización en Lista. La verificación general usa `pnpm test`, `pnpm run test:e2e` y `pnpm run build`.
