import { strToU8 } from 'fflate';
import { attribute, children, first, isCompound, openZip, resolvePart, writeZip, xmlPart } from './files';

export const namespaces = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  s: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

export class OfficePackage {
  readonly parts: Map<string, Uint8Array>;
  private readonly docs = new Map<string, XMLDocument>();
  private readonly modified = new Set<string>();
  readonly main: string;

  constructor(readonly source: Uint8Array) {
    if (isCompound(source)) throw new Error('암호화된 Office 문서입니다. 잠금을 해제한 사본을 열어 주세요.');
    this.parts = openZip(source);
    const rootLinks = this.links('');
    this.main = [...rootLinks.values()].find(link => link.type.endsWith('/officeDocument'))?.path ?? '';
    if (!this.main) throw new Error('Office 문서의 본문을 찾을 수 없습니다.');
    if (this.parts.has('EncryptionInfo')) throw new Error('암호화된 Office 문서입니다.');
  }

  read(path: string) {
    const cached = this.docs.get(path);
    if (cached) return cached;
    const document = xmlPart(this.parts, path);
    this.docs.set(path, document);
    return document;
  }

  root(path = this.main) { return this.read(path).documentElement; }
  has(path: string) { return this.parts.has(path); }
  get dirty() { return this.modified.size > 0; }
  mark(...paths: string[]) { paths.forEach(path => this.modified.add(path)); }
  relationshipPart(path: string) { return path.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels'); }

  links(path: string) {
    const relationshipPart = path ? this.relationshipPart(path) : '_rels/.rels';
    const result = new Map<string, { path: string; type: string }>();
    if (!this.has(relationshipPart)) return result;
    for (const relation of children(this.root(relationshipPart), 'Relationship')) {
      if (attribute(relation, 'TargetMode') === 'External') continue;
      result.set(attribute(relation, 'Id'), {
        path: resolvePart(path, attribute(relation, 'Target')),
        type: attribute(relation, 'Type'),
      });
    }
    return result;
  }

  partByType(path: string, type: string) {
    return [...this.links(path).values()].find(link => link.type.endsWith('/' + type))?.path ?? '';
  }

  addImage(slide: string, bytes: Uint8Array, extension: string) {
    const path = this.relationshipPart(slide);
    if (!this.has(path)) {
      this.parts.set(path, strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
    }
    const root = this.root(path);
    const existing = new Set(children(root, 'Relationship').map(child => attribute(child, 'Id')));
    let next = 1;
    while (existing.has(`rId${next}`)) next += 1;
    const media = `image-${crypto.randomUUID()}.${extension}`;
    const directory = slide.split('/').slice(0, -2).join('/');
    this.parts.set(`${directory}/media/${media}`, bytes);
    const newRelationship = root.ownerDocument.createElementNS(root.namespaceURI, 'Relationship');
    newRelationship.setAttribute('Id', `rId${next}`);
    newRelationship.setAttribute('Type', `${namespaces.r}/image`);
    newRelationship.setAttribute('Target', `../media/${media}`);
    root.append(newRelationship);
    const types = this.root('[Content_Types].xml');
    if (!children(types, 'Default').some(type => attribute(type, 'Extension') === extension)) {
      const type = types.ownerDocument.createElementNS(types.namespaceURI, 'Default');
      type.setAttribute('Extension', extension);
      type.setAttribute('ContentType', extension === 'jpg' ? 'image/jpeg' : `image/${extension}`);
      types.append(type);
      this.mark('[Content_Types].xml');
    }
    this.mark(path);
    return `rId${next}`;
  }

  save() {
    if (!this.dirty) return this.source;
    const parts = new Map(this.parts);
    const serializer = new XMLSerializer();
    for (const path of this.modified) parts.set(path, strToU8(serializer.serializeToString(this.read(path))));
    return writeZip(parts);
  }
}

export function element(parent: Element, prefix: keyof typeof namespaces, name: string, text?: string) {
  const namespace = parent.lookupNamespaceURI(prefix) ?? namespaces[prefix];
  const node = parent.ownerDocument.createElementNS(namespace, `${prefix}:${name}`);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function addFirst(parent: Element, prefix: keyof typeof namespaces, name: string) {
  const present = first(parent, name);
  if (present) return present;
  const node = element(parent, prefix, name);
  parent.prepend(node);
  return node;
}

export function wordAttribute(node: Element, name: string, value: string) {
  node.setAttributeNS(node.lookupNamespaceURI('w') ?? namespaces.w, `w:${name}`, value);
}

export function columnName(index: number) {
  let result = '';
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    result = String.fromCharCode(65 + (number - 1) % 26) + result;
  }
  return result;
}

export function columnIndex(name: string) {
  let index = 0;
  for (const char of (name.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}
