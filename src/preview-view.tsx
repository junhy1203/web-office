import { useEffect, useState, useMemo } from 'react';
import { FileQuestion, ZoomIn, ZoomOut } from 'lucide-react';
import { blobOf, fileError } from './files';
import { readPreview, type Item } from './preview';
import { Toolbar } from './office-ui';
import type { Tab } from './workspace';

const pictures: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', apng: 'png', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', ico: 'x-icon', jfif: 'jpeg', jxl: 'jxl', heic: 'heic', heif: 'heif', jp2: 'jp2', j2k: 'j2k' };

function asPng(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => canvas.toBlob(blob => {
    if (blob) void blob.arrayBuffer().then(data => resolve(new Uint8Array(data)), reject);
    else reject(new Error('이미지를 표시할 수 없습니다.'));
  }, 'image/png'));
}

async function loadImage(tab: Tab): Promise<Item[]> {
  const name = tab.format.extension;
  const bytes = tab.bytes;
  if (pictures[name]) return [{ kind: 'image', bytes, type: 'image/' + pictures[name] }];
  if (name === 'tif' || name === 'tiff') {
    const { default: utif } = await import('utif');
    const data = Uint8Array.from(bytes).buffer;
    const pages = utif.decode(data).filter(page => page.t256?.[0] && page.t257?.[0]);
    return Promise.all(pages.slice(0, 20).map(async (page, index) => {
      if (page.t256![0] * page.t257![0] > 40_000_000) throw new Error('TIFF 페이지 크기가 표시 한도를 초과합니다.');
      utif.decodeImage(data, page);
      const canvas = document.createElement('canvas');
      canvas.width = page.width;
      canvas.height = page.height;
      canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(utif.toRGBA8(page)), page.width, page.height), 0, 0);
      return { kind: 'image', bytes: await asPng(canvas), type: 'image/png', title: `${index + 1}쪽` };
    }));
  }
  if (name === 'psd' || name === 'psb') {
    if (bytes.length < 26 || String.fromCharCode(...bytes.slice(0, 4)) !== '8BPS') throw new Error('Photoshop 문서 헤더를 읽을 수 없습니다.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(18) * view.getUint32(14) > 40_000_000) throw new Error('Photoshop 이미지 크기가 표시 한도를 초과합니다.');
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(Uint8Array.from(bytes).buffer, { skipLayerImageData: true, skipThumbnail: true });
    if (psd.canvas) return [{ kind: 'image', bytes: await asPng(psd.canvas), type: 'image/png', title: '합성 이미지' }];
  }
  return readPreview(tab);
}

function ImageItem({ item, zoom }: { item: Extract<Item, { kind: 'image' }>; zoom: number }) {
  const [failed, setFailed] = useState(false);
  const url = useMemo(() => URL.createObjectURL(blobOf(item.bytes, item.type)), [item.bytes, item.type]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return failed ? <p className="notice">브라우저에서 이 이미지를 해석할 수 없습니다. 파일의 버전과 손상 여부를 확인해 주세요.</p> :
    <img className="preview-image" src={url} alt={item.title || '이미지 미리보기'} onError={() => setFailed(true)} style={{ maxWidth: `${zoom}%` }} />;
}

export default function PreviewView({ tab }: { tab: Tab }) {
  const [items, setItems] = useState<Item[]>();
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    let active = true;
    (tab.format.kind === 'image' ? loadImage(tab) : readPreview(tab)).then(values => {
      if (active) setItems(values.filter(item => item.kind === 'text' ? item.text.trim() : item.kind === 'table' ? item.rows.length : true));
    }).catch(error => { if (active) setError(fileError(error)); });
    return () => { active = false; };
  }, [tab]);
  if (error) return <div className="load-state" role="alert"><FileQuestion size={30} /><strong>미리보기를 열 수 없습니다</strong><p>{error}</p></div>;
  if (!items) return <div className="load-state" role="status">파일 내용을 읽는 중…</div>;
  if (items.length === 0) return <div className="load-state"><FileQuestion size={32} />
    <strong>이 파일의 내용 미리보기를 준비 중입니다</strong>
    <p>{tab.format.group === 'Google Drive' ? 'Google Drive 원문을 가리키는 바로가기입니다. 원문 연결 기능은 준비 중입니다.' :
      '이 형식 또는 버전의 본문을 브라우저에서 읽을 수 있는 뷰어가 아직 없습니다.'}</p>
  </div>;
  const hasImages = items.some(item => item.kind === 'image');
  return <div className="document-workspace">
    <Toolbar><strong>{tab.format.extension.toUpperCase()}</strong><span className="muted">내용 보기</span>
      <span className="spacer" />{hasImages && <>
        <button className="icon-button" title="축소" aria-label="축소" disabled={zoom <= 50} onClick={() => setZoom(zoom - 25)}><ZoomOut size={18} /></button>
        <span className="muted">{zoom}%</span>
        <button className="icon-button" title="확대" aria-label="확대" disabled={zoom >= 250} onClick={() => setZoom(zoom + 25)}><ZoomIn size={18} /></button>
      </>}
    </Toolbar>
    <div className="preview-scroll">{items.map((item, index) => <section className={`preview-card preview-${item.kind}`} key={index}>
      {item.title && <h2>{item.title}</h2>}
      {item.kind === 'image' && <ImageItem item={item} zoom={zoom} />}
      {(item.kind === 'text' || item.kind === 'notice') && <pre>{item.text}</pre>}
      {item.kind === 'table' && <div className="preview-table"><table><tbody>{item.rows.map((row, y) => <tr key={y}>
        {row.map((cell, x) => <td key={x}>{cell}</td>)}</tr>)}</tbody></table></div>}
    </section>)}</div>
  </div>;
}
