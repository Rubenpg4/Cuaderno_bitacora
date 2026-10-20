import type { AsvsTaskLink } from '../shared/asvsTracking';
import type { Proposal, Snapshot } from '../shared/model';
import { AsvsRequirementContext } from './AsvsProposalDetails';

export default function AsvsTaskProposalInfo({
  proposal,
  snapshot,
}: {
  proposal: Proposal;
  snapshot: Snapshot;
}) {
  if (proposal.kind !== 'task' || !Array.isArray(proposal.patch.asvsLinks)) return null;
  return (
    <section aria-label="Asociaciones ASVS propuestas" className="asvs-proposal-change">
      {(proposal.patch.asvsLinks as AsvsTaskLink[]).map((link) => (
        <div key={link.reqId}>
          <AsvsRequirementContext
            reference={link.reqId}
            snapshot={snapshot}
            excludeTaskId={proposal.targetId}
          />
          <dl className="asvs-change">
            <div>
              <dt>Por qué aplica</dt>
              <dd>{link.reason}</dd>
            </div>
            <div>
              <dt>Alcance en la tarea</dt>
              <dd>{link.scope}</dd>
            </div>
            <div>
              <dt>Criterio de aceptación</dt>
              <dd>{link.criterion}</dd>
            </div>
            <div>
              <dt>Cómo se verificará</dt>
              <dd>{link.method}</dd>
            </div>
          </dl>
        </div>
      ))}
    </section>
  );
}
