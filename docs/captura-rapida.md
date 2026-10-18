<!-- doc:summary: Captura rápida cifrada, botón flotante y bandeja de entrada por cuaderno. -->
# Captura rápida y bandeja de entrada

Bitácora ofrece una captura breve independiente de los borradores de formularios. Un apunte permanece en el vault cifrado del cuaderno y no es un registro definitivo hasta que la persona lo clasifica y el servicio valida el registro resultante. Hoy la app tiene una sola ventana nativa de Tauri; el botón se monta en todas sus vistas y diálogos.

## Uso

1. «Captura rápida» permanece abajo a la derecha de la ventana, incluidas las vistas, los diálogos y la pantalla bloqueada. Sobre un diálogo, el botón se presenta en su capa y mantiene el acceso por teclado. Una ventana nativa adicional tendrá que montar este mismo control y consultar el cuaderno activo.
2. Con el cuaderno bloqueado, pulsar el botón enfoca el formulario de desbloqueo. No se puede escribir ni conservar un apunte antes de desbloquear. Con el cuaderno abierto, el botón abre un campo de texto y muestra el número de apuntes pendientes.
3. El texto se guarda automáticamente tras una pausa de 500 ms o al pulsar «Guardar apunte», cerrar el cuadro o abrir la bandeja. El cuadro muestra el estado del guardado y permanece abierto si la escritura falla. La bandeja permite editar, vincular con un registro del mismo cuaderno, conservar o descartar tras confirmar.
4. Para clasificar, se elige entrada, incidencia, decisión o idea y se revisa su editor normal. Cerrar el editor sin guardar conserva el apunte. Una vinculación previa se muestra como contexto; si debe quedar en el registro final, se añade en su editor y pasa la validación habitual.
5. En escritorio, **Ctrl + Mayús + B** trae la ventana al frente y abre la captura desde otra aplicación. Si el cuaderno está bloqueado, enfoca el desbloqueo. Si el atajo está ocupado, la interfaz informa y el botón sigue disponible. El atajo no lee el portapapeles ni registra teclas. En el navegador solo está disponible el botón.

El primer corte admite texto de hasta 8000 caracteres. No adjunta archivos ni crea automáticamente tareas, evidencias u otros registros.

## Datos y servicio

`shared/model.ts` distingue `QuickCapture` de `RecordItem`. El servicio genera ID, cuaderno, versión y fechas; el cliente solo aporta texto y, para editar o vincular, la versión vigente. `service/domain.ts` valida y persiste las operaciones mediante `service/server.ts`. `service/workspaces.ts` comprueba que apuntes y vínculos pertenezcan al vault activo al abrirlo o restaurarlo. Los vaults antiguos sin colección de capturas se interpretan con la bandeja vacía.

El texto y el vínculo se almacenan únicamente en el vault cifrado. No se guardan en el índice de cuadernos, almacenamiento web, URL, logs ni notificaciones del sistema. No aparecen en búsquedas, informes, exportaciones de registros, extractos o herramientas MCP actuales; sí se incluyen en la copia cifrada del vault.

Al convertir, el servicio valida el registro y marca el apunte como convertido en la **misma transacción**. El texto del apunte se vacía y la bandeja deja de mostrarlo. Una petición repetida con el mismo ID y tipo devuelve el registro ya creado, sin duplicarlo. Si la validación o la escritura falla, el apunte sigue pendiente. Descartar elimina el apunte del estado activo del vault. Borrar un registro vinculado limpia el vínculo del apunte pendiente.

## Bloqueo y recuperación

El bloqueo manual espera los guardados abiertos antes de cerrar el cuaderno. El bloqueo automático o un cierre inesperado solo permiten recuperar texto cuya escritura cifrada haya terminado; el texto aún en memoria puede perderse. Al bloquear, la interfaz desmonta el cuadro y elimina su estado React. Desbloquear otro cuaderno muestra solo su propia bandeja. La copia cifrada restaura apuntes y marcas de conversión junto con el resto del estado del cuaderno.

## Rutas y verificación

`src/App.tsx` coordina el botón y los diálogos; `src/app/QuickCapture.tsx` presenta la captura y la bandeja; `src/ui.tsx` conserva el foco de los diálogos; `src/styles/capture.css` define posición, contraste y tamaño adaptable. `src-tauri/src/main.rs` registra el atajo global y emite una señal sin transportar texto. `tests/service.test.ts` cubre validación, cifrado, versiones, conversión idempotente, bloqueo y descarte. `tests/app.e2e.ts` recorre las vistas, un diálogo, la bandeja, la conversión y el bloqueo.

La compilación Rust verifica la integración del atajo. Su activación real desde otra aplicación y los casos de ventana minimizada o conflicto de registro necesitan una comprobación manual en escritorio.
