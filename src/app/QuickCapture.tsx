import { useEffect, useRef, useState } from 'react';
import { Inbox, NotebookPen, Plus, Trash2 } from 'lucide-react';
import type { Kind, QuickCapture, RecordItem } from '../../shared/model';
import { api } from '../api';
import { AutoTextarea, Button, Field, Modal, Notice } from '../ui';

const conversionKinds: { kind: 'entry' | 'incident' | 'decision' | 'idea'; label: string }[] = [
  { kind: 'entry', label: 'Entrada' },
  { kind: 'incident', label: 'Incidencia' },
  { kind: 'decision', label: 'Decisión' },
  { kind: 'idea', label: 'Idea' },
];

export function QuickCaptureButton({
  onClick,
  count,
  locked = false,
}: {
  onClick: () => void;
  count?: number;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      className="quick-capture-button"
      onClick={onClick}
      aria-label={locked ? 'Captura rápida: desbloquear' : 'Captura rápida'}
      title={
        locked
          ? 'Desbloquea el cuaderno para capturar'
          : '__TAURI_INTERNALS__' in window
            ? 'Captura rápida · Ctrl+Mayús+B'
            : 'Captura rápida'
      }
    >
      <NotebookPen size={22} aria-hidden="true" />
      <span>Captura rápida</span>
      {!!count && <span className="quick-capture-count">{count}</span>}
    </button>
  );
}

export default function QuickCapture({
  captures,
  records,
  onClose,
  onRefresh,
  onConvert,
}: {
  captures: QuickCapture[];
  records: RecordItem[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onConvert: (capture: QuickCapture, kind: Kind) => void;
}) {
  const [view, setView] = useState<'compose' | 'inbox'>('compose');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const textRef = useRef('');
  const savedText = useRef('');
  const captureRef = useRef<QuickCapture | undefined>(undefined);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const visible = captures.filter((capture) => !capture.convertedRecordId);

  function changeText(value: string) {
    textRef.current = value;
    setText(value);
    setError('');
    setStatus(value === savedText.current ? 'Guardado en el vault cifrado' : 'Guardando…');
  }

  async function flush(): Promise<QuickCapture | undefined> {
    if (pending.current) {
      await pending.current;
      return flush();
    }
    if (textRef.current === savedText.current) return captureRef.current;
    const currentText = textRef.current;
    if (!currentText.trim()) {
      if (captureRef.current)
        throw Error('El apunte no puede quedar vacío. Descártalo desde la bandeja.');
      return undefined;
    }
    const request = (async () => {
      const capture = captureRef.current
        ? await api<QuickCapture>('capture-update', {
            id: captureRef.current.id,
            expectedVersion: captureRef.current.version,
            text: currentText,
          })
        : await api<QuickCapture>('capture-create', { text: currentText });
      captureRef.current = capture;
      savedText.current = currentText;
      setStatus('Guardado en el vault cifrado');
      await onRefresh();
    })();
    pending.current = request;
    try {
      await request;
    } catch (cause) {
      setStatus('No se pudo guardar');
      throw cause;
    } finally {
      pending.current = undefined;
    }
    if (textRef.current !== savedText.current) return flush();
    return captureRef.current;
  }

  useEffect(() => {
    if (!text.trim() || text === savedText.current) return;
    const timer = setTimeout(() => void flush().catch((cause) => setError(cause.message)), 500);
    return () => clearTimeout(timer);
  }, [text]);

  async function finish(next?: 'inbox') {
    setError('');
    try {
      await flush();
      if (next === 'inbox') setView('inbox');
      else onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function edit(capture: QuickCapture) {
    captureRef.current = capture;
    savedText.current = capture.text;
    textRef.current = capture.text;
    setText(capture.text);
    setStatus('Guardado en el vault cifrado');
    setError('');
    setView('compose');
  }

  function newCapture() {
    captureRef.current = undefined;
    savedText.current = '';
    textRef.current = '';
    setText('');
    setStatus('');
    setError('');
    setView('compose');
  }
  async function startNew() {
    setError('');
    try {
      await flush();
      newCapture();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function changeLink(capture: QuickCapture, recordId: string) {
    setBusyId(capture.id);
    setError('');
    try {
      await api('capture-link', { id: capture.id, expectedVersion: capture.version, recordId });
      await onRefresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function discard(capture: QuickCapture) {
    if (!window.confirm('¿Descartar este apunte? Esta acción no se puede deshacer.')) return;
    setBusyId(capture.id);
    setError('');
    try {
      await api('capture-discard', { id: capture.id, expectedVersion: capture.version });
      await onRefresh();
      if (captureRef.current?.id === capture.id) newCapture();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <Modal
      title={view === 'compose' ? 'Captura rápida' : 'Bandeja de entrada'}
      onClose={() => void finish()}
      wide
    >
      <div className="quick-capture-tabs">
        <button
          type="button"
          aria-current={view === 'compose' ? 'page' : undefined}
          onClick={() => void startNew()}
        >
          <Plus size={16} /> Nuevo apunte
        </button>
        <button
          type="button"
          aria-current={view === 'inbox' ? 'page' : undefined}
          onClick={() => void finish('inbox')}
        >
          <Inbox size={16} /> Bandeja ({visible.length})
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {view === 'compose' ? (
        <div className="quick-capture-compose">
          <p>Escribe ahora. Clasifica el apunte cuando tengas tiempo.</p>
          <Field label="Apunte">
            <AutoTextarea
              value={text}
              onChange={(event) => changeText(event.target.value)}
              rows={6}
              maxLength={8000}
              data-initial-focus
              placeholder="Una idea, incidencia, acuerdo o avance…"
            />
          </Field>
          <div className="quick-capture-footer">
            <span role="status">{status}</span>
            <Button onClick={() => void finish()}>Guardar apunte</Button>
          </div>
        </div>
      ) : visible.length ? (
        <div className="quick-capture-list">
          {visible.map((capture) => (
            <article className="quick-capture-item" key={capture.id}>
              <div className="quick-capture-item-head">
                <time dateTime={capture.createdAt}>
                  {new Date(capture.createdAt).toLocaleString('es-ES')}
                </time>
                <button type="button" onClick={() => edit(capture)}>
                  Editar
                </button>
              </div>
              <p>{capture.text}</p>
              <Field label="Vincular con un registro">
                <select
                  value={capture.linkedRecordId || ''}
                  disabled={busyId === capture.id}
                  onChange={(event) => void changeLink(capture, event.target.value)}
                >
                  <option value="">Sin vínculo</option>
                  {records
                    .filter((record) => record.kind !== 'project')
                    .map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.title}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="quick-capture-item-actions">
                {conversionKinds.map(({ kind, label }) => (
                  <button type="button" key={kind} onClick={() => onConvert(capture, kind)}>
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="quick-capture-discard"
                  aria-label="Descartar apunte"
                  disabled={busyId === capture.id}
                  onClick={() => void discard(capture)}
                >
                  <Trash2 size={16} /> Descartar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="quick-capture-empty">La bandeja está vacía. Tus apuntes aparecerán aquí.</p>
      )}
    </Modal>
  );
}
