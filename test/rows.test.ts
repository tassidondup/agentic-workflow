import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/rows.js';

const md = [
  '# Listing price',
  '',
  '| ID | Price | Expected |',
  '|----|------:|----------|',
  '| LST-001 | 0 | 422 |',
  '| LST-002 | 999999 | 201 |',
  '',
  '```md',
  '| ID | ignored | Expected |',
  '|---|---|---|',
  '| LST-999 | x | y |',
  '```',
  '',
  '| Name | Value |',
  '|---|---|',
  '| a | b |',
].join('\n');

describe('parseRows', () => {
  it('parses ID tables with cells keyed by header and 1-based line numbers', () => {
    const rows = parseRows(md, 'docs/specs/listing/spec.md');
    expect(rows.map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
    expect(rows[0]).toEqual({
      id: 'LST-001',
      cells: { ID: 'LST-001', Price: '0', Expected: '422' },
      file: 'docs/specs/listing/spec.md',
      line: 5,
    });
  });
  it('handles CRLF line endings', () => {
    expect(parseRows(md.replaceAll('\n', '\r\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
  });
  it('ignores a header without a separator row', () => {
    expect(parseRows('| ID | Expected |\n| LST-001 | x |', 'f.md')).toEqual([]);
  });
  it('ignores tables inside tilde fences and treats ``` inside ~~ as non-closing', () => {
    const md = [
      '| ID | Expected |',
      '|---|---|',
      '| LST-001 | a |',
      '',
      '~~~',
      '| ID | Other |',
      '|---|---|',
      '| LST-002 | b |',
      '```',
      '| ID | Still in tilde |',
      '|---|---|',
      '| LST-003 | c |',
      '~~~',
      '',
      '| ID | Expected |',
      '|---|---|',
      '| LST-004 | d |',
    ].join('\n');
    const rows = parseRows(md, 'f.md');
    expect(rows.map((r) => r.id)).toEqual(['LST-001', 'LST-004']);
  });
  it('accepts separators with 1-2 dashes', () => {
    expect(parseRows('| ID | Expected |\n|-|-|\n| LST-001 | x |', 'f.md').map((r) => r.id)).toEqual(['LST-001']);
    expect(parseRows('| ID | Expected |\n|:-|--:|\n| LST-002 | y |', 'f.md').map((r) => r.id)).toEqual(['LST-002']);
  });
  it('accepts GFM tables without leading/trailing pipes (I4)', () => {
    expect(parseRows('ID | Expected\n---|---\nLST-001 | x', 'f.md').map((r) => r.cells)).toEqual([{ ID: 'LST-001', Expected: 'x' }]);
    expect(parseRows('| ID | Expected |\n|---|---|\nLST-002 | y\n| LST-003 | z', 'f.md').map((r) => r.id)).toEqual(['LST-002', 'LST-003']);
  });
  it('ends a table at the first line without a pipe (I4)', () => {
    expect(parseRows('ID | Expected\n---|---\nLST-001 | x\nprose\nLST-002 | y', 'f.md').map((r) => r.id)).toEqual(['LST-001']);
  });
  it('closes a fence only with the same char and at least the opening length (M5)', () => {
    const md = [
      '````md',
      '```',
      '| ID | Expected |',
      '|---|---|',
      '| LST-001 | hidden |',
      '````',
      '| ID | Expected |',
      '|---|---|',
      '| LST-002 | shown |',
      '',
      '~~~',
      '~~~~~',
      '| ID | Expected |',
      '|---|---|',
      '| LST-003 | shown |',
    ].join('\n');
    expect(parseRows(md, 'f.md').map((r) => r.id)).toEqual(['LST-002', 'LST-003']);
  });
  it('does not close a fence on a line with an info string', () => {
    const md = ['```', '```js', '| ID | Expected |', '|---|---|', '| LST-001 | hidden |', '```'].join('\n');
    expect(parseRows(md, 'f.md')).toEqual([]);
  });
  const table = ['| ID | Expected |', '|---|---|', '| LST-001 | shown |'];
  it('does not treat a backtick line with backticks after it as a fence (it is inline code)', () => {
    expect(parseRows(['```x``` text', ...table].join('\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001']);
  });
  it('does not treat a fence indented 4+ spaces or a tab as a fence (it is indented code)', () => {
    expect(parseRows(['    ```', ...table, '    ```'].join('\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001']);
    expect(parseRows(['\t~~~', ...table].join('\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001']);
  });
  it('accepts a fence indented up to 3 spaces, and only closes on one indented up to 3', () => {
    expect(parseRows(['   ```', ...table, '   ```'].join('\n'), 'f.md')).toEqual([]);
    expect(parseRows(['```', '    ```', ...table, '```'].join('\n'), 'f.md')).toEqual([]);
  });
  it('reads an escaped pipe as part of a cell', () => {
    const md = ['| ID | Input | Expected |', '|---|---|---|', '| LST-001 | a \\| b | 422 |'].join('\n');
    expect(parseRows(md, 'f.md')[0]?.cells).toEqual({ ID: 'LST-001', Input: 'a | b', Expected: '422' });
  });
});
