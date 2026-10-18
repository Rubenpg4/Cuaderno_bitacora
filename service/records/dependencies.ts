import type { RecordItem, Snapshot } from '../../shared/model.js';

// Existing vaults predate task dependencies. Keep history snapshots readable too.
export function assignLegacyTaskDependencies(state: Snapshot) {
  let changed = false;
  const assign = (record: RecordItem | null) => {
    if (record?.kind === 'task' && !Array.isArray(record.dependencyIds)) {
      record.dependencyIds = [];
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
