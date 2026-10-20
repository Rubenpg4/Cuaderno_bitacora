import { useMemo, type ReactNode } from 'react';
import type { RecordItem } from '../shared/model';
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '../shared/markdown';
import { MentionText, type MentionedRecord } from './EntryMentions';

type MentionOptions = {
  records?: RecordItem[];
  onOpenRecord?: (record: MentionedRecord) => void;
  /** Sin enlaces ni controles: para vistas previas dentro de botones o tarjetas. */
  compact?: boolean;
};

function mentionTitle(kind: string, id: string, records?: RecordItem[]) {
  const record = records?.find((item) => item.id === id && item.kind === kind);
  return record ? `@${record.title}` : '@registro';
}

function renderInline(nodes: MarkdownInline[], options: MentionOptions): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'break':
        return options.compact ? ' ' : <br key={index} />;
      case 'strong':
        return <strong key={index}>{renderInline(node.children, options)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children, options)}</em>;
      case 'del':
        return <del key={index}>{renderInline(node.children, options)}</del>;
      case 'code':
        return <code key={index}>{node.value}</code>;
      case 'link':
        return options.compact ? (
          <span className="md-link" key={index}>
            {renderInline(node.children, options)}
          </span>
        ) : (
          <a href={node.href} target="_blank" rel="noopener noreferrer" key={index}>
            {renderInline(node.children, options)}
          </a>
        );
      case 'mention':
        return options.records && options.onOpenRecord ? (
          <MentionText
            key={index}
            value={`@[${node.kind}:${node.id}]`}
            records={options.records}
            onOpen={options.onOpenRecord}
          />
        ) : (
          <span className="entry-mention" key={index}>
            {mentionTitle(node.kind, node.id, options.records)}
          </span>
        );
    }
  });
}

function TaskMark({ checked }: { checked: boolean }) {
  return (
    <span className={`md-task-mark ${checked ? 'checked' : ''}`} aria-hidden="true">
      {checked ? '✓' : ''}
    </span>
  );
}

function renderBlock(block: MarkdownBlock, key: number, options: MentionOptions): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3';
      return (
        <Tag key={key} className={`md-heading md-h${block.level}`}>
          {renderInline(block.children, options)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.children, options)}</p>;
    case 'code':
      return (
        <pre key={key} data-lang={block.lang || undefined}>
          <code>{block.value}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={key}>
          {block.children.map((child, index) => renderBlock(child, index, options))}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} />;
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} className={item.checked === undefined ? undefined : 'md-task'}>
          {item.checked !== undefined && (
            <>
              <TaskMark checked={item.checked} />
              <span className="sr-only">{item.checked ? 'Hecho: ' : 'Pendiente: '}</span>
            </>
          )}
          <div className="md-item-body">
            {item.children.map((child, position) => renderBlock(child, position, options))}
          </div>
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'table':
      return (
        <div className="md-table" key={key}>
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                    {renderInline(cell, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                      {renderInline(cell, options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Markdown completo con títulos, listas, tablas, citas y bloques de código. */
export function Markdown({
  source,
  records,
  onOpenRecord,
  className = '',
}: {
  source: string;
  records?: RecordItem[];
  onOpenRecord?: (record: MentionedRecord) => void;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={`markdown-body ${className}`.trim()}>
      {blocks.map((block, index) => renderBlock(block, index, { records, onOpenRecord }))}
    </div>
  );
}

function previewBlock(block: MarkdownBlock, options: MentionOptions): ReactNode[] {
  switch (block.type) {
    case 'heading':
      return [<strong key="h">{renderInline(block.children, options)}</strong>];
    case 'paragraph':
      return renderInline(block.children, options);
    case 'code':
      return [<code key="c">{block.value.replace(/\s+/g, ' ')}</code>];
    case 'quote':
      return block.children.flatMap((child) => previewBlock(child, options));
    case 'rule':
      return [];
    case 'list':
      return block.items.map((item, index) => (
        <span className="md-preview-item" key={index}>
          {item.checked === undefined ? (
            block.ordered ? (
              `${block.start + index}. `
            ) : (
              '• '
            )
          ) : (
            <TaskMark checked={item.checked} />
          )}
          {item.children.flatMap((child) => previewBlock(child, options))}{' '}
        </span>
      ));
    case 'table':
      return [block.head, ...block.rows].map((row, index) => (
        <span key={index}>
          {row.map((cell, column) => (
            <span key={column}>
              {column > 0 && ' · '}
              {renderInline(cell, options)}
            </span>
          ))}{' '}
        </span>
      ));
  }
}

/**
 * Resumen en una sola línea de flujo, sin elementos de bloque ni controles,
 * para que las tarjetas mantengan su recorte por líneas.
 */
export function MarkdownPreview({
  source,
  records,
  onOpenRecord,
}: {
  source: string;
  records?: RecordItem[];
  onOpenRecord?: (record: MentionedRecord) => void;
}) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <span className="markdown-preview">
      {blocks.map((block, index) => (
        <span key={index}>
          {index > 0 && ' '}
          {previewBlock(block, { records, onOpenRecord, compact: true })}
        </span>
      ))}
    </span>
  );
}
