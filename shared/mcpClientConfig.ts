import type { Provider } from './model';

export interface McpLaunch {
  nodePath: string;
  mcpPath: string;
  dataDir: string;
}

/** Block to paste into the client's MCP configuration: TOML for Codex, JSON otherwise. */
export function mcpConfigBlock(provider: Provider, launch: McpLaunch) {
  if (provider === 'codex')
    return [
      '[mcp_servers.bitacora]',
      `command = ${JSON.stringify(launch.nodePath)}`,
      `args = [${JSON.stringify(launch.mcpPath)}]`,
      '',
      '[mcp_servers.bitacora.env]',
      'BITACORA_PROVIDER = "codex"',
      `BITACORA_DATA_DIR = ${JSON.stringify(launch.dataDir)}`,
    ].join('\n');
  return JSON.stringify(
    {
      mcpServers: {
        bitacora: {
          command: launch.nodePath,
          args: [launch.mcpPath],
          env: { BITACORA_PROVIDER: provider, BITACORA_DATA_DIR: launch.dataDir },
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
export function mcpInstallCommand(provider: Provider, launch: McpLaunch) {
  const quote = (value: string) => `"${value}"`;
  const run = `-- ${quote(launch.nodePath)} ${quote(launch.mcpPath)}`;
  if (provider === 'claude')
    return `claude mcp add bitacora --scope user -e BITACORA_PROVIDER=claude -e ${quote(`BITACORA_DATA_DIR=${launch.dataDir}`)} ${run}`;
  if (provider === 'codex')
    return `codex mcp add bitacora --env BITACORA_PROVIDER=codex --env ${quote(`BITACORA_DATA_DIR=${launch.dataDir}`)} ${run}`;
  return undefined;
}
