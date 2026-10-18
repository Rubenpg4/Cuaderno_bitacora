import { useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { api, download } from './api';
import { AutoTextarea, Button, Field, Notice } from './ui';
export default function Export({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(format: string) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ data: string; type: string; extension: string }>('export', {
        body,
        format,
        reviewed,
      });
      await download(r.data, r.type, `bitacora-informe-revisado.${r.extension}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Notice>
        El texto de las políticas se excluye de la memoria por defecto. Revisa también nombres,
        referencias, URLs y detalles de las actividades. La exportación saldrá del almacén cifrado.
      </Notice>
      <Field label="Contenido que vas a exportar">
        <AutoTextarea
          className="export-preview"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setReviewed(false);
          }}
        />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>He revisado este contenido para su destinatario y puedo compartirlo.</span>
      </label>
      <div className="row">
        {['md', 'docx', 'pdf'].map((format) => (
          <Button
            key={format}
            variant={format === 'pdf' ? '' : 'secondary'}
            disabled={!reviewed || busy}
            onClick={() => void run(format)}
          >
            <Download size={16} />
            {format === 'md' ? 'Markdown' : format.toUpperCase()}
          </Button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
    </>
  );
}
