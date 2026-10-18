export interface AsvsReportSelection {
  projectId: string;
  requirementIds: string[];
  taskIds: string[];
  evidenceIds: string[];
  includeOriginal: boolean;
}

export interface AsvsReportPreview {
  date: string;
  digest: string;
  md: string;
  csv: string;
}
