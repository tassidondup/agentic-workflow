export interface SpecRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, string>>;
  readonly file: string;
  readonly line: number;
}

// GFM: leading and trailing pipes are optional; a line without any pipe is not a table row.
const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (!t.includes('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
};

const isSeparator = (cells: string[] | null): boolean =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

interface Fence {
  readonly char: string;
  readonly length: number;
  readonly bare: boolean; // no info string after the marker
}

const FENCE = /^(`{3,}|~{3,})(.*)$/;

const getFence = (line: string): Fence | null => {
  const m = FENCE.exec(line.trim());
  if (m === null) return null;
  const marker = m[1] as string;
  return { char: marker.charAt(0), length: marker.length, bare: (m[2] ?? '').trim() === '' };
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
