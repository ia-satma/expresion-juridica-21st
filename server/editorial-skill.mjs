import fs from 'node:fs/promises';
import path from 'node:path';
import { BRAND_CONTACT } from './brand-contact.mjs';
export const EDITORIAL_SKILL_ID = 'ej-content-studio-v2';
export const SOCIAL_DESIGN_SKILL_ID = 'ej-social-design-v2';
let cached;
let socialCached;
export function editorialSkill() {
  if (!cached) cached = fs.readFile(path.join(process.cwd(), 'server/agents/ej-content-studio/SKILL.md'), 'utf8').then(text => `${text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim()}\n\nOfficial institutional email: ${BRAND_CONTACT.email}. Use this exact contact when a firm contact is appropriate. This supersedes old contact details in brand reference documents. Preserve unrelated third-party email addresses in the user's source material.`);
  return cached;
}
export function socialDesignSkill() {
  if (!socialCached) socialCached = fs.readFile(path.join(process.cwd(), 'server/agents/ej-social-design/SKILL.md'), 'utf8').then(text => text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim());
  return socialCached;
}
