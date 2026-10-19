import type { Exec, ExecResult } from './exec.js';
import { assertSafeRepoPath } from './paths.js';

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
  /** Git file mode: the new mode, or the old mode for a deletion (100644 file, 100755 executable, 120000 symlink, 160000 submodule). */
  readonly mode: string;
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
  const r = run(root, ['diff', '--raw', '--no-renames', '-z', `${assertRef(base)}...HEAD`, '--'], exec);
  if (r.status !== 0) throw fail('diff', r);
  // With -z each entry is ":<old mode> <new mode> <old sha> <new sha> <status>" NUL "<path>" NUL.
  const fields = r.stdout.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [meta, path] = [fields[i], fields[i + 1]];
    if (meta === undefined || path === undefined) break;
    const parts = meta.startsWith(':') ? meta.slice(1).split(' ') : [];
    const [oldMode, newMode, status] = [parts[0], parts[1], parts[4]];
    if (oldMode === undefined || newMode === undefined || status === undefined) throw new Error(`git diff returned an unreadable entry: "${meta.slice(0, 60)}"`);
    files.push(Object.freeze({ status, path, mode: status === 'D' ? oldMode : newMode }));
  }
  return Object.freeze(files);
}

/** Blob sha of `repoPath` at `ref`, or null if the path does not exist there. Throws if `ref` is unknown. A null result must never be treated as a pass (a killed git process also maps to status 1). */
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

/** Text of `repoPath` at `ref`, or null if the path does not exist there. Throws if `ref` is unknown or git fails. */
export function fileAt(root: string, ref: string, repoPath: string, exec: Exec): string | null {
  const sha = blobAt(root, ref, repoPath, exec);
  if (sha === null) return null;
  const r = run(root, ['cat-file', 'blob', sha], exec);
  if (r.status !== 0) throw fail('cat-file', r);
  return r.stdout;
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

/** True if the checkout is a shallow clone, whose history cannot be trusted for attribution. Throws on anything unexpected. */
export function isShallow(root: string, exec: Exec): boolean {
  const r = run(root, ['rev-parse', '--is-shallow-repository'], exec);
  if (r.status !== 0) throw fail('rev-parse', r);
  const out = r.stdout.trim();
  if (out === 'true') return true;
  if (out === 'false') return false;
  throw new Error(`git rev-parse --is-shallow-repository returned unexpected output: "${out.slice(0, 40)}"`);
}
