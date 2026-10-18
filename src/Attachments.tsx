import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react';
import type { Attachment } from '../shared/model';

const mimeByExtension: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  md: 'text/markdown',
  pdf: 'application/pdf',
};
const maxBytes = 2 * 1024 * 1024;

function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [markdown, setMarkdown] = useState('');
  useEffect(() => {
    const bytes = Uint8Array.from(atob(attachment.data), (character) => character.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
    setUrl(objectUrl);
    if (attachment.mime === 'text/markdown') setMarkdown(new TextDecoder().decode(bytes));
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment.data, attachment.mime]);
  return (
    <li>
      <div className="attachment-heading">
        <span className="attachment-file-icon" aria-hidden="true">
          {attachment.mime.startsWith('image/') ? <ImageIcon size={17} /> : <FileText size={17} />}
        </span>
        <span className="attachment-file-info">
          <a href={url || undefined} target="_blank" rel="noreferrer" download={attachment.name}>
            {attachment.name}
          </a>
          <small>{(attachment.size / 1024).toFixed(0)} KiB</small>
        </span>
        {onRemove && (
          <button
            className="attachment-remove"
            type="button"
            onClick={onRemove}
            aria-label={`Quitar ${attachment.name}`}
            title="Quitar adjunto"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <details>
        <summary>Vista previa</summary>
        {attachment.mime.startsWith('image/') ? (
          <img className="attachment-image" src={url} alt={attachment.name} />
        ) : attachment.mime === 'text/markdown' ? (
          <pre className="attachment-markdown">{markdown}</pre>
        ) : (
          <iframe
            className="attachment-pdf"
            src={url}
            title={`PDF: ${attachment.name}`}
            sandbox="allow-scripts"
          />
        )}
      </details>
    </li>
  );
}

export function Attachments({
  attachments,
  onChange,
}: {
  attachments: Attachment[];
  onChange?: (next: Attachment[]) => void;
}) {
  const [error, setError] = useState('');
  async function add(files: FileList | null) {
    if (!files?.length || !onChange) return;
    setError('');
    try {
      const next = [...attachments];
      for (const file of Array.from(files)) {
        const mime = mimeByExtension[file.name.toLowerCase().split('.').pop() || ''];
        if (!mime || file.size > maxBytes || !file.size)
          throw Error('Usa PNG, JPEG, GIF, WebP, Markdown o PDF de hasta 2 MiB cada uno.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const data = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mime,
          size: file.size,
          data: btoa(data),
        });
      }
      if (next.length > 10 || next.reduce((sum, item) => sum + item.size, 0) > 8 * 1024 * 1024)
        throw Error('Se admiten diez adjuntos y 8 MiB en total.');
      onChange(next);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <section className="attachments">
      <div className="attachments-title">
        <Paperclip size={17} aria-hidden="true" />
        <h3>Adjuntos</h3>
        {onChange && <span className="attachments-count">{attachments.length}/10</span>}
      </div>
      {onChange && (
        <label className={`attachment-upload ${attachments.length >= 10 ? 'is-full' : ''}`}>
          <span className="attachment-upload-icon" aria-hidden="true">
            <Upload size={20} />
          </span>
          <span className="attachment-upload-copy">
            <strong>Añade imágenes y documentos</strong>
            <small>PNG, JPG, GIF, WebP, MD o PDF · 2 MB por archivo · 8 MB en total</small>
          </span>
          <span className="attachment-upload-action">Elegir archivos</span>
          <input
            className="attachment-upload-input"
            type="file"
            multiple
            disabled={attachments.length >= 10}
            accept=".png,.jpg,.jpeg,.gif,.webp,.md,.pdf"
            onChange={(event) => {
              void add(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {attachments.length > 0 && (
        <ul>
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              onRemove={
                onChange
                  ? () => onChange(attachments.filter((item) => item.id !== attachment.id))
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
