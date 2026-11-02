import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { BRAND_CONTACT, canonicalBrandEmail, normalizePublicBrandCopy } from '../server/brand-contact.mjs';
import { editorialSkill } from '../server/editorial-skill.mjs';

assert.equal(BRAND_CONTACT.email, 'Consultoria@expresionjuridica.com');
assert.equal(canonicalBrandEmail('expresionjuridica@live.com'), BRAND_CONTACT.email);
assert.equal(canonicalBrandEmail('consultoria@expresionjuridica.com'), BRAND_CONTACT.email);
assert.equal(canonicalBrandEmail('persona@cliente.example'), 'persona@cliente.example');
assert.equal(normalizePublicBrandCopy('Certeza jurídica y certeza. CERTEZA.'), 'Certidumbre jurídica y certidumbre. CERTIDUMBRE.');
assert.equal(normalizePublicBrandCopy('mailto:expresionjuridica@live.com'), `mailto:${BRAND_CONTACT.email}`);
assert.match(await editorialSkill(), /Official institutional email: Consultoria@expresionjuridica\.com/);
let checkedFiles = 0;
for (const name of execFileSync('git', ['ls-files', 'sitio', 'firma-cms'], { encoding: 'utf8' }).trim().split('\n')) {
  if (!/\.(html|js)$/.test(name)) continue;
  const text = await fs.readFile(name, 'utf8');
  assert(!/expresionjuridica@live\.com/i.test(text), `Old brand email remains in ${name}`);
  if (name.startsWith('sitio/')) assert(!/\bcerteza\b/i.test(text), `Old public brand wording remains in ${name}`);
  checkedFiles++;
}
console.log(JSON.stringify({ passed: true, canonicalContact: true, agentInstructions: true, publicCopy: true, thirdPartyEmailsPreserved: true, checkedFiles }));
