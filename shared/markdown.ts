// Analizador Markdown acotado (estilo GitHub) que produce un árbol de datos.
// No interpreta HTML: la interfaz pinta el árbol con elementos React, así que
// el texto de los registros nunca llega al DOM como marcado.

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'em' | 'del'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'mention'; kind: string; id: string }
  | { type: 'break' };

export type MarkdownListItem = { checked?: boolean; children: MarkdownBlock[] };
export type MarkdownAlign = 'left' | 'center' | 'right' | null;

export type MarkdownBlock =
  | { type: 'heading'; level: number; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'quote'; children: MarkdownBlock[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: 'rule' }
  | {
      type: 'table';
      align: MarkdownAlign[];
      head: MarkdownInline[][];
      rows: MarkdownInline[][][];
    };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+/;
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
const MENTION = /@\[(task|incident|decision|idea):([\w-]+)\]/y;
const BARE_URL = /https?:\/\/[^\s<>]+/y;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>@]/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
}

function indentOf(line: string) {
  return line.length - line.trimStart().length;
}

function listMarker(line: string) {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const ordered = /\d/.test(match[2]);
  return {
    indent: match[1].length,
    ordered,
    start: ordered ? Number.parseInt(match[2], 10) : 1,
    content: match[3] ?? '',
  };
}

function startsBlock(line: string) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    !!listMarker(line)
  );
}

function splitRow(line: string) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < row.length; index++) {
    if (row[index] === '\\' && row[index + 1] === '|') {
      current += '|';
      index++;
    } else if (row[index] === '|') {
      cells.push(current.trim());
      current = '';
    } else current += row[index];
  }
  cells.push(current.trim());
  return cells;
}

function startsTable(lines: string[], index: number) {
  const next = lines[index + 1] ?? '';
  return (
    lines[index].includes('|') &&
    TABLE_DELIMITER.test(next) &&
    splitRow(lines[index]).length === splitRow(next).length
  );
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index]);
        index++;
      }
      index++;
      blocks.push({ type: 'code', lang: fence[2], value: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2] ?? ''),
      });
      index++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim()) {
        body.push(lines[index].replace(QUOTE, ''));
        index++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(body) });
      continue;
    }
    if (listMarker(line)) {
      const [list, next] = parseList(lines, index);
      blocks.push(list);
      index = next;
      continue;
    }
    if (startsTable(lines, index)) {
      const head = splitRow(line);
      const align = splitRow(lines[index + 1]).map((cell): MarkdownAlign => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
      });
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const cells = splitRow(lines[index]);
        rows.push(head.map((_, column) => parseInline(cells[column] ?? '')));
        index++;
      }
      blocks.push({ type: 'table', align, head: head.map((cell) => parseInline(cell)), rows });
      continue;
    }
    const paragraph = [line.trim()];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines[index]) &&
      !startsTable(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function parseList(lines: string[], start: number): [MarkdownBlock, number] {
  const first = listMarker(lines[start])!;
  const items: MarkdownListItem[] = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker(lines[index]);
    if (!marker || marker.indent > first.indent + 1 || marker.ordered !== first.ordered) break;
    const offset = lines[index].length - marker.content.length;
    const body = [marker.content];
    index++;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        const next = lines.slice(index + 1).find((candidate) => candidate.trim());
        if (next === undefined || indentOf(next) <= marker.indent) break;
        body.push('');
        index++;
        continue;
      }
      if (indentOf(line) > marker.indent) {
        body.push(line.slice(Math.min(indentOf(line), offset)));
        index++;
        continue;
      }
      if (body.at(-1)?.trim() && !startsBlock(line)) {
        body.push(line.trim());
        index++;
        continue;
      }
      break;
    }
    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({
      ...(task ? { checked: task[1] !== ' ' } : {}),
      children: parseBlocks(body),
    });
    if (index < lines.length && !lines[index].trim()) index++;
  }
  return [{ type: 'list', ordered: first.ordered, start: first.start, items }, index];
}

function isWordChar(char: string | undefined) {
  return !!char && /[\p{L}\p{N}]/u.test(char);
}

