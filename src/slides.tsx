import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, SquarePlus } from 'lucide-react';
import { attribute, children, descendants, fileError, first } from './files';
import { element, namespaces, OfficePackage } from './office';
import { hexColor, InlineText, PartImage, Toolbar } from './office-ui';
import type { EditorProps } from './workspace';

function transform(shape: Element) {
  return first(first(shape, 'spPr'), 'xfrm') ?? first(shape, 'xfrm');
}

function position(shape: Element, width: number, height: number): CSSProperties {
  const xfrm = transform(shape);
  const off = first(xfrm, 'off');
  const ext = first(xfrm, 'ext');
  return {
    left: Number(attribute(off, 'x')) * 100 / width + '%',
    top: Number(attribute(off, 'y')) * 100 / height + '%',
    width: (Number(attribute(ext, 'cx')) || width / 3) * 100 / width + '%',
    height: (Number(attribute(ext, 'cy')) || height / 8) * 100 / height + '%',
    transform: `rotate(${Number(attribute(xfrm, 'rot')) / 60_000}deg)`,
  };
}

export default function SlidesEditor({ tab, setSave, onDirty }: EditorProps) {
  const office = useMemo(() => new OfficePackage(tab.bytes), [tab.bytes]);
  const presentation = office.root();
  const idList = first(presentation, 'sldIdLst');
  const links = useMemo(() => office.links(office.main), [office]);
  const slides = idList ? children(idList, 'sldId').flatMap(id => {
    const relation = [...id.attributes].find(attr => attr.localName === 'id' && attr.namespaceURI)?.value;
    const path = relation ? links.get(relation)?.path : undefined;
    return path ? [{ id, path }] : [];
  }) : [];
  const [activePath, setActivePath] = useState('');
  const [selected, setSelected] = useState<Element>();
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const activeIndex = Math.max(0, slides.findIndex(slide => slide.path === activePath));
  const active = slides[activeIndex];
  const width = Number(attribute(first(presentation, 'sldSz'), 'cx')) || 12_192_000;
  const height = Number(attribute(first(presentation, 'sldSz'), 'cy')) || 6_858_000;
  const editable = tab.format.editable;
  useEffect(() => {
    if (!editable) return;
    setSave(async () => ({ bytes: office.save(), name: tab.name }));
    return () => setSave();
  }, [editable, office, setSave, tab.name]);
  if (!active) throw new Error('프레젠테이션에 열 수 있는 슬라이드가 없습니다.');
  const commonSlideData = first(office.root(active.path), 'cSld');
  const tree = first(commonSlideData, 'spTree');
  const shapes = tree ? Array.from(tree.children).filter(shape => ['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(shape.localName)) : [];
  const imageLinks = office.links(active.path);

  function change(path = active.path) {
    office.mark(path);
    onDirty(true);
    refresh(current => current + 1);
  }
  function reorder(offset: number) {
    const neighbor = slides[activeIndex + offset];
    if (!neighbor) return;
    if (offset < 0) neighbor.id.before(active.id);
    else neighbor.id.after(active.id);
    setActivePath(active.path);
    change(office.main);
  }
  function addShape() {
    if (!tree) return;
    const nextId = Math.max(0, ...descendants(tree, 'cNvPr').map(node => Number(attribute(node, 'id')) || 0)) + 1;
    const shape = element(tree, 'p', 'sp');
    const properties = element(shape, 'p', 'nvSpPr');
    const name = element(properties, 'p', 'cNvPr');
    name.setAttribute('id', String(nextId));
    name.setAttribute('name', '사각형 ' + nextId);
    properties.append(name, element(properties, 'p', 'cNvSpPr'), element(properties, 'p', 'nvPr'));
    const style = element(shape, 'p', 'spPr');
    const anchor = element(style, 'a', 'xfrm');
    const offset = element(anchor, 'a', 'off');
    offset.setAttribute('x', String(Math.round(width * 0.3)));
    offset.setAttribute('y', String(Math.round(height * 0.32)));
    const size = element(anchor, 'a', 'ext');
    size.setAttribute('cx', String(Math.round(width * 0.4)));
    size.setAttribute('cy', String(Math.round(height * 0.22)));
    anchor.append(offset, size);
    const geometry = element(style, 'a', 'prstGeom');
    geometry.setAttribute('prst', 'rect');
    geometry.append(element(geometry, 'a', 'avLst'));
    const fill = element(style, 'a', 'solidFill');
    const color = element(fill, 'a', 'srgbClr');
    color.setAttribute('val', 'DCE8FF');
    fill.append(color);
    style.append(anchor, geometry, fill);
    const body = element(shape, 'p', 'txBody');
    const paragraph = element(body, 'a', 'p');
    const run = element(paragraph, 'a', 'r');
    run.append(element(run, 'a', 't', '텍스트'));
    paragraph.append(run);
    body.append(element(body, 'a', 'bodyPr'), element(body, 'a', 'lstStyle'), paragraph);
    shape.append(properties, style, body);
    tree.insertBefore(shape, first(tree, 'extLst') ?? null);
    setSelected(shape);
    change();
  }
  function move(event: ReactPointerEvent<HTMLDivElement>, shape: Element) {
    if (!editable || event.button !== 0 || (event.target as HTMLElement).closest('[contenteditable]')) return;
    setSelected(shape);
    const offset = first(transform(shape), 'off');
    if (!offset) return;
    const item = event.currentTarget;
    const scale = item.parentElement!.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const initial = { x: Number(attribute(offset, 'x')), y: Number(attribute(offset, 'y')) };
    item.setPointerCapture(event.pointerId);
    const track = (move: PointerEvent) => {
      item.style.left = initial.x * 100 / width + (move.clientX - start.x) * 100 / scale.width + '%';
      item.style.top = initial.y * 100 / height + (move.clientY - start.y) * 100 / scale.height + '%';
    };
    const end = (endEvent: PointerEvent) => {
      item.removeEventListener('pointermove', track);
      item.removeEventListener('pointerup', end);
      item.removeEventListener('pointercancel', end);
      const dx = endEvent.clientX - start.x;
      const dy = endEvent.clientY - start.y;
      if (endEvent.type === 'pointerup' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        offset.setAttribute('x', String(Math.round(initial.x + dx * width / scale.width)));
        offset.setAttribute('y', String(Math.round(initial.y + dy * height / scale.height)));
        change();
      } else {
        item.style.left = initial.x * 100 / width + '%';
        item.style.top = initial.y * 100 / height + '%';
      }
    };
    item.addEventListener('pointermove', track);
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
  }
  async function replaceImage(file: File) {
    try {
      const blip = selected ? descendants(selected, 'blip')[0] : undefined;
      if (!blip || file.size > 20 * 1024 * 1024) throw new Error('교체할 이미지가 없거나 파일이 너무 큽니다.');
      const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
      const extension = types[file.type];
      if (!extension) throw new Error('PNG, JPEG 또는 GIF 이미지를 선택해 주세요.');
      const source = await file.arrayBuffer();
      const image = await createImageBitmap(file);
      image.close();
      const relation = office.addImage(active.path, new Uint8Array(source), extension);
      blip.setAttributeNS(blip.lookupNamespaceURI('r') ?? namespaces.r, 'r:embed', relation);
      change();
      setError('');
    } catch (problem) { setError(fileError(problem)); }
  }
  function renderShape(shape: Element, index: number) {
    const part = first(shape, 'spPr');
    const fill = hexColor(first(first(part, 'solidFill'), 'srgbClr'));
    const geometry = attribute(first(part, 'prstGeom'), 'prst');
    const fillStyle = { backgroundColor: fill, borderRadius: geometry === 'ellipse' ? '50%' : undefined };
    return <div key={index} className={`slide-object${selected === shape ? ' selected' : ''}${editable ? ' movable' : ''}`}
      style={{ ...position(shape, width, height), ...fillStyle }} onPointerDown={event => move(event, shape)}>
      {shape.localName === 'pic' ? <PartImage office={office} path={imageLinks.get(attribute(descendants(shape, 'blip')[0], 'embed'))?.path ?? ''}
        alt="슬라이드 이미지" style={{ width: '100%', height: '100%', objectFit: 'fill' }} /> :
        descendants(shape, 'p').map((paragraph, position) => <p key={position} style={{
          textAlign: attribute(first(paragraph, 'pPr'), 'algn') === 'ctr' ? 'center' : undefined,
        }}>{descendants(paragraph, 't').map((text, run) => {
          const format = first(text.parentElement, 'rPr');
          const fontSize = Number(attribute(format, 'sz')) / 100;
          return <span key={run} style={{ fontSize: fontSize ? `${fontSize / 36}em` : undefined,
            fontWeight: attribute(format, 'b') === '1' ? 700 : undefined,
            color: hexColor(first(first(format, 'solidFill'), 'srgbClr')),
          }}><InlineText value={text.textContent ?? ''} label="슬라이드 텍스트" onSelect={() => setSelected(shape)}
            update={editable ? value => {
              if (text.textContent !== value) { text.textContent = value; change(); }
            } : undefined} /></span>;
        })}</p>)}
    </div>;
  }
  const background = hexColor(descendants(first(commonSlideData, 'bg') ?? presentation.ownerDocument.createElement('empty'), 'srgbClr')[0]);
  return <div className="document-workspace">
    <Toolbar><strong>슬라이드 {activeIndex + 1} / {slides.length}</strong><span className="tool-divider" />
      {editable && <>
        <button className="icon-button" aria-label="슬라이드 위로" title="위로" disabled={activeIndex === 0} onClick={() => reorder(-1)}><ArrowUp size={17} /></button>
        <button className="icon-button" aria-label="슬라이드 아래로" title="아래로" disabled={activeIndex >= slides.length - 1} onClick={() => reorder(1)}><ArrowDown size={17} /></button>
        <button className="button" onClick={addShape}><SquarePlus size={16} /> 사각형 삽입</button>
        <button className="button" disabled={selected?.localName !== 'pic'} onClick={() => imageInput.current?.click()}><ImagePlus size={16} /> 이미지 교체</button>
        <input type="file" hidden ref={imageInput} accept="image/png,image/jpeg,image/gif" onChange={event => {
          const image = event.target.files?.[0]; if (image) void replaceImage(image); event.target.value = '';
        }} />
      </>}
    </Toolbar>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="slide-workspace">
      <nav className="slide-list" aria-label="슬라이드 목록">{slides.map((slide, index) => <button key={slide.path}
        className={index === activeIndex ? 'slide-active' : ''} onClick={() => { setActivePath(slide.path); setSelected(undefined); }}>
        <span>{index + 1}</span><div>{descendants(office.root(slide.path), 't')[0]?.textContent || '슬라이드'}</div>
      </button>)}</nav>
      <div className="slide-stage"><div className="slide-paper" style={{ aspectRatio: width / height, backgroundColor: background }} key={active.path}>
        {shapes.map(renderShape)}
      </div></div>
    </div>
  </div>;
}
