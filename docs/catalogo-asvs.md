<!-- doc:summary: Catálogo local ASVS 5.0.0: fuente, importación validada, referencias, regeneración y empaquetado. -->
# Catálogo local ASVS

El catálogo público de OWASP ASVS 5.0.0 está incorporado como recurso local. La configuración por cuaderno, la vista y las evaluaciones humanas con historial están disponibles según el [contrato de verificación](verificacion-asvs.md); las herramientas MCP ASVS siguen pendientes. Cargar el catálogo no activa ASVS ni crea prácticas, tareas o datos del cuaderno.

## Fuente y atribución

`resources/asvs/5.0.0.en.csv` conserva los bytes del [CSV inglés oficial de la etiqueta v5.0.0](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv). Su SHA-256 es `98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680`. `.gitattributes` impide que Git convierta los saltos de línea de la fuente y altere su huella.

La fuente y el contenido del catálogo generado conservan la atribución a OWASP Foundation y sus colaboradores y la licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Se incluyen licencia original y notas de transformación en `resources/asvs/`. El catálogo base permanece íntegro en inglés; se añade estructura, referencias, ordenación y huellas. La traducción española es una adaptación separada con la misma licencia. Las descripciones son contenido: los consumidores deben dibujarlas como texto, sin evaluarlas ni inyectarlas como HTML.

## Traducción profesional al español

`pnpm run asvs:translate` utiliza la [API oficial de DeepL](https://developers.deepl.com/api-reference/translate/request-translation) para traducir los 345 requisitos, los 17 capítulos y las 80 secciones. Requiere `DEEPL_API_KEY` en el entorno del proceso; nunca se añade al repositorio, al frontend ni al catálogo generado. Las claves Free (`:fx`) usan `api-free.deepl.com`; las demás usan `api.deepl.com`. No se siguen redirecciones ni se muestran cuerpos de error del proveedor.

Solo se envían textos del catálogo público, en lotes de hasta 50 textos únicos, de inglés a español, con contexto de seguridad, formato conservado y preferencia por el modelo de mayor calidad. Los números, niveles, referencias, URL y fragmentos entre comillas invertidas se protegen mediante XML y se verifican antes de escribir. El comando usa red y puede consumir la cuota o generar cargos según el plan de DeepL. No accede a cuadernos, evaluaciones, evidencias ni vaults.

El resultado completo se guarda por sustitución atómica en `shared/catalogs/asvs-5.0.0.es.json`, con proveedor, versión, huella de fuente y huella inglesa de cada requisito. Una respuesta incompleta o inválida conserva el artefacto anterior. Si ya hay traducción válida, el comando no vuelve a llamar a DeepL. El valor `null` indica que todavía no se ha generado; la interfaz lo indica y muestra inglés. La terminología y el significado normativo requieren revisión humana antes de distribuir una nueva traducción; las comprobaciones automáticas no certifican su calidad lingüística.

La vista utiliza español cuando está disponible, permite desplegar el original oficial en inglés y busca en descripciones de ambos idiomas y títulos españoles. Las traducciones afectan exclusivamente a la presentación: no cambian IDs, niveles, huellas oficiales ni vigencia de evaluaciones. `pnpm run asvs:check` valida también cobertura completa, jerarquía, textos, términos protegidos y correspondencia con la fuente de la traducción, sin red.

`scripts/asvs-spanish-terminology.ts` aplica correcciones editoriales versionadas (`terminologyRevision: 1`): **Saneamiento** para la sección de sanitization, **tokens autocontenidos** para self-contained tokens y distinción entre sesiones finalizadas y tokens caducados en V7.4.1. La traducción procede de DeepL con estos ajustes locales; no es una traducción oficial de OWASP.

## Importación y regeneración

`service/asvs/importCatalog.ts` analiza CSV entrecomillado con comas, comillas escapadas, campos multilínea, LF/CRLF y BOM UTF-8. Rechaza UTF-8 inválido, controles no admitidos, columnas ausentes/duplicadas/extra, filas incompletas, campos vacíos, niveles fuera de 1..3, IDs duplicados y jerarquías o nombres incoherentes. Admite las líneas vacías finales del CSV oficial, pero no filas vacías interiores. El texto conserva sus saltos originales.

Los límites son 1 MiB de entrada, 16000 caracteres por campo y 400 filas contando cabecera. El importador es puro y no accede al vault. El generador valida por completo entrada y huella antes de escribir; utiliza un archivo temporal y sustitución por renombrado. Una entrada inválida conserva el catálogo previo.

| Comando | Resultado |
| --- | --- |
| `pnpm run asvs:generate` | Regenera `shared/catalogs/asvs-5.0.0.en.json` desde la fuente local, con formato estable y sin fechas variables. |
| `pnpm run asvs:check` | Comprueba huella e igualdad exacta con la regeneración sin escribir. También se ejecuta en `pnpm run build`. |
| `pnpm test tests/asvsCatalog.test.ts` | Verifica CSV válidos/malformados, referencias, límites, catálogo completo y generación reproducible en directorios temporales. |

Los comandos funcionan sin red. Cambiar la fuente requiere revisar explícitamente metadatos, huella, distribución, licencia y pruebas; el generador no descarga actualizaciones.

## Consulta y empaquetado

`shared/asvs.ts` define tipos y funciones de referencias, ordenación, resolución y selección. `shared/asvsCatalog.ts` carga el JSON generado y exporta `asvsCatalog` con requisitos y segmentos congelados.

Cada requisito conserva ID original (`V1.2.5`), referencia canónica (`v5.0.0-1.2.5`), segmentos numéricos, capítulo/sección, descripción, nivel mínimo, versión y huella. `parseAsvsReference` acepta IDs originales, referencias numéricas o canónicas de la versión seleccionada. `resolveAsvsReference` solo busca en el catálogo recibido: una referencia canónica de otra versión no se resuelve. La comparación usa números: 1.2 precede a 1.10.

| Nivel mínimo | Requisitos de ese nivel | Selección acumulativa `L <= nivel` |
| --- | --- | --- |
| 1 | 70 | 70 |
| 2 | 183 | 253 |
| 3 | 92 | 345 |

El catálogo contiene 345 IDs únicos, 17 capítulos y 80 secciones. La selección no interpreta las condiciones más exigentes de niveles superiores dentro de una descripción; esas condiciones se conservan para revisión.

`scripts/build-service.mjs` copia los catálogos inglés y español, licencia y atribución a `dist-service/catalogs/`. El empaquetado de escritorio ya copia todo `dist-service` a sus recursos. La consulta queda disponible sin red ni datos del usuario; solo generar una nueva traducción requiere DeepL.
