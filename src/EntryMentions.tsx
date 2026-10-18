import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ENTRY_MENTION_PATTERN, type RecordItem } from '../shared/model';
export { mentionSummaryText } from '../shared/model';

export type MentionedRecord = Extract<
  RecordItem,
  { kind: 'task' | 'incident' | 'decision' | 'idea' }
>;

const labels = {
  task: 'Tarea',
  incident: 'Incidencia',
  decision: 'Decisión',
  idea: 'Idea',
} as const;
const kinds = ['incident', 'task', 'decision', 'idea'] as const;

function summary(record: MentionedRecord) {
  switch (record.kind) {
    case 'task':
      return `${record.state} · ${record.due}${record.description ? ` · ${record.description}` : ''}`;
    case 'incident':
      return `${record.date} · ${record.solution || record.description || 'Sin descripción'}`;
    case 'decision':
      return `${record.date} · ${record.decision || record.problem || 'Sin descripción'}`;
    case 'idea':
      return `${record.date} · ${record.description || 'Sin descripción'}`;
  }
}

function findRecord(records: RecordItem[], kind: string, id: string) {
  return records.find(
    (record): record is MentionedRecord => record.id === id && record.kind === kind,
  );
}

function mentionNode(kind: string, id: string, records: RecordItem[]) {
  const record = findRecord(records, kind, id);
  const span = document.createElement('span');
  span.className = `entry-mention ${record ? '' : 'missing'}`;
  span.contentEditable = 'false';
  span.dataset.mention = `@[${kind}:${id}]`;
  span.dataset.recordId = id;
  span.textContent = `@${record?.title || 'Registro eliminado'}`;
  const card = document.createElement('span');
  card.className = 'entry-mention-card';
  card.textContent = record
    ? `${labels[record.kind]} · ${record.title}\n${summary(record)}\nCtrl + clic para abrir`
    : 'Este registro ya no existe';
  span.append(card);
  return span;
}

function setEditorValue(editor: HTMLElement, value: string, records: RecordItem[]) {
  editor.replaceChildren();
  let previous = 0;
  for (const match of value.matchAll(ENTRY_MENTION_PATTERN)) {
    const index = match.index ?? 0;
    editor.append(document.createTextNode(value.slice(previous, index)));
    editor.append(mentionNode(match[1], match[2], records));
    previous = index + match[0].length;
  }
  editor.append(document.createTextNode(value.slice(previous)));
}

function editorValue(editor: HTMLElement) {
  function read(node: Node): string {
    if (node instanceof HTMLElement && node.dataset.mention) return node.dataset.mention;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeName === 'BR') return '\n';
    return [...node.childNodes].map(read).join('');
  }
  return [...editor.childNodes].map(read).join('');
}

