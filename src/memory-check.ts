import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { assertChangeId, changeDir } from './paths.js';
import { openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const MAX_CONTEXT_LINES = 150;
const LINK = /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g;

function contextIssues(root: string): Issue[] {
  const file = 'docs/context.md';
  const abs = join(root, 'docs', 'context.md');
  if (!existsSync(abs)) return [{ file, line: 0, message: `${file} is missing` }];
  const lines = readFileSync(abs, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const size: Issue[] = lines.length > MAX_CONTEXT_LINES
    ? [{ file, line: 0, message: `${file} has ${lines.length} lines; the limit is ${MAX_CONTEXT_LINES}` }]
    : [];
  const links = lines.flatMap((text, i) =>
    [...text.matchAll(LINK)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .flatMap((target): Issue[] => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(target.split('#')[0] ?? '');
        } catch {
          return [{ file, line: i + 1, message: `Broken link: ${target}` }];
        }
        const resolved = join(dirname(abs), decoded);
        const rel = relative(root, resolved);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          return [{ file, line: i + 1, message: `Link points outside the repository: ${target}` }];
        }
        return existsSync(resolved) ? [] : [{ file, line: i + 1, message: `Broken link: ${target}` }];
      }),
  );
  return [...size, ...links];
}

export function memoryCheck(root: string): Issue[] {
  const glossary: Issue[] = existsSync(join(root, 'docs', 'glossary.md'))
    ? []
    : [{ file: 'docs/glossary.md', line: 0, message: 'docs/glossary.md is missing' }];
  const audits = openChangeIds(root).flatMap((id): Issue[] => {
    try {
      assertChangeId(id);
    } catch {
      return [{ file: `docs/changes/${id}`, line: 0, message: `docs/changes/${id} is not a valid change id` }];
    }
    const dir = changeDir(root, id);
    return existsSync(join(dir, 'approvals', 'tests.json')) && !existsSync(join(dir, 'decisions-audit.md'))
      ? [{ file: `docs/changes/${id}/decisions-audit.md`, line: 0, message: `Change ${id} has approved tests but no decisions-audit.md` }]
      : [];
  });
  return [...contextIssues(root), ...glossary, ...audits];
}
