/**
 * Copies src/core (minus tests) into supabase/functions/_shared/core so the edge
 * functions judge runs with exactly the same code as the app.
 * Run after changing anything in src/core:  npm run sync:core
 * (src/core/__tests__/sharedCore.test.ts fails if the copy is stale.)
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const from = join(root, 'src/core');
const to = join(root, 'supabase/functions/_shared/core');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => f.endsWith('.ts'));
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`Copied ${files.length} files to ${to}`);
