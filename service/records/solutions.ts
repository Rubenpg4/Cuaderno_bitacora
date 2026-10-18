import type { RecordItem, Snapshot } from '../../shared/model.js';

// Tasks saved before the solution field existed retain their original description.
export function assignLegacyTaskSolutions(state: Snapshot) {
  let changed = false;
  const assign = (record: RecordItem | null) => {
    if (record?.kind === 'task' && typeof record.solution !== 'string') {
      record.solution = '';
      changed = true;
    }
  };
  state.records.forEach(assign);
  for (const entry of state.history) {
    assign(entry.before);
    assign(entry.after);
  }
  return changed;
}
