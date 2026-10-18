<!-- doc:summary: Diseño de perfiles MCP por cuaderno y requisitos de verificación de identidad corporativa. -->
# Perfiles MCP por cuaderno (diseño)

La elección, persistencia y edición de perfiles ya están implementadas. **El acceso MCP del perfil
corporativo permanece bloqueado** hasta contar con una prueba verificable de la cuenta de Claude.
Actualmente `service/mcp.ts` usa stdio y envía a `service/server.ts` un token de sesión de
Bitácora. Ese token acredita un permiso sobre el cuaderno, pero no la identidad de la cuenta de
Claude que inició el proceso. `service/domain.ts` admite Claude, Codex y Antigravity cuando existe
la autorización local de empresa.

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
- El valor persistido expresa la política elegida, **no** que Claude haya superado la verificación.
  Un cuaderno corporativo puede existir sin habilitar su MCP mientras falte esa prueba.

## Regla corporativa y frontera de confianza

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

Por tanto, **la implementación actual no puede activar de forma segura el MCP corporativo**. El
servicio deniega todos los permisos corporativos hasta disponer de un emisor y un canal con la
garantía anterior.
No se sustituirá esa prueba con una comprobación local de la configuración de Claude, una cabecera
enviada por el cliente o un token que el cliente pueda copiar a otra cuenta.

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
3. En corporativo, Asistentes oculta el formulario de conexión y el servidor rechaza permisos para
   todos los proveedores, incluido Claude hasta la verificación corporativa. Al volver a personal,
   las sesiones personales deben crearse de nuevo bajo las reglas actuales.
4. El bloqueo, la eliminación, la restauración y el cambio de cuaderno invalidarán permisos y
   pruebas ligadas al cuaderno anterior. Las copias conservarán el perfil cifrado, pero nunca
   credenciales de identidad ni sesiones activas. El índice sin contraseña no revelará el perfil.

## Comprobación pendiente para habilitar el MCP corporativo

Quedan por implementar y probar la aceptación de la cuenta corporativa de Claude y el rechazo de
cuentas personales, de otra organización, pruebas caducadas y llamadas sin prueba. La prueba
corporativa deberá usar un mecanismo documentado y
verificable del proveedor, no un doble de prueba como única evidencia de la identidad real.

## Fuentes de los límites del proveedor

- [Cuentas personales y de organización en Claude](https://support.claude.com/en/articles/9267400-move-your-personal-claude-account-to-a-team-or-enterprise-organization).
- [Configuración empresarial de Claude Desktop: `forceLoginOrgUUID`](https://support.claude.com/en/articles/12622667-enterprise-configuration-for-claude-desktop).
- [Conectores MCP remotos personalizados](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) y [requisito de acceso remoto](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities).
- [Alcance de la restricción por dominio verificado](https://support.claude.com/en/articles/15402193-restrict-verified-domain-connectors-to-your-enterprise).
- [Autorización empresarial gestionada en Claude](https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization), [extensión MCP ID-JAG](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) y [matriz de soporte de clientes](https://modelcontextprotocol.io/extensions/client-matrix).
