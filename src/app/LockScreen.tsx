import { useEffect, useState } from 'react';
import { BookOpen, LockKeyhole, NotebookPen, ShieldCheck } from 'lucide-react';
import type { McpProfile, WorkspaceStatus } from '../../shared/model';
import { Badge, Button, Field, Notice } from '../ui';
import ThemeToggle from './ThemeToggle';

interface LockScreenProps {
  status?: WorkspaceStatus;
  selectedWorkspace: string;
  setSelectedWorkspace: (value: string) => void;
  workspaceTitle: string;
  setWorkspaceTitle: (value: string) => void;
  workspaceProfile: McpProfile;
  setWorkspaceProfile: (value: McpProfile) => void;
  password: string;
  repeat: string;
  error: string;
  busy: boolean;
  setPassword: (value: string) => void;
  setRepeat: (value: string) => void;
  unlock: () => Promise<void>;
  createWorkspace: () => Promise<void>;
  removeWorkspace: () => Promise<void>;
}

export default function LockScreen({
  status,
  selectedWorkspace,
  setSelectedWorkspace,
  workspaceTitle,
  setWorkspaceTitle,
  workspaceProfile,
  setWorkspaceProfile,
  password,
  repeat,
  error,
  busy,
  setPassword,
  setRepeat,
  unlock,
  createWorkspace,
  removeWorkspace,
}: LockScreenProps) {
  const [mode, setMode] = useState<'open' | 'create' | 'delete'>('open');
  const [confirmation, setConfirmation] = useState('');
  const creating = mode === 'create' || !status?.projects.length;
  const deleting = mode === 'delete' && !creating;
  const selected = status?.projects.find((project) => project.id === selectedWorkspace);

  useEffect(() => {
    setMode('open');
    setConfirmation('');
  }, [selectedWorkspace]);

  function changeMode(next: 'open' | 'create' | 'delete') {
    setPassword('');
    setRepeat('');
    setConfirmation('');
    setMode(next);
  }

  return (
    <div className="lock-screen">
      <div className="lock-theme-toggle">
        <ThemeToggle />
      </div>
      <div className="lock-story">
        <div className="brand">
          <BookOpen size={29} />
          <strong>
            bitácora<span>Tu trabajo, con perspectiva</span>
          </strong>
        </div>
        <div>
          <span className="lock-illustration">
            <NotebookPen size={62} strokeWidth={1} />
            <span />
            <span />
            <span />
          </span>
          <h1>
            Lo que haces hoy.
            <br />
            Lo que podrás contar mañana.
          </h1>
          <p>Un lugar para tus avances, tus decisiones y todo lo que estás aprendiendo.</p>
        </div>
        <span className="lock-foot">
          <ShieldCheck size={17} /> Local · Cifrada · Bajo tu control
        </span>
      </div>
      <main className="unlock-card">
        <Badge tone="blue">Cuadernos independientes</Badge>
        <h2>
          {creating ? 'Crea un cuaderno.' : deleting ? 'Eliminar cuaderno.' : 'Abre tu cuaderno.'}
        </h2>
        <p>
          {creating
            ? 'Cada cuaderno tiene su propia contraseña y archivo cifrado.'
            : deleting
              ? 'Esta operación elimina el cuaderno seleccionado y sus registros.'
              : 'Selecciona un cuaderno e introduce su contraseña.'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (deleting) void removeWorkspace();
            else if (creating) void createWorkspace();
            else void unlock();
          }}
        >
          {!creating && (
            <Field label="Cuaderno">
              <select
                value={selectedWorkspace}
                onChange={(event) => {
                  setSelectedWorkspace(event.target.value);
                  setPassword('');
                }}
                required
              >
                {status?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {creating && (
            <Field label="Nombre del cuaderno">
              <input
                autoFocus
                value={workspaceTitle}
                onChange={(event) => setWorkspaceTitle(event.target.value)}
                maxLength={240}
                required
              />
            </Field>
          )}
          {creating && (
            <Field label="Perfil MCP del cuaderno">
              <select
                value={workspaceProfile}
                onChange={(event) => setWorkspaceProfile(event.target.value as McpProfile)}
              >
                <option value="personal">Personal</option>
                <option value="corporativo">Corporativo</option>
              </select>
              <small>
                {workspaceProfile === 'corporativo'
                  ? 'Solo Claude Code con sesión en una organización permitida por la política corporativa local podrá conectarse.'
                  : 'Permite elegir Claude, Codex o Antigravity con las autorizaciones actuales.'}
              </small>
            </Field>
          )}
          <Field label="Contraseña">
            <input
              autoFocus={!creating}
              type="password"
              minLength={creating ? 12 : 1}
              autoComplete={creating ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {creating && (
            <Field label="Repite la contraseña">
              <input
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                required
              />
              <small>Al menos 12 caracteres. No existe recuperación de contraseña.</small>
            </Field>
          )}
          {deleting && (
            <Field label="Escribe ELIMINAR para confirmar">
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          )}
          {selected?.id === 'legacy' && !deleting && (
            <Notice>
              Al abrir este cuaderno se migrarán sus proyectos a archivos cifrados separados. Se
              creará una copia cifrada previa y se conservará el vault anterior para recuperar
              datos. Guarda además una copia cifrada fuera del equipo antes de actualizar.
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
          <Button
            type="submit"
            disabled={busy || !status || (deleting && confirmation !== 'ELIMINAR')}
          >
            <LockKeyhole size={17} />
            {busy
              ? 'Procesando…'
              : deleting
                ? 'Eliminar cuaderno'
                : creating
                  ? 'Crear mi bitácora'
                  : 'Desbloquear bitácora'}
          </Button>
        </form>
        {!!status?.projects.length && (
          <div className="row">
            {mode !== 'open' && (
              <Button variant="ghost" onClick={() => changeMode('open')}>
                Volver a abrir
              </Button>
            )}
            {mode !== 'create' && (
              <Button variant="ghost" onClick={() => changeMode('create')}>
                Crear otro cuaderno
              </Button>
            )}
            {mode !== 'delete' && selected?.id !== 'legacy' && (
              <Button variant="ghost danger" onClick={() => changeMode('delete')}>
                Eliminar este cuaderno
              </Button>
            )}
          </div>
        )}
        <p className="privacy-note">
          Cambiar de cuaderno requiere cerrar la sesión. La IA externa permanece desactivada hasta
          que autorices su uso en el cuaderno abierto.
        </p>
        {!status && !error && <p role="status">Conectando con el servicio local…</p>}
      </main>
    </div>
  );
}
