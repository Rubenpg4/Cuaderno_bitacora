<!-- doc:summary: Diseño de perfiles MCP por cuaderno y requisitos de verificación de identidad corporativa. -->
# Perfiles MCP por cuaderno (diseño)

La elección, persistencia y edición de perfiles ya están implementadas. El perfil corporativo
admite **solo Claude Code** tras una [verificación local de buena fe](#verificación-local-de-buena-fe)
de la organización de Claude con la que ha iniciado sesión en este equipo. No es una prueba
firmada por Anthropic: evita usar un cuaderno corporativo con la cuenta personal por error, pero no
protege frente a la manipulación deliberada del equipo. `service/mcp.ts` usa stdio y envía a
`service/server.ts` un token de sesión de Bitácora y, en Claude, la organización detectada.
`service/domain.ts` admite Claude, Codex y Antigravity en el perfil personal cuando existe la
autorización local de empresa.

## Selección y persistencia

- Cada cuaderno tiene un perfil `personal` o `corporativo`. El formulario de creación muestra la
  elección junto al nombre y la contraseña, con `personal` como valor inicial. Los cuadernos
  existentes y los restaurados sin este campo se interpretarán como `personal`.
- El perfil y su versión de política son configuración reservada dentro del `Snapshot` cifrado.
  `service/vault.ts` migra los cuadernos antiguos a `personal`. No figuran en `workspaces.json`,
  que contiene solo ID y título. «Ajustes y copias» permite cambiar el perfil con el cuaderno
  desbloqueado; las propuestas MCP no pueden modificarlo.
- Las API de creación y cambio validan el perfil en el servicio. Asistentes lee el perfil efectivo
  y muestra la conexión personal o el aviso de bloqueo corporativo. El perfil personal conserva
  los tres proveedores y los límites, la confirmación de autorización y la revisión de
  propuestas actuales.
- El valor persistido expresa la política elegida, **no** que Claude haya superado la verificación;
  la verificación se repite en cada alta, renovación y llamada.
  Un cuaderno corporativo puede existir sin habilitar su MCP mientras falte esa prueba.

## Verificación local de buena fe

Implementada en `service/claudeIdentity.ts` y aplicada desde `service/server.ts`:

- **Política:** `corporate-policy.json` en la carpeta de datos de Bitácora, fuera del vault, con
  el formato `{"claudeOrgIds": ["<orgId>"]}` (máximo 20). La aplicación solo la lee; ni la
  interfaz ni las propuestas MCP la modifican. Sin política no hay acceso corporativo. El `orgId`
  se obtiene con `claude auth status`.
- **Cuenta aceptada:** el servicio ejecuta `claude auth status --json` sin shell (o la ruta de
  `BITACORA_CLAUDE_PATH`) y exige `loggedIn`, `authMethod: claude.ai`, `apiProvider: firstParty`,
  plan `team` o `enterprise` y un `orgId` incluido en la política. No guarda ni registra el correo.
- **Permiso:** crear, renovar o cambiar los proyectos de una sesión corporativa repite la consulta
  sin caché. El permiso queda ligado a ese `orgId`; Codex y Antigravity se rechazan.
- **Cada llamada `/mcp`:** el conector ejecuta la misma consulta con el entorno del Claude Code
  que lo lanzó y envía el `orgId` en la cabecera `X-Bitacora-Claude-Org`. El servicio exige que
  coincida con su propia verificación (caché de 60 s) y con el `orgId` del permiso. Si Claude Code
  cambia de cuenta u organización, las llamadas se rechazan.
- **Interfaz:** Asistentes muestra la organización detectada o el motivo del bloqueo y la ruta de
  la política, y solo ofrece Claude.

**Límite.** Todo lo anterior se basa en información que declara el propio equipo. Un usuario local
puede sustituir el ejecutable `claude`, alterar su configuración o falsear la cabecera. La vía
firmada descrita a continuación sigue siendo la mejora necesaria para obtener una garantía frente a
ese caso.

## Regla corporativa y frontera de confianza (verificación firmada)

El perfil corporativo solo aceptará Claude en la organización de Claude designada por la empresa.
La aplicación no aceptará un correo con dominio laboral, una casilla marcada por la persona, un
nombre de cliente MCP, un token de Bitácora ni una clave de API de Claude Console como prueba de
esa condición. [Anthropic permite que una cuenta personal y otra de organización compartan la
misma dirección de correo](https://support.claude.com/en/articles/9267400-move-your-personal-claude-account-to-a-team-or-enterprise-organization).

Para habilitar el acceso corporativo se necesitará una integración de identidad que entregue al
servicio una **afirmación verificable y ligada a cada sesión o petición MCP**: emisor de confianza,
destinatario Bitácora, identificador inmutable de la organización de Claude aprobada, sujeto,
caducidad y vínculo con el cliente o canal que realiza la llamada. La lista de organizaciones
permitidas será política administrada, separada del vault y no editable desde el cliente ni por
propuestas MCP. El servicio verificará firma, emisor, destinatario, vigencia, organización y
vínculo; rechazará una prueba ausente, caducada, alterada o de otra organización. El alta y la
renovación de permisos, `/mcp` y las operaciones de lectura y propuesta repetirán la autorización
contra el perfil y el cuaderno activos. El permiso resultante quedará asociado al ID del cuaderno,
proveedor, identidad verificada, organización y versión de la política, con caducidad corta.

La integración deberá demostrar, mediante documentación del proveedor y una prueba de extremo a
extremo, que la afirmación corresponde **a la cuenta de Claude que usa el conector**. OAuth con el
IdP de la empresa prueba quién se autentica ante Bitácora, pero por sí solo no demuestra con qué
cuenta de Claude se abrió el MCP: una cuenta personal puede iniciar ese mismo flujo. La opción
`forceLoginOrgUUID` de Claude Desktop restringe el inicio de sesión en un equipo administrado,
pero Bitácora tampoco recibe una afirmación de identidad por stdio. Los conectores MCP remotos
personalizados requieren un servidor accesible desde la nube de Anthropic; su alta por un
administrador de Team/Enterprise no impide por sí sola que una cuenta personal configure el mismo
endpoint. La restricción de conectores por dominio verificado publicada por Anthropic cubre una
lista concreta de conectores y **no incluye los personalizados**.

Por tanto, **la implementación actual no ofrece esa garantía firmada**. Como paso intermedio se ha
aceptado la [verificación local de buena fe](#verificación-local-de-buena-fe), que se apoya
precisamente en la configuración local de Claude y en una cabecera del conector; no debe
presentarse como prueba de identidad frente a un usuario local malintencionado.

### Vía candidata: autorización empresarial gestionada

La extensión MCP
[Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
define un intercambio de una afirmación de identidad del IdP corporativo por un `ID-JAG` y después
por un token de acceso al servidor MCP. Bitácora podría usar ese flujo en un conector remoto
corporativo **solo si** Claude lo admite para conectores personalizados y vincula la afirmación a la
sesión de Claude de la organización aprobada. El servidor de autorización verificaría la firma, el
emisor, el destinatario, la vigencia, el sujeto y los permisos del `ID-JAG`, y emitiría un token
limitado al cuaderno y a la versión de su política. La ruta corporativa no ofrecería inicio de sesión
individual como alternativa. El servicio comprobaría ese token en cada llamada y denegaría cualquier
petición stdio al cuaderno corporativo.

[Anthropic documenta la autorización gestionada](https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization)
para Team y Enterprise, pero su lista actual de conectores preparados no incluye los personalizados.
Además, cuando conviven la autorización gestionada y el inicio de sesión individual, Claude puede
recurrir al segundo si falla la primera. La
[matriz de clientes MCP](https://modelcontextprotocol.io/extensions/client-matrix) tampoco acredita
todavía soporte de esta extensión en Claude. Por ello, el flujo anterior es una hipótesis de
integración, no una garantía disponible para Bitácora. Un conector remoto requeriría también hacer
accesible el servidor desde la nube de Anthropic, con un diseño de despliegue y privacidad distinto
del servicio local actual.

Antes de habilitarlo, el administrador corporativo y Anthropic deberán confirmar el soporte para
conectores personalizados y la relación entre el `ID-JAG` y la cuenta de Claude activa. Una prueba de
extremo a extremo deberá registrar el mismo cuaderno con una cuenta corporativa autorizada, una
cuenta personal del mismo usuario y una cuenta de otra organización: solo la primera podrá obtener
un token y consultar o proponer. También deberá cubrir caducidad, revocación, cambio de perfil y el
fallo del IdP, sin retorno al inicio de sesión individual. Si esa vinculación no se puede demostrar,
el perfil corporativo seguirá sin acceso MCP.

## Cambio de perfil y aislamiento

1. En una transición de perfil, el servicio persiste primero el nuevo perfil y aumenta una
   versión de política del cuaderno. Todo permiso emitido bajo una versión anterior dejará de ser
   válido antes de responder a otra petición, aunque falle la limpieza posterior de archivos.
2. Revoca todas las sesiones MCP del cuaderno, retira los archivos de permiso local y exige
   volver a conectar. No reutilizará tokens, credenciales ni aprobaciones de identidad entre
   perfiles o cuadernos. Revoca todos los extractos autorizados. Las propuestas pendientes
   emitidas bajo el perfil anterior se rechazan para evitar
   aceptarlas bajo otra política; los registros ya aceptados permanecerán en el vault e historial.
3. En corporativo, Asistentes oculta el formulario de conexión hasta verificar Claude Code y el
   servidor rechaza permisos para Codex, Antigravity y cualquier Claude sin organización permitida.
   Al volver a personal, las sesiones personales deben crearse de nuevo bajo las reglas actuales.
4. El bloqueo, la eliminación, la restauración y el cambio de cuaderno invalidarán permisos y
   pruebas ligadas al cuaderno anterior. Las copias conservarán el perfil cifrado, pero nunca
   credenciales de identidad ni sesiones activas. El índice sin contraseña no revelará el perfil.

## Comprobaciones

`tests/service.test.ts` cubre, con un doble de `claude auth status`, la aceptación de Team con
organización permitida y el rechazo sin política, de cuentas Pro, Console o de otro proveedor, de
otra organización, de sesión cerrada, de Codex y de llamadas sin cabecera o con otra organización.
`tests/workspaces.test.ts` comprueba en el dominio el vínculo del permiso con la organización. La
lectura real se ha probado manualmente con Claude Code y una cuenta Team. Queda pendiente la
verificación firmada (ID-JAG) descrita arriba, que no puede sustituirse por un doble de prueba.

## Fuentes de los límites del proveedor

- [Cuentas personales y de organización en Claude](https://support.claude.com/en/articles/9267400-move-your-personal-claude-account-to-a-team-or-enterprise-organization).
- [Configuración empresarial de Claude Desktop: `forceLoginOrgUUID`](https://support.claude.com/en/articles/12622667-enterprise-configuration-for-claude-desktop).
- [Conectores MCP remotos personalizados](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) y [requisito de acceso remoto](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities).
- [Alcance de la restricción por dominio verificado](https://support.claude.com/en/articles/15402193-restrict-verified-domain-connectors-to-your-enterprise).
- [Autorización empresarial gestionada en Claude](https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization), [extensión MCP ID-JAG](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) y [matriz de soporte de clientes](https://modelcontextprotocol.io/extensions/client-matrix).
