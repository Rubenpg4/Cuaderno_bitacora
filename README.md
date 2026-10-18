# Bitácora

Organizador local de trabajo: tareas, diario, objetivos y evidencias en cuadernos cifrados, con interfaz web/escritorio (React + Tauri) y acceso opcional de asistentes de IA por MCP.

Los datos no forman parte del repositorio: cada instalación los guarda cifrados en `%LOCALAPPDATA%\Bitacora` y empieza vacía.

## Inicio rápido (Windows)

```powershell
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm run dev
```

Requisitos y pasos completos en [docs/instalacion-windows.md](docs/instalacion-windows.md). El resto de la documentación está en [docs/README.md](docs/README.md).

## Licencia y seguridad

El código se distribuye bajo [GPL-3.0-or-later](LICENSE). El catálogo de `resources/asvs/` procede de OWASP ASVS 5.0.0 y conserva su licencia CC BY-SA 4.0: consulta [resources/asvs/LICENSE.md](resources/asvs/LICENSE.md).

Para informar de una vulnerabilidad, consulta [SECURITY.md](SECURITY.md); no publiques datos reales en issues.
