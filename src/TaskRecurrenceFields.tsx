import { madridDate, validDay } from '../shared/model';
import { type RecurrenceRule } from '../shared/recurrence';
import { Field } from './ui';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function TaskRecurrenceFields({
  value,
  onChange,
  defaultStart,
  disabled = false,
  allowNone = true,
}: {
  value: RecurrenceRule | null;
  onChange: (value: RecurrenceRule | null) => void;
  defaultStart: string;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  const frequency = value?.frequency || 'none';
  function choose(next: string) {
    if (next === 'none') return onChange(null);
    const start = value?.start || (validDay(defaultStart) ? defaultStart : madridDate());
    if (next === 'weekly') {
      const weekday = new Date(`${start}T12:00:00Z`).getUTCDay() || 7;
      onChange({ frequency: 'weekly', start, end: value?.end, weekdays: [weekday] });
    } else {
      onChange({
        frequency: 'monthly',
        start,
        end: value?.end,
        monthDay: Number(start.slice(8, 10)),
      });
    }
  }
  return (
    <div className="form-section">
      <Field label="Repetición">
        <select
          value={frequency}
          onChange={(event) => choose(event.target.value)}
          disabled={disabled}
        >
          {allowNone && <option value="none">No repetir</option>}
          <option value="weekly">Semanal</option>
          <option value="monthly">Mensual</option>
        </select>
      </Field>
      {value && (
        <>
          <div className="form-grid">
            <Field label="Inicio de la serie">
              <input
                type="date"
                value={value.start}
                onChange={(event) => onChange({ ...value, start: event.target.value })}
                disabled={disabled}
                required
              />
            </Field>
            <Field label="Fin de la serie (opcional)">
              <input
                type="date"
                value={value.end || ''}
                onChange={(event) => {
                  const next = { ...value, end: event.target.value || undefined };
                  onChange(next);
                }}
                disabled={disabled}
              />
            </Field>
          </div>
          {value.frequency === 'weekly' ? (
            <div className="form-section">
              <strong>Días de la semana</strong>
              <div className="form-grid">
                {weekdays.map((label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={value.weekdays.includes(index + 1)}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          weekdays: event.target.checked
                            ? [...value.weekdays, index + 1].sort((a, b) => a - b)
                            : value.weekdays.filter((day) => day !== index + 1),
                        })
                      }
                    />{' '}
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <Field label="Día de cada mes">
              <input
                type="number"
                min="1"
                max="31"
                value={value.monthDay}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, monthDay: Number(event.target.value) })}
              />
            </Field>
          )}
          <small className="muted">
            Se preparan 90 días futuros. Cada aparición es independiente; los adjuntos se añaden a
            cada tarea por separado.
          </small>
        </>
      )}
    </div>
  );
}
