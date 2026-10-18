import { madridDate, type Kind } from '../shared/model';
export function blank(kind: Kind): Record<string, any> {
  const base = { kind, title: '', project: '' };
  switch (kind) {
    case 'task':
      return {
        ...base,
        phase: 'Descubrimiento',
        type: 'General',
        tags: [],
        priority: 'Media',
        state: 'Por hacer',
        due: madridDate(),
        blocked: '',
        nextStep: '',
        description: '',
        solution: '',
        dependencyIds: [],
        checks: [],
      };
    case 'entry':
      return {
        ...base,
        date: madridDate(),
        taskIds: [],
        linkedIds: [],
        activity: '',
        result: '',
        learning: '',
        nextStep: '',
        blocker: '',
        competency: '',
        evidence: '',
        original: '',
        contribution: 'Investigué',
      };
    case 'incident':
      return {
        ...base,
        date: madridDate(),
        description: '',
        solution: '',
        resolvedDate: '',
      };
    case 'idea':
      return { ...base, date: madridDate(), description: '' };
    case 'practice':
      return {
        ...base,
        category: 'Seguridad y privacidad',
        explanation: '',
        source: '',
        owner: '',
        status: 'Borrador',
        mandatory: false,
        pinned: false,
        phases: [],
        tags: [],
      };
    case 'decision':
      return {
        ...base,
        date: madridDate(),
        problem: '',
        alternatives: '',
        decision: '',
        reason: '',
        consequences: '',
        evidence: '',
      };
    case 'meeting':
      return {
        ...base,
        from: new Date(Date.now() - 7 * 86400000).toISOString(),
        to: new Date().toISOString(),
        body: '',
        agreements: '',
        agreementItems: [],
        sourceIds: [],
      };
    case 'project':
      return {
        ...base,
        objective: '',
        specifications: '',
        competency: '',
        tutor: '',
        validationDate: '',
        validationReference: '',
      };
    case 'subproject':
      return { ...base, description: '', status: 'Activo' };
    case 'objective':
      return {
        ...base,
        description: '',
        links: [],
        validation: {
          state: 'Pendiente',
          date: '',
          reference: '',
          responsible: '',
          linkIds: [],
        },
      };
  }
}
