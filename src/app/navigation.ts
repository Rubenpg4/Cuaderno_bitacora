import {
  CalendarDays,
  Columns3,
  GraduationCap,
  List,
  NotebookPen,
  ClipboardList,
  ListChecks,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import type { Kind } from '../../shared/model';

export const navigation = [
  { name: 'Hoy', icon: Sun },
  { name: 'Revisión semanal', icon: ClipboardList },
  { name: 'Tablero', icon: Columns3 },
  { name: 'Lista', icon: List },
  { name: 'Diario', icon: NotebookPen },
  { name: 'Martes', icon: CalendarDays },
  { name: 'Memoria', icon: GraduationCap },
  { name: 'Buenas prácticas', icon: ListChecks },
  { name: 'Verificación ASVS', icon: ShieldCheck },
];

export const pageCopy: Record<string, [string, string]> = {
  'Verificación ASVS': [
    'Seguridad con evidencias.',
    'Revisa el alcance, los requisitos y la vigencia de cada evaluación.',
  ],
  Hoy: [
    'Un día más, un paso adelante.',
    'Tu trabajo de hoy construye la historia de tus prácticas.',
  ],
  'Revisión semanal': [
    'Decide qué sigue esta semana.',
    'Atiende lo urgente, abre los bloqueos y concreta los próximos pasos.',
  ],
  Tablero: [
    'Del siguiente paso al resultado.',
    'Organiza el trabajo y conserva el contexto de cada tarea.',
  ],
  Lista: ['Todas tus tareas, de un vistazo.', 'Consulta, filtra y ordena el trabajo del proyecto.'],
  Diario: [
    'Tu recorrido, día a día.',
    'Avances, aprendizajes y decisiones que merece la pena recordar.',
  ],
  Martes: [
    'Llega con las ideas claras.',
    'Lo que has conseguido, lo que te frena y lo que viene después.',
  ],
  Memoria: [
    'Seis meses. Una historia con evidencias.',
    'Construye tu memoria a partir del trabajo que ya has registrado.',
  ],
  'Buenas prácticas': [
    'La calidad también se practica.',
    'Los criterios de tu empresa, presentes en cada decisión.',
  ],
};

export const kindNames: Record<Kind, string> = {
  task: 'tarea',
  entry: 'entrada',
  incident: 'incidencia',
  idea: 'idea',
  practice: 'práctica',
  decision: 'decisión de arquitectura',
  meeting: 'reunión',
  project: 'proyecto',
  subproject: 'subproyecto',
  objective: 'objetivo',
};
