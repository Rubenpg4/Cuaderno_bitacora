import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Code2, Eye } from 'lucide-react';
import type { RecordItem } from '../shared/model';
import type { MentionedRecord } from './EntryMentions';
import { Markdown } from './Markdown';
import { AutoTextarea } from './ui';

/**
 * Campo de texto largo que se muestra compilado como Markdown y alterna con
 * su editor. Empieza en modo visual salvo que el texto esté vacío.
 */
export function MarkdownField({
  label,
  value,
  children,
  records,
  onOpenRecord,
}: {
  label: string;
  value: string;
  /** Editor del campo (área de texto o editor de menciones). */
  children: ReactNode;
  records?: RecordItem[];
  onOpenRecord?: (record: MentionedRecord) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const [editing, setEditing] = useState(() => !value.trim());
  const body = useRef<HTMLDivElement>(null);
  const focusEditor = useRef(false);

  useEffect(() => {
    if (!editing || !focusEditor.current) return;
    focusEditor.current = false;
    const editor = body.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    editor?.focus();
    if (editor instanceof HTMLTextAreaElement)
      editor.setSelectionRange(editor.value.length, editor.value.length);
  }, [editing]);

  const toggle = () => {
    focusEditor.current = !editing;
    setEditing((current) => !current);
  };
  const editor =
    isValidElement(children) && (children.type === 'textarea' || children.type === AutoTextarea)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id,
          'aria-label': label,
        })
      : children;

  return (
    <div className={`field markdown-field ${editing ? 'is-editing' : 'is-visual'}`}>
      <div className="markdown-field-head">
        {editing ? (
          <label htmlFor={id} id={labelId}>
            {label}
          </label>
        ) : (
          <span className="markdown-field-label" id={labelId}>
            {label}
          </span>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={editing}
          aria-label="Editar en Markdown"
          aria-describedby={labelId}
          title={editing ? 'Ver el resultado' : 'Editar el texto Markdown'}
          className="markdown-switch"
          onClick={toggle}
        >
          <span className="markdown-switch-option" data-active={!editing}>
            <Eye size={13} aria-hidden="true" /> Visual
          </span>
          <span className="markdown-switch-option" data-active={editing}>
            <Code2 size={13} aria-hidden="true" /> Editor
          </span>
        </button>
      </div>
      <div className="markdown-field-body" ref={body}>
        {editing ? (
          editor
        ) : value.trim() ? (
          <div
            className="markdown-view"
            role="group"
            aria-labelledby={labelId}
            onDoubleClick={toggle}
          >
            <Markdown source={value} records={records} onOpenRecord={onOpenRecord} />
          </div>
        ) : (
          <button type="button" className="markdown-view markdown-empty" onClick={toggle}>
            Sin contenido. Pulsa para escribir.
          </button>
        )}
      </div>
    </div>
  );
}
