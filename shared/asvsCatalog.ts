import data from './catalogs/asvs-5.0.0.en.json' with { type: 'json' };
import { ASVS_SOURCE_SHA256, ASVS_VERSION, parseAsvsReference, type AsvsCatalog } from './asvs.js';

// Generated and checked against the pinned public CSV before packaging.
if (
  data.formatVersion !== 1 ||
  data.version !== ASVS_VERSION ||
  data.sourceSha256 !== ASVS_SOURCE_SHA256 ||
  data.language !== 'en' ||
  data.license !== 'CC-BY-SA-4.0'
)
  throw Error('Metadatos del catálogo ASVS empaquetado no válidos.');

export const asvsCatalog: AsvsCatalog = Object.freeze({
  ...data,
  formatVersion: data.formatVersion,
  language: data.language,
  license: data.license,
  requirements: Object.freeze(
    data.requirements.map((requirement) => {
      const reference = parseAsvsReference(requirement.reqId, data.version);
      const { minLevel } = requirement;
      if (
        !reference ||
        requirement.catalogVersion !== data.version ||
        requirement.canonicalRef !== reference.canonicalRef ||
        requirement.segments.length !== 3 ||
        requirement.segments.some((segment, index) => segment !== reference.segments[index]) ||
        (minLevel !== 1 && minLevel !== 2 && minLevel !== 3)
      )
        throw Error('Requisito del catálogo ASVS empaquetado no válido.');
      return Object.freeze({
        ...requirement,
        minLevel,
        segments: Object.freeze(reference.segments),
      });
    }),
  ),
});
