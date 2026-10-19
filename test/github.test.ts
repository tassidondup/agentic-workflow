import { beforeEach, describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { ghReader } from '../src/github.js';
import { ghCalls, resetGhCalls, withFakeGh, type GhRoute } from './helpers/fake-gh.js';

const REPO = 'acme/widgets';
const SHA = 'a'.repeat(40);
const real: Exec = () => {
  throw new Error('real exec must not be used');
};

const reader = (routes: readonly GhRoute[]) => ghReader(REPO, '/unused', withFakeGh(routes, real));
const review = (i: number) => ({
  user: { login: `u${i}` },
  state: 'APPROVED',
  commit_id: SHA,
  submitted_at: '2026-10-18T00:00:00Z',
});
const reviewsPath = (page: number) => `repos/${REPO}/pulls/7/reviews?per_page=100&page=${page}`;
const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => review(from + i));

beforeEach(resetGhCalls);

describe('pullsForCommit', () => {
  it('maps the list response', () => {
    const gh = reader([
      {
        path: `repos/${REPO}/commits/${SHA}/pulls?per_page=100`,
        body: [
          { number: 7, merged_at: '2026-10-18T01:00:00Z', base: { ref: 'main' } },
          { number: 8, merged_at: null, base: { ref: 'dev' } },
        ],
      },
    ]);
    expect(gh.pullsForCommit(SHA)).toEqual([
      { number: 7, mergedAt: '2026-10-18T01:00:00Z', baseRef: 'main' },
      { number: 8, mergedAt: null, baseRef: 'dev' },
    ]);
  });
});

describe('pull', () => {
  const body = (mergedBy: unknown) => ({
    number: 7,
    merged: true,
    merged_by: mergedBy,
    user: { login: 'author' },
    head: { sha: SHA },
  });

  it('maps merged_by.login, user.login and head.sha', () => {
    const gh = reader([{ path: `repos/${REPO}/pulls/7`, body: body({ login: 'merger' }) }]);
    expect(gh.pull(7)).toEqual({ number: 7, merged: true, mergedBy: 'merger', author: 'author', headSha: SHA });
  });

  it('maps a null merged_by to null', () => {
    const gh = reader([{ path: `repos/${REPO}/pulls/7`, body: body(null) }]);
    expect(gh.pull(7).mergedBy).toBeNull();
  });
});

describe('reviews', () => {
  it('pages until a short page', () => {
    const gh = reader([
      { path: reviewsPath(1), body: page(100) },
      { path: reviewsPath(2), body: page(3, 100) },
    ]);
    const got = gh.reviews(7);
    expect(got).toHaveLength(103);
    expect(got[0]).toEqual({ user: 'u0', state: 'APPROVED', commitId: SHA, submittedAt: '2026-10-18T00:00:00Z' });
    expect(ghCalls).toEqual([reviewsPath(1), reviewsPath(2)]);
  });

  it('fails closed after 10 full pages', () => {
    const routes = Array.from({ length: 10 }, (_, i) => ({ path: reviewsPath(i + 1), body: page(100) }));
    expect(() => reader(routes).reviews(7)).toThrow(/too many reviews/);
  });

  it('maps a null user to null', () => {
    const gh = reader([{ path: reviewsPath(1), body: [{ ...review(0), user: null }] }]);
    expect(gh.reviews(7)[0]?.user).toBeNull();
  });
});

describe('response shape', () => {
  it('throws when a field has the wrong type or is missing', () => {
    const gh = reader([
      { path: `repos/${REPO}/pulls/7`, body: { number: 7, merged: 'yes', user: { login: 'a' }, head: { sha: SHA } } },
      { path: `repos/${REPO}/pulls/8`, body: { merged: true, user: { login: 'a' }, head: { sha: SHA } } },
      { path: `repos/${REPO}/commits/${SHA}/pulls?per_page=100`, body: { not: 'an array' } },
    ]);
    expect(() => gh.pull(7)).toThrow(/unexpected/i);
    expect(() => gh.pull(8)).toThrow(/unexpected/i);
    expect(() => gh.pullsForCommit(SHA)).toThrow(/unexpected/i);
  });

  it('throws when gh prints something that is not JSON', () => {
    const exec: Exec = () => ({ status: 0, stdout: 'not json', stderr: '' });
    expect(() => ghReader(REPO, '/unused', exec).pull(7)).toThrow(/not valid JSON/);
  });
});

describe('failure handling', () => {
  const failing = (stderr: string): Exec => () => ({ status: 1, stdout: '', stderr });

  it.each(['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_pat_11AAAA_bbbb'])(
    'throws on a failed gh call and never echoes the token %s',
    (token) => {
      const run = () => ghReader(REPO, '/unused', failing(`bad credentials ${token}`)).pull(7);
      expect(run).toThrow(/\[redacted\]/);
      try {
        run();
      } catch (e) {
        expect((e as Error).message).not.toContain(token);
      }
    },
  );

  it('caps error text at 300 characters', () => {
    try {
      ghReader(REPO, '/unused', failing('x'.repeat(5000))).pull(7);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(400);
    }
  });

  it('reports a 404 from the fake', () => {
    expect(() => reader([]).pull(7)).toThrow(/HTTP 404/);
  });
});

describe('input validation', () => {
  it('rejects an invalid repo before calling gh', () => {
    const exec = withFakeGh([], real);
    expect(() => ghReader('a/b/../c', '/unused', exec)).toThrow(/Unsafe repository/);
    expect(() => ghReader('../..', '/unused', exec)).toThrow(/Unsafe repository/);
    expect(() => ghReader('acme/..', '/unused', exec)).toThrow(/Unsafe repository/);
    expect(ghCalls).toEqual([]);
  });

  it.each(['HEAD', 'A'.repeat(40), 'a'.repeat(39), '--help'])('rejects sha %j before calling gh', (sha) => {
    expect(() => reader([]).pullsForCommit(sha)).toThrow(/Unsafe commit sha/);
    expect(ghCalls).toEqual([]);
  });

  it.each([0, 1.5, -1, Number.NaN, 2 ** 60])('rejects pull number %j before calling gh', (n) => {
    const gh = reader([]);
    expect(() => gh.pull(n)).toThrow(/Invalid pull request number/);
    expect(() => gh.reviews(n)).toThrow(/Invalid pull request number/);
    expect(ghCalls).toEqual([]);
  });
});

describe('invocation', () => {
  it('runs gh api with the version headers and no shell', () => {
    const seen: { cmd: string; args: readonly string[]; cwd: string }[] = [];
    const exec: Exec = (cmd, args, cwd) => {
      seen.push({ cmd, args, cwd });
      return { status: 0, stdout: '[]', stderr: '' };
    };
    ghReader(REPO, '/the/root', exec).pullsForCommit(SHA);
    expect(seen).toEqual([
      {
        cmd: 'gh',
        args: [
          'api',
          '-H',
          'Accept: application/vnd.github+json',
          '-H',
          'X-GitHub-Api-Version: 2022-11-28',
          `repos/${REPO}/commits/${SHA}/pulls?per_page=100`,
        ],
        cwd: '/the/root',
      },
    ]);
  });
});
