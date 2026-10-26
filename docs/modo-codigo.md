<!-- doc:summary: Modo código del conector MCP: ejecución aislada de JavaScript, límites, privacidad, modos de publicación y vía de programmatic tool calling. -->

# Modo código del conector MCP

El modo código permite que el asistente escriba un script de JavaScript que llama a las herramientas de Bitácora como funciones. El script se ejecuta dentro de un sandbox aislado y al modelo solo le llega lo que el script devuelve. Los resultados intermedios no pasan por la conversación, y un recorrido que con herramientas individuales necesita varias idas y vueltas se resuelve en una sola llamada.

Aplica las ideas de [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/), de su [versión en el servidor](https://blog.cloudflare.com/code-mode-mcp/) y de [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) de Anthropic. Las herramientas se presentan como una API tipada, se descubren de forma progresiva y los datos se filtran en el código. No amplía lo que la sesión puede leer o proponer. La arquitectura general del acceso está en [Acceso de IA mediante MCP](mcp.md).

## Herramientas y modos

`BITACORA_MCP_MODO` decide qué publica el conector (`service/mcp.ts`). La variable se lee en `shared/mcpClientConfig.ts`.

| Modo | Herramientas publicadas | Uso |
| --- | --- | --- |
| `hibrido` (por defecto, sin variable) | Las herramientas individuales más `consultar_api` y `ejecutar_codigo` | Clientes que alternan consultas puntuales y recorridos |
| `codigo` | `estado_sesion`, `consultar_guia`, `consultar_api` y `ejecutar_codigo` | Mínimo contexto de definiciones: unos 2.200 caracteres, frente a unos 17.600 del híbrido y 16.300 de las herramientas individuales con ASVS activo |
| `herramientas` | Solo las herramientas individuales, como antes del modo código | Clientes que no escriben código con fiabilidad |

En el modo `codigo` las cuatro herramientas llevan `_meta["anthropic/alwaysLoad"]`. Así Claude Code las carga desde el principio y no necesita buscarlas.

Asistentes ofrece el selector «Modo del conector» junto a la configuración generada. El bloque y el comando de instalación añaden la variable solo si el modo no es el predeterminado, de modo que las configuraciones existentes siguen siendo válidas. Si cambias de modo, aplica de nuevo la configuración y reinicia el cliente MCP.

- **`consultar_api`:** sin argumentos, lista las funciones con una línea por función y la marca lectura o escritura. Con `funciones` (hasta diez), devuelve sus firmas TypeScript (`declare namespace bitacora { … }`) con el tipo de entrada y la forma de la respuesta.
- **`ejecutar_codigo`:** recibe `{ codigo }`, de hasta 20.000 caracteres. Es el cuerpo de una función `async`: el script llama a `await bitacora.<herramienta>(args)` con los mismos nombres y argumentos que las herramientas y termina con `return`. Admite anotaciones de tipo TypeScript, que se eliminan antes de ejecutar.

La respuesta de `ejecutar_codigo` es JSON compacto: `{ resultado, llamadas, propuestas?, registros? }`.

- `propuestas` aparece siempre que hubo escrituras, aunque el script no las devuelva.
- `registros` recoge la salida de `console`, con un máximo de 4.000 caracteres.
- Un resultado de más de 12.000 caracteres se recorta y se marca con `recortado`. Es el mismo presupuesto que una página de lectura.
- Un error devuelve `isError` con el mensaje, la línea del script y las propuestas que ya se hubieran creado.

## Registro único de herramientas

`service/mcpTools.ts` define una sola vez cada herramienta. Cada entrada incluye:

- nombre, acción del servicio, título y descripción;
- esquema de entrada y anotaciones;
- si pertenece a ASVS o escribe;
- una transformación de la entrada, que usa `proponer_eliminacion`;
- `output`, un esquema Zod con los campos principales de la respuesta.

El conector registra las herramientas a partir de esta tabla. `service/codeMode/api.ts` construye con ella las funciones del sandbox y las firmas de `consultar_api`. `service/codeMode/zodToTs.ts` imprime los esquemas como TypeScript.

`output` no se publica a los clientes, para no aumentar las definiciones. `tests/mcpConnector.test.ts` comprueba que las respuestas reales de cada herramienta de lectura coinciden con él. Las funciones ASVS siguen el estado del cuaderno, igual que las herramientas.

## Sandbox y límites

`service/codeMode/sandbox.ts` ejecuta el script en [QuickJS](https://github.com/justjake/quickjs-emscripten) compilado a WebAssembly. Usa la variante que incrusta el WASM en el propio bundle, así que no hay que copiar archivos ni ejecutar scripts de instalación. En cada ejecución se crea un módulo, un runtime y un contexto nuevos.

| Límite | Valor | Mecanismo |
| --- | --- | --- |
| Tiempo total | 30 s | Interrupción de QuickJS por plazo y temporizador del host mientras espera llamadas |
| Memoria | 64 MB | `WebAssembly.Memory` con máximo fijo. El límite propio de QuickJS no cuenta las asignaciones pequeñas en esta compilación |
| Pila | 256 KB | `setMaxStackSize`, por debajo de la pila nativa del host |
| Llamadas | 50 por ejecución | `CODE_LIMITS` en `service/codeMode/api.ts` |
| Llamadas simultáneas | 4 | Cola en el puente del host |
| Propuestas | 10 por ejecución, incluida `completar_tarea` | Contador de escrituras |

**Aislamiento:**

- El invitado no tiene `require`, `process`, `fetch`, temporizadores, sistema de archivos ni variables de entorno.
- Solo alcanza al host mediante el puente de `bitacora`, por el que únicamente pasan cadenas JSON.
- El token de sesión lo lee el conector y nunca entra en el sandbox.

**Puente y errores:**

- Cada función valida antes su entrada con el esquema `.strict()` de la herramienta y devuelve los mismos mensajes «Revisa los campos».
- Un fallo llega al script como excepción capturable, con la herramienta, la causa y el paso siguiente que da el servicio.
- Las llamadas iniciadas sin `await` se esperan antes de responder, para informar de todas las escrituras.
- Al agotar el tiempo, las llamadas en cola no se envían.

**Opciones descartadas:**

- `node:vm` y `vm2`, porque no son una frontera de seguridad.
- `isolated-vm`, porque es un módulo nativo, está en mantenimiento y requiere `--no-node-snapshot`.
- Un proceso Deno, porque habría que distribuir otro binario.
- SES, porque no limita CPU ni memoria.

## Seguridad y revisión humana

Cada función llama a la misma ruta `/mcp` que la herramienta directa. El servicio vuelve a autorizar la sesión en cada llamada y aplica la visibilidad, las validaciones y los campos reservados de siempre. Si la sesión caduca, se revoca o el cuaderno se bloquea a mitad de script, las llamadas siguientes fallan. `lastTool` registra la herramienta interna, nunca parámetros ni contenido. No cambian las acciones del servicio ni `MCP_PROTOCOL_VERSION`.

Las propuestas creadas desde código siguen pendientes de revisión humana, salvo el cierre autónomo que ya permite `completar_tarea` con `canCompleteTasks`. Hay dos razones para el tope de diez escrituras por ejecución:

- En Bitácora la revisión ocurre en Asistentes, no en el cliente de IA. Un bucle sin límite podría llenar la bandeja.
- Una propuesta de cierre pasa la tarea a «En revisión» de inmediato.

Por eso la respuesta enumera siempre las propuestas creadas.

El contenido de los registros sigue siendo un dato y no una instrucción, también dentro del código. El sandbox no tiene red, así que un texto malicioso no puede sacar datos por esa vía. El riesgo que queda es que el código proponga cambios guiado por ese contenido, y lo cubren la revisión humana y el tope de escrituras. `ejecutar_codigo` se anota con `readOnlyHint: false` porque puede escribir.

## Eficiencia

`tests/mcpConnector.test.ts` mide un recorrido real sobre doce tareas sintéticas: paginar el filtro, leer todas las tareas y quedarse con las bloqueadas.

| Vía | Llamadas | Texto devuelto |
| --- | --- | --- |
| Herramientas individuales | 4 | Unos 11.400 caracteres |
| `ejecutar_codigo` | 1 | Menos de 100 caracteres |

La prueba exige que el modo código devuelva al menos diez veces menos texto.

Para una consulta única, la herramienta directa sigue siendo más barata, porque evita escribir código. Anthropic observa lo mismo con programmatic tool calling: en turnos secuenciales de una o dos llamadas puede costar algo más.

Claude Code ya difiere las definiciones MCP con tool search. Por eso el ahorro principal está en los resultados intermedios y en las idas y vueltas, más que en las definiciones.

## Programmatic tool calling de Anthropic

[Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) es una función de la API de Claude: el sandbox lo gestiona Anthropic y las herramientas se marcan con `allowed_callers: ["code_execution_20260120"]`. No admite herramientas del conector MCP, así que no se aplica a Claude Code, Codex ni Antigravity conectados por MCP.

Si el [asistente integrado](asistente-registros.md) se implementa sobre la API de Claude, el registro único ya ofrece lo que esa vía necesita: esquemas de entrada sin `$ref`, respuestas documentadas en `output`, consultas idempotentes y paginadas, y errores que explican cómo corregir la llamada. Las herramientas de lectura podrían declararse con `allowed_callers` y las propuestas mantenerse como llamadas directas.

## Verificación

- `pnpm test tests/codeModeSandbox.test.ts`: resultado, consola, líneas de error, TypeScript, tiempo, memoria, pila, aislamiento, concurrencia y llamadas pendientes.
- `pnpm test tests/codeModeApi.test.ts`: cobertura del registro frente a `MCP_ACTION_TOOLS`, tipos, índice y firmas, validación previa y topes.
- `pnpm test tests/mcpConnector.test.ts`: conector real por stdio, eficiencia medida, propuestas pendientes, contrato de respuestas, presupuestos de definiciones y modos de publicación.
- `pnpm test tests/mcpClientConfig.test.ts`: variable del modo en el bloque y los comandos.
