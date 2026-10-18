# OWASP ASVS 5.0.0 — public catalog source

`5.0.0.en.csv` is the unchanged English CSV from the OWASP ASVS `v5.0.0` tag:

https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv

SHA-256: `98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680`.

Copyright OWASP Foundation and ASVS contributors. Licensed under Creative Commons
Attribution-ShareAlike 4.0 International (CC BY-SA 4.0); see `LICENSE.md` and
https://creativecommons.org/licenses/by-sa/4.0/.

The generated `shared/catalogs/asvs-5.0.0.en.json` retains all requirement descriptions
without translation. Changes from the source: structured fields, canonical references,
numeric ordering, source metadata and content fingerprints. The catalog content in that
JSON retains the same CC BY-SA 4.0 license. Its metadata includes attribution and license.

Regenerate with `pnpm run asvs:generate`; verify with `pnpm run asvs:check`.
The separate `shared/catalogs/asvs-5.0.0.es.json` is a Spanish adaptation generated
with the official DeepL API by `pnpm run asvs:translate`. It retains OWASP attribution
and the CC BY-SA 4.0 license of the source. It is not an official OWASP translation.
Only public catalog texts are sent to DeepL; no notebook data or credentials are stored
in the artifact. Original English content fingerprints remain the assessment authority.
The Spanish artifact is used offline after generation; `null` means not yet generated.
Review terminology and normative meaning before distributing new translations.
Versioned local editorial corrections use "Saneamiento" and "tokens autocontenidos"
and distinguish terminated sessions from expired tokens in V7.4.1.
Both commands work offline and never access a notebook or vault. The CSV is data;
its descriptions must be rendered as text, never executed or injected as HTML.
