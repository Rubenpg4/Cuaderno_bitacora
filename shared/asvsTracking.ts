import type { AsvsLevel } from './asvs.js';

export const ASVS_STATES = [
  'Pendiente',
  'Cumplido',
  'No cumplido',
  'No aplicable',
  'Requiere consulta',
] as const;
export type AsvsState = (typeof ASVS_STATES)[number];
export type AsvsApplicability = 'Por determinar' | 'Aplicable' | 'No aplicable';
export interface AsvsTaskLink {
  mandatory?: boolean;
  catalogVersion: string;
  reqId: string;
  reason: string;
  scope: string;
  criterion: string;
  method: string;
}
export interface AsvsReviewRequest {
  projectId: string;
  targetId: string;
  expectedVersion: number;
  expectedConfigVersion: number;
  state: AsvsState;
  applicability: AsvsApplicability;
  scope: AsvsAssessment['scope'];
  scopeDetail: string;
  pendingScope: string;
  taskId?: string;
  expectedTaskVersion?: number;
  note: string;
  method: string;
  responsible: string;
  evidence: { recordId?: string; reference: string; revision: string }[];
}
export interface AsvsProposal {
  destination?: 'task';
  id: string;
  provider: import('./model.js').Provider;
  reference: string;
  requirementSha256: string;
  request: AsvsReviewRequest;
  before: AsvsAssessment;
  sourceFingerprints: { recordId: string; fingerprint: string }[];
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}
export interface AsvsConfig {
  projectId: string;
  version: number;
  catalogVersion: string;
  catalogSha256: string;
  level: AsvsLevel | null;
  contextRevision: number;
  contextReason: string;
  catalogBaseline?: AsvsCatalogBaseline[];
}
export interface AsvsCatalogBaseline {
  reqId: string;
  contentSha256: string;
  minLevel: AsvsLevel;
}
export interface AsvsCatalogDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}
export interface AsvsCatalogMapping {
  from: string;
  to: string;
  reason: string;
}
export interface AsvsSourceRevision {
  projectId: string;
  catalogVersion: string;
  reference: string;
  revision: string;
  version: number;
  reason: string;
  at: string;
}
export interface AsvsRevisionRequest {
  projectId: string;
  expectedConfigVersion: number;
  expectedVersion: number;
  reference: string;
  revision: string;
  reason: string;
}
export interface AsvsRevisionProposal {
  id: string;
  provider: import('./model.js').Provider;
  request: AsvsRevisionRequest;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}
export interface AsvsEvidence {
  id: string;
  projectId: string;
  reference: string;
  revision: string;
  recordId?: string;
  fingerprint?: string;
}
export interface AsvsAssessment {
  id: string;
  version: number;
  projectId: string;
  catalogVersion: string;
  reqId: string;
  requirementSha256: string;
  state: AsvsState;
  applicability: AsvsApplicability;
  scope: 'project' | 'component' | 'task';
  scopeDetail: string;
  pendingScope: string;
  taskId?: string;
  taskFingerprint?: string;
  note: string;
  method: string;
  responsible: string;
  reviewedAt: string | null;
  actor: 'Tú';
  evaluatedLevel: AsvsLevel;
  contextRevision: number;
  evidence: AsvsEvidence[];
  decision: { reason: string; reference: string; responsible: string; at: string } | null;
}
export type AsvsHistory = {
  id: string;
  projectId: string;
  at: string;
  actor: 'Tú';
} & (
  | { kind: 'config'; before: AsvsConfig | null; after: AsvsConfig }
  | { kind: 'assessment'; before: AsvsAssessment | null; after: AsvsAssessment }
  | { kind: 'task-verification'; before: AsvsAssessment | null; after: AsvsAssessment }
  | { kind: 'source-revision'; before: AsvsSourceRevision | null; after: AsvsSourceRevision }
  | {
      kind: 'catalog';
      before: AsvsConfig;
      after: AsvsConfig;
      diff: AsvsCatalogDiff;
      mappings: AsvsCatalogMapping[];
    }
);
export interface AsvsData {
  dataVersion: 1;
  config: AsvsConfig;
  assessments: AsvsAssessment[];
  history: AsvsHistory[];
  taskVerifications?: AsvsAssessment[];
  proposals?: AsvsProposal[];
  sourceRevisions?: AsvsSourceRevision[];
  revisionProposals?: AsvsRevisionProposal[];
}
export interface AsvsAssessmentStatus {
  active: boolean;
  stale: boolean;
  reasons: string[];
  freshnessKey: string;
  partial: boolean;
  tick: boolean;
  excluded: boolean;
}
export interface AsvsOverview {
  config: AsvsConfig | null;
  items: { assessment: AsvsAssessment; status: AsvsAssessmentStatus }[];
  summary: AsvsCoverageCounts;
  chapters: { chapterId: string; counts: AsvsCoverageCounts }[];
  gaps: AsvsGap[];
}
export interface AsvsCoverageCounts {
  selected: number;
  fulfilled: number;
  excluded: number;
  denominator: number;
  stale: number;
  partial: number;
  undetermined: number;
  failed: number;
  pending: number;
  consultation: number;
}
export interface AsvsGap {
  reference: string;
  reqId: string;
  chapterId: string;
  category: 'revalidation' | 'failed' | 'consultation' | 'partial' | 'pending';
  cause: string;
  nextStep: string;
  tasks: {
    id: string;
    title: string;
    version: number;
    state: import('./model.js').Task['state'];
  }[];
}
