import { madridDate, validDay, type RecordItem, type Snapshot } from '../../shared/model.js';

// Older vaults allowed tasks without a due date. Schedule them for the current Madrid day.
export function assignLegacyTaskDates(state: Snapshot) {
  let changed = false;
  const today = madridDate();
  const assign = (record: RecordItem | null) => {
    if (record?.kind === 'task' && !validDay(record.due)) {
      record.due = today;
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

// Decisions created before day assignment retain the date shown by the old diary.
export function assignLegacyDecisionDates(state: Snapshot) {
  let changed = false;
  const assign = (record: RecordItem | null) => {
    if (record?.kind === 'decision' && !validDay(record.date)) {
      record.date = record.createdAt.slice(0, 10);
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
