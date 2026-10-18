// Copy the merged experiment CSVs from ../results into public/data so the
// site always shows the latest simulation output. Missing files are reported,
// never replaced with placeholder data.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', '..', 'results');
const dataDir = join(here, '..', 'public', 'data');
const files = ['summary.csv', 'timeseries.csv', 'cwnd.csv'];

mkdirSync(dataDir, { recursive: true });
for (const name of files) {
  const src = join(resultsDir, name);
  const dest = join(dataDir, name);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`synced ${name}`);
  } else {
    rmSync(dest, { force: true });
    console.warn(`missing ${src} - run scripts/run_experiments.py first`);
  }
}