function openMention(
  event: MouseEvent<HTMLElement>,
  records: RecordItem[],
  onOpen: (record: MentionedRecord) => void,
) {
  if (!event.ctrlKey && !event.metaKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const id = target.closest<HTMLElement>('[data-record-id]')?.dataset.recordId;
  const record = records.find(
    (item): item is MentionedRecord => item.id === id && kinds.some((kind) => kind === item.kind),
  );
  if (record) {
    event.preventDefault();
    event.stopPropagation();
    onOpen(record);
  }
}

export function MentionText({
  value,
  records,
  onOpen,
}: {
  value: string;
  records: RecordItem[];
  onOpen: (record: MentionedRecord) => void;
}) {
  const parts = [];
  let previous = 0;
  for (const match of value.matchAll(ENTRY_MENTION_PATTERN)) {
    parts.push(value.slice(previous, match.index ?? 0));
    const record = findRecord(records, match[1], match[2]);
    parts.push(
      <span
        className={`entry-mention ${record ? '' : 'missing'}`}
        data-record-id={match[2]}
        key={`${match.index ?? 0}-${match[2]}`}
        tabIndex={record ? 0 : undefined}
        onClick={(event) => openMention(event, records, onOpen)}
        onKeyDown={(event) => {
          if (record && event.key === 'Enter') onOpen(record);
        }}
      >
        @{record?.title || 'Registro eliminado'}
        <span className="entry-mention-card">
          {record
            ? `${labels[record.kind]} · ${record.title}\n${summary(record)}\nCtrl + clic para abrir`
            : 'Este registro ya no existe'}
        </span>
      </span>,
    );
    previous = (match.index ?? 0) + match[0].length;
  }
  parts.push(value.slice(previous));
  return <span className="entry-mention-text">{parts}</span>;
}

type Trigger = { node: Text; start: number; end: number; query: string };

export function MentionEditor({
  value,
  onChange,
  records,
  onOpen,
  rows = 2,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  records: RecordItem[];
  onOpen: (record: MentionedRecord) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const trigger = useRef<Trigger | null>(null);
  const [menu, setMenu] = useState<'kinds' | 'records' | ''>('');
  const [kind, setKind] = useState<(typeof kinds)[number]>('task');
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (editor.current && editorValue(editor.current) !== value) {
      setEditorValue(editor.current, value, records);
    }
  }, [value, records]);

  const choices = records.filter(
    (record): record is MentionedRecord =>
      record.kind === kind &&
      record.title.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')),
  );

  function inspectCaret() {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!(node instanceof Text) || !editor.current?.contains(node)) {
      trigger.current = null;
      setMenu('');
      return;
    }
    const before = node.data.slice(0, selection?.anchorOffset);
    const match = /(?:^|\s)@([^@\n]*)$/.exec(before);
    if (!match) {
      trigger.current = null;
      setMenu('');
      return;
    }
    const found = match[1];
    trigger.current = {
      node,
      start: before.length - found.length - 1,
      end: before.length,
      query: found,
    };
    setQuery(found.trim());
    setActive(0);
    setMenu((current) => (current === 'records' ? current : 'kinds'));
  }

  function insert(record: MentionedRecord) {
    const current = trigger.current;
    if (!current || !current.node.isConnected || !editor.current) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(current.node, current.start);
    range.setEnd(current.node, current.end);
    range.deleteContents();
    const mention = mentionNode(record.kind, record.id, records);
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(mention);
    range.setStart(space, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    onChange(editorValue(editor.current));
    trigger.current = null;
    setMenu('');
    editor.current.focus();
  }

  function insertPlainText(value: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.current) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(value);
    range.insertNode(node);
    range.setStart(node, value.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    onChange(editorValue(editor.current));
    inspectCaret();
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!menu && event.key === 'Enter') {
      event.preventDefault();
      insertPlainText('\n');
      return;
    }
    if (!menu) return;
    const count = menu === 'kinds' ? kinds.length : choices.length;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu('');
    } else if (count && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter' && count) {
      event.preventDefault();
      if (menu === 'kinds') {
        setKind(kinds[active]);
        setActive(0);
        setMenu('records');
      } else insert(choices[active]);
    }
  }

  return (
    <div className="mention-editor-wrap">
      <div
        ref={editor}
        className="mention-editor"
        contentEditable
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        data-placeholder={placeholder}
        style={{ minHeight: `${rows * 1.5 + 1}em` }}
        onInput={() => {
          if (editor.current) onChange(editorValue(editor.current));
          inspectCaret();
        }}
        onClick={(event) => openMention(event, records, onOpen)}
        onKeyDown={handleKey}
        onKeyUp={inspectCaret}
        onPaste={(event) => {
          event.preventDefault();
          insertPlainText(event.clipboardData.getData('text/plain'));
        }}
      />
      {menu && (
        <div className="mention-menu" role="listbox" aria-label="Vincular registro">
          <strong>
            {menu === 'kinds' ? 'Elige el tipo de registro' : `Busca ${labels[kind].toLowerCase()}`}
          </strong>
          {menu === 'kinds'
            ? kinds.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  key={option}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setKind(option);
                    setActive(0);
                    setMenu('records');
                  }}
                >
                  {labels[option]}
                </button>
              ))
            : choices.slice(0, 12).map((record, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  key={record.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(record)}
                >
                  {record.title}
                </button>
              ))}
          {menu === 'records' && !choices.length && <small>No hay registros que coincidan.</small>}
        </div>
      )}
    </div>
  );
}
