import { strFromU8, unzipSync, zipSync } from 'fflate';

export const maxFileBytes = 100 * 1024 * 1024;
const maxArchiveBytes = 200 * 1024 * 1024;

export function fileError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function blobOf(bytes: Uint8Array, type = 'application/octet-stream') {
  return new Blob([Uint8Array.from(bytes)], { type });
}

export function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(blobOf(bytes));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isCompound(bytes: Uint8Array) {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte);
}

export function openZip(bytes: Uint8Array) {
  if (!isZip(bytes)) throw new Error('ZIP 패키지를 읽을 수 없습니다. 암호화된 파일이거나 형식이 다를 수 있습니다.');
  let total = 0;
  let count = 0;
  return new Map(Object.entries(unzipSync(bytes, { filter: (entry) => {
    total += entry.originalSize;
    count += 1;
    if (total > maxArchiveBytes || count > 15_000 || entry.originalSize > maxFileBytes) {
      throw new Error('압축을 푼 파일 크기 또는 항목 수가 열기 한도를 초과했습니다.');
    }
    return !entry.name.endsWith('/');
  } })));
}

export function writeZip(parts: Map<string, Uint8Array>) {
  return zipSync(Object.fromEntries(parts), { level: 3 });
}

export function xml(source: string) {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('외부 개체를 포함한 XML 문서는 열 수 없습니다.');
  const result = new DOMParser().parseFromString(source, 'application/xml');
  if (result.getElementsByTagName('parsererror').length) throw new Error('문서의 XML 구조가 손상되었습니다.');
  return result;
}

export function xmlPart(parts: Map<string, Uint8Array>, name: string) {
  const bytes = parts.get(name);
  if (!bytes) throw new Error(`문서 구성 요소를 찾을 수 없습니다. (${name})`);
  return xml(strFromU8(bytes));
}

export function resolvePart(base: string, relative: string) {
  const url = new URL(relative, new URL(base, 'https://package.invalid/'));
  if (url.origin !== 'https://package.invalid') return '';
  return decodeURIComponent(url.pathname.slice(1));
}

export function children(node: Element | Document, name: string) {
  return Array.from(node.children).filter(child => child.localName === name);
}

export function first(node: Element | Document | undefined | null, name: string) {
  return node ? children(node, name)[0] : undefined;
}

export function descendants(node: Element | Document, name: string) {
  return Array.from(node.getElementsByTagNameNS('*', name));
}

export function attribute(node: Element | undefined | null, name: string) {
  return Array.from(node?.attributes ?? []).find(attr => attr.localName === name)?.value ?? '';
}
