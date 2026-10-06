import { readChange, ROW_ID } from './change.js';
import { changeRepoDir, isChangeId } from './paths.js';
import type { SpecRow } from './rows.js';
import { lstatInRepo } from './safe-fs.js';
import { changeRowIds, changeRows, liveRowIds, openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const issue = (row: SpecRow, message: string): Issue => ({ file: row.file, line: row.line, message });
const expectedKey = (row: SpecRow): string | undefined =>
  Object.keys(row.cells).find((k) => k.toLowerCase() === 'expected');

function rowIssues(rows: readonly SpecRow[]): Issue[] {
  const seen = new Map<string, SpecRow>();
  const byInputs = new Map<string, SpecRow>();
  return rows.flatMap((row) => {
    const found: Issue[] = [];
    if (!ROW_ID.test(row.id)) found.push(issue(row, `Row ID "${row.id}" must look like LST-004`));
    if (seen.has(row.id)) found.push(issue(row, `Row ID ${row.id} appears more than once`));
    seen.set(row.id, row);
    const exp = expectedKey(row);
    if (exp === undefined) return [...found, issue(row, `Row ${row.id} is in a table without an Expected column`)];
    const inputs = JSON.stringify(Object.entries(row.cells).filter(([k]) => k.toLowerCase() !== 'id' && k !== exp));
    const twin = byInputs.get(inputs);
    if (twin && twin.cells[expectedKey(twin) ?? exp] !== row.cells[exp]) {
      found.push(issue(row, `${row.id} has the same inputs as ${twin.id} but a different Expected value`));
    }
    if (!twin) byInputs.set(inputs, row);
    return found;
  });
}

function collisionIssues(root: string, id: string, rows: readonly SpecRow[]): Issue[] {
  const live = liveRowIds(root);
  // Folders that are not valid change ids are reported by memory-check, not linted here (M1).
  const others = openChangeIds(root).filter((c) => c !== id && isChangeId(c));
  return rows
    .filter((r) => ROW_ID.test(r.id) && !live.has(r.id))
    .flatMap((r) => others.filter((c) => changeRowIds(root, c).includes(r.id)).map((c) => issue(r, `New row ${r.id} is also introduced by open change ${c}`)));
}

const declaresNoBehaviourChange = (root: string, id: string): boolean => {
  try {
    return readChange(root, id).noBehaviourChange;
  } catch {
    return false; // unreadable change.json: report the zero-rows issue rather than skip it
  }
};

export function lintChange(root: string, id: string): Issue[] {
  const path = `${changeRepoDir(id)}/spec-delta.md`;
  if (lstatInRepo(root, path) === null) return [{ file: path, line: 0, message: 'spec-delta.md is missing' }];
  const rows = changeRows(root, id);
  if (rows.length === 0 && !declaresNoBehaviourChange(root, id)) {
    return [{ file: path, line: 0, message: 'spec-delta.md has no example rows' }];
  }
  return [...rowIssues(rows), ...collisionIssues(root, id, rows)];
}
