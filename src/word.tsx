import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Table, Underline } from 'lucide-react';
import { attribute, children, descendants, first } from './files';
import { addFirst, element, OfficePackage, wordAttribute } from './office';
import { hexColor, InlineText, PartImage, Toolbar } from './office-ui';
import type { EditorProps } from './workspace';

type Selection = { paragraph: Element; run?: Element };

function runStyle(run?: Element): CSSProperties {
  const format = first(run, 'rPr');
  const size = Number(attribute(first(format, 'sz'), 'val'));
  const enabled = (name: string) => {
    const property = first(format, name);
    return !!property && !['0', 'false', 'off', 'none'].includes(attribute(property, 'val'));
  };
  return {
    fontWeight: enabled('b') ? 700 : undefined,
    fontStyle: enabled('i') ? 'italic' : undefined,
    textDecoration: enabled('u') ? 'underline' : undefined,
    fontSize: size ? `${size / 2}pt` : undefined,
    color: hexColor(first(format, 'color')),
  };
}

export default function WordEditor({ tab, setSave, onDirty }: EditorProps) {
  const office = useMemo(() => new OfficePackage(tab.bytes), [tab.bytes]);
  const body = first(office.root(), 'body');
  if (!body) throw new Error('Word 본문이 비어 있거나 손상되었습니다.');
  const links = useMemo(() => office.links(office.main), [office]);
  const [selection, select] = useState<Selection>();
  const [, refresh] = useState(0);
  const editable = tab.format.editable;
  useEffect(() => {
    if (!editable) return;
    setSave(async () => ({ bytes: office.save(), name: tab.name }));
    return () => setSave();
  }, [office, tab.name, setSave, editable]);

  function update() {
    office.mark(office.main);
    onDirty(true);
    refresh(value => value + 1);
  }
  function formatText(name: 'b' | 'i' | 'u') {
    if (!selection?.run) return;
    const properties = addFirst(selection.run, 'w', 'rPr');
    const existing = first(properties, name);
    if (existing) {
      const off = ['0', 'false', 'off', 'none'].includes(attribute(existing, 'val'));
      wordAttribute(existing, 'val', off ? (name === 'u' ? 'single' : '1') : (name === 'u' ? 'none' : '0'));
    } else {
      const next = element(properties, 'w', name);
      if (name === 'u') wordAttribute(next, 'val', 'single');
      properties.append(next);
    }
    update();
  }
  function alignment(value: string) {
    if (!selection) return;
    const properties = addFirst(selection.paragraph, 'w', 'pPr');
    const align = first(properties, 'jc') ?? element(properties, 'w', 'jc');
    wordAttribute(align, 'val', value);
    properties.append(align);
    update();
  }
  function addTable() {
    const table = element(body!, 'w', 'tbl');
    const grid = element(table, 'w', 'tblGrid');
    for (let column = 0; column < 2; column += 1) {
      const size = element(grid, 'w', 'gridCol');
      wordAttribute(size, 'w', '3000');
      grid.append(size);
    }
    table.append(grid);
    for (let row = 0; row < 2; row += 1) {
      const tr = element(table, 'w', 'tr');
      for (let column = 0; column < 2; column += 1) {
        const td = element(tr, 'w', 'tc');
        td.append(element(td, 'w', 'p'));
        tr.append(td);
      }
      table.append(tr);
    }
    const anchor = selection?.paragraph;
    if (anchor && anchor.parentElement === body) anchor.after(table);
    else body!.insertBefore(table, first(body, 'sectPr') ?? null);
    update();
  }
  function edit(text: Element, value: string) {
    if (text.textContent === value) return;
    text.textContent = value;
    if (/^\s|\s$/.test(value)) text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    update();
  }
  function renderRun(run: Element, paragraph: Element, key: number) {
    return <span key={key} style={runStyle(run)}>{Array.from(run.children).map((item, index) => {
      if (item.localName === 't') return <InlineText key={index} value={item.textContent ?? ''} label="본문 텍스트"
        onSelect={() => select({ paragraph, run })} update={editable ? value => edit(item, value) : undefined} />;
      if (item.localName === 'br' || item.localName === 'cr') return <br key={index} />;
      if (item.localName === 'tab') return <span key={index}>{'    '}</span>;
      if (item.localName === 'drawing' || item.localName === 'pict') {
        const drawing = descendants(item, 'blip')[0] ?? descendants(item, 'imagedata')[0];
        const extent = descendants(item, 'extent')[0];
        const width = Number(attribute(extent, 'cx')) / 9525;
        return <PartImage key={index} office={office} path={links.get(attribute(drawing, 'embed') || attribute(drawing, 'id'))?.path ?? ''}
          alt="문서 이미지" style={width ? { width, maxWidth: '100%' } : { maxWidth: '100%' }} />;
      }
      return null;
    })}</span>;
  }
  function renderBlocks(node: Element): ReactNode {
    return Array.from(node.children).map((block, index) => {
      if (block.localName === 'p') {
        const rawAlign = attribute(first(first(block, 'pPr'), 'jc'), 'val');
        const textAlign = rawAlign === 'both' ? 'justify' : ['left', 'right', 'center'].includes(rawAlign) ? rawAlign as CSSProperties['textAlign'] : undefined;
        const runs = descendants(block, 'r').filter(item => item.namespaceURI === block.namespaceURI);
        return <p key={index} style={{ textAlign }} onClick={() => select(previous => previous?.paragraph === block ? previous : { paragraph: block })}>
          {runs.length > 0 ? runs.map((run, position) => renderRun(run, block, position)) : <InlineText value="" label="빈 문단"
            onSelect={() => select({ paragraph: block })} update={editable ? value => {
              if (!value) return;
              const run = element(block, 'w', 'r');
              const text = element(run, 'w', 't');
              run.append(text);
              block.append(run);
              edit(text, value);
              select({ paragraph: block, run });
            } : undefined} />}
        </p>;
      }
      if (block.localName === 'tbl') return <table key={index}><tbody>{children(block, 'tr').map((row, rowIndex) => <tr key={rowIndex}>
        {children(row, 'tc').map((cell, cellIndex) => <td key={cellIndex}
          colSpan={Number(attribute(first(first(cell, 'tcPr'), 'gridSpan'), 'val')) || 1}>{renderBlocks(cell)}</td>)}
      </tr>)}</tbody></table>;
      if (['sdt', 'sdtContent', 'customXml', 'ins'].includes(block.localName)) return <div key={index}>{renderBlocks(block)}</div>;
      return null;
    });
  }

  return <div className="document-workspace">
    <Toolbar>
      <strong>Word 문서</strong><span className="tool-divider" />
      {editable ? <>
        <button className="icon-button" title="굵게" aria-label="굵게" disabled={!selection?.run} onClick={() => formatText('b')}><Bold size={18} /></button>
        <button className="icon-button" title="기울임" aria-label="기울임" disabled={!selection?.run} onClick={() => formatText('i')}><Italic size={18} /></button>
        <button className="icon-button" title="밑줄" aria-label="밑줄" disabled={!selection?.run} onClick={() => formatText('u')}><Underline size={18} /></button>
        <span className="tool-divider" />
        {([['left', '왼쪽 정렬', AlignLeft], ['center', '가운데 정렬', AlignCenter], ['right', '오른쪽 정렬', AlignRight]] as const)
          .map(([value, label, Icon]) => <button key={value} className="icon-button" title={label} aria-label={label} disabled={!selection} onClick={() => alignment(value)}><Icon size={18} /></button>)}
        <button className="button" onClick={addTable}><Table size={16} /> 표 삽입</button>
      </> : <span className="muted">보기 전용</span>}
    </Toolbar>
    <div className="paper-scroll"><article className="word-paper">{renderBlocks(body)}</article></div>
  </div>;
}
