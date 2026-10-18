import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyRecordId({ id, title }: { id: string; title: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      type="button"
      className="copy-record-id"
      aria-label="Copiar ID"
      title={status === 'error' ? 'No se pudo copiar el ID' : `Copiar ID de ${title}`}
      onClick={() => void copy()}
    >
      {status === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      <span aria-live="polite">
        {status === 'copied' ? 'ID copiado' : status === 'error' ? 'Error al copiar' : 'Copiar ID'}
      </span>
    </button>
  );
}
