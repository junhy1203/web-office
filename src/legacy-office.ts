import { CFB, read, utils } from 'xlsx';

function stream(bytes: Uint8Array, name: string) {
  const file = CFB.read(bytes, { type: 'array' });
  const match = CFB.find(file, name);
  if (!match?.content) throw new Error('이 버전의 Office 문서를 읽을 수 없습니다.');
  return Uint8Array.from(match.content);
}

export function readBinaryWord(bytes: Uint8Array) {
  const main = stream(bytes, 'WordDocument');
  const fib = new DataView(main.buffer, main.byteOffset, main.byteLength);
  if (fib.getUint16(0, true) !== 0xa5ec) throw new Error('Word 97 이후 바이너리 문서가 필요합니다.');
  const flags = fib.getUint16(10, true);
  if (flags & 0x8100) throw new Error('암호 또는 배포 제한으로 보호된 Word 문서입니다.');
  const table = stream(bytes, flags & 0x0200 ? '1Table' : '0Table');
  let offset = 32;
  offset += 2 + 2 * fib.getUint16(offset, true);
  offset += 2 + 4 * fib.getUint16(offset, true);
  if (fib.getUint16(offset, true) < 34) throw new Error('이전 Word 형식입니다.');
  offset += 2 + 8 * 33;
  const start = fib.getUint32(offset, true);
  const length = fib.getUint32(offset + 4, true);
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (start + length > table.length) throw new Error('Word 본문 위치가 손상되었습니다.');
  let cursor = start;
  while (cursor < start + length && table[cursor] === 1) cursor += 3 + view.getUint16(cursor + 1, true);
  if (table[cursor] !== 2) throw new Error('Word 텍스트 조각을 찾을 수 없습니다.');
  const size = view.getUint32(cursor + 1, true);
  const count = (size - 4) / 12;
  cursor += 5;
  if (!Number.isSafeInteger(count) || count < 1 || cursor + size > start + length) throw new Error('Word 텍스트 표가 손상되었습니다.');
  const text: string[] = [];
  const charOffsets = cursor;
  const pieces = cursor + 4 * (count + 1);
  const codepage = fib.getUint16(6, true);
  const legacyDecoder = new TextDecoder((codepage & 0x3ff) === 0x12 ? 'euc-kr' : 'windows-1252');
  const unicode = new TextDecoder('utf-16le');
  for (let index = 0; index < count; index += 1) {
    const chars = view.getUint32(charOffsets + 4 * (index + 1), true) - view.getUint32(charOffsets + 4 * index, true);
    if (chars < 0) throw new Error('Word 텍스트 표가 손상되었습니다.');
    const fc = view.getUint32(pieces + 8 * index + 2, true);
    const compressed = (fc & 0x40000000) !== 0;
    const begin = (fc & 0x3fffffff) / (compressed ? 2 : 1);
    const end = begin + chars * (compressed ? 1 : 2);
    if (!Number.isInteger(begin) || end > main.length) throw new Error('Word 본문 위치가 손상되었습니다.');
    text.push((compressed ? legacyDecoder : unicode).decode(main.subarray(begin, end)));
  }
  return text.join('').replace(/[\r\v\f\x07]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
}

export function readBinarySlides(bytes: Uint8Array) {
  const raw = stream(bytes, 'PowerPoint Document');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const unicode = new TextDecoder('utf-16le');
  let count = 0;
  function visit(start: number, end: number, depth: number): string[] {
    if (depth > 40) throw new Error('PowerPoint 문서의 중첩 깊이가 너무 큽니다.');
    const text: string[] = [];
    for (let offset = start; offset + 8 <= end;) {
      if (++count > 200_000) throw new Error('PowerPoint 항목의 수가 너무 많습니다.');
      const header = view.getUint16(offset, true);
      const type = view.getUint16(offset + 2, true);
      const from = offset + 8;
      const to = from + view.getUint32(offset + 4, true);
      if (to > end) break;
      if (type === 4000 || type === 4008) {
        const content = (type === 4000 ? unicode.decode(raw.subarray(from, to)) :
          Array.from(raw.subarray(from, to), byte => String.fromCharCode(byte)).join('')).replaceAll('\r', '\n').trim();
        if (content) text.push(content);
      } else if ((header & 0x000f) === 0x000f) text.push(...visit(from, to, depth + 1));
      offset = to;
    }
    return text;
  }
  return [...new Set(visit(0, raw.length, 0))].join('\n\n');
}

export function readLegacySheets(bytes: Uint8Array, text?: string) {
  const book = read(text ?? bytes, { type: text === undefined ? 'array' : 'string', sheetRows: 1001, dense: false });
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    const range = utils.decode_range(sheet['!ref'] ?? 'A1');
    range.e.c = Math.min(range.e.c, range.s.c + 49);
    range.e.r = Math.min(range.e.r, range.s.r + 999);
    const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, range, defval: '' });
    return { name, rows, limited: sheet['!fullref'] !== undefined || range.e.c < utils.decode_range(sheet['!ref'] ?? 'A1').e.c };
  });
}
