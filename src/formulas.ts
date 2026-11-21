import { columnIndex, columnName } from './office';

function calculate(formula: string, cell: (address: string) => number) {
  const tokens = formula.toUpperCase().replaceAll('$', '').match(/[A-Z]+\d+|[A-Z]+|(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[^\s]/g) ?? [];
  if (tokens.length > 160) throw new Error('formula');
  let cursor = 0;
  const peek = () => tokens[cursor];
  function take(expected?: string) {
    const token = tokens[cursor++];
    if (!token || (expected && token !== expected)) throw new Error('formula');
    return token;
  }
  function term(): number {
    const token = take();
    if (token === '-' || token === '+') return (token === '-' ? -1 : 1) * term();
    if (token === '(') { const value = expression(); take(')'); return value; }
    if (/^[A-Z]+\d+$/.test(token)) return cell(token);
    if (/^\d|^\.\d/.test(token)) return Number(token);
    if (['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(token)) {
      take('(');
      const args: number[] = [];
      do {
        if (peek() === ',') take(',');
        if (/^[A-Z]+\d+$/.test(peek() ?? '') && tokens[cursor + 1] === ':') {
          const start = take();
          take(':');
          const end = take();
          const x1 = columnIndex(start);
          const x2 = columnIndex(end);
          const y1 = Number(start.match(/\d+$/)?.[0]);
          const y2 = Number(end.match(/\d+$/)?.[0]);
          if (x1 < 0 || x2 < x1 || y2 < y1 || (x2 - x1 + 1) * (y2 - y1 + 1) > 1000) throw new Error('range');
          for (let row = y1; row <= y2; row += 1) {
            for (let column = x1; column <= x2; column += 1) args.push(cell(columnName(column) + row));
          }
        } else args.push(expression());
      } while (peek() === ',');
      take(')');
      if (token === 'MIN') return Math.min(...args);
      if (token === 'MAX') return Math.max(...args);
      if (token === 'COUNT') return args.length;
      const sum = args.reduce((total, value) => total + value, 0);
      return token === 'AVERAGE' ? sum / args.length : sum;
    }
    throw new Error('formula');
  }
  function product() {
    let value = term();
    while (peek() === '*' || peek() === '/') value = take() === '*' ? value * term() : value / term();
    return value;
  }
  function expression() {
    let value = product();
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + product() : value - product();
    return value;
  }
  const result = expression();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error('formula');
  return result;
}

export function previewFormula(address: string, read: (address: string) => string) {
  const visited = new Set<string>();
  let operations = 0;
  function get(cell: string): number {
    if (visited.has(cell) || visited.size > 32 || ++operations > 2500) throw new Error('cycle');
    const value = read(cell);
    if (!value.startsWith('=')) return Number(value) || 0;
    visited.add(cell);
    try { return calculate(value.slice(1), get); }
    finally { visited.delete(cell); }
  }
  try { return String(get(address)); }
  catch { return undefined; }
}
