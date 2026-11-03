import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// No matches or secret values are ever printed. Test-only tokens are assembled
// at runtime; test fixtures with placeholder words are not live credentials.
const patterns = [
  ['openai', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/g],
  ['google-api', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['github', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const textFile = filename => /\.(?:[cm]?js|jsx|tsx?|json|html|css|md|txt|ya?ml|toml|sh|py|example)$/.test(filename) || /(?:^|\/)\.env(?:\.|$)/.test(filename);
const findings = []; let filesChecked = 0;
for (const filename of tracked) {
  if (!textFile(filename) || !fs.existsSync(filename)) continue;
  filesChecked++;
  const text = fs.readFileSync(filename, 'utf8');
  for (const [kind, expression] of patterns) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) findings.push({ file: filename, line: text.slice(0, match.index).split('\n').length, kind });
  }
  if (/(?:^|\/)\.env(?:\.|$)/.test(filename) && !filename.endsWith('.example')) findings.push({ file: filename, kind: 'tracked-environment-file' });
}
const report = { passed: findings.length === 0, filesChecked, findings, valuesPrinted: false, scope: 'tracked working tree; pattern detection, not a guarantee against every possible secret format' };
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
