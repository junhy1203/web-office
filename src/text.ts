import { Buffer } from 'buffer';
import iconv from 'iconv-lite';

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'cp949' | 'windows-1252';
export interface TextFile {
  value: string;
  encoding: TextEncoding;
  bom: Uint8Array;
  newline: string;
}

export function decodeText(bytes: Uint8Array, preferred?: TextEncoding): TextFile {
  let encoding: TextEncoding = preferred ?? 'utf-8';
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { encoding = 'utf-8'; offset = 3; }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
  let value: string;
  try {
    value = new TextDecoder(encoding === 'cp949' ? 'euc-kr' : encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    if (offset || preferred) throw new Error('지정된 인코딩으로 파일을 읽을 수 없습니다.');
    try {
      value = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
      encoding = 'cp949';
    } catch {
      value = new TextDecoder('windows-1252').decode(bytes);
      encoding = 'windows-1252';
    }
  }
  if (value.includes('\0')) throw new Error('텍스트 대신 바이너리 데이터가 들어 있습니다.');
  const endings = value.match(/\r\n|\n|\r/g) ?? [];
  const newline = ['\r\n', '\n', '\r'].map(ending => ({ ending, count: endings.filter(value => value === ending).length }))
    .sort((a, b) => b.count - a.count)[0];
  return { value: value.replace(/\r\n|\r/g, '\n'), encoding, bom: bytes.slice(0, offset), newline: newline.count ? newline.ending : '\n' };
}

export function encodeText(value: string, file: TextFile, asUtf8 = false) {
  const encoding = asUtf8 ? 'utf-8' : file.encoding;
  const source = value.replaceAll('\n', file.newline);
  const encoded = encoding === 'utf-8' ? new TextEncoder().encode(source) : iconv.encode(source, encoding);
  if (encoding !== 'utf-8' && iconv.decode(Buffer.from(encoded), encoding) !== source) {
    throw new Error(`${encoding} 인코딩에 저장할 수 없는 문자가 있습니다. UTF-8 사본으로 저장해 주세요.`);
  }
  const bom = asUtf8 ? new Uint8Array() : file.bom;
  const result = new Uint8Array(bom.length + encoded.length);
  result.set(bom);
  result.set(encoded, bom.length);
  return result;
}

export function parseDelimited(source: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  const finishCell = () => { row.push(cell); cell = ''; quoteClosed = false; };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character !== '"') cell += character;
      else if (source[index + 1] === '"') { cell += '"'; index += 1; }
      else { quoted = false; quoteClosed = true; }
    } else if (character === '"' && cell === '' && !quoteClosed) quoted = true;
    else if (character === delimiter) finishCell();
    else if (character === '\n') { finishCell(); rows.push(row); row = []; }
    else cell += character;
  }
  if (quoted) throw new Error('닫히지 않은 큰따옴표가 있는 표입니다.');
  if (cell !== '' || row.length || quoteClosed || !rows.length) {
    finishCell();
    rows.push(row);
  }
  return rows;
}

export function writeDelimited(rows: string[][], delimiter: string, finalNewline: boolean) {
  const data = rows.map(row => row.map(cell => cell.includes(delimiter) || /["\r\n]/.test(cell)
    ? `"${cell.replaceAll('"', '""')}"` : cell).join(delimiter)).join('\n');
  return finalNewline ? `${data}\n` : data;
}
