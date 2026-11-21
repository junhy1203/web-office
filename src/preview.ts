import { strFromU8 } from 'fflate';
import { attribute, children, descendants, first, isZip, openZip, resolvePart, xml, xmlPart } from './files';
import { decodeText } from './text';
import type { Tab } from './workspace';

export type Item = { title?: string } & (
  { kind: 'text'; text: string } |
  { kind: 'table'; rows: string[][] } |
  { kind: 'image'; bytes: Uint8Array; type?: string } |
  { kind: 'notice'; text: string }
);
const text = (content: string, title?: string): Item => ({ kind: 'text', text: content, title });
const notice = (content: string): Item => ({ kind: 'notice', text: content });
const image = (bytes: Uint8Array, title?: string, type?: string): Item => ({ kind: 'image', bytes, title, type });
const table = (rows: string[][], title?: string): Item => ({ kind: 'table', rows, title });
const raster = /\.(jpe?g|png|apng|gif|webp|bmp|avif|ico|jfif)$/i;
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function bodyOfHtml(source: string) {
  const template = document.createElement('template');
  template.innerHTML = source;
  template.content.querySelectorAll('script,style,template,iframe,object,embed').forEach(node => node.remove());
  for (const node of template.content.querySelectorAll('p,div,br,h1,h2,h3,li,tr,section,article')) node.append('\n');
  return template.content.textContent?.trim() ?? '';
}

function contentItems(root: Element) {
  return [...root.getElementsByTagName('*')].filter(element => ['p', 'h', 'title', 'subtitle'].includes(element.localName)
    && !['p', 'h'].includes(element.parentElement?.localName ?? '')).map(element => element.textContent?.trim()).filter(Boolean).join('\n');
}

function odf(bytes: Uint8Array) {
  const parts = isZip(bytes) ? openZip(bytes) : undefined;
  if (parts?.has('META-INF/manifest.xml') && descendants(xmlPart(parts, 'META-INF/manifest.xml'), 'encryption-data').length) {
    throw new Error('암호로 보호된 OpenDocument 문서입니다.');
  }
  const document = parts ? xmlPart(parts, 'content.xml') : xml(decodeText(bytes).value);
  const body = descendants(document, 'body')[0] ?? document.documentElement;
  const output: Item[] = [];
  for (const node of descendants(body, 'table')) {
    if (output.length >= 40) break;
    const rows: string[][] = [];
    for (const row of descendants(node, 'table-row')) {
      const columns: string[] = [];
      for (const cell of [...row.children]) {
        const value = contentItems(cell) || attribute(cell, 'value') || attribute(cell, 'string-value');
        const count = Math.min(50 - columns.length, Number(attribute(cell, 'number-columns-repeated')) || 1);
        for (let index = 0; index < count; index++) columns.push(value);
        if (columns.length >= 50) break;
      }
      const count = Math.min(1000 - rows.length, Number(attribute(row, 'number-rows-repeated')) || 1);
      for (let index = 0; index < count; index++) rows.push(columns);
      if (rows.length >= 1000) break;
    }
    if (rows.length) output.push(table(rows, attribute(node, 'name') || '표'));
  }
  const pages = descendants(body, 'page');
  if (pages.length) {
    pages.slice(0, 200).forEach((page, index) => {
      const contents = contentItems(page);
      if (contents) output.push(text(contents, attribute(page, 'name') || `슬라이드 ${index + 1}`));
    });
  } else if (output.length === 0 || body.firstElementChild?.localName !== 'spreadsheet') {
    const contents = contentItems(body);
    if (contents) output.unshift(text(contents, '본문'));
  }
  if (parts) {
    for (const [name, value] of parts) {
      if (name.startsWith('Pictures/') && raster.test(name) && output.length < 220) output.push(image(value, name.split('/').at(-1)));
    }
  }
  return output;
}

