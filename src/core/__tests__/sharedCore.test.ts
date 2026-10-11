import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const core = join(__dirname, '..');
const shared = join(__dirname, '../../../supabase/functions/_shared/core');

describe('edge function copy of src/core', () => {
  it('is up to date (run `npm run sync:core`)', () => {
    const files = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
    expect(files(shared)).toEqual(files(core));
    for (const f of files(core)) {
      expect({ f, same: readFileSync(join(shared, f), 'utf8') === readFileSync(join(core, f), 'utf8') }).toEqual({ f, same: true });
    }
  });
});
