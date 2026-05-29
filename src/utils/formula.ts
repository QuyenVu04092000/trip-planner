function colLetterToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function indexToColLetter(n: number): string {
  let col = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    col = String.fromCharCode(65 + r) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function parseNum(v: string): number {
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function expandRange(range: string, getCell: (ref: string) => string): number[] {
  const [start, end] = range.split(':');
  const startColStr = start.match(/[A-Z]+/)?.[0] || 'A';
  const startRow = parseInt(start.match(/\d+/)?.[0] || '1');
  const endColStr = end.match(/[A-Z]+/)?.[0] || startColStr;
  const endRow = parseInt(end.match(/\d+/)?.[0] || String(startRow));

  const values: number[] = [];
  const startColIdx = colLetterToIndex(startColStr);
  const endColIdx = colLetterToIndex(endColStr);

  for (let c = startColIdx; c <= endColIdx; c++) {
    for (let r = startRow; r <= endRow; r++) {
      values.push(parseNum(getCell(`${indexToColLetter(c)}${r}`)));
    }
  }
  return values;
}

function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of argsStr) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function resolveArgs(argsStr: string, getCell: (ref: string) => string): number[] {
  const values: number[] = [];
  for (const arg of splitArgs(argsStr)) {
    if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(arg)) {
      values.push(...expandRange(arg, getCell));
    } else if (/^[A-Z]+\d+$/.test(arg)) {
      values.push(parseNum(getCell(arg)));
    } else {
      const n = parseFloat(arg);
      if (!isNaN(n)) values.push(n);
    }
  }
  return values;
}

function evaluateExpr(expr: string, getCell: (ref: string) => string): number {
  // Handle functions
  const funcMatch = expr.match(/^(SUM|AVERAGE|AVG|MIN|MAX|COUNT)\((.+)\)$/);
  if (funcMatch) {
    const [, func, argsStr] = funcMatch;
    const values = resolveArgs(argsStr, getCell);
    if (values.length === 0) return 0;
    switch (func) {
      case 'SUM': return values.reduce((a, b) => a + b, 0);
      case 'AVERAGE': case 'AVG': return values.reduce((a, b) => a + b, 0) / values.length;
      case 'MIN': return Math.min(...values);
      case 'MAX': return Math.max(...values);
      case 'COUNT': return values.length;
      default: return 0;
    }
  }

  // Replace cell references with their numeric values
  const resolved = expr.replace(/[A-Z]+\d+/g, (ref) => String(parseNum(getCell(ref))));

  // Only allow safe arithmetic characters
  if (!/^[\d\s+\-*/.()%,]+$/.test(resolved)) return NaN;

  try {
    // eslint-disable-next-line no-new-func
    return Function(`'use strict'; return (${resolved})`)() as number;
  } catch {
    return NaN;
  }
}

export function evaluateCell(
  ref: string,
  cells: Record<string, string>,
  visited = new Set<string>()
): string {
  const raw = cells[ref] || '';
  if (!raw.startsWith('=')) return raw;
  if (visited.has(ref)) return '#REF!';

  visited.add(ref);

  const getCell = (r: string) => evaluateCell(r, cells, new Set(visited));
  const expr = raw.slice(1).trim().toUpperCase();

  try {
    const result = evaluateExpr(expr, getCell);
    if (isNaN(result)) return '#VALORE!';
    if (!isFinite(result)) return '#DIV/0!';
    // Format nicely: no trailing zeros for integers
    return Number.isInteger(result) ? String(result) : String(Math.round(result * 100) / 100);
  } catch {
    return '#ERRORE!';
  }
}

export function isFormula(raw: string): boolean {
  return raw.startsWith('=');
}
