import { validDay } from './model.js';

export type RecurrenceRule =
  | { frequency: 'weekly'; start: string; end?: string; weekdays: number[] }
  | { frequency: 'monthly'; start: string; end?: string; monthDay: number };

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function occurrenceDays(rule: RecurrenceRule, from: string, through: string): string[] {
  if (!validDay(rule.start) || (rule.end && (!validDay(rule.end) || rule.end < rule.start)))
    throw Error('Fechas de repetición inválidas.');
  if (rule.frequency === 'weekly') {
    if (
      !rule.weekdays.length ||
      new Set(rule.weekdays).size !== rule.weekdays.length ||
      rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    )
      throw Error('Selecciona días de la semana válidos.');
  } else if (!Number.isInteger(rule.monthDay) || rule.monthDay < 1 || rule.monthDay > 31) {
    throw Error('Selecciona un día del mes válido.');
  }
  const first = rule.start > from ? rule.start : from;
  const last = rule.end && rule.end < through ? rule.end : through;
  if (first > last) return [];
  const result: string[] = [];
  if (rule.frequency === 'weekly') {
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
      if (rule.weekdays.includes(weekday)) result.push(day);
    }
  } else {
    let [year, month] = first.split('-').map(Number);
    const [lastYear, lastMonth] = last.split('-').map(Number);
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      const maximum = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const day = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(rule.monthDay, maximum)).padStart(2, '0')}`;
      if (day >= first && day <= last) result.push(day);
      month++;
      if (month === 13) {
        month = 1;
        year++;
      }
    }
  }
  return result;
}
