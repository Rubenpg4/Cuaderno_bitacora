import { useState } from 'react';
import { asvsCatalog } from '../../shared/asvsCatalog';
import type {
  AsvsCatalogDiff,
  AsvsCatalogMapping,
  AsvsConfig,
  AsvsOverview,
} from '../../shared/asvsTracking';
import { api } from '../api';
import { Button, Field, Notice } from '../ui';

export default function AsvsCatalogUpdate({
  config,
  onSaved,
}: {
  config: AsvsConfig;
  onSaved: (overview: AsvsOverview) => void;
}) {
  const [preview, setPreview] = useState<{
    fromVersion: string;
    toVersion: string;
    diff: AsvsCatalogDiff;
    previewToken: string;
  }>();
  const [mappings, setMappings] = useState<AsvsCatalogMapping[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = {
    projectId: config.projectId,
    expectedConfigVersion: config.version,
    catalogVersion: asvsCatalog.version,
  };
  async function load() {
    setBusy(true);
    setError('');
    setConfirmed(false);
    try {
      setPreview(await api('asvs-catalog-preview', base));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(
        await api<AsvsOverview>('asvs-catalog-update', {
          ...base,
          previewToken: preview!.previewToken,
          confirmed,
          mappings,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    added: 'Añadidos',
    removed: 'Retirados',
    changed: 'Cambiados',
    unchanged: 'Texto y nivel sin cambios',
  };
  return (
    <section className="asvs-config" aria-label="Actualizar catálogo ASVS">
      <h2>Actualizar catálogo ASVS</h2>
      <p>
        Versión fijada: {config.catalogVersion}. Versión empaquetada: {asvsCatalog.version}. Las
        correspondencias justificadas ayudan a planificar; cada evaluación de la nueva versión
        empieza Pendiente.
      </p>
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>
        Previsualizar actualización de catálogo
      </Button>
      {preview && (
        <form onSubmit={save}>
          <p>
            {preview.fromVersion} → {preview.toVersion}. Los ticks, exclusiones y vínculos antiguos
            se conservan como historial; no se trasladan por coincidencia de número.
          </p>
          {(Object.keys(labels) as (keyof AsvsCatalogDiff)[]).map((key) => (
            <details key={key}>
              <summary>
                {labels[key]} ({preview.diff[key].length})
              </summary>
              <p>{preview.diff[key].join(', ') || 'Ninguno'}</p>
            </details>
          ))}
          {mappings.map((mapping, index) => (
            <div className="asvs-fields" key={index}>
              {(['from', 'to', 'reason'] as const).map((field) => (
                <Field
                  key={field}
                  label={`${field === 'from' ? 'Referencia anterior' : field === 'to' ? 'Referencia nueva' : 'Justificación de correspondencia'} ${index + 1}`}
                >
                  <input
                    required
                    maxLength={field === 'reason' ? 16000 : 240}
                    value={mapping[field]}
                    onChange={(e) =>
                      setMappings((previous) =>
                        previous.map((m, i) =>
                          i === index ? { ...m, [field]: e.target.value } : m,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
              <Button
                variant="secondary"
                onClick={() => setMappings((previous) => previous.filter((_, i) => i !== index))}
              >
                Retirar correspondencia {index + 1}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={mappings.length >= 50}
            onClick={() =>
              setMappings((previous) => [...previous, { from: '', to: '', reason: '' }])
            }
          >
            Añadir correspondencia justificada
          </Button>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            Confirmo el cambio de catálogo y la reevaluación sin trasladar ticks
          </label>
          <Button type="submit" disabled={busy || !confirmed}>
            Confirmar actualización de catálogo
          </Button>
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
