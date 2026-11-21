import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Search } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fileError } from './files';
import { Toolbar } from './office-ui';

GlobalWorkerOptions.workerSrc = worker;

export default function PdfView({ bytes }: { bytes: Uint8Array }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState('');
  const [password, setPassword] = useState<{ submit: (value: string) => void; wrong: boolean }>();
  const [pageNumber, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchId = useRef(0);

  useEffect(() => {
    let alive = true;
    const task = getDocument({
      data: bytes.slice(), enableXfa: false, useWasm: false,
      cMapUrl: new URL('pdf-runtime/cmaps/', location.href).href, cMapPacked: true,
      standardFontDataUrl: new URL('pdf-runtime/standard_fonts/', location.href).href,
      stopAtErrors: true, disableFontFace: false,
    });
    task.onPassword = (submit: (password: string) => void, reason: number) => {
      if (alive) setPassword({ submit, wrong: reason === PasswordResponses.INCORRECT_PASSWORD });
    };
    task.promise.then(document => {
      if (alive) { setPdf(document); setPassword(undefined); }
    }).catch(error => { if (alive) setError(`PDF를 읽을 수 없습니다. ${fileError(error)}`); });
    return () => { alive = false; searchId.current += 1; void task.destroy(); };
  }, [bytes]);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    if (!pdf) return;
    pdf.getPage(pageNumber).then(page => {
      const element = canvas.current;
      if (!alive || !element) return;
      const viewport = page.getViewport({ scale: zoom / 100 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 2400 / Math.max(viewport.width, viewport.height));
      element.width = Math.ceil(viewport.width * ratio);
      element.height = Math.ceil(viewport.height * ratio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      const render = page.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      stop = () => render.cancel();
      return render.promise;
    }).catch(problem => { if (alive) setError(`페이지를 표시할 수 없습니다. ${fileError(problem)}`); });
    return () => { alive = false; stop?.(); };
  }, [pageNumber, pdf, zoom]);

  async function search() {
    if (!pdf || !query.trim()) return;
    const id = ++searchId.current;
    const phrase = query.trim().normalize('NFC').toLowerCase();
    const found: number[] = [];
    setSearching(true);
    setSearched(false);
    try {
      for (let index = 1; index <= pdf.numPages; index += 1) {
        if (id !== searchId.current) return;
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('');
        if (text.normalize('NFC').toLowerCase().includes(phrase)) found.push(index);
      }
      if (id !== searchId.current) return;
      setMatches(found);
      setSearched(true);
      if (found.length) setPage(found[0]);
    } catch (error) {
      if (id === searchId.current) setError(`PDF 텍스트 검색에 실패했습니다. ${fileError(error)}`);
    } finally {
      if (id === searchId.current) setSearching(false);
    }
  }

  return <div className="document-workspace">
    {pdf && <Toolbar>
      <button className="icon-button" aria-label="이전 페이지" disabled={pageNumber === 1} onClick={() => setPage(pageNumber - 1)}><ChevronLeft size={18} /></button>
      <span className="muted">{pageNumber} / {pdf.numPages}</span>
      <button className="icon-button" aria-label="다음 페이지" disabled={pageNumber === pdf.numPages} onClick={() => setPage(pageNumber + 1)}><ChevronRight size={18} /></button>
      <span className="tool-divider" />
      <button className="icon-button" aria-label="축소" disabled={zoom <= 50} onClick={() => setZoom(zoom - 25)}><Minus size={18} /></button>
      <span className="muted">{zoom}%</span>
      <button className="icon-button" aria-label="확대" disabled={zoom >= 250} onClick={() => setZoom(zoom + 25)}><Plus size={18} /></button>
      <span className="spacer" />
      <form className="inline-form" onSubmit={event => { event.preventDefault(); void search(); }}>
        <input aria-label="PDF 텍스트 검색" placeholder="PDF에서 찾기" value={query}
          onChange={event => { setQuery(event.target.value); searchId.current += 1; setSearching(false); setMatches([]); setSearched(false); }} />
        <button className="icon-button" aria-label="검색 실행" disabled={searching || !query.trim()}><Search size={17} /></button>
      </form>
      {searched && (matches.length ? <select aria-label="검색 결과" value={matches.includes(pageNumber) ? pageNumber : ''}
        onChange={event => setPage(Number(event.target.value))}>
        <option value="" disabled>{matches.length}쪽에서 찾음</option>
        {matches.map(page => <option key={page} value={page}>{page}쪽</option>)}
      </select> : <span className="muted">결과 없음</span>)}
    </Toolbar>}
    {error && <div className="notice" role="alert">{error}</div>}
    {password && <form className="load-state" onSubmit={event => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get('password');
      if (typeof value === 'string' && value) { password.submit(value); event.currentTarget.reset(); }
    }}><p>{password.wrong ? '비밀번호가 맞지 않습니다.' : '암호로 보호된 PDF입니다.'}</p>
      <div className="inline-form"><input aria-label="PDF 비밀번호" type="password" name="password" autoComplete="off" required />
        <button className="button primary">열기</button></div></form>}
    {!pdf && !password && !error && <div className="load-state" role="status">PDF를 여는 중…</div>}
    <div className="paper-scroll" hidden={!pdf}><canvas aria-label={`PDF ${pageNumber}쪽`} className="pdf-page" ref={canvas} /></div>
  </div>;
}
