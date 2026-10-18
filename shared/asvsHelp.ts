import { ASVS_VERSION, type AsvsRequirement } from './asvs.js';

// Public chapter paths checked against the official v5.0.0 release.
const chapters = [
  '0x10-V1-Encoding-and-Sanitization.md',
  '0x11-V2-Validation-and-Business-Logic.md',
  '0x12-V3-Web-Frontend-Security.md',
  '0x13-V4-API-and-Web-Service.md',
  '0x14-V5-File-Handling.md',
  '0x15-V6-Authentication.md',
  '0x16-V7-Session-Management.md',
  '0x17-V8-Authorization.md',
  '0x18-V9-Self-contained-Tokens.md',
  '0x19-V10-OAuth-and-OIDC.md',
  '0x20-V11-Cryptography.md',
  '0x21-V12-Secure-Communication.md',
  '0x22-V13-Configuration.md',
  '0x23-V14-Data-Protection.md',
  '0x24-V15-Secure-Coding-and-Architecture.md',
  '0x25-V16-Security-Logging-and-Error-Handling.md',
  '0x26-V17-WebRTC.md',
];

export function asvsHelpLinks(requirement: AsvsRequirement) {
  const chapter = chapters[requirement.segments[0] - 1];
  if (requirement.catalogVersion !== ASVS_VERSION || !chapter) return null;
  return {
    source: `https://github.com/OWASP/ASVS/blob/v${ASVS_VERSION}/5.0/en/${chapter}`,
    guide: 'https://cheatsheetseries.owasp.org/IndexASVS.html',
  };
}
