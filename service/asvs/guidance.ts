import { asvsDisplayRequirements, asvsTranslationProvider } from '../../shared/asvsCatalogEs.js';
import type { AsvsAssessment, AsvsAssessmentStatus } from '../../shared/asvsTracking.js';

const spanish = new Map(asvsDisplayRequirements.map((r) => [r.reqId, r]));

/** Spanish presentation text for assistants; the official English text remains the authority. */
export function asvsSpanishText(reqId: string) {
  const requirement = spanish.get(reqId);
  if (!asvsTranslationProvider || !requirement) return null;
  return {
    chapterName: requirement.chapterName,
    sectionName: requirement.sectionName,
    description: requirement.description,
    translatedBy: asvsTranslationProvider,
  };
}

export type AsvsNextAction =
  | 'inactive'
  | 'none'
  | 'excluded'
  | 'await-review'
  | 'revalidate'
  | 'continue-task'
  | 'plan-fix'
  | 'consult'
  | 'plan-or-evaluate';

const guidance: Record<AsvsNextAction, string> = {
  inactive:
    'El requisito no está en el nivel objetivo activo: úsalo solo como referencia y no propongas evaluaciones.',
  none: 'Verificado con evidencia vigente: no requiere acción; puedes citar su evidencia.',
  excluded:
    'Excluido por decisión humana: no propongas trabajo salvo que la persona indique un cambio de contexto.',
  'await-review':
    'Ya tienes una propuesta pendiente para este requisito: espera la revisión humana y consulta su estado con consultar_propuestas.',
  revalidate:
    'La evidencia está desactualizada: revisa las fuentes y el alcance y propón una nueva evaluación con proponer_evaluacion_asvs.',
  'continue-task':
    'Hay tareas abiertas vinculadas: trabaja en ellas y, al terminar, propón la verificación con proponer_verificacion_asvs.',
  'plan-fix':
    'Incumplimiento declarado sin tarea abierta: confirma impacto y exposición y propón una tarea de corrección con proponer_cambios y patch.asvsLinks.',
  consult:
    'Hay una consulta abierta: resuélvela con la persona responsable antes de proponer una evaluación.',
  'plan-or-evaluate':
    'Sin evaluar ni planificar: si aplica al sistema, propón una tarea con proponer_cambios y patch.asvsLinks (motivo, alcance, criterio y método) o una evaluación con evidencia concreta.',
};

/** One concrete next step per requirement so assistants avoid exploratory calls. */
export function asvsNextAction(input: {
  assessment?: AsvsAssessment;
  status?: AsvsAssessmentStatus | null;
  openTaskCount: number;
  pendingProposalCount: number;
}): { action: AsvsNextAction; guidance: string } {
  const { assessment, status } = input;
  const action: AsvsNextAction =
    !assessment || !status?.active
      ? 'inactive'
      : status.tick
        ? 'none'
        : status.excluded
          ? 'excluded'
          : input.pendingProposalCount
            ? 'await-review'
            : status.stale && assessment.reviewedAt
              ? 'revalidate'
              : input.openTaskCount
                ? 'continue-task'
                : assessment.state === 'No cumplido'
                  ? 'plan-fix'
                  : assessment.state === 'Requiere consulta'
                    ? 'consult'
                    : 'plan-or-evaluate';
  return { action, guidance: guidance[action] };
}
