import type { DragEvent } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Eye,
  Trash2,
} from 'lucide-react';
import {
  isTaskCompletedOnDay,
  madridDate,
  taskDateLabel,
  upcomingDateLabel,
  type Task,
} from '../../shared/model';
import CopyRecordId from '../CopyRecordId';
import { Badge } from '../ui';

interface TodayTaskRowProps {
  task: Task;
  day: string;
  isUpcoming?: boolean;
  selected: boolean;
  dragging: boolean;
  projectName: (id: string) => string;
  onDragStart: (event: DragEvent<HTMLElement>, task: Task) => void;
  onDragEnd: () => void;
  onSelect: () => void;
  onMoveToday: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

export default function TodayTaskRow({
  task,
  day,
  isUpcoming = false,
  selected,
  dragging,
  projectName,
  onDragStart,
  onDragEnd,
  onSelect,
  onMoveToday,
  onOpen,
  onDelete,
}: TodayTaskRowProps) {
  const isOverdue =
    !isUpcoming && day === madridDate() && task.due < day && task.state !== 'Completada';
  return (
    <div
      className={`task-row ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${isUpcoming ? 'upcoming' : ''}`}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
    >
      <button
        className="task-row-select"
        draggable
        onDragStart={(event) => onDragStart(event, task)}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span
          className={`state-icon ${
            task.state === 'Completada' ? 'done' : task.state === 'En revisión' ? 'review' : ''
          }`}
        >
          {task.state === 'Completada' ? (
            <CheckCircle2 size={19} aria-hidden="true" />
          ) : task.state === 'En revisión' ? (
            <span>
              <Eye size={11} strokeWidth={2.4} aria-hidden="true" />
            </span>
          ) : (
            <span />
          )}
        </span>
        <span className="task-row-text">
          <strong>{task.title}</strong>
          <small>
            {isUpcoming
              ? `${upcomingDateLabel(task.due, day)} · ${projectName(task.project)} · ${task.phase}`
              : task.due !== day && isTaskCompletedOnDay(task, day)
                ? `${taskDateLabel(day)} (prevista: ${task.due}) · ${projectName(task.project)} · ${task.phase}`
                : `${taskDateLabel(task.due)} · ${projectName(task.project)} · ${task.phase}`}
            {task.blocked ? ' · Bloqueada' : ''}
          </small>
        </span>
        {isOverdue && (
          <span className="overdue-date-chip" title={`Prevista para el ${taskDateLabel(task.due)}`}>
            <AlertCircle size={12} aria-hidden="true" />
            Con retraso
          </span>
        )}
        {isUpcoming && (
          <span
            className="upcoming-date-chip"
            title={`Prevista para el ${taskDateLabel(task.due)}`}
          >
            <CalendarDays size={12} aria-hidden="true" />
            {upcomingDateLabel(task.due, day)}
          </span>
        )}
        <Badge
          tone={
            task.blocked
              ? 'amber'
              : task.state === 'En curso'
                ? 'blue'
                : task.state === 'Completada'
                  ? 'green'
                  : task.state === 'En revisión'
                    ? 'amber'
                    : ''
          }
        >
          {task.blocked ? 'Bloqueada' : task.state}
        </Badge>
      </button>
      <CopyRecordId id={task.id} title={task.title} />
      {isUpcoming && (
        <button
          className="task-row-action"
          title="Mover a hoy"
          aria-label={`Mover ${task.title} a hoy`}
          onClick={(event) => {
            event.stopPropagation();
            onMoveToday();
          }}
        >
          <ArrowUpRight size={16} />
        </button>
      )}
      <button
        className="task-row-action"
        aria-label={`Ampliar detalles de ${task.title}`}
        onClick={onOpen}
      >
        <ChevronRight size={17} />
      </button>
      <button
        className="task-row-action danger"
        aria-label={`Borrar tarea ${task.title}`}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
