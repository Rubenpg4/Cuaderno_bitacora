import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// Verificación local de buena fe: confirma la organización de Claude con la que Claude Code ha
// iniciado sesión en este equipo. No es una prueba firmada; véase docs/perfiles-mcp.md.
export interface ClaudeIdentity {
  orgId: string;
  orgName: string;
  subscriptionType: 'team' | 'enterprise';
}
export type ClaudeAuthStatusReader = (env?: NodeJS.ProcessEnv) => Promise<unknown>;

export const CORPORATE_POLICY_FILE = 'corporate-policy.json';
export const CLAUDE_IDENTITY_HEADER = 'x-bitacora-claude-org';

const authStatus = z.object({
  loggedIn: z.literal(true, {
    errorMap: () => ({ message: 'Claude Code no tiene una sesión iniciada.' }),
  }),
  authMethod: z.literal('claude.ai', {
    errorMap: () => ({ message: 'Claude Code debe iniciar sesión con una cuenta de claude.ai.' }),
  }),
  apiProvider: z.literal('firstParty', {
    errorMap: () => ({ message: 'Claude Code debe usar la API de Anthropic.' }),
  }),
  subscriptionType: z.enum(['team', 'enterprise'], {
    errorMap: () => ({
      message: 'La cuenta de Claude Code no pertenece a un plan Team o Enterprise.',
    }),
  }),
  orgId: z.string().regex(/^[\w-]{8,64}$/, 'Claude Code no informa de su organización.'),
  orgName: z.string().max(200).optional(),
});

export function readClaudeAuthStatus(env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  return new Promise((resolve, reject) =>
    execFile(
      env.BITACORA_CLAUDE_PATH || 'claude',
      ['auth', 'status', '--json'],
      { env, timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(error ?? Error('Respuesta de Claude Code no válida.'));
        }
      },
    ),
  );
}

export function parseClaudeIdentity(raw: unknown): ClaudeIdentity {
  const parsed = authStatus.safeParse(raw);
  if (!parsed.success) throw Error(parsed.error.issues[0].message);
  const { orgId, orgName, subscriptionType } = parsed.data;
  return { orgId, orgName: orgName || orgId, subscriptionType };
}

/** Organizaciones permitidas; política local fuera del vault que la aplicación solo lee. */
export function readCorporatePolicy(dir: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, CORPORATE_POLICY_FILE), 'utf8'));
  } catch {
    return [];
  }
  const parsed = z
    .object({ claudeOrgIds: z.array(z.string().regex(/^[\w-]{8,64}$/)).max(20) })
    .safeParse(raw);
  return parsed.success ? parsed.data.claudeOrgIds : [];
}

export async function verifyCorporateClaude(
  dir: string,
  read: ClaudeAuthStatusReader = readClaudeAuthStatus,
): Promise<ClaudeIdentity> {
  const allowed = readCorporatePolicy(dir);
  if (!allowed.length)
    throw Error(`Falta la política corporativa (${CORPORATE_POLICY_FILE}) en la carpeta de datos.`);
  let raw: unknown;
  try {
    raw = await read();
  } catch {
    throw Error('No se pudo consultar la cuenta de Claude Code.');
  }
  const identity = parseClaudeIdentity(raw);
  if (!allowed.includes(identity.orgId))
    throw Error('La organización de Claude Code no está permitida en la política corporativa.');
  return identity;
}
