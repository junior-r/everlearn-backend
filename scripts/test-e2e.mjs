// Runs the HTTP suite and keeps everything it printed in `test-results/http-suite.log`.
// A vitest worker has died mid-run on Windows without leaving a trace; the log of the
// last run, and of the last run that failed, is what is left to look at afterwards.
import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, mkdirSync } from 'node:fs';

const DIRECTORY = 'test-results';
const LOG = `${DIRECTORY}/http-suite.log`;
const FAILED_LOG = `${DIRECTORY}/http-suite.failed.log`;

mkdirSync(DIRECTORY, { recursive: true });
const log = createWriteStream(LOG);
log.write(`HTTP suite started ${new Date().toISOString()} on node ${process.version}\n\n`);

const vitest = spawn(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', './vitest.config.e2e.ts', '--reporter=verbose', ...process.argv.slice(2)],
  // A shell, because on Windows `pnpm` is a .cmd file
  { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } },
);
vitest.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
vitest.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  log.write(chunk);
});
vitest.on('close', (code, signal) => {
  log.end(`\nHTTP suite ended ${new Date().toISOString()} with exit code ${code ?? 'none'} (signal ${signal ?? 'none'})\n`, () => {
    if (code !== 0) {
      copyFileSync(LOG, FAILED_LOG);
      console.error(`\nThe full output of this failed run was kept in ${FAILED_LOG}`);
    }
    process.exit(code ?? 1);
  });
});
