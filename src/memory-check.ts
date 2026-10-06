import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changeDir } from './paths.js';
import { openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const MAX_CONTEXT_LINES = 150;
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

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
      .map((m) => m[1] ?? '')
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .filter((target) => !existsSync(join(dirname(abs), target.split('#')[0] ?? '')))
      .map((target): Issue => ({ file, line: i + 1, message: `Broken link: ${target}` })),
  );
  return [...size, ...links];
}

export function memoryCheck(root: string): Issue[] {
  const glossary: Issue[] = existsSync(join(root, 'docs', 'glossary.md'))
    ? []
    : [{ file: 'docs/glossary.md', line: 0, message: 'docs/glossary.md is missing' }];
  const audits = openChangeIds(root)
    .filter((id) => existsSync(join(changeDir(root, id), 'approvals', 'tests.json')))
    .filter((id) => !existsSync(join(changeDir(root, id), 'decisions-audit.md')))
    .map((id): Issue => ({ file: `docs/changes/${id}/decisions-audit.md`, line: 0, message: `Change ${id} has approved tests but no decisions-audit.md` }));
  return [...contextIssues(root), ...glossary, ...audits];
}
