// Verifies an `expo export` output does / does not contain the fictional demo catalog.
// Usage: node e2e/check-bundle.js <distDir> --expect-demo | --expect-no-demo
const fs = require('fs');
const path = require('path');
const [dir, mode] = process.argv.slice(2);
const MARKERS = ['Forno Nove', 'ONLYADS40', 'Smashville', 'Kicks Collective'];
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|hbc)$/.test(f)) files.push(p);
  }
})(dir);
const hits = MARKERS.filter((m) => files.some((f) => fs.readFileSync(f).includes(m)));
const want = mode === '--expect-demo';
const ok = want ? hits.length === MARKERS.length : hits.length === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} ${dir}: ${files.length} bundle file(s), demo markers found: [${hits.join(', ')}] (expected ${want ? 'all' : 'none'})`);
process.exit(ok ? 0 : 1);
