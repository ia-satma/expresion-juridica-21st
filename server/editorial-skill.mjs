import fs from 'node:fs/promises';
import path from 'node:path';
export const EDITORIAL_SKILL_ID = 'ej-content-studio-v1';
let cached;
export function editorialSkill() {
  if (!cached) cached = fs.readFile(path.join(process.cwd(), 'server/agents/ej-content-studio/SKILL.md'), 'utf8').then(text => text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim());
  return cached;
}
