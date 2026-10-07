import { ROW_ID } from './change.js';
import type { WorkflowConfig } from './config.js';
import { isObject } from './guards.js';
import { canonicalJson, HEX64, sha256 } from './hash.js';
import { rowTags } from './junit.js';
import { assertSafeRepoPath } from './paths.js';
import { listRepoFiles, lstatInRepo, readRepoFile } from './safe-fs.js';

export interface AcceptanceEntry {
  readonly path: string;
  readonly sha256: string;
  readonly rows: readonly string[];
}

export interface HarnessEntry {
  readonly path: string;
  readonly sha256: string | null; // null: the path did not exist when the baseline ran
}

export interface Manifest {
  readonly acceptance: readonly AcceptanceEntry[];
  readonly harness: readonly HarnessEntry[];
}

const fileSha = (root: string, path: string): string | null =>
  lstatInRepo(root, path) === null ? null : sha256(readRepoFile(root, path));

function acceptanceEntry(root: string, path: string): AcceptanceEntry {
  const bytes = readRepoFile(root, path);
  const rows = [...new Set(rowTags(bytes.toString('utf8')))].sort();
  return Object.freeze({ path, sha256: sha256(bytes), rows: Object.freeze(rows) });
}

/** Hashes every file under test.acceptanceDir and every test.harness path, as they are in `root` now. */
export function buildManifest(root: string, config: WorkflowConfig): Manifest {
  const acceptance = listRepoFiles(root, config.test.acceptanceDir).map((p) => acceptanceEntry(root, p));
  const harness = config.test.harness.map((path) => Object.freeze({ path, sha256: fileSha(root, path) }));
  return Object.freeze({ acceptance: Object.freeze(acceptance), harness: Object.freeze(harness) });
}

const isSafePath = (p: unknown): boolean => {
  if (typeof p !== 'string') return false;
  try {
    assertSafeRepoPath(p);
    return true;
  } catch {
    return false;
  }
};
const isHash = (s: unknown): boolean => typeof s === 'string' && HEX64.test(s);
const isAcceptanceEntry = (e: unknown): boolean =>
  isObject(e) && isSafePath(e.path) && isHash(e.sha256) &&
  Array.isArray(e.rows) && e.rows.every((r) => typeof r === 'string' && ROW_ID.test(r));
const isHarnessEntry = (e: unknown): boolean =>
  isObject(e) && isSafePath(e.path) && (e.sha256 === null || isHash(e.sha256));

/** Reads the manifest fields of a parsed baseline.json. Throws a plain message if they are malformed. */
export function parseManifest(raw: Readonly<Record<string, unknown>>): Manifest {
  const { acceptance, harness } = raw;
  if (!Array.isArray(acceptance) || !acceptance.every(isAcceptanceEntry)) {
    throw new Error('"acceptance" must list { path, sha256, rows } entries');
  }
  if (!Array.isArray(harness) || !harness.every(isHarnessEntry)) {
    throw new Error('"harness" must list { path, sha256 } entries (sha256 may be null)');
  }
  return Object.freeze({ acceptance: acceptance as AcceptanceEntry[], harness: harness as HarnessEntry[] });
}

/** Throws unless the manifest equals the acceptance folder and harness as they are in `root` now. */
export function assertManifestCurrent(root: string, config: WorkflowConfig, manifest: Manifest): void {
  const now = canonicalJson(buildManifest(root, config));
  if (now !== canonicalJson({ acceptance: manifest.acceptance, harness: manifest.harness })) {
    throw new Error(
      `baseline.json is stale or invalid: files under ${config.test.acceptanceDir} or test.harness changed since the baseline ran; re-run wf baseline`,
    );
  }
}
