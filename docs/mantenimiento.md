<!-- doc:summary: Procedimiento de actualización documental y alcance de las comprobaciones automáticas. -->
# Mantenimiento de la documentación

## Durante cada mejora

1. Lee el documento pertinente desde el índice de `AGENTS.md` o `CLAUDE.md`; no cargues toda la documentación por defecto.
2. Si cambia el comportamiento, los contratos, los comandos o las garantías, corrige el documento afectado junto con el código.
3. Si aparece una decisión duradera, añade una explicación breve al documento temático; evita historiales de sesión, planes transitorios y hechos que puedan deducirse fácilmente del código.
4. Si añades un documento, escribe un título `#` y una línea `<!-- doc:summary: Resumen breve. -->` al inicio. Ejecuta `pnpm run docs:sync` para actualizar los índices de `AGENTS.md`, `CLAUDE.md` y `docs/README.md`.
5. Ejecuta `pnpm run build` para cambios de código o `pnpm run docs:check` para cambios solo documentales, junto con las pruebas pertinentes. La compilación ya ejecuta la comprobación documental.

`docs:check` verifica que los índices coincidan con los documentos y que existan los destinos de los enlaces Markdown locales. Esto detecta índices y rutas rotas. No puede determinar si una explicación sigue siendo cierta: esa revisión corresponde a quien cambie el código.

## Criterios editoriales

- Usa lenguaje concreto y describe el comportamiento implementado, con rutas de código o pruebas cuando ayuden a comprobarlo.
- Mantén `AGENTS.md` y `CLAUDE.md` cortos. Revisa periódicamente reglas que ya no eviten errores y elimínalas.
- Usa un documento temático para detalles largos; evita duplicar las mismas instrucciones en varios lugares.
- No incluyas secretos, datos personales reales ni contenido sensible de una instalación.

## Fuentes de las pautas para agentes

- [OpenAI: AGENTS.md y contexto según la tarea](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
- [Anthropic: memoria de proyecto y CLAUDE.md](https://code.claude.com/docs/en/memory).
- [Anthropic: prácticas para Claude Code](https://code.claude.com/docs/en/best-practices).
- [Google Antigravity: reglas de proyecto y verificación](https://antigravity.google/docs/cli/best-practices/).

Estas fuentes orientan el tamaño y la organización de las instrucciones. Las reglas del producto se basan en el código de este repositorio.
