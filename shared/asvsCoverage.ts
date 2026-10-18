import type { AsvsCatalog } from './asvs.js';
import type {
  AsvsCatalogBaseline,
  AsvsCatalogDiff,
  AsvsCoverageCounts,
  AsvsGap,
  AsvsOverview,
} from './asvsTracking.js';
import type { RecordItem, Task } from './model.js';

export function compareAsvsCatalogs(
  before: readonly AsvsCatalogBaseline[],
  after: readonly AsvsCatalogBaseline[],
): AsvsCatalogDiff {
  const old = new Map(before.map((r) => [r.reqId, r]));
  const current = new Map(after.map((r) => [r.reqId, r]));
  return {
    added: after.filter((r) => !old.has(r.reqId)).map((r) => r.reqId),
    removed: before.filter((r) => !current.has(r.reqId)).map((r) => r.reqId),
    changed: after
      .filter((r) => {
        const previous = old.get(r.reqId);
        return (
          previous &&
          (previous.contentSha256 !== r.contentSha256 || previous.minLevel !== r.minLevel)
        );
      })
      .map((r) => r.reqId),
    unchanged: after
      .filter((r) => {
        const previous = old.get(r.reqId);
        return previous?.contentSha256 === r.contentSha256 && previous.minLevel === r.minLevel;
      })
      .map((r) => r.reqId),
  };
}

export function asvsCoverage(
  catalog: AsvsCatalog,
  overview: Pick<AsvsOverview, 'config' | 'items'>,
  records: RecordItem[],
): Pick<AsvsOverview, 'summary' | 'chapters' | 'gaps'> {
  const counts = (): AsvsCoverageCounts => ({
    selected: 0,
    fulfilled: 0,
    excluded: 0,
    denominator: 0,
    stale: 0,
    partial: 0,
    undetermined: 0,
    failed: 0,
    pending: 0,
    consultation: 0,
  });
  const summary = counts();
  const chapters = new Map<string, AsvsCoverageCounts>();
  const gaps: AsvsGap[] = [];
  const config = overview.config;
  if (!config?.level || config.catalogVersion !== catalog.version)
    return { summary, chapters: [], gaps };
  const items = new Map(
    overview.items
      .filter((i) => i.assessment.catalogVersion === config.catalogVersion)
      .map((i) => [i.assessment.reqId, i]),
  );
  const tasks = records.filter(
    (r): r is Task =>
      r.kind === 'task' && r.project === config.projectId && !r.recurrence?.canceledAt,
  );
  // The catalog, including requirements never reviewed, defines the denominator.
  for (const requirement of catalog.requirements) {
    if (requirement.minLevel > config.level) continue;
    const item = items.get(requirement.reqId);
    const assessment = item?.assessment;
    const status = item?.status;
    const state = assessment?.state ?? 'Pendiente';
    const chapter = chapters.get(requirement.chapterId) ?? counts();
    chapters.set(requirement.chapterId, chapter);
    for (const total of [summary, chapter]) {
      total.selected++;
      if (status?.tick) total.fulfilled++;
      if (status?.excluded) total.excluded++;
      else total.denominator++;
      if (status?.stale && assessment?.reviewedAt) total.stale++;
      if (status?.partial) total.partial++;
      if (!assessment || assessment.applicability === 'Por determinar') total.undetermined++;
      if (state === 'No cumplido') total.failed++;
      if (state === 'Pendiente') total.pending++;
      if (state === 'Requiere consulta') total.consultation++;
    }
    if (status?.tick || status?.excluded) continue;
    const related = tasks.filter((t) =>
      t.asvsLinks?.some(
        (l) => l.catalogVersion === catalog.version && l.reqId === requirement.reqId,
      ),
    );
    const category =
      status?.stale && assessment?.reviewedAt
        ? 'revalidation'
        : state === 'No cumplido'
          ? 'failed'
          : state === 'Requiere consulta'
            ? 'consultation'
            : status?.partial
              ? 'partial'
              : 'pending';
    const nextStep =
      category === 'revalidation'
        ? 'Revalidar las fuentes y el alcance; conservar la revisión anterior en el historial.'
        : category === 'failed'
          ? 'Confirmar impacto y exposición del hallazgo y planificar su corrección con evidencia.'
          : category === 'consultation'
            ? 'Resolver la consulta con la persona responsable antes de evaluar.'
            : category === 'partial'
              ? 'Verificar el alcance pendiente del proyecto.'
              : 'Determinar aplicabilidad y documentar el método y la evidencia prevista.';
    gaps.push({
      reference: requirement.canonicalRef,
      reqId: requirement.reqId,
      chapterId: requirement.chapterId,
      category,
      nextStep,
      cause: JSON.stringify([
        catalog.version,
        config.level,
        config.contextRevision,
        assessment?.version ?? 0,
        category,
        status?.reasons ?? [],
        status?.freshnessKey ?? '',
        related.map((t) => [t.id, t.state]),
      ]),
      tasks: related.map(({ id, title, version, state }) => ({ id, title, version, state })),
    });
  }
  return {
    summary,
    chapters: [...chapters].map(([chapterId, counts]) => ({ chapterId, counts })),
    gaps,
  };
}
