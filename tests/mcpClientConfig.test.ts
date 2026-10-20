import { describe, expect, it } from 'vitest';
import { mcpConfigBlock, mcpInstallCommand } from '../shared/mcpClientConfig';

// Synthetic paths with spaces, as in a default Windows installation.
const launch = {
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  mcpPath: 'C:\\Program Files\\Bitacora\\mcp.cjs',
  dataDir: 'C:\\Users\\persona\\AppData\\Local\\Bitacora',
};

describe('configuración de clientes MCP', () => {
  it('genera el comando de instalación con la sintaxis de cada CLI', () => {
    expect(mcpInstallCommand('claude', launch)).toBe(
      'claude mcp add bitacora --scope user -e BITACORA_PROVIDER=claude -e "BITACORA_DATA_DIR=C:\\Users\\persona\\AppData\\Local\\Bitacora" -- "C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\Bitacora\\mcp.cjs"',
    );
    expect(mcpInstallCommand('codex', launch)).toBe(
      'codex mcp add bitacora --env BITACORA_PROVIDER=codex --env "BITACORA_DATA_DIR=C:\\Users\\persona\\AppData\\Local\\Bitacora" -- "C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\Bitacora\\mcp.cjs"',
    );
    expect(mcpInstallCommand('antigravity', launch)).toBeUndefined();
  });
  it('conserva el bloque de configuración de cada cliente', () => {
    expect(mcpConfigBlock('codex', launch)).toContain('BITACORA_PROVIDER = "codex"');
    expect(mcpConfigBlock('codex', launch)).toContain(`args = [${JSON.stringify(launch.mcpPath)}]`);
    for (const provider of ['claude', 'antigravity'] as const)
      expect(JSON.parse(mcpConfigBlock(provider, launch))).toEqual({
        mcpServers: {
          bitacora: {
            command: launch.nodePath,
            args: [launch.mcpPath],
            env: { BITACORA_PROVIDER: provider, BITACORA_DATA_DIR: launch.dataDir },
          },
        },
      });
  });
});
