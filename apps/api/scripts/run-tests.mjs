// Node 20's test runner cannot glob for TypeScript files and its directory
// discovery only matches .js, so collect the suites here and hand them to tsx.
// Keeping this in Node (rather than a shell glob) keeps `pnpm test` working on
// Windows, which the release scripts still target.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(apiRoot, 'src');

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  }));
  return found.flat();
}

const tests = (await collectTests(sourceRoot)).sort();
if (tests.length === 0) {
  console.error(`No *.test.ts files found under ${relative(apiRoot, sourceRoot)}`);
  process.exit(1);
}

console.log(`Running ${tests.length} test file(s)`);
const runner = spawn(
  process.execPath,
  [join(apiRoot, 'node_modules/tsx/dist/cli.mjs'), '--test', ...tests.map((test) => relative(apiRoot, test))],
  { cwd: apiRoot, stdio: 'inherit' }
);
runner.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
