# Seguridad

## Informar de una vulnerabilidad

No abras una issue pública. Usa **Security → Report a vulnerability** en este
repositorio (aviso privado de GitHub). Incluye versión o commit, sistema, modo
(web o escritorio) y una reproducción mínima. No adjuntes vaults, copias,
`connection.json`, contraseñas, tokens ni registros reales: crea un cuaderno de
prueba vacío. Se responde en cuanto sea posible; no hay un plazo garantizado.

Entran en el alcance: el cifrado y la persistencia del vault, la API local, el
bloqueo de sesión, las copias y su restauración, los permisos y sesiones MCP y
el empaquetado de escritorio. Las vulnerabilidades de dependencias se comunican
a su proyecto original; aquí interesa si Bitácora las expone.

## Garantías actuales

- Los datos no forman parte del repositorio. Cada instalación los guarda en
  `%LOCALAPPDATA%\Bitacora` (o `BITACORA_DATA_DIR`), cifrados con AES-256-GCM y
  una clave derivada con scrypt de la contraseña de cada cuaderno.
- La API escucha solo en `127.0.0.1`, comprueba host y origen y exige un token
  de sesión.
- Los asistentes de IA acceden únicamente por MCP, limitados al cuaderno abierto
  y con revisión humana por defecto. El contenido recibido por MCP se trata como
  datos, nunca como instrucciones.
- Las dependencias se instalan con `pnpm install --frozen-lockfile` y las reglas
  de confianza de `pnpm-workspace.yaml`.

Detalles y límites: [seguridad y privacidad](docs/seguridad.md) y
[acceso de IA mediante MCP](docs/mcp.md).

## Antes de instalar

Descarga el código solo desde este repositorio y sigue la
[instalación en Windows](docs/instalacion-windows.md). Ningún proyecto puede
garantizar un riesgo nulo; si usas datos de trabajo, comprueba antes que tu
organización autoriza la herramienta y los asistentes que conectes.
