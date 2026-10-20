import type { DiffSegment } from '../shared/textDiff';

/**
 * Unchanged text in normal color with only the removed and added fragments marked. The hidden
 * labels tell screen readers which fragment is which, since most do not announce del/ins.
 */
export function InlineDiff({ segments }: { segments: DiffSegment[] }) {
  return (
    <div className="diff-inline">
      {segments.map((segment, index) => {
        if (segment.kind === 'same') return <span key={index}>{segment.text}</span>;
        const removed = segment.kind === 'removed';
        return (
          <span key={index}>
            <span className="diff-label">{removed ? '[Eliminado: ' : '[Añadido: '}</span>
            {removed ? (
              <del className="diff-removed">{segment.text}</del>
            ) : (
              <ins className="diff-added">{segment.text}</ins>
            )}
            <span className="diff-label">]</span>
          </span>
        );
      })}
    </div>
  );
}
