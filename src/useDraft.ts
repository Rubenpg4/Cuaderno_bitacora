import { useEffect, useRef, useState } from 'react';
import { api } from './api';

// Los borradores viven en el vault cifrado; el navegador solo conserva el formulario abierto.
export function useDraft(
  key: string,
  initial: Record<string, any>,
  restored?: Record<string, unknown>,
) {
  const [data, rawSetData] = useState<Record<string, any>>(() => restored || initial);
  const [status, setStatus] = useState(restored ? 'Borrador recuperado' : '');
  const latest = useRef(data);
  const revision = useRef(0);
  const persisted = useRef(0);
  const pending = useRef<Promise<void> | undefined>(undefined);

  function setData(
    value: Record<string, any> | ((old: Record<string, any>) => Record<string, any>),
  ) {
    const next = typeof value === 'function' ? value(latest.current) : value;
    latest.current = next;
    revision.current++;
    setStatus('Guardando borrador…');
    rawSetData(next);
  }

  async function flush() {
    if (pending.current) await pending.current;
    if (persisted.current === revision.current) return;
    const submitted = latest.current;
    const current = revision.current;
    pending.current = api('save-draft', { key, data: submitted }).then(() => {
      persisted.current = current;
      if (revision.current === current) setStatus('Borrador guardado en tu equipo');
    });
    try {
      await pending.current;
    } catch (error) {
      setStatus('No se pudo guardar el borrador');
      throw error;
    } finally {
      pending.current = undefined;
    }
    if (persisted.current !== revision.current) await flush();
  }

  function reset(next: Record<string, any>) {
    latest.current = next;
    persisted.current = ++revision.current;
    setStatus('');
    rawSetData(next);
  }

  useEffect(() => {
    if (persisted.current === revision.current) return;
    const timer = setTimeout(() => void flush().catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => {
    function guard(event: BeforeUnloadEvent) {
      if (persisted.current !== revision.current || pending.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  useEffect(() => () => void flush().catch(() => {}), []);
  return { data, setData, flush, reset, status };
}
