import type { Kind, RecordItem, Snapshot } from '../shared/model';
let connection: Promise<{ url: string; token: string }>;
function connect() {
  return (connection ||= (async () => {
    if ('__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      const c = await invoke<{ port: number; token: string }>('connection');
      return { url: `http://127.0.0.1:${c.port}`, token: c.token };
    }
    const token =
      new URLSearchParams(location.hash.slice(1)).get('session') ||
      (() => {
        try {
          return sessionStorage.getItem('bitacora-session-token') || '';
        } catch {
          return '';
        }
      })() ||
      import.meta.env.VITE_SESSION_TOKEN ||
      '';
    if (location.hash) history.replaceState(null, '', location.pathname);
    if (token) {
      try {
        sessionStorage.setItem('bitacora-session-token', token);
      } catch {
        // Ignora si sessionStorage no está disponible
      }
    }
    return { url: import.meta.env.VITE_SERVICE_URL || location.origin, token };
  })());
}
export async function api<T = unknown>(action: string, data?: unknown): Promise<T> {
  const c = await connect();
  const r = await fetch(`${c.url}/api/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    ...(action === 'status' ? {} : { body: JSON.stringify(data || {}) }),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || 'No se pudo completar la operación.');
  return result;
}
export function saveRecord(
  kind: Kind,
  data: Record<string, unknown>,
  original?: RecordItem,
  draftKey?: string,
) {
  return api<RecordItem>('save', {
    kind,
    data,
    id: original?.id,
    expectedVersion: original?.version,
    draftKey,
  });
}
export const getSnapshot = () => api<Snapshot>('snapshot');
export async function download(data: string, type: string, name: string) {
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('save_document', { data, name });
  }
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
