import type { Exec, ExecResult } from './exec.js';
import { assertSafeRepoPath } from './paths.js';

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
}

const SAFE_REF = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/** Rejects anything that could be read as a git option or revision expression. */
export function assertRef(ref: string): string {
  if (!SAFE_REF.test(ref) || ref.includes('..')) throw new Error(`Unsafe git ref: "${ref}"`);
  return ref;
}

function run(root: string, args: readonly string[], exec: Exec): ExecResult {
  return exec('git', args, root);
}

function fail(what: string, r: ExecResult): Error {
  return new Error(`git ${what} failed (exit ${r.status}): ${r.stderr.trim()}`);
}

/** Files changed on HEAD since it diverged from `base`. A rename is reported as a delete plus an add. */
export function changedFiles(root: string, base: string, exec: Exec): readonly ChangedFile[] {
  const r = run(root, ['diff', '--name-status', '--no-renames', '-z', `${assertRef(base)}...HEAD`, '--'], exec);
  if (r.status !== 0) throw fail('diff', r);
  const fields = r.stdout.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, path] = [fields[i], fields[i + 1]];
    if (status === undefined || path === undefined) break;
    files.push(Object.freeze({ status, path }));
  }
  return Object.freeze(files);
}

/** Blob sha of `repoPath` at `ref`, or null if the path does not exist there. Throws if `ref` is unknown. */
export function blobAt(root: string, ref: string, repoPath: string, exec: Exec): string | null {
  const safeRef = assertRef(ref);
  const safePath = assertSafeRepoPath(repoPath);
  // `rev-parse --verify --quiet ref:path` exits 1 for both a bad ref and a missing path, so check the ref first.
  const commit = run(root, ['rev-parse', '--verify', '--quiet', `${safeRef}^{commit}`], exec);
  if (commit.status !== 0) throw fail('rev-parse', commit);
  const r = run(root, ['rev-parse', '--verify', '--quiet', `${safeRef}:${safePath}`], exec);
  if (r.status === 1) return null;
  if (r.status !== 0) throw fail('rev-parse', r);
  return r.stdout.trim();
}

/** Newest commit reachable from `ref` that touched `repoPath`, or null if none did. */
export function lastCommitTouching(root: string, ref: string, repoPath: string, exec: Exec): string | null {
  const safeRef = assertRef(ref);
  const safePath = assertSafeRepoPath(repoPath);
  const r = run(root, ['--literal-pathspecs', 'log', '-n', '1', '--format=%H', safeRef, '--', safePath], exec);
  if (r.status !== 0) throw fail('log', r);
  const sha = r.stdout.trim();
  return sha === '' ? null : sha;
}
