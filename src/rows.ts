export interface SpecRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, string>>;
  readonly file: string;
  readonly line: number;
}

// GFM: leading and trailing pipes are optional; a line without any unescaped pipe is not a
// table row; `\|` is a literal pipe inside a cell.
const PIPE = /(?<!\\)\|/;
const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (!PIPE.test(t)) return null;
  return t.replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(PIPE).map((c) => c.trim().replaceAll('\\|', '|'));
};

const isSeparator = (cells: string[] | null): boolean =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

interface Fence {
  readonly char: string;
  readonly length: number;
  readonly bare: boolean; // no info string after the marker
}

// CommonMark: a fence may be indented at most 3 spaces (4+, or a tab, makes indented code),
// and a backtick fence's info string may not contain a backtick (that line is inline code).
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const getFence = (line: string): Fence | null => {
  const m = FENCE.exec(line.trimEnd());
  if (m === null) return null;
  const marker = m[1] as string;
  const info = m[2] ?? '';
  if (marker.startsWith('`') && info.includes('`')) return null;
  return { char: marker.charAt(0), length: marker.length, bare: info.trim() === '' };
};

// CommonMark: a closing fence uses the opening char, is at least as long, and has no info string (M5).
const closes = (open: Fence, f: Fence): boolean => f.char === open.char && f.length >= open.length && f.bare;

export function parseRows(markdown: string, file: string): SpecRow[] {
  const lines = markdown.split(/\r?\n/);
  const rows: SpecRow[] = [];
  let header: string[] | null = null;
  let open: Fence | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fence = getFence(line);
    if (fence !== null) {
      if (open === null) open = fence;
      else if (closes(open, fence)) open = null;
      header = null;
      continue;
    }
    const cells = open === null ? splitRow(line) : null;
    if (cells === null) {
      header = null;
      continue;
    }
    if (header === null) {
      if ((cells[0] ?? '').toLowerCase() === 'id' && isSeparator(splitRow(lines[i + 1] ?? ''))) {
        header = cells;
        i += 1;
      }
      continue;
    }
    const keys = header;
    rows.push(Object.freeze({
      id: cells[0] ?? '',
      cells: Object.freeze(Object.fromEntries(keys.map((h, k) => [h, cells[k] ?? '']))),
      file,
      line: i + 1,
    }));
  }
  return rows;
}
