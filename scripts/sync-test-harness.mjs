#!/usr/bin/env node
/**
 * Sync src/server/test-harness/ (and this script) from devvit-app-template.
 *
 *   node scripts/sync-test-harness.mjs                 # latest master from GitHub
 *   node scripts/sync-test-harness.mjs --ref v2.0.0    # a tag or branch
 *   node scripts/sync-test-harness.mjs --source ../devvit-app-template   # local checkout
 *   node scripts/sync-test-harness.mjs --check         # exit 1 if out of date, change nothing
 *
 * The harness folder is replaced wholesale: do not edit it in an app repo. Put
 * app-specific helpers next to your tests, or upstream them to the template.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = 'https://github.com/AllHailSeizure/devvit-app-template.git';
const HARNESS = 'src/server/test-harness';
const SCRIPT = 'scripts/sync-test-harness.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const check = args.includes('--check');
const ref = opt('--ref') ?? 'master';
const root = process.cwd();

let src = opt('--source') && resolve(opt('--source'));
let tmp;
let commit = 'local';
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), 'harness-sync-'));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, REPO, tmp], { stdio: 'inherit' });
  src = tmp;
  commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} else if (existsSync(join(src, '.git'))) {
  commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

if (resolve(src) === resolve(root)) {
  console.error('Refusing to sync the template onto itself.');
  process.exit(2);
}

const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? files(p).map((f) => join(name, f)) : [name];
      })
    : [];
const version = (dir) => /HARNESS_VERSION = '([^']+)'/.exec(readFileSync(join(dir, HARNESS, 'index.ts'), 'utf8'))?.[1];

const want = files(join(src, HARNESS));
const have = files(join(root, HARNESS));
const changed = [
  ...want.filter(
    (f) => !have.includes(f) || readFileSync(join(src, HARNESS, f), 'utf8') !== readFileSync(join(root, HARNESS, f), 'utf8')
  ),
  ...have.filter((f) => !want.includes(f)).map((f) => `${f} (removed upstream)`),
];
const scriptChanged =
  !existsSync(join(root, SCRIPT)) || readFileSync(join(src, SCRIPT), 'utf8') !== readFileSync(join(root, SCRIPT), 'utf8');

const before = existsSync(join(root, HARNESS, 'index.ts')) ? (version(root) ?? 'unversioned') : 'none';
const after = version(src);

if (check) {
  if (changed.length || scriptChanged) {
    console.error(`Test harness is out of date (${before} here, ${after} upstream @ ${commit.slice(0, 7)}):`);
    for (const f of changed) console.error(`  ${HARNESS}/${f}`);
    if (scriptChanged) console.error(`  ${SCRIPT}`);
    console.error('Run: npm run harness:sync');
    process.exitCode = 1;
  } else {
    console.log(`Test harness ${before} is up to date with ${ref} (${commit.slice(0, 7)}).`);
  }
} else {
  rmSync(join(root, HARNESS), { recursive: true, force: true });
  cpSync(join(src, HARNESS), join(root, HARNESS), { recursive: true });
  cpSync(join(src, SCRIPT), join(root, SCRIPT));
  writeFileSync(
    join(root, '.harness-sync.json'),
    `${JSON.stringify({ source: REPO, ref, commit, version: after }, null, 2)}\n`
  );
  console.log(`Synced ${relative(root, join(root, HARNESS))} ${before} -> ${after} (${ref} @ ${commit.slice(0, 7)}).`);
  if (changed.length) console.log(`Changed: ${changed.join(', ')}`);
  console.log('Next: npm run check');
}

if (tmp) rmSync(tmp, { recursive: true, force: true });
