import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Lightbulb,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  isIncidentResolved,
  madridDate,
  type Decision,
  type Idea,
  type Incident,
  type Task,
} from '../../shared/model';

interface CalendarMonthsProps {
  day: string;
  markedDays: Set<string>;
  tasksByDay: Map<string, Task[]>;
  incidentsByDay?: Map<string, Incident[]>;
  decisionsByDay?: Map<string, Decision[]>;
  ideasByDay?: Map<string, Idea[]>;
  openDay: (day: string) => void;
  draggedTaskId?: string;
  dropTask?: (day: string) => void;
  draggedIncidentId?: string;
  dropIncident?: (day: string) => void;
}

function monthLabel(day: Date) {
  const label = day.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function CalendarMonths({
  day,
  markedDays,
  tasksByDay,
  incidentsByDay,
  decisionsByDay,
  ideasByDay,
  openDay,
  draggedTaskId,
  dropTask,
  draggedIncidentId,
  dropIncident,
}: CalendarMonthsProps) {
  const [dropDay, setDropDay] = useState('');
  const [firstMonth, setFirstMonth] = useState(() => {
    const selected = new Date(`${day}T12:00:00`);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  useEffect(() => {
    const selected = new Date(`${day}T12:00:00`);
    setFirstMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [day]);
  const move = (months: number) =>
    setFirstMonth((current) => new Date(current.getFullYear(), current.getMonth() + months, 1));
  const offset = (firstMonth.getDay() + 6) % 7;
  const days = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + 1, 0).getDate();
  const isDragging = Boolean(draggedTaskId || draggedIncidentId);

  return (
    <section className="months-calendar" aria-label="Calendario mensual">
      <div className="months-toolbar">
        <button className="icon-button" aria-label="Mes anterior" onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <strong>{monthLabel(firstMonth)}</strong>
        <button className="icon-button" aria-label="Mes siguiente" onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="calendar-month">
        <div className="month-days">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((name) => (
            <span className="weekday" key={name}>
              {name}
            </span>
          ))}
          {Array.from({ length: offset }, (_, gap) => (
            <span key={`gap-${gap}`} />
          ))}
          {Array.from({ length: days }, (_, number) => {
            const date = madridDate(
              new Date(firstMonth.getFullYear(), firstMonth.getMonth(), number + 1, 12),
            );
            const dayTasks = tasksByDay.get(date) || [];
            const dayIncidents = incidentsByDay?.get(date) || [];
            const dayDecisions = decisionsByDay?.get(date) || [];
            const dayIdeas = ideasByDay?.get(date) || [];
            const totalItems =
              dayTasks.length + dayIncidents.length + dayDecisions.length + dayIdeas.length;
            const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });

            // Ordenamos: primero incidencias sin solucionar (rojas), luego tareas, luego incidencias solucionadas
            const sortedIncidents = [...dayIncidents].sort((a, b) => {
              const aRes = isIncidentResolved(a);
              const bRes = isIncidentResolved(b);
              if (!aRes && bRes) return -1;
              if (aRes && !bRes) return 1;
              return a.title.localeCompare(b.title);
            });

            const dayItems: Array<
              | { type: 'incident'; item: Incident; resolved: boolean }
              | { type: 'task'; item: Task }
              | { type: 'decision'; item: Decision }
              | { type: 'idea'; item: Idea }
            > = [
              ...sortedIncidents
                .filter((inc) => !isIncidentResolved(inc))
                .map((item) => ({ type: 'incident' as const, item, resolved: false })),
              ...dayTasks.map((item) => ({ type: 'task' as const, item })),
              ...sortedIncidents
                .filter((inc) => isIncidentResolved(inc))
                .map((item) => ({ type: 'incident' as const, item, resolved: true })),
              ...dayDecisions.map((item) => ({ type: 'decision' as const, item })),
              ...dayIdeas.map((item) => ({ type: 'idea' as const, item })),
            ];

            const tasksText = `${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}`;
            const incidentsText = dayIncidents.length
              ? `, ${dayIncidents.length} ${dayIncidents.length === 1 ? 'incidencia' : 'incidencias'}`
              : '';
            const decisionsText = dayDecisions.length
              ? `, ${dayDecisions.length} ${dayDecisions.length === 1 ? 'decisión' : 'decisiones'}`
              : '';
            const ideasText = dayIdeas.length
              ? `, ${dayIdeas.length} ${dayIdeas.length === 1 ? 'idea' : 'ideas'}`
              : '';
            const taskDetails = dayTasks.length
              ? `: ${dayTasks.map((t) => t.title).join(', ')}`
              : '';

            return (
              <button
                key={date}
                className={`${date === day ? 'active' : ''} ${markedDays.has(date) ? 'marked' : ''} ${dropDay === date ? 'drop-target' : ''}`}
                aria-label={`${dateLabel}, ${tasksText}${incidentsText}${decisionsText}${ideasText}${taskDetails}`}
                aria-haspopup="dialog"
                aria-current={date === day ? 'date' : undefined}
                onClick={() => openDay(date)}
                onDragOver={(event) => {
                  if (!isDragging || (!dropTask && !dropIncident)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropDay(date);
                }}
                onDragLeave={() => setDropDay((current) => (current === date ? '' : current))}
                onDrop={(event) => {
                  if (!isDragging) return;
                  event.preventDefault();
                  setDropDay('');
                  if (draggedTaskId && dropTask) dropTask(date);
                  else if (draggedIncidentId && dropIncident) dropIncident(date);
                }}
              >
                <strong>{number + 1}</strong>
                <span className="month-task-list">
                  {dayItems.slice(0, 2).map((entry) =>
                    entry.type === 'incident' ? (
                      <span
                        className={`month-incident ${entry.resolved ? 'resolved' : 'unresolved'}`}
                        key={`inc-${entry.item.id}`}
                        title={`${entry.resolved ? 'Incidencia solucionada' : 'Incidencia sin solucionar'}: ${entry.item.title}`}
                      >
                        {entry.resolved ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        <span>{entry.item.title}</span>
                      </span>
                    ) : entry.type === 'task' ? (
                      <span
                        className={`month-task ${entry.item.state === 'Completada' ? 'completed' : ''}`}
                        key={`task-${entry.item.id}`}
                        title={`Tarea ${entry.item.state.toLowerCase()}: ${entry.item.title}`}
                      >
                        {entry.item.state === 'Completada' ? (
                          <CheckCircle2 size={10} />
                        ) : (
                          <CheckSquare size={10} />
                        )}
                        <span>{entry.item.title}</span>
                      </span>
                    ) : (
                      <span
                        className={`month-note ${entry.type}`}
                        key={`${entry.type}-${entry.item.id}`}
                        title={`${entry.type === 'decision' ? 'Decisión' : 'Idea'}: ${entry.item.title}`}
                      >
                        {entry.type === 'decision' ? (
                          <BookOpen size={10} />
                        ) : (
                          <Lightbulb size={10} />
                        )}
                        <span>{entry.item.title}</span>
                      </span>
                    ),
                  )}
                  {totalItems > 2 && <span className="month-task-more">+{totalItems - 2} más</span>}
                </span>
                {totalItems > 0 && (
                  <span className="month-note-counts" aria-hidden="true">
                    {dayTasks.length > 0 && (
                      <span
                        className="calendar-note-count task"
                        title={`${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}`}
                      >
                        <CheckSquare size={11} /> {dayTasks.length}
                      </span>
                    )}
                    {dayIncidents.length > 0 && (
                      <span
                        className={`calendar-note-count incident ${dayIncidents.some((incident) => !isIncidentResolved(incident)) ? 'unresolved' : 'resolved'}`}
                        title={`${dayIncidents.length} ${dayIncidents.length === 1 ? 'incidencia' : 'incidencias'}`}
                      >
                        {dayIncidents.some((incident) => !isIncidentResolved(incident)) ? (
                          <AlertCircle size={11} />
                        ) : (
                          <CheckCircle2 size={11} />
                        )}{' '}
                        {dayIncidents.length}
                      </span>
                    )}
                    {dayDecisions.length > 0 && (
                      <span
                        className="calendar-note-count decision"
                        title={`${dayDecisions.length} ${dayDecisions.length === 1 ? 'decisión' : 'decisiones'}`}
                      >
                        <BookOpen size={11} /> {dayDecisions.length}
                      </span>
                    )}
                    {dayIdeas.length > 0 && (
                      <span
                        className="calendar-note-count idea"
                        title={`${dayIdeas.length} ${dayIdeas.length === 1 ? 'idea' : 'ideas'}`}
                      >
                        <Lightbulb size={11} /> {dayIdeas.length}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
