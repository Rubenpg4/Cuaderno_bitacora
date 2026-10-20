export interface DiffSegment {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Larger tables are slow to build; the caller falls back to the full before/after view. */
const MAX_TABLE_CELLS = 1_000_000;
/** Below this share of unchanged text the highlighted view is noisier than before/after. */
const MIN_UNCHANGED_SHARE = 0.4;

/** Words, runs of whitespace (newlines included) and single punctuation marks. */
function tokens(text: string) {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function push(segments: DiffSegment[], kind: DiffSegment['kind'], text: string) {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

/** Longest common subsequence over the tokens that differ after trimming shared ends. */
function middleDiff(before: string[], after: string[]): DiffSegment[] | undefined {
  const rows = before.length + 1;
  const cols = after.length + 1;
  if (rows * cols > MAX_TABLE_CELLS) return undefined;
  // lcs[i * cols + j] is the common length of before[i..] and after[j..].
  const lcs = new Uint16Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lcs[i * cols + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      push(segments, 'same', before[i++]);
      j++;
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])
      push(segments, 'removed', before[i++]);
    else push(segments, 'added', after[j++]);
  }
  push(segments, 'removed', before.slice(i).join(''));
  push(segments, 'added', after.slice(j).join(''));
  return segments;
}

/**
 * Whitespace kept between two changes reads as noise, so it joins both sides; each run of
 * changes is then shown as all removed text followed by all added text.
 */
function readable(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    push(result, 'removed', removed);
    push(result, 'added', added);
    removed = added = '';
  };
  segments.forEach((segment, index) => {
    const between =
      segment.kind === 'same' &&
      !segment.text.trim() &&
      (removed || added) &&
      index < segments.length - 1;
    if (segment.kind === 'removed' || between) removed += segment.text;
    if (segment.kind === 'added' || between) added += segment.text;
    if (segment.kind === 'same' && !between) {
      flush();
      push(result, 'same', segment.text);
    }
  });
  flush();
  return result;
}

/** Word-level differences, or undefined when the texts are too long to compare. */
export function diffWords(before: string, after: string): DiffSegment[] | undefined {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const middle = middleDiff(a.slice(start, a.length - end), b.slice(start, b.length - end));
  if (!middle) return undefined;
  const segments: DiffSegment[] = [];
  push(segments, 'same', a.slice(0, start).join(''));
  for (const segment of middle) push(segments, segment.kind, segment.text);
  push(segments, 'same', a.slice(a.length - end).join(''));
  return readable(segments);
}

const visibleLength = (text: string) => text.replace(/\s+/g, '').length;

/**
 * Highlighted differences only when they help: identical, empty, very long or mostly rewritten
 * texts keep the full before/after view.
 */
export function inlineTextDiff(before: string, after: string): DiffSegment[] | undefined {
  if (before === after || !before.trim() || !after.trim()) return undefined;
  const segments = diffWords(before, after);
  if (!segments) return undefined;
  const unchanged = segments
    .filter((segment) => segment.kind === 'same')
    .reduce((total, segment) => total + visibleLength(segment.text), 0);
  const longest = Math.max(visibleLength(before), visibleLength(after));
  return unchanged / longest >= MIN_UNCHANGED_SHARE ? segments : undefined;
}
