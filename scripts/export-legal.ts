/** Writes docs/legal/privacy.md and terms.md from src/legal/content.ts (host these at public URLs). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGAL_DOCS } from '@/legal/content';

const dir = join(__dirname, '..', 'docs', 'legal');
mkdirSync(dir, { recursive: true });
for (const [id, doc] of Object.entries(LEGAL_DOCS)) {
  const md = [`# ${doc.title}`, '', `_Last updated: ${doc.updated}_`, '', ...(doc.reviewed ? [] : ['> **DRAFT — pending legal review. Do not publish.**', '']), ...doc.sections.flatMap((s) => [`## ${s.heading}`, '', ...s.body.flatMap((p) => [p, ''])])].join('\n');
  writeFileSync(join(dir, `${id}.md`), md);
  console.log(`wrote docs/legal/${id}.md`);
}
