import type { AsvsCatalog } from './asvs.js';

export const asvsTechnicalText =
  /`[^`]+`|https?:\/\/[^\s`<>"()]+|\b(?:L[123]|V\d+(?:\.\d+)+|\d+(?:[.,]\d+)*)\b/g;

function sameTechnicalText(source: string, translated: string) {
  const tokens = (text: string) => [...text.matchAll(asvsTechnicalText)].map((match) => match[0]);
  return JSON.stringify(tokens(source)) === JSON.stringify(tokens(translated));
}

export interface AsvsTranslation {
  readonly formatVersion: 1;
  readonly catalogVersion: string;
  readonly sourceSha256: string;
  readonly language: 'es';
  readonly provider: 'DeepL';
  readonly terminologyRevision: 1;
  readonly requirements: readonly {
    readonly reqId: string;
    readonly sourceContentSha256: string;
    readonly chapterName: string;
    readonly sectionName: string;
    readonly description: string;
  }[];
}

// Translations are presentation data. Assessments keep the official English fingerprints.
export function validateAsvsTranslation(input: unknown, catalog: AsvsCatalog): AsvsTranslation {
  const data = input as AsvsTranslation | null;
  if (
    !data ||
    data.formatVersion !== 1 ||
    data.catalogVersion !== catalog.version ||
    data.sourceSha256 !== catalog.sourceSha256 ||
    data.language !== 'es' ||
    data.provider !== 'DeepL' ||
    data.terminologyRevision !== 1 ||
    !Array.isArray(data.requirements) ||
    data.requirements.length !== catalog.requirements.length
  )
    throw Error('Metadatos o cobertura de la traducción ASVS no válidos.');
  const chapters = new Map<string, string>();
  const sections = new Map<string, string>();
  data.requirements.forEach((translated, index) => {
    const source = catalog.requirements[index];
    if (
      !translated ||
      translated.reqId !== source.reqId ||
      translated.sourceContentSha256 !== source.contentSha256 ||
      [translated.chapterName, translated.sectionName, translated.description].some(
        (text) =>
          typeof text !== 'string' ||
          !text.trim() ||
          text.length > 16000 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text),
      ) ||
      !sameTechnicalText(source.description, translated.description) ||
      !sameTechnicalText(source.chapterName, translated.chapterName) ||
      !sameTechnicalText(source.sectionName, translated.sectionName) ||
      (chapters.has(source.chapterId) &&
        chapters.get(source.chapterId) !== translated.chapterName) ||
      (sections.has(source.sectionId) && sections.get(source.sectionId) !== translated.sectionName)
    )
      throw Error(`Traducción ASVS no válida para ${source.reqId}.`);
    chapters.set(source.chapterId, translated.chapterName);
    sections.set(source.sectionId, translated.sectionName);
  });
  return data;
}

export function localizeAsvsCatalog(catalog: AsvsCatalog, input: unknown) {
  if (input === null) return catalog.requirements;
  const translation = validateAsvsTranslation(input, catalog);
  return catalog.requirements.map((source, index) => ({
    ...source,
    chapterName: translation.requirements[index].chapterName,
    sectionName: translation.requirements[index].sectionName,
    description: translation.requirements[index].description,
  }));
}
