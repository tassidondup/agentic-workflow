export interface SpecRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, string>>;
  readonly file: string;
  readonly line: number;
}

const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (t.length < 2 || !t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};

const isSeparator = (cells: string[] | null): boolean =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

export function parseRows(markdown: string, file: string): SpecRow[] {
  const lines = markdown.split(/\r?\n/);
  const rows: SpecRow[] = [];
  let header: string[] | null = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      header = null;
      continue;
    }
    const cells = inFence ? null : splitRow(line);
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
