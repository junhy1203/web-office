import { useEffect, useRef, useState } from 'react';
import type { RhwpEditor } from '@rhwp/editor';
import { strFromU8 } from 'fflate';
import { descendants, fileError, isZip, openZip, xml } from './files';
import { replaceExtension } from './formats';
import type { EditorProps } from './workspace';

let core: Promise<typeof import('@rhwp/core')> | undefined;
function loadCore() {
  return core ??= import('@rhwp/core').then(async module => {
    const canvas = document.createElement('canvas').getContext('2d');
    if (!canvas) throw new Error('한글 편집에 필요한 Canvas를 사용할 수 없습니다.');
    (globalThis as typeof globalThis & { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
      canvas.font = font;
      return canvas.measureText(text).width;
    };
    const response = await fetch(new URL('rhwp/core.wasm.pack', location.href));
    if (!response.ok || !response.body) throw new Error('한글 문서 엔진을 불러올 수 없습니다.');
    const wasm = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    await module.default({ module_or_path: wasm });
    return module;
  }).catch(error => { core = undefined; throw error; });
}

function describeWarnings(report: string) {
  const data: unknown = JSON.parse(report);
  const messages: string[] = [];
  function scan(value: unknown) {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!value || typeof value !== 'object') return;
    const entry = value as Record<string, unknown>;
    const level = String(entry.severity ?? entry.level ?? '').toLowerCase();
    const message = entry.message ?? entry.detail ?? entry.description ?? entry.kind ?? entry.code;
    if (typeof message === 'string' && level !== 'info') messages.push(message);
    Object.values(entry).forEach(scan);
  }
  scan(data);
  return [...new Set(messages)].slice(0, 12);
}

async function prepareHangul(bytes: Uint8Array, name: string, blank = false) {
  const { HwpDocument } = await loadCore();
  if (blank) {
    const doc = HwpDocument.createEmpty();
    try { doc.createBlankDocument(); return { bytes: doc.exportHwpx(), name, warnings: [] }; }
    finally { doc.free(); }
  }
  if (isZip(bytes)) {
    const source = openZip(bytes);
    const manifest = source.get('META-INF/manifest.xml');
    if (manifest && descendants(xml(strFromU8(manifest)), 'encryption-data').length) {
      throw new Error('비밀번호로 보호된 한글 문서입니다.');
    }
  }
  const doc = new HwpDocument(bytes);
  try {
    if (doc.getSourceFormat() === 'hwpx') {
      return { bytes, name: replaceExtension(name, 'hwpx'), warnings: [] };
    }
    const result = doc.exportHwpxWithReport();
    try {
      return { bytes: result.takeBytes(), name: replaceExtension(name, 'hwpx'), warnings: describeWarnings(result.contentLoss()) };
    } finally { result.free(); }
  } finally { doc.free(); }
}

function comparePackages(before: Uint8Array, after: Uint8Array) {
  const input = openZip(before);
  const output = openZip(after);
  const missing = [...input.keys()].filter(name => !output.has(name) &&
    /^(BinData\/|Contents\/(?!section\d+\.xml)|Scripts\/)/i.test(name));
  return missing.length ? [`내보낸 사본에서 빠진 구성 요소: ${missing.slice(0, 8).join(', ')}`] : [];
}

export default function HangulEditor({ tab, onDirty, setSave, requestSave }: EditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDirty, setSave, requestSave });
  callbacks.current = { onDirty, setSave, requestSave };
  const [state, setState] = useState('한글 편집기를 불러오는 중…');
  const [ready, setReady] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    const host = container.current!;
    let disposed = false;
    let studio: RhwpEditor | undefined;
    let timer = 0;
    let events: AbortController | undefined;
    let unsubscribe: (() => void) | undefined;
    let baseline = '';
    let sourceWarnings: string[] = [];

    const updateDirty = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const latest = await studio?.getDocumentState();
          if (!disposed && latest) callbacks.current.onDirty(latest.documentSha256 !== baseline);
        } catch { /* The iframe may have closed. */ }
      }, 120);
    };
    async function open() {
      const [module, input] = await Promise.all([
        import('@rhwp/editor'),
        prepareHangul(tab.bytes, tab.name, tab.blank),
      ]);
      if (disposed) return;
      const url = new URL('rhwp/index.html', location.href);
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('한글 편집기 리소스를 찾을 수 없습니다.');
      }
      studio = await module.createStudio(host, { studioUrl: url.href, renderer: 'canvas2d', requestTimeoutMs: 8000 });
      if (disposed) { studio.destroy(); return; }
      studio.element.title = '한글 편집기';
      await studio.loadFile(input.bytes.slice(), input.name);
      if (disposed) return;
      baseline = (await studio.getDocumentState()).documentSha256;
      sourceWarnings = input.warnings;
      setWarnings(sourceWarnings);
      setReady(true);
      callbacks.current.setSave(async () => {
        if (!studio) throw new Error('한글 편집기가 닫혔습니다.');
        const savedState = await studio.getDocumentState();
        const bytes = await studio.exportHwpx();
        const notes = [...sourceWarnings, ...comparePackages(input.bytes, bytes)];
        if (notes.length && !window.confirm(`저장할 사본의 호환성을 확인해 주세요.\n\n${notes.join('\n')}\n\n사본을 저장할까요?`)) {
          throw new DOMException('저장이 취소되었습니다.', 'AbortError');
        }
        baseline = savedState.documentSha256;
        const latest = await studio.getDocumentState();
        return { bytes, name: replaceExtension(tab.name, 'hwpx'), dirty: latest.documentSha256 !== baseline };
      });
      try { unsubscribe = studio.onDocumentChanged(updateDirty); } catch { /* Check user input through the iframe. */ }
      events = new AbortController();
      const frame = studio.element.contentDocument;
      const options = { signal: events.signal, capture: true };
      for (const type of ['input', 'compositionend', 'paste', 'cut', 'keyup', 'click', 'drop']) {
        frame?.addEventListener(type, updateDirty, options);
      }
      frame?.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.stopImmediatePropagation();
          callbacks.current.requestSave();
        }
      }, options);
    }
    open().catch(error => { if (!disposed) setState(`한글 문서를 열지 못했습니다. ${fileError(error)}`); });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      events?.abort();
      unsubscribe?.();
      studio?.destroy();
      callbacks.current.setSave();
    };
  }, [tab.bytes, tab.name, tab.blank]);

  return <div className="hangul-workspace">
    {warnings.length > 0 && <details className="notice warning"><summary>HWPX 변환 확인 항목 {warnings.length}개</summary>
      <ul>{warnings.map(item => <li key={item}>{item}</li>)}</ul></details>}
    {!ready && <div className="load-state hangul-placeholder" role="status">{state}</div>}
    <div className="hangul-frame" ref={container} aria-hidden={!ready} style={{ visibility: ready ? 'visible' : 'hidden' }} />
  </div>;
}
