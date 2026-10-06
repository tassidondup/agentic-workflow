import { posix } from 'node:path';
import { assertChangeId, changeRepoDir } from './paths.js';
import { lstatInRepo, readRepoFile } from './safe-fs.js';
import { openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const MAX_CONTEXT_LINES = 150;
const CONTEXT = 'docs/context.md';
const LINK = /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g;

const exists = (root: string, repoPath: string): boolean => lstatInRepo(root, repoPath) !== null;

/** Issue for one relative link target in docs/context.md, or none if it resolves inside the repo. */
function linkIssue(root: string, target: string, line: number): Issue[] {
  const issue = (message: string): Issue[] => [{ file: CONTEXT, line, message }];
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split('#')[0] ?? '');
  } catch {
    return issue(`Broken link: ${target}`);
  }
  const resolved = posix.normalize(posix.join(posix.dirname(CONTEXT), decoded)).replace(/\/$/, '');
  if (resolved === '..' || resolved.startsWith('../')) {
    return issue(`Link points outside the repository: ${target}`);
  }
  if (resolved === '.') return [];
  try {
    return exists(root, resolved) ? [] : issue(`Broken link: ${target}`);
  } catch (e) {
    return issue(`Broken link: ${target} (${(e as Error).message})`);
  }
}

function contextIssues(root: string): Issue[] {
  if (!exists(root, CONTEXT)) return [{ file: CONTEXT, line: 0, message: `${CONTEXT} is missing` }];
  const lines = readRepoFile(root, CONTEXT, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const size: Issue[] = lines.length > MAX_CONTEXT_LINES
    ? [{ file: CONTEXT, line: 0, message: `${CONTEXT} has ${lines.length} lines; the limit is ${MAX_CONTEXT_LINES}` }]
    : [];
  const links = lines.flatMap((text, i) =>
    [...text.matchAll(LINK)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .flatMap((target) => linkIssue(root, target, i + 1)),
  );
  return [...size, ...links];
}

export function memoryCheck(root: string): Issue[] {
  const glossary: Issue[] = exists(root, 'docs/glossary.md')
    ? []
    : [{ file: 'docs/glossary.md', line: 0, message: 'docs/glossary.md is missing' }];
  const audits = openChangeIds(root).flatMap((id): Issue[] => {
    try {
      assertChangeId(id);
    } catch {
      return [{ file: `docs/changes/${id}`, line: 0, message: `docs/changes/${id} is not a valid change id` }];
    }
    const dir = changeRepoDir(id);
    return exists(root, `${dir}/approvals/tests.json`) && !exists(root, `${dir}/decisions-audit.md`)
      ? [{ file: `${dir}/decisions-audit.md`, line: 0, message: `Change ${id} has approved tests but no decisions-audit.md` }]
      : [];
  });
  return [...contextIssues(root), ...glossary, ...audits];
}
