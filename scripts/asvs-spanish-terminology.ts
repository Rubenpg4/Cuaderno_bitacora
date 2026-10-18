import { asvsCatalog } from '../shared/asvsCatalog.js';
import type { AsvsTranslation } from '../shared/asvsTranslation.js';

// Editorial corrections to DeepL output, tied to the pinned ASVS 5.0.0 source.
export function reviewAsvsSpanishTerminology(translation: AsvsTranslation): AsvsTranslation {
  return {
    ...translation,
    terminologyRevision: 1,
    requirements: translation.requirements.map((translated, index) => {
      const source = asvsCatalog.requirements[index];
      let description = translated.description;
      if (source.description.includes('self-contained')) {
        description = description
          .replaceAll('tokens autónomos', 'tokens autocontenidos')
          .replaceAll('token autónomo', 'token autocontenido');
      }
      if (source.reqId === 'V7.4.1')
        description = description.replaceAll(
          'lista de tokens caducados',
          'lista de tokens cuyas sesiones han finalizado',
        );
      return {
        ...translated,
        chapterName: source.chapterId === 'V9' ? 'Tokens autocontenidos' : translated.chapterName,
        sectionName: source.sectionId === 'V1.3' ? 'Saneamiento' : translated.sectionName,
        description,
      };
    }),
  };
}
