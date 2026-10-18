import data from './catalogs/asvs-5.0.0.es.json' with { type: 'json' };
import { asvsCatalog } from './asvsCatalog.js';
import { localizeAsvsCatalog } from './asvsTranslation.js';

export const asvsDisplayRequirements = localizeAsvsCatalog(asvsCatalog, data);
export const asvsTranslationProvider = data === null ? null : 'DeepL';
