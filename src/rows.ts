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

const getFenceMarker = (line: string): string | null => {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) return '```';
  if (trimmed.startsWith('~~~')) return '~~~';
  return null;
};

export function parseRows(markdown: string, file: string): SpecRow[] {
  const lines = markdown.split(/\r?\n/);
  const rows: SpecRow[] = [];
  let header: string[] | null = null;
  let fenceMarker: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const marker = getFenceMarker(line);
    if (marker !== null) {
      if (fenceMarker === marker) {
        fenceMarker = null;
      } else if (fenceMarker === null) {
        fenceMarker = marker;
      }
      header = null;
      continue;
    }
    const cells = fenceMarker === null ? splitRow(line) : null;
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
