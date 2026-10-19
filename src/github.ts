import type { Exec } from './exec.js';
import { isObject } from './guards.js';

export interface PullSummary {
  readonly number: number;
  readonly mergedAt: string | null;
  readonly baseRef: string;
}

export interface PullDetail {
  readonly number: number;
  readonly merged: boolean;
  readonly mergedBy: string | null;
  readonly author: string | null;
  readonly headSha: string;
}

export interface Review {
  readonly user: string | null;
  readonly state: string;
  readonly commitId: string | null;
  readonly submittedAt: string | null;
}

export interface GitHubReader {
  pullsForCommit(sha: string): readonly PullSummary[];
  pull(n: number): PullDetail;
  reviews(n: number): readonly Review[];
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const TOKEN_RE = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+)/g;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_ERROR_CHARS = 300;
const GH_HEADERS = ['-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];

const bad = (what: string): Error => new Error(`Unexpected GitHub response: ${what}`);

const scrub = (text: string): string => text.replace(TOKEN_RE, '[redacted]').slice(0, MAX_ERROR_CHARS);

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw bad(`${key} is not a non-empty string`);
  return v;
}

function nullableStr(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(`${key} is not a string or null`);
  return v;
}

function num(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw bad(`${key} is not a positive integer`);
  return v;
}

function obj(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = o[key];
  if (!isObject(v)) throw bad(`${key} is not an object`);
  return v;
}

/** `login` of a nested user object, or null if the user is null (deleted account). */
function login(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (!isObject(v)) throw bad(`${key} is not an object or null`);
  return str(v, 'login');
}

const asList = (v: unknown): readonly unknown[] => {
  if (!Array.isArray(v)) throw bad('expected a JSON array');
  return v;
};

const asItem = (v: unknown): Record<string, unknown> => {
  if (!isObject(v)) throw bad('list item is not an object');
  return v;
};

function toSummary(v: unknown): PullSummary {
  const o = asItem(v);
  return Object.freeze({ number: num(o, 'number'), mergedAt: nullableStr(o, 'merged_at'), baseRef: str(obj(o, 'base'), 'ref') });
}

function toDetail(v: unknown): PullDetail {
  const o = asItem(v);
  if (typeof o.merged !== 'boolean') throw bad('merged is not a boolean');
  return Object.freeze({
    number: num(o, 'number'),
    merged: o.merged,
    mergedBy: login(o, 'merged_by'),
    author: login(o, 'user'),
    headSha: str(obj(o, 'head'), 'sha'),
  });
}

function toReview(v: unknown): Review {
  const o = asItem(v);
  return Object.freeze({
    user: login(o, 'user'),
    state: str(o, 'state'),
    commitId: nullableStr(o, 'commit_id'),
    submittedAt: nullableStr(o, 'submitted_at'),
  });
}

function assertPullNumber(n: number): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid pull request number: ${String(n)}`);
  return n;
}

function assertRepo(repo: string): string {
  const [owner, name] = repo.split('/');
  const dotted = (s: string | undefined): boolean => s === '.' || s === '..';
  if (!REPO_RE.test(repo) || dotted(owner) || dotted(name)) throw new Error(`Unsafe repository: "${repo}"`);
  return repo;
}

function assertSha(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error(`Unsafe commit sha: "${sha}"`);
  return sha;
}

/** Read-only GitHub access through `gh api`. `gh` reads its own credentials; `wf` never sees a token. */
export function ghReader(repo: string, root: string, exec: Exec): GitHubReader {
  const safeRepo = assertRepo(repo);

  function get(path: string): unknown {
    const r = exec('gh', ['api', ...GH_HEADERS, path], root);
    if (r.status !== 0) {
      throw new Error(`gh api ${path} failed (exit ${r.status}): ${scrub(r.stderr.trim() || 'no error output')}`);
    }
    try {
      return JSON.parse(r.stdout) as unknown;
    } catch {
      throw bad(`${path} is not valid JSON`);
    }
  }

  return {
    pullsForCommit(sha) {
      const items = asList(get(`repos/${safeRepo}/commits/${assertSha(sha)}/pulls?per_page=${PAGE_SIZE}`));
      if (items.length >= PAGE_SIZE) throw new Error('Refusing to continue: too many pull requests for one commit to list safely');
      return Object.freeze(items.map(toSummary));
    },
    pull(n) {
      return toDetail(get(`repos/${safeRepo}/pulls/${assertPullNumber(n)}`));
    },
    reviews(n) {
      const safeN = assertPullNumber(n);
      const all: Review[] = [];
      for (let p = 1; p <= MAX_PAGES; p += 1) {
        const items = asList(get(`repos/${safeRepo}/pulls/${safeN}/reviews?per_page=${PAGE_SIZE}&page=${p}`));
        all.push(...items.map(toReview));
        if (items.length < PAGE_SIZE) return Object.freeze(all);
      }
      throw new Error(`Refusing to continue: too many reviews on pull request ${safeN} (more than ${MAX_PAGES * PAGE_SIZE})`);
    },
  };
}
