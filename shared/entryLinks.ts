import { ENTRY_MENTION_PATTERN, type RecordItem } from './model';

export const entryMentionFields = [
  'activity',
  'result',
  'learning',
  'blocker',
  'nextStep',
] as const;

export interface EntryMentionIds {
  taskIds: string[];
  linkedIds: string[];
}

export function linksFromEntryText(entry: Record<string, unknown>, records: RecordItem[]) {
  const taskIds = new Set<string>();
  const linkedIds = new Set<string>();
  for (const field of entryMentionFields) {
    const value = entry[field];
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(ENTRY_MENTION_PATTERN)) {
      if (!records.some((record) => record.kind === match[1] && record.id === match[2])) continue;
      if (match[1] === 'task') taskIds.add(match[2]);
      else linkedIds.add(match[2]);
    }
  }
  return { taskIds: [...taskIds], linkedIds: [...linkedIds] };
}

export function resolveEntryMentions(entry: Record<string, unknown>, records: RecordItem[]) {
  const resolved = { ...entry };
  const mentionRecords = records.filter(
    (record) =>
      ['task', 'incident', 'decision', 'idea'].includes(record.kind) && record.title.trim(),
  );

  for (const field of entryMentionFields) {
    const value = entry[field];
    if (typeof value !== 'string') continue;
    let text = '';
    let index = 0;
    while (index < value.length) {
      if (value[index] !== '@' || (index > 0 && /[\p{L}\p{N}_@]/u.test(value[index - 1]))) {
        text += value[index++];
        continue;
      }
      const canonical = /^@\[(task|incident|decision|idea):([\w-]+)\]/.exec(value.slice(index));
      if (canonical) {
        text += canonical[0];
        index += canonical[0].length;
        continue;
      }
      const matches = mentionRecords
        .filter((record) => {
          const end = index + 1 + record.title.length;
          return (
            value.slice(index + 1, end).toLocaleLowerCase('es') ===
              record.title.toLocaleLowerCase('es') &&
            (end === value.length || !/[\p{L}\p{N}_]/u.test(value[end]))
          );
        })
        .sort((first, second) => second.title.length - first.title.length);
      const match = matches[0];
      if (match && (!matches[1] || matches[1].title.length < match.title.length)) {
        text += `@[${match.kind}:${match.id}]`;
        index += match.title.length + 1;
      } else text += value[index++];
    }
    resolved[field] = text;
  }

  return { entry: resolved, ...linksFromEntryText(resolved, records) };
}
