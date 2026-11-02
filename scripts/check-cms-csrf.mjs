import assert from 'node:assert/strict';
import { currentCmsCsrf } from '../public/admin/csrf.js';
// Auth-state in another tab rotates the double-submit cookie. A mutation
// must send that current cookie value instead of the first tab's stale state.
assert.equal(currentCmsCsrf('other=value; cms_csrf=first', 'first'), 'first');
assert.equal(currentCmsCsrf('other=value; cms_csrf=second', 'first'), 'second');
assert.equal(currentCmsCsrf('cms_csrf=third; other=value', 'first'), 'third');
assert.equal(currentCmsCsrf('other=value', 'first'), 'first');
assert.equal(currentCmsCsrf('cms_csrf=%invalid', 'first'), 'first');
assert.equal(currentCmsCsrf('', ''), '');
console.log(JSON.stringify({ passed: true, crossTabCsrfRotation: true, validationUnchanged: true }));
