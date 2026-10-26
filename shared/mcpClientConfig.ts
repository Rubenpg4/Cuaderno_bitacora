import type { Provider } from './model';

export interface McpLaunch {
  nodePath: string;
  mcpPath: string;
  dataDir: string;
}

/**
 * Tools the connector publishes (`BITACORA_MCP_MODO`): the individual tools, those plus code
 * mode (default), or only code mode. It never changes what the session may read or propose.
 */
export const MCP_MODES = ['herramientas', 'hibrido', 'codigo'] as const;
export type McpMode = (typeof MCP_MODES)[number];
export const DEFAULT_MCP_MODE: McpMode = 'hibrido';
export const MCP_MODE_LABELS: Record<McpMode, string> = {
  herramientas: 'Herramientas individuales',
  hibrido: 'Híbrido: herramientas y modo código (recomendado)',
  codigo: 'Solo modo código',
};
export function parseMcpMode(value: string | undefined): McpMode {
  return MCP_MODES.find((mode) => mode === value) ?? DEFAULT_MCP_MODE;
}

/** The default mode adds no variable, so existing configurations stay valid. */
function modeEnv(mode: McpMode): Record<string, string> {
  return mode === DEFAULT_MCP_MODE ? {} : { BITACORA_MCP_MODO: mode };
}

/** Block to paste into the client's MCP configuration: TOML for Codex, JSON otherwise. */
export function mcpConfigBlock(
  provider: Provider,
  launch: McpLaunch,
  mode: McpMode = DEFAULT_MCP_MODE,
) {
  if (provider === 'codex')
    return [
      '[mcp_servers.bitacora]',
      `command = ${JSON.stringify(launch.nodePath)}`,
      `args = [${JSON.stringify(launch.mcpPath)}]`,
      '',
      '[mcp_servers.bitacora.env]',
      'BITACORA_PROVIDER = "codex"',
      `BITACORA_DATA_DIR = ${JSON.stringify(launch.dataDir)}`,
      ...Object.entries(modeEnv(mode)).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    ].join('\n');
  return JSON.stringify(
    {
      mcpServers: {
        bitacora: {
          command: launch.nodePath,
          args: [launch.mcpPath],
          env: {
            BITACORA_PROVIDER: provider,
            BITACORA_DATA_DIR: launch.dataDir,
            ...modeEnv(mode),
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * One-time install command for clients with a CLI; Antigravity has none. Variables go as
 * separate quoted flags, not as a JSON argument, so it works the same in PowerShell, cmd and
 * POSIX shells. Syntax: `claude mcp add <name> -e KEY=value -- <command>` and
 * `codex mcp add <name> --env KEY=VALUE -- <command>` (each CLI's `--help`).
 */
export function mcpInstallCommand(
  provider: Provider,
  launch: McpLaunch,
  mode: McpMode = DEFAULT_MCP_MODE,
) {
  const quote = (value: string) => `"${value}"`;
  const run = `-- ${quote(launch.nodePath)} ${quote(launch.mcpPath)}`;
  const extra = (flag: string) =>
    Object.entries(modeEnv(mode))
      .map(([key, value]) => ` ${flag} ${key}=${value}`)
      .join('');
  if (provider === 'claude')
    return `claude mcp add bitacora --scope user -e BITACORA_PROVIDER=claude -e ${quote(`BITACORA_DATA_DIR=${launch.dataDir}`)}${extra('-e')} ${run}`;
  if (provider === 'codex')
    return `codex mcp add bitacora --env BITACORA_PROVIDER=codex --env ${quote(`BITACORA_DATA_DIR=${launch.dataDir}`)}${extra('--env')} ${run}`;
  return undefined;
}