function rtf(source: string) {
  if (!source.startsWith('{\\rtf')) throw new Error('RTF 문서 헤더를 찾을 수 없습니다.');
  const skip = new Set(['fonttbl','colortbl','stylesheet','info','pict','object','header','footer','listtable','listoverridetable','generator','datastore','themedata']);
  const states = [{ hidden: false, unicodeFallback: 1 }];
  const result: string[] = [];
  let skipCharacters = 0;
  let encoding = 'windows-1252';
  const tokens = source.matchAll(/\\'([\da-f]{2})|\\([a-z]+)(-?\d+)? ?|\\(.)|([{}])|([^{}\\]+)/gis);
  let encoded: number[] = [];
  function flush() {
    if (encoded.length) result.push(new TextDecoder(encoding).decode(Uint8Array.from(encoded)));
    encoded = [];
  }
  for (const [, hex, word, value, symbol, brace, contents] of tokens) {
    const state = states.at(-1)!;
    if (!hex) flush();
    if (brace === '{') { states.push({ ...state }); continue; }
    if (brace === '}') { if (states.length > 1) states.pop(); continue; }
    if (word === 'ansicpg') { encoding = value === '949' ? 'euc-kr' : 'windows-1252'; continue; }
    if (symbol === '*' || (word && skip.has(word))) { state.hidden = true; continue; }
    if (state.hidden) continue;
    if (word === 'uc') { state.unicodeFallback = Math.min(16, Math.max(0, Number(value) || 0)); continue; }
    if (word === 'u') { result.push(String.fromCharCode(Number(value) & 65535)); skipCharacters = state.unicodeFallback; continue; }
    if (word === 'par' || word === 'line') result.push('\n');
    if (word === 'tab' || word === 'cell') result.push('\t');
    if (hex) {
      if (skipCharacters) skipCharacters -= 1;
      else encoded.push(Number.parseInt(hex, 16));
    } else if (symbol && '{}\\~'.includes(symbol)) {
      if (skipCharacters) skipCharacters -= 1;
      else result.push(symbol === '~' ? ' ' : symbol);
    } else if (contents) {
      const clean = contents.replace(/[\r\n]/g, '');
      result.push(clean.slice(skipCharacters));
      skipCharacters = Math.max(0, skipCharacters - clean.length);
    }
  }
  flush();
  return result.join('').trim();
}

function epub(bytes: Uint8Array) {
  const parts = openZip(bytes);
  if (parts.has('META-INF/encryption.xml')) {
    const protection = xmlPart(parts, 'META-INF/encryption.xml');
    const entries = descendants(protection, 'EncryptionMethod');
    if (entries.some(method => !['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'].includes(attribute(method, 'Algorithm')))) {
      throw new Error('저작권 보호(DRM)가 적용된 EPUB입니다.');
    }
  }
  const path = attribute(descendants(xmlPart(parts, 'META-INF/container.xml'), 'rootfile')[0], 'full-path');
  const packageXml = xmlPart(parts, path);
  const manifest = new Map(descendants(packageXml, 'item').map(item => [attribute(item, 'id'), attribute(item, 'href')]));
  const output: Item[] = [];
  for (const item of descendants(packageXml, 'itemref').slice(0, 300)) {
    const target = resolvePart(path, manifest.get(attribute(item, 'idref')) ?? '');
    const chapter = parts.get(target);
    if (!chapter) continue;
    const chapterSource = strFromU8(chapter);
    const content = bodyOfHtml(chapterSource);
    if (content) output.push(text(content, `본문 ${output.length + 1}`));
    for (const match of chapterSource.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
      const imagePath = resolvePart(target, match[1]);
      const picture = parts.get(imagePath);
      if (picture && raster.test(imagePath) && output.length < 400) output.push(image(picture, imagePath.split('/').at(-1)));
    }
  }
  return output;
}

function xps(bytes: Uint8Array) {
  const parts = openZip(bytes);
  const pages = [...parts.keys()].filter(path => /\.fpage$/i.test(path)).sort(natural.compare);
  if (!pages.length) throw new Error('XPS 페이지를 찾을 수 없습니다.');
  return pages.slice(0, 300).flatMap((path, index) => {
    const page = xmlPart(parts, path);
    const glyphs = descendants(page, 'Glyphs').map(node => attribute(node, 'UnicodeString')).filter(Boolean);
    const shown = glyphs.length ? [text(glyphs.join('\n'), `${index + 1}쪽`)] : [];
    for (const brush of descendants(page, 'ImageBrush').slice(0, 20)) {
      const raw = attribute(brush, 'ImageSource');
      const location = raw.startsWith('{ColorConvertedBitmap ') ? raw.slice(22).trim().split(/\s+/)[0] : raw;
      const target = resolvePart(path, location);
      const picture = parts.get(target);
      if (picture && raster.test(target)) shown.push(image(picture, `${index + 1}쪽 이미지`));
    }
    return shown;
  });
}

function comicTar(bytes: Uint8Array) {
  const pictures: { name: string; bytes: Uint8Array }[] = [];
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start: number, end: number) => decoder.decode(header.subarray(start, end)).split('\0')[0].trim();
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    const sizeField = field(124, 136);
    if (!/^[0-7]+$/.test(sizeField)) throw new Error('만화 보관 파일의 크기 정보가 손상되었습니다.');
    const size = Number.parseInt(sizeField, 8);
    const body = offset + 512;
    if (!Number.isSafeInteger(size) || body + size > bytes.length) throw new Error('만화 보관 파일이 잘렸거나 손상되었습니다.');
    if ((header[156] === 0 || header[156] === 48) && size && raster.test(name) && !name.startsWith('__MACOSX/')) {
      pictures.push({ name, bytes: bytes.subarray(body, body + size) });
    }
    if (pictures.length >= 400) break;
    offset = body + Math.ceil(size / 512) * 512;
  }
  return pictures.sort((a, b) => natural.compare(a.name, b.name)).map(page => image(page.bytes, page.name.split('/').at(-1)));
}

