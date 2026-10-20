/**
 * Contract version between the stdio connector and the local service. Raise it whenever a
 * response or input changes shape, so a client still running an older connector is told to
 * restart instead of misreading the new contract.
 */
export const MCP_PROTOCOL_VERSION = 2;
export const MCP_PROTOCOL_HEADER = 'X-Bitacora-Mcp-Protocol';
/** Service action → tool name shown to the person as the session's last use. */
export const MCP_ACTION_TOOLS: Record<string, string> = {
  session: 'estado_sesion',
  context: 'buscar_contexto',
  read: 'leer_elementos',
  criteria: 'consultar_criterios',
  filter: 'filtrar_registros',
  summary: 'resumir_proyecto',
  'task-quality': 'diagnosticar_tareas',
  relations: 'consultar_relaciones',
  propose: 'proponer_cambios',
  'propose-delete': 'proponer_eliminacion',
  proposals: 'consultar_propuestas',
  'complete-task': 'completar_tarea',
  'asvs-query': 'consultar_asvs',
  'asvs-read': 'leer_referencias_asvs',
  'asvs-propose': 'proponer_evaluacion_asvs',
  'asvs-task-criteria': 'consultar_criterios_asvs',
  'asvs-task-propose': 'proponer_verificacion_asvs',
  'asvs-remediation': 'planificar_remediacion_asvs',
  'asvs-revision-propose': 'proponer_revision_asvs',
};
export const MCP_PROTOCOL_MISMATCH =
  'El conector MCP y Bitácora son de versiones distintas. Reinicia el cliente MCP o recarga su configuración y repite la consulta.';
