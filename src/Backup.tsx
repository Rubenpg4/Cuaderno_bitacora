import { useState } from 'react';
import { Download, Upload, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api, download } from './api';
import { Button, Field, Notice } from './ui';
import type { McpProfile } from '../shared/model';
import { ASVS_VERSION } from '../shared/asvs';
import type { AsvsConfig } from '../shared/asvsTracking';
export default function Backup({
  refresh,
  projectId,
  mcpProfile,
  asvsConfig,
}: {
  refresh: () => Promise<void>;
  projectId: string;
  mcpProfile: McpProfile;
  asvsConfig?: AsvsConfig;
}) {
  const [password, setPassword] = useState(''),
    [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [repeatPassword, setRepeatPassword] = useState(''),
    [restorePass, setRestorePass] = useState(''),
    [file, setFile] = useState<File>(),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [selectedProfile, setSelectedProfile] = useState<McpProfile>(mcpProfile),
    [asvsLevel, setAsvsLevel] = useState(String(asvsConfig?.level ?? '')),
    [busy, setBusy] = useState(false);
  async function changeProfile() {
    setError('');
    setBusy(true);
    try {
      await api('mcp-profile', { profile: selectedProfile });
      await refresh();
      setMessage('Perfil guardado. Se han revocado los permisos MCP y las propuestas pendientes.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAsvs() {
    setError('');
    setBusy(true);
    try {
      await api('asvs-configure', {
        projectId,
        expectedConfigVersion: asvsConfig?.version ?? 0,
        catalogVersion: asvsConfig?.catalogVersion ?? ASVS_VERSION,
        level: asvsLevel ? Number(asvsLevel) : null,
      });
      await refresh();
      setMessage(
        asvsLevel
          ? `ASVS activado en nivel L${asvsLevel}.`
          : 'ASVS desactivado. Se conservan sus datos por si lo reactivas.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    setError('');
    setBusy(true);
    try {
      const r = await api<{ data: string }>('backup', { password });
      await download(
        r.data,
        'application/octet-stream',
        `bitacora-${projectId}-${new Date().toISOString().slice(0, 10)}.backup`,
      );
      setPassword('');
      setMessage('Copia cifrada descargada. Guarda su contraseña por separado.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setError('');
    setBusy(true);
    try {
      if (!file) throw Error('Selecciona una copia.');
      if (file.size > 18 * 1024 * 1024) throw Error('La copia supera 18 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api('restore', { data, password: restorePass, confirm: confirmation });
      setRestorePass('');
      setConfirmation('');
      await refresh();
      setMessage(
        'Copia restaurada. Se han revocado las sesiones y desactivado el uso de IA externa.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePassword() {
    setError('');
    if (newPassword !== repeatPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await api('change-password', { current: currentPassword, next: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setMessage('Contraseña del cuaderno actualizada.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="form-section">
        <h3>Perfil MCP de este cuaderno</h3>
        <Field label="Perfil">
          <select
            value={selectedProfile}
            onChange={(event) => setSelectedProfile(event.target.value as McpProfile)}
          >
            <option value="personal">Personal</option>
            <option value="corporativo">Corporativo</option>
          </select>
        </Field>
        <p className="muted">
          {selectedProfile === 'corporativo'
            ? 'Solo se admitirá Claude Code con sesión en una organización Team o Enterprise incluida en la política corporativa local; Bitácora lo comprueba en este equipo.'
            : 'Permite Claude, Codex y Antigravity con las autorizaciones actuales.'}{' '}
          Cambiar de perfil revoca sesiones, extractos y propuestas pendientes.
        </p>
        <Button
          variant="secondary"
          disabled={busy || selectedProfile === mcpProfile}
          onClick={() => void changeProfile()}
        >
          Guardar perfil
        </Button>
      </section>
      <section className="form-section">
        <h3>
          <ShieldCheck size={18} /> Verificación ASVS
        </h3>
        <Field label="Verificación ASVS de este cuaderno">
          <select value={asvsLevel} onChange={(event) => setAsvsLevel(event.target.value)}>
            <option value="">Desactivada</option>
            <option value="1">L1 — 70 requisitos</option>
            <option value="2">L2 — 253 requisitos</option>
            <option value="3">L3 — 345 requisitos</option>
          </select>
        </Field>
        <p className="muted">
          {asvsLevel
            ? 'Muestra la vista Verificación ASVS, los requisitos en las tareas y las herramientas ASVS de los asistentes.'
            : 'Desactivada, ASVS no aparece en la interfaz ni lo revisan los asistentes MCP. Se conservan evaluaciones, historial y vínculos por si lo reactivas.'}
        </p>
        <Button
          variant="secondary"
          disabled={busy || asvsLevel === String(asvsConfig?.level ?? '')}
          onClick={() => void saveAsvs()}
        >
          Guardar ASVS
        </Button>
      </section>
      <Notice>
        La copia contiene solo el cuaderno abierto y está cifrada. Consérvala fuera del equipo en
        una ubicación autorizada. Solo se puede restaurar en este mismo cuaderno. No hay
        recuperación de contraseña.
      </Notice>
      <section className="form-section">
        <h3>
          <LockKeyhole size={18} /> Crear copia de seguridad
        </h3>
        <Field label="Contraseña de la copia (mínimo 12 caracteres)">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button disabled={password.length < 12 || busy} onClick={() => void backup()}>
          <Download size={16} /> Descargar copia cifrada
        </Button>
      </section>
      <section className="form-section">
        <h3>Cambiar contraseña de este cuaderno</h3>
        <Field label="Contraseña actual">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="Nueva contraseña (mínimo 12 caracteres)">
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label="Repite la nueva contraseña">
          <input
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(event) => setRepeatPassword(event.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={busy || !currentPassword || newPassword.length < 12 || !repeatPassword}
          onClick={() => void changePassword()}
        >
          <LockKeyhole size={16} /> Cambiar contraseña
        </Button>
      </section>
      <section className="form-section">
        <h3>Restaurar una copia</h3>
        <p>Reemplazará los registros actuales. Descarga antes una copia si quieres conservarlos.</p>
        <Field label="Archivo de copia">
          <input
            type="file"
            accept=".backup,.vault"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </Field>
        <Field label="Contraseña de la copia">
          <input
            type="password"
            value={restorePass}
            onChange={(e) => setRestorePass(e.target.value)}
          />
        </Field>
        <Field label="Escribe RESTAURAR para confirmar">
          <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          disabled={confirmation !== 'RESTAURAR' || !file || !restorePass || busy}
          onClick={() => void restore()}
        >
          <Upload size={16} /> Restaurar datos
        </Button>
      </section>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
    </>
  );
}
