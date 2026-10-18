import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asvsCatalog } from '../shared/asvsCatalog';
import spanishCatalog from '../shared/catalogs/asvs-5.0.0.es.json';
import { localizeAsvsCatalog, validateAsvsTranslation } from '../shared/asvsTranslation';
import { translateAsvsWithDeepL, writeAsvsTranslation } from '../scripts/asvs-translate';

// Provider responses are simulated; fixtures never claim to be real DeepL translations.
const simulatedProvider = vi.fn<typeof fetch>(async (_url, options) => {
  const body = JSON.parse(String(options?.body));
  return Response.json({
    translations: body.text.map((text: string) => ({
      text: text.replaceAll('Verify', 'Verifique'),
    })),
  });
});

describe('traducción profesional del catálogo público ASVS', () => {
  it('el artefacto distribuido cubre los 345 requisitos y conserva las correcciones de terminología', () => {
    const translated = validateAsvsTranslation(spanishCatalog, asvsCatalog);
    expect(translated.requirements).toHaveLength(345);
    expect(translated.terminologyRevision).toBe(1);
    expect(translated.requirements.find((r) => r.reqId === 'V1.3.1')?.sectionName).toBe(
      'Saneamiento',
    );
    expect(translated.requirements.find((r) => r.reqId === 'V9.1.1')?.chapterName).toBe(
      'Tokens autocontenidos',
    );
    expect(translated.requirements.find((r) => r.reqId === 'V7.4.1')?.description).toContain(
      'tokens cuyas sesiones han finalizado',
    );
    expect(
      translated.requirements.every(
        (r, index) => r.description !== asvsCatalog.requirements[index].description,
      ),
    ).toBe(true);
  });

  it('traduce todos los textos por lotes, preservando referencias, términos y huellas oficiales', async () => {
    simulatedProvider.mockClear();
    const translation = await translateAsvsWithDeepL('test-only:fx', simulatedProvider);
    expect(translation.requirements).toHaveLength(345);
    expect(translation.provider).toBe('DeepL');
    expect(validateAsvsTranslation(translation, asvsCatalog)).toBe(translation);
    const localized = localizeAsvsCatalog(asvsCatalog, translation);
    expect(localized[0].description).toContain('Verifique');
    expect(asvsCatalog.requirements[0].description).toContain('Verify');
    expect(localized.map((r) => [r.reqId, r.canonicalRef, r.minLevel, r.contentSha256])).toEqual(
      asvsCatalog.requirements.map((r) => [r.reqId, r.canonicalRef, r.minLevel, r.contentSha256]),
    );
    expect(localizeAsvsCatalog(asvsCatalog, null)).toBe(asvsCatalog.requirements);
    const sent: string[] = [];
    for (const [url, options] of simulatedProvider.mock.calls) {
      expect(url).toBe('https://api-free.deepl.com/v2/translate');
      expect(options?.redirect).toBe('error');
      const body = JSON.parse(String(options?.body));
      expect(body.target_lang).toBe('ES');
      expect(body.source_lang).toBe('EN');
      expect(body.text.length).toBeLessThanOrEqual(50);
      expect(Buffer.byteLength(String(options?.body))).toBeLessThanOrEqual(128 * 1024);
      expect(body.ignore_tags).toEqual(['keep']);
      sent.push(...body.text);
    }
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent.some((text) => text.includes('<keep>'))).toBe(true);
  });

  it('rechaza traducciones incompletas, vacías, incoherentes, de otra fuente o con números alterados', async () => {
    const valid = await translateAsvsWithDeepL('test-only', simulatedProvider);
    const mutable = { ...valid, requirements: valid.requirements.map((r) => ({ ...r })) };
    for (const change of [
      (data: typeof mutable) => {
        data.requirements.pop();
      },
      (data: typeof mutable) => {
        data.sourceSha256 = 'other';
      },
      (data: typeof mutable) => {
        data.requirements[0].sourceContentSha256 = 'other';
      },
      (data: typeof mutable) => {
        data.requirements[0].description = ' ';
      },
      (data: typeof mutable) => {
        data.requirements[0].description += '\u0000';
      },
      (data: typeof mutable) => {
        data.requirements[1].reqId = data.requirements[0].reqId;
      },
      (data: typeof mutable) => {
        data.requirements[1].chapterName = 'Otro capítulo';
      },
      (data: typeof mutable) => {
        data.requirements[0].description += ' 999999';
      },
    ]) {
      const changed = JSON.parse(JSON.stringify(valid));
      change(changed);
      expect(() => validateAsvsTranslation(changed, asvsCatalog)).toThrow();
    }
  });

  it('rechaza fallos del proveedor sin divulgar su cuerpo ni credenciales', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(translateAsvsWithDeepL('', unused)).rejects.toThrow('DEEPL_API_KEY');
    expect(unused).not.toHaveBeenCalled();
    await expect(
      translateAsvsWithDeepL(
        'test-only',
        async () => new Response('private-body', { status: 403 }),
      ),
    ).rejects.toThrow('HTTP 403');
    await expect(
      translateAsvsWithDeepL('test-only', async () => {
        throw Error('private-key');
      }),
    ).rejects.toThrow('No se pudo conectar');
    await expect(
      translateAsvsWithDeepL('test-only', async () => Response.json({ translations: [] })),
    ).rejects.toThrow('incompleto');
    await expect(
      translateAsvsWithDeepL('test-only', async () => Response.json(null)),
    ).rejects.toThrow('incompleto');
    await expect(
      translateAsvsWithDeepL('test-only', async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        return Response.json({
          translations: body.text.map((text: string) => ({
            text: text.replace(/<keep>[^<]*<\/keep>/g, '<keep>changed</keep>'),
          })),
        });
      }),
    ).rejects.toThrow('protegidos');
  });

  it('separa números protegidos de las unidades que DeepL puede concatenar en XML', async () => {
    const result = await translateAsvsWithDeepL('test-only', async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return Response.json({
        translations: body.text.map((text: string) => ({
          text: text.replace('<keep>32</keep>-bit', '<keep>32</keep>bits'),
        })),
      });
    });
    expect(result.requirements.find((r) => r.reqId === 'V6.5.2')?.description).toContain('32 bits');
  });

  it('escribe un artefacto completo de forma atómica y conserva el anterior ante entrada inválida', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-translation-'));
    try {
      const output = join(directory, 'translation.json');
      writeFileSync(output, 'null\n');
      const valid = await translateAsvsWithDeepL('test-only', simulatedProvider);
      await writeAsvsTranslation(output, valid);
      const previous = readFileSync(output, 'utf8');
      expect(JSON.parse(previous)).toEqual(valid);
      await writeAsvsTranslation(output, valid);
      expect(readFileSync(output, 'utf8')).toBe(previous);
      await expect(writeAsvsTranslation(output, { ...valid, requirements: [] })).rejects.toThrow();
      expect(readFileSync(output, 'utf8')).toBe(previous);
      expect(readdirSync(directory)).toEqual(['translation.json']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
