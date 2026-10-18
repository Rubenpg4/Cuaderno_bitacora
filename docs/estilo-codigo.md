<!-- doc:summary: Convenciones de organización, formato, validación y comunicación para cambios de código. -->
# Estilo y codificación

## Organización

- `shared/` define tipos y cálculos puros; `service/` valida, autoriza y persiste; `src/` presenta datos y llama a la API; `src-tauri/` integra el escritorio. Respeta esta dirección de dependencias.
- Separa un módulo cuando tenga una responsabilidad reconocible o un contrato reutilizable. Usa nombres que describan esa responsabilidad (`records/schemas.ts`, `views/BoardView.tsx`). Evita carpetas y abstracciones que solo añadan saltos de lectura.
- Consulta el [mapa de cambios](mapa-cambios.md) para localizar el punto de entrada y las pruebas del flujo antes de extraer un módulo.
- Mantén las validaciones de entrada, permisos y campos reservados en el servicio. Los valores del cliente y las propuestas MCP no son autoridad.
- Conserva los contratos públicos al mover código. Si cambian datos persistidos, define migración y prueba recuperación de instalaciones existentes.

## Lectura y formato

- TypeScript, JavaScript, TSX, CSS, HTML y JSON usan Prettier con la configuración de `.prettierrc.json`: ancho de 100 caracteres, comillas simples donde correspondan y comas finales. Ejecuta `pnpm run format` tras editar y `pnpm run format:check` para verificar. El comando de compilación incluye esta comprobación.
- Rust usa `rustfmt` cuando el componente está instalado (`cargo fmt --manifest-path src-tauri/Cargo.toml`). No reordenes código ajeno para ocultar un cambio funcional.
- Prefiere funciones y componentes con una tarea clara, nombres explícitos y retornos tempranos. Divide JSX largo en vistas o componentes con propiedades tipadas. Mantén CSS por capas de responsabilidad y el orden de importación declarado en `src/styles.css`.
- Comenta invariantes, motivos y límites que no se deduzcan del código. Evita comentarios que repitan una instrucción. No incluyas datos personales, secretos ni ejemplos extraídos del vault.

## Verificación

- Antes de refactorizar, localiza las llamadas y contratos afectados y ejecuta las pruebas cercanas. Después ejecuta `pnpm test` si el cambio cruza módulos y `pnpm run build` para código; `build` ya comprueba documentación y formato, así que no repitas esos comandos al final. Para cambios visibles, ejecuta `pnpm run test:e2e`; para escritorio, comprueba Rust cuando esté disponible.
- Añade pruebas de comportamiento al cambiar dominio, persistencia, permisos, API o recorridos. En una extracción sin cambio funcional, usa las pruebas existentes y el compilador para detectar regresiones; evita pruebas que solo reproduzcan la implementación.
- Actualiza la documentación si corresponde. Ejecuta `pnpm run docs:sync` al modificar documentación y `pnpm run docs:check` cuando no vayas a ejecutar `build` después.

## Respuestas de agentes

- Comunica primero el resultado, después las comprobaciones y cualquier límite material. Usa frases cortas y rutas concretas; no vuelques archivos, logs completos ni razonamiento interno.
- Lee únicamente el contexto relevante. Agrupa búsquedas independientes, conserva resultados resumidos y no repitas comprobaciones que ya resolvieron el riesgo. La brevedad nunca debe ocultar un fallo o una limitación de verificación.
