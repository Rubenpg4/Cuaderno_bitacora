import { randomUUID } from 'node:crypto';
import { madridDate, type Kind, type Practice, type Snapshot } from '../../shared/model.js';

export function blank(kind: Kind): Record<string, unknown> {
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
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }),
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
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }),
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
export function initialState(): Snapshot {
  const now = new Date().toISOString();
  return {
    mcpProfile: 'personal',
    mcpProfileVersion: 1,
    drafts: {},
    captures: [],
    records: [
      [
        'Confirmar qué datos puedo compartir',
        'Seguridad y privacidad',
        'Consulta las herramientas autorizadas y prepara extractos sin secretos.',
      ],
      [
        'Dejar constancia de decisiones',
        'Organización',
        'Anota el motivo, el responsable y el siguiente paso.',
      ],
      [
        'Revisar costes antes de crear recursos',
        'Costes y recursos',
        'Comprueba presupuesto, aprobación y cómo retirarás el recurso.',
      ],
      [
        'Acompañar resultados de evidencias',
        'Calidad técnica',
        'Vincula pruebas, revisiones o referencias a cada resultado.',
      ],
    ].map(
      ([title, category, explanation]) =>
        ({
          ...blank('practice'),
          id: randomUUID(),
          version: 1,
          createdAt: now,
          updatedAt: now,
          title,
          category,
          explanation,
          pinned: true,
          source: 'Ejemplo orientativo de Bitácora; pendiente de adaptar a la empresa.',
        }) as Practice,
    ),
    shares: [],
    proposals: [],
    history: [],
    taskSeries: [],
    taskSeriesHistory: [],
    grants: [],
    settings: {
      companyAuthorized: false,
      universityStructure: 'Objetivos, fases, aportaciones, resultados y aprendizajes',
    },
  };
}