function findClosing(text: string, delimiter: string, from: number) {
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
      continue;
    }
    if (text[index] === '`') {
      const run = /^`+/.exec(text.slice(index))![0];
      const end = text.indexOf(run, index + run.length);
      if (end > 0) index = end + run.length - 1;
      continue;
    }
    if (delimiter.length === 1 && text.startsWith(delimiter.repeat(2), index)) {
      const end = text.indexOf(delimiter.repeat(2), index + 2);
      if (end < 0) return -1;
      index = end + 1;
      continue;
    }
    if (
      text.startsWith(delimiter, index) &&
      !/\s/.test(text[index - 1]) &&
      !(delimiter[0] === '_' && isWordChar(text[index + delimiter.length]))
    )
      return index;
  }
  return -1;
}

function closingBracket(text: string, from: number) {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '[') depth++;
    else if (text[index] === ']' && depth-- === 0) return index;
  }
  return -1;
}

function trimUrl(url: string) {
  let end = url.length;
  while (end > 0 && /[.,;:!?'"]/.test(url[end - 1])) end--;
  if (url[end - 1] === ')' && !url.slice(0, end).includes('(')) end--;
  return url.slice(0, end);
}

export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', value: buffer });
    buffer = '';
  };
  const push = (node: MarkdownInline) => {
    flush();
    nodes.push(node);
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && ESCAPABLE.test(text[index + 1] ?? '')) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char === '\n') {
      buffer = buffer.trimEnd();
      push({ type: 'break' });
      index++;
      continue;
    }
    if (char === '`') {
      const run = /^`+/.exec(text.slice(index))![0];
      const end = text.indexOf(run, index + run.length);
      if (end > 0) {
        let value = text.slice(index + run.length, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(value) && value.trim()) value = value.slice(1, -1);
        push({ type: 'code', value });
        index = end + run.length;
        continue;
      }
      buffer += run;
      index += run.length;
      continue;
    }
    if (char === '@') {
      MENTION.lastIndex = index;
      const mention = MENTION.exec(text);
      if (mention) {
        push({ type: 'mention', kind: mention[1], id: mention[2] });
        index += mention[0].length;
        continue;
      }
    }
    if (char === '[') {
      const close = closingBracket(text, index + 1);
      const target =
        close > 0 ? /^\(\s*<?([^\s()<>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(close + 1)) : null;
      if (target) {
        const label = parseInline(text.slice(index + 1, close));
        const href = target[1];
        if (SAFE_LINK.test(href)) push({ type: 'link', href, children: label });
        else {
          flush();
          nodes.push(...label);
        }
        index = close + 1 + target[0].length;
        continue;
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(index));
      if (auto) {
        push({ type: 'link', href: auto[1], children: [{ type: 'text', value: auto[1] }] });
        index += auto[0].length;
        continue;
      }
    }
    if (char === 'h' && !isWordChar(text[index - 1])) {
      BARE_URL.lastIndex = index;
      const bare = BARE_URL.exec(text);
      if (bare) {
        const url = trimUrl(bare[0]);
        if (url.length > 'https://'.length) {
          push({ type: 'link', href: url, children: [{ type: 'text', value: url }] });
          index += url.length;
          continue;
        }
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      const run = /^([*_~])\1*/.exec(text.slice(index))![0];
      const opener = run.length >= 3 && char !== '~' ? run.slice(0, 3) : run.slice(0, 2);
      const candidates =
        char === '~'
          ? run.length >= 2
            ? ['~~']
            : []
          : [opener, char.repeat(2), char].filter(
              (value, position, all) =>
                value.length <= run.length && all.indexOf(value) === position,
            );
      let matched = false;
      for (const delimiter of candidates) {
        const after = text[index + delimiter.length];
        if (!after || /\s/.test(after)) continue;
        if (char === '_' && isWordChar(text[index - 1])) continue;
        const end = findClosing(text, delimiter, index + delimiter.length + 1);
        if (end < 0) continue;
        const inner = parseInline(text.slice(index + delimiter.length, end));
        push(
          delimiter.length === 3
            ? { type: 'strong', children: [{ type: 'em', children: inner }] }
            : {
                type: char === '~' ? 'del' : delimiter.length === 2 ? 'strong' : 'em',
                children: inner,
              },
        );
        index = end + delimiter.length;
        matched = true;
        break;
      }
      if (matched) continue;
      buffer += run;
      index += run.length;
      continue;
    }
    buffer += char;
    index++;
  }
  flush();
  return nodes;
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'break':
          return ' ';
        case 'mention':
          return `@[${node.kind}:${node.id}]`;
        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

/** Texto plano de una sola línea, útil para títulos emergentes y resúmenes. */
export function markdownToPlainText(source: string): string {
  const blockText = (block: MarkdownBlock): string => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return inlineText(block.children);
      case 'code':
        return block.value;
      case 'quote':
        return block.children.map(blockText).join(' ');
      case 'list':
        return block.items.map((item) => item.children.map(blockText).join(' ')).join(' · ');
      case 'rule':
        return '';
      case 'table':
        return [block.head, ...block.rows]
          .map((row) => row.map(inlineText).join(' · '))
          .join(' · ');
    }
  };
  return parseMarkdown(source).map(blockText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
