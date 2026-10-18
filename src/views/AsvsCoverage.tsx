import { useState } from 'react';
import type { AsvsCoverageCounts, AsvsOverview } from '../../shared/asvsTracking';
import type { RecordItem } from '../../shared/model';
import { asvsDisplayRequirements } from '../../shared/asvsCatalogEs';
import { Button, Field } from '../ui';

function Counts({ counts }: { counts: AsvsCoverageCounts }) {
  return (
    <>
      <td>{counts.selected}</td>
      <td>{counts.fulfilled}</td>
      <td>{counts.failed}</td>
      <td>{counts.pending}</td>
      <td>{counts.consultation}</td>
      <td>{counts.excluded}</td>
      <td>{counts.stale}</td>
      <td>{counts.partial}</td>
      <td>{counts.denominator}</td>
    </>
  );
}

export default function AsvsCoverage({
  overview,
  records,
  openRecord,
  openRequirement,
}: {
  overview: AsvsOverview;
  records: RecordItem[];
  openRecord: (r: RecordItem) => void;
  openRequirement: (reference: string) => void;
}) {
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(0);
  const gaps = overview.gaps.filter(
    (g) =>
      category === 'all' ||
      (category === 'unassigned'
        ? !g.tasks.some((t) => t.state !== 'Completada')
        : category === 'open'
          ? g.tasks.some((t) => t.state !== 'Completada')
          : g.category === category),
  );
  const lastPage = Math.max(0, Math.ceil(gaps.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  return (
    <section className="asvs-config" aria-label="Cobertura y lagunas ASVS">
      <h2>Seguimiento del alcance evaluado</h2>
      <p>
        El denominador incluye todos los requisitos del nivel objetivo y solo resta las exclusiones
        humanas vigentes. Los estados declarados pueden solaparse con evidencia desactualizada o
        cobertura parcial. Una propuesta pendiente y una tarea completada no acreditan cumplimiento
        del proyecto. Este seguimiento no afirma certificación.
      </p>
      <div
        className="asvs-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Cobertura ASVS por capítulo"
      >
        <table className="asvs-coverage-table">
          <caption>Cobertura del nivel objetivo L{overview.config?.level}</caption>
          <thead>
            <tr>
              {[
                'Capítulo',
                'Total',
                'Cumplido vigente',
                'No cumplido',
                'Pendiente',
                'Requiere consulta',
                'No aplicable aprobado',
                'Desactualizados',
                'Parciales',
                'Denominador',
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overview.chapters.map(({ chapterId, counts }) => (
              <tr key={chapterId}>
                <th scope="row">
                  <Button variant="secondary" onClick={() => openRequirement(chapterId)}>
                    {chapterId} ·{' '}
                    {asvsDisplayRequirements.find((r) => r.chapterId === chapterId)?.chapterName}
                  </Button>
                </th>
                <Counts counts={counts} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <Counts counts={overview.summary} />
            </tr>
          </tfoot>
        </table>
      </div>
      <Field label="Filtrar lagunas ASVS">
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">Todas las lagunas</option>
          <option value="unassigned">Sin tarea abierta</option>
          <option value="open">Con tareas abiertas</option>
          <option value="revalidation">Revalidaciones pendientes</option>
          <option value="failed">No cumplido</option>
          <option value="consultation">Requiere consulta</option>
          <option value="partial">Cobertura parcial</option>
          <option value="pending">Sin evaluar</option>
        </select>
      </Field>
      <p>
        {gaps.length} lagunas · hasta diez por página. Para priorizar, considerar impacto,
        exposición, evidencia y dependencias; el nivel mínimo ASVS no indica severidad.
      </p>
      {gaps.slice(currentPage * 10, currentPage * 10 + 10).map((gap) => (
        <article className="asvs-gap" key={gap.reference}>
          <h3>
            <Button variant="secondary" onClick={() => openRequirement(gap.reference)}>
              {gap.reqId}
            </Button>
          </h3>
          <p>{gap.nextStep}</p>
          <p>
            {gap.tasks.some((t) => t.state !== 'Completada')
              ? 'Tareas abiertas de seguimiento'
              : 'Sin tarea abierta para este requisito'}
          </p>
          {gap.tasks.map((task) => {
            const record = records.find((r) => r.id === task.id);
            return record ? (
              <Button key={task.id} variant="secondary" onClick={() => openRecord(record)}>
                {task.title} · {task.state}
              </Button>
            ) : null;
          })}
        </article>
      ))}
      {gaps.length > 10 && (
        <div className="row">
          <Button
            variant="secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Lagunas anteriores
          </Button>
          <span>
            Página {currentPage + 1} de {lastPage + 1}
          </span>
          <Button
            variant="secondary"
            disabled={currentPage >= lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Más lagunas ASVS
          </Button>
        </div>
      )}
    </section>
  );
}
