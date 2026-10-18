export const ASVS_VERSION = '5.0.0';
export const ASVS_SOURCE_URL =
  'https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv';
export const ASVS_SOURCE_SHA256 =
  '98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680';
export const ASVS_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

export type AsvsLevel = 1 | 2 | 3;
export interface AsvsRequirement {
  readonly catalogVersion: string;
  readonly reqId: string;
  readonly canonicalRef: string;
  readonly segments: readonly [number, number, number];
  readonly chapterId: string;
  readonly chapterName: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly description: string;
  readonly minLevel: AsvsLevel;
  readonly contentSha256: string;
}
export interface AsvsCatalog {
  readonly formatVersion: 1;
  readonly version: string;
  readonly language: 'en';
  readonly source: string;
  readonly sourceSha256: string;
  readonly attribution: string;
  readonly license: 'CC-BY-SA-4.0';
  readonly licenseUrl: string;
  readonly requirements: readonly AsvsRequirement[];
}

export function parseAsvsReference(reference: string, selectedVersion: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(selectedVersion)) return null;
  const canonical = /^v([\d.]+)-(.+)$/.exec(reference);
  if (canonical && canonical[1] !== selectedVersion) return null;
  const id = canonical ? canonical[2] : reference.replace(/^V/, '');
  if (!/^[1-9]\d*\.[1-9]\d*\.[1-9]\d*$/.test(id)) return null;
  const segments = id.split('.').map(Number) as [number, number, number];
  if (segments.some((segment) => !Number.isSafeInteger(segment))) return null;
  return {
    reqId: `V${id}`,
    canonicalRef: `v${selectedVersion}-${id}`,
    segments,
  };
}

export function compareAsvsRequirements(a: AsvsRequirement, b: AsvsRequirement) {
  for (let index = 0; index < 3; index++) {
    const difference = a.segments[index] - b.segments[index];
    if (difference) return difference;
  }
  return 0;
}

export function selectAsvsRequirements(catalog: AsvsCatalog, level: AsvsLevel) {
  if (![1, 2, 3].includes(level)) throw Error('Nivel ASVS no válido.');
  return catalog.requirements.filter((requirement) => requirement.minLevel <= level);
}

export function resolveAsvsReference(catalog: AsvsCatalog, reference: string) {
  const parsed = parseAsvsReference(reference, catalog.version);
  return parsed
    ? catalog.requirements.find((requirement) => requirement.reqId === parsed.reqId)
    : undefined;
}