async function sqlite(bytes: Uint8Array) {
  const [{ default: sql }, { default: wasm }] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]);
  if (strFromU8(bytes.slice(0, 15)) !== 'SQLite format 3') throw new Error('SQLite 형식이 아니거나 암호화되었습니다.');
  const engine = await sql({ locateFile: () => wasm, useOldExtensionFunctions: false });
  const database = new engine.Database(bytes.slice());
  try {
    const names = database.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 40")[0]?.values ?? [];
    return names.flatMap(([name]) => {
      const escaped = String(name).replaceAll('"', '""');
      const result = database.exec(`SELECT * FROM "${escaped}" LIMIT 200`)[0];
      return result ? [table([result.columns, ...result.values.map(row => row.map(value => value instanceof Uint8Array ? `바이너리 ${value.length} B` : String(value ?? '')))], String(name))] : [];
    });
  } finally { database.close(); }
}

export async function readPreview(tab: Tab): Promise<Item[]> {
  const { bytes, format } = tab;
  const ext = format.extension;
  if (/^(odt|ott|fodt|ods|ots|fods|odp|otp|fodp|sxw|stw|sxi|sti|sxc|stc)$/.test(ext)) return odf(bytes);
  if (/^(doc|dot|ppt|pps|pot|xls|xlsb|xlt|numbers|dif|slk|wk1|wk3|wk4|wks|dbf|et|ett)$/.test(ext)) {
    const legacy = await import('./legacy-office');
    if (ext === 'doc' || ext === 'dot') return [text(legacy.readBinaryWord(bytes), 'Word 본문')];
    if (['ppt','pps','pot'].includes(ext)) return [text(legacy.readBinarySlides(bytes), '슬라이드 텍스트')];
    if (['et', 'ett'].includes(ext) && !isZip(bytes) && bytes[0] !== 0xd0) return [];
    return legacy.readLegacySheets(bytes, ['dif','slk'].includes(ext) ? decodeText(bytes).value : undefined)
      .flatMap(sheet => [table(sheet.rows, sheet.name), ...(sheet.limited ? [notice('시트의 처음 1,000행·50열 범위까지 표시합니다.')] : [])]);
  }
  if (ext === 'epub') return epub(bytes);
  if (ext === 'xps' || ext === 'oxps') return xps(bytes);
  if (ext === 'cbt') return comicTar(bytes);
  if (ext === 'cbz') return [...openZip(bytes)].filter(([name]) => raster.test(name) && !name.startsWith('__MACOSX/'))
    .sort(([a], [b]) => natural.compare(a, b)).slice(0, 400).map(([name, entry]) => image(entry, name.split('/').at(-1)));
  if (ext === 'fb2' || ext === 'opml' || ext === 'enex' || ext === 'webloc') {
    const document = xml(decodeText(bytes).value);
    if (ext === 'opml') return [text(descendants(document, 'outline').map(node => [attribute(node, 'text'), attribute(node, 'xmlUrl')].filter(Boolean).join(' · ')).join('\n'))];
    if (ext === 'enex') return descendants(document, 'note').map(note => text(bodyOfHtml(first(note, 'content')?.textContent ?? ''), first(note, 'title')?.textContent ?? undefined));
    if (ext === 'webloc') return [text(descendants(document, 'string')[0]?.textContent ?? '', '주소')];
    if (document.documentElement.localName !== 'FictionBook') throw new Error('FictionBook 문서 헤더를 찾을 수 없습니다.');
    return [text(contentItems(descendants(document, 'body')[0] ?? document.documentElement), '본문')];
  }
  if (ext === 'ipynb') {
    const notebook = JSON.parse(decodeText(bytes).value);
    if (!Array.isArray(notebook.cells)) throw new Error('노트북 셀을 찾을 수 없습니다.');
    return notebook.cells.slice(0, 400).flatMap((cell: { cell_type?: string; source?: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, string | string[]> }[] }, index: number) => {
      const value = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
      const output = (cell.outputs ?? []).map(item => item.text ?? item.data?.['text/plain'] ?? '')
        .map(value => Array.isArray(value) ? value.join('') : value).join('\n');
      return [text(value, `셀 ${index + 1} · ${cell.cell_type === 'code' ? '코드' : '본문'}`), ...(output ? [text(output, '저장된 출력')] : [])];
    });
  }
  if (['db', 'sqlite', 'sqlite3', 'db3'].includes(ext)) return sqlite(bytes);
  if (ext === 'rtf') return [text(rtf(decodeText(bytes).value), '본문')];
  if (['eml', 'mht', 'mhtml'].includes(ext)) {
    const { default: PostalMime } = await import('postal-mime');
    const mail = await PostalMime.parse(bytes);
    const content = mail.text || (mail.html ? bodyOfHtml(mail.html) : '');
    if (!content) return [];
    return [text(content, mail.subject || '본문'), ...mail.attachments
      .filter(file => file.filename && raster.test(file.filename) && file.content instanceof ArrayBuffer)
      .slice(0, 30).map(file => image(new Uint8Array(file.content as ArrayBuffer), file.filename ?? undefined))];
  }
  if (['ics', 'ical', 'vcf', 'sig', 'asc', 'pem'].includes(ext)) {
    const source = decodeText(bytes).value.replace(/\n[ \t]/g, '');
    if (['ics', 'ical', 'vcf'].includes(ext)) {
      const useful = source.split('\n').filter(line => /^(?:SUMMARY|DESCRIPTION|DTSTART|DTEND|LOCATION|FN|ORG|EMAIL|TEL|ADR|URL)(?:[;:]|$)/i.test(line));
      if (useful.length) return [text(useful.join('\n'), ext === 'vcf' ? '연락처' : '일정')];
    }
    return [text(source)];
  }
  if (['drawio', 'dio', 'vsdx', 'idml'].includes(ext)) {
    if (ext === 'vsdx' || ext === 'idml') {
      const parts = openZip(bytes);
      const matcher = ext === 'vsdx' ? /^visio\/pages\/page\d+\.xml$/ : /^Stories\/Story_.*\.xml$/;
      return [...parts.keys()].filter(path => matcher.test(path)).sort(natural.compare).slice(0, 150).map(path => {
        const source = xmlPart(parts, path);
        return text(descendants(source, ext === 'vsdx' ? 'Text' : 'Content').map(part => part.textContent).join('\n'), path.split('/').at(-1));
      });
    }
    const source = xml(decodeText(bytes).value);
    return descendants(source, 'diagram').map((page, index) => text(descendants(page, 'mxCell').map(node => attribute(node, 'value'))
      .filter(Boolean).map(bodyOfHtml).join('\n'), attribute(page, 'name') || `페이지 ${index + 1}`));
  }
  return [];
}
