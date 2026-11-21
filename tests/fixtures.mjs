import { strToU8, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import initRhwp, { HwpDocument } from '@rhwp/core';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const s = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationships = content => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + content + '</Relationships>';
const link = (id, kind, path) => '<Relationship Id="' + id + '" Type="' + r + '/' + kind + '" Target="' + path + '"/>';
const encode = entries => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([path, raw]) =>
  [path, typeof raw === 'string' ? strToU8(raw) : raw]))));
const mime = kind => 'application/vnd.openxmlformats-officedocument.' + kind + '+xml';

function office(main, type, files, contentTypes = '') {
  return encode({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/' + main + '" ContentType="' + mime(type) + '"/>' + contentTypes + '</Types>',
    '_rels/.rels': relationships(link('rId1', 'officeDocument', main)),
    ...files,
  });
}

export const word = office('word/document.xml', 'wordprocessingml.document.main', {
  'word/document.xml': '<w:document xmlns:w="' + w + '"><w:body><w:p><w:r><w:t>처음 문장</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>표 값</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>',
  'word/styles.xml': '<w:styles xmlns:w="' + w + '"><w:style w:type="paragraph" w:styleId="Preserve"/></w:styles>',
  'word/_rels/document.xml.rels': relationships(link('rId1', 'styles', 'styles.xml')),
}, '<Override PartName="/word/styles.xml" ContentType="' + mime('wordprocessingml.styles') + '"/>');

export const sheet = office('xl/workbook.xml', 'spreadsheetml.sheet.main', {
  'xl/workbook.xml': '<workbook xmlns="' + s + '" xmlns:r="' + r + '"><sheets><sheet name="주문" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': relationships(link('rId1', 'worksheet', 'worksheets/sheet1.xml') + link('rId2', 'styles', 'styles.xml')),
  'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + s + '"><dimension ref="A1:C1"/><sheetData><row r="1"><c r="A1"><v>2</v></c><c r="B1"><v>3</v></c><c r="C1"><f>SUM(A1:B1)</f><v>5</v></c></row></sheetData></worksheet>',
  'xl/styles.xml': '<styleSheet xmlns="' + s + '"><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
}, '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + mime('spreadsheetml.worksheet') + '"/>');

const slide = name => '<p:sld xmlns:p="' + p + '" xmlns:a="' + a + '"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>' + name + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
export const slides = office('ppt/presentation.xml', 'presentationml.presentation.main', {
  'ppt/presentation.xml': '<p:presentation xmlns:p="' + p + '" xmlns:r="' + r + '"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  'ppt/_rels/presentation.xml.rels': relationships(link('rId1', 'slide', 'slides/slide1.xml') + link('rId2', 'slide', 'slides/slide2.xml')),
  'ppt/slides/slide1.xml': slide('첫 슬라이드'),
  'ppt/slides/slide2.xml': slide('둘째 슬라이드'),
}, [1, 2].map(index => '<Override PartName="/ppt/slides/slide' + index + '.xml" ContentType="' + mime('presentationml.slide') + '"/>').join(''));

export const odt = encode({
  mimetype: 'application/vnd.oasis.opendocument.text',
  'content.xml': '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>오픈문서 본문</text:p></office:text></office:body></office:document-content>',
});

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');

export async function richHangul() {
  await initRhwp({ module_or_path: await readFile(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url)) });
  const doc = HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, '공문 본문');
    doc.createHeaderFooter(0, true, 0);
    doc.insertTextInHeaderFooter(0, true, 0, 0, 0, '머리말 확인');
    doc.createHeaderFooter(0, false, 0);
    doc.insertTextInHeaderFooter(0, false, 0, 0, 0, '꼬리말 확인');
    doc.insertClickHereField(0, 0, 2, '기안자 입력', '', '기안자', true);
    const position = JSON.parse(doc.createTable(0, 0, 0, 2, 2));
    doc.insertTextInCell(0, position.paraIdx, position.controlIdx, 0, 0, 0, '표 내용');
    const page = JSON.parse(doc.insertPageBreak(0, position.paraIdx, 0));
    doc.insertText(0, page.paraIdx, 0, '두 번째 쪽');
    doc.insertPicture(0, page.paraIdx, 0, '[]', png, 3500, 3500, 1, 1, 'png', '예제 이미지');
    return { hwpx: doc.exportHwpx(), hwp: doc.exportHwp() };
  } finally { doc.free(); }
}

export function pdf() {
  const stream = 'BT /F1 20 Tf 50 150 Td (Sample text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const positions = [];
  for (const [index, object] of objects.entries()) {
    positions.push(body.length);
    body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  return Buffer.from(body + 'xref\n0 6\n0000000000 65535 f \n' +
    positions.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + body.length + '\n%%EOF');
}
