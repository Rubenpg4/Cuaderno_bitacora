import { asvsCatalog } from '../shared/asvsCatalog';
import type { AsvsTaskLink } from '../shared/asvsTracking';
import type { Proposal, Snapshot } from '../shared/model';

export default function AsvsTaskProposalInfo({
  proposal,
  records,
}: {
  proposal: Proposal;
  records: Snapshot['records'];
}) {
  if (proposal.kind !== 'task' || !Array.isArray(proposal.patch.asvsLinks)) return null;
  return (
    <section aria-label="Asociaciones ASVS propuestas">
      {(proposal.patch.asvsLinks as AsvsTaskLink[]).map((link) => {
        const r = asvsCatalog.requirements.find(
          (item) => item.reqId === link.reqId || item.canonicalRef === link.reqId,
        );
        const similar = records.filter(
          (item) =>
            item.kind === 'task' &&
            item.id !== proposal.targetId &&
            item.project === proposal.projectId &&
            item.asvsLinks?.some((l) => l.reqId === r?.reqId),
        );
        return (
          <div key={link.reqId}>
            <strong>{r?.canonicalRef ?? link.reqId}</strong>
            <p lang="en">{r?.description}</p>
            <p>Motivo: {link.reason}</p>
            <p>
              Alcance: {link.scope} · Criterio: {link.criterion} · Método: {link.method}
            </p>
            <p>
              Posibles tareas relacionadas: {similar.map((t) => t.title).join('; ') || 'Ninguna'}
            </p>
          </div>
        );
      })}
    </section>
  );
}
