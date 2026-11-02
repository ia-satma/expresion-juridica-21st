import fs from 'node:fs/promises';

export const BRAND_CONTACT = Object.freeze(JSON.parse(await fs.readFile(new URL('./assets/ej-brand/contact.json', import.meta.url), 'utf8')));
const aliases = new Set([BRAND_CONTACT.email, ...BRAND_CONTACT.legacyEmails].map(value => value.toLowerCase()));
export function canonicalBrandEmail(value) {
  return typeof value === 'string' && aliases.has(value.trim().toLowerCase()) ? BRAND_CONTACT.email : value;
}
export function normalizePublicBrandCopy(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/(?<![A-Za-z0-9._%+-])(?:expresionjuridica@live\.com|consultoria@expresionjuridica\.com)(?![A-Za-z0-9._%+-])/gi, BRAND_CONTACT.email)
    .replace(/\bcerteza\b/gi, word => word === word.toUpperCase() ? 'CERTIDUMBRE' : word[0] === 'C' ? 'Certidumbre' : 'certidumbre');
}
