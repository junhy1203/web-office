import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Braces, Check, CircleHelp, Code2, Download, File, Files, FileText, FolderOpen,
  House, LayoutGrid, PanelLeft, Plus, Presentation, Search, ShieldCheck, Table2, Upload, X,
} from 'lucide-react';
import { detectFormat, formats } from './formats';
import { download, fileError, maxFileBytes } from './files';
import type { EditorProps, SavedFile, Tab } from './workspace';
import './style.css';

const HangulEditor = lazy(() => import('./hangul'));
const CodeEditor = lazy(() => import('./code-editor'));
const CsvEditor = lazy(() => import('./sheet').then(module => ({ default: module.CsvEditor })));
const SheetEditor = lazy(() => import('./sheet'));
const WordEditor = lazy(() => import('./word'));
const SlidesEditor = lazy(() => import('./slides'));
const PdfView = lazy(() => import('./pdf-view'));
const PreviewView = lazy(() => import('./preview-view'));

const icons = { hangul: FileText, text: Braces, csv: Table2, word: FileText, sheet: Table2, slides: Presentation, pdf: FileText, image: File, preview: File, pending: File };
const detectedPreview = new Set('doc dot odt ott fodt rtf sxw stw ppt pps pot odp otp fodp sxi sti xls xlsb xlt ods ots fods numbers dif slk sxc stc et ett wk1 wk3 wk4 wks db sqlite sqlite3 db3 dbf jpg jpeg png apng gif webp avif bmp tif tiff ico jfif psd psb xps oxps epub fb2 cbz cbt eml ics ical vcf enex opml ipynb mhtml mht webloc sig asc pem drawio dio vsdx idml'.split(' '));
const support = (format: Tab['format']) => {
  if (format.editable) return '편집';
  if (['text', 'word', 'sheet', 'slides', 'pdf'].includes(format.kind) || detectedPreview.has(format.extension)) return '보기';
  return '준비 중';
};

function FileIcon({ tab, size = 17 }: { tab: Tab; size?: number }) {
  const Icon = icons[tab.format.kind];
  return <Icon size={size} className={`file-icon kind-${tab.format.kind}`} />;
}

class EditorError extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error: fileError(error) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="load-state" role="alert"><File size={30} /><strong>파일을 열 수 없습니다</strong><p>{this.state.error}</p></div>;
  }
}

function EditorHost({ tab, active, register, markDirty, save }: {
  tab: Tab;
  active: boolean;
  register: (id: string, callback?: () => Promise<SavedFile>) => void;
  markDirty: (id: string, dirty: boolean) => void;
  save: (id: string) => Promise<void>;
}) {
  const setSave = useCallback((callback?: () => Promise<SavedFile>) => register(tab.id, callback), [register, tab.id]);
  const onDirty = useCallback((dirty: boolean) => markDirty(tab.id, dirty), [markDirty, tab.id]);
  const requestSave = useCallback(() => { void save(tab.id); }, [save, tab.id]);
  const props: EditorProps = { tab, active, setSave, onDirty, requestSave };
  const Editor = { hangul: HangulEditor, text: CodeEditor, csv: CsvEditor, word: WordEditor, sheet: SheetEditor, slides: SlidesEditor }[tab.format.kind as 'hangul' | 'text' | 'csv' | 'word' | 'sheet' | 'slides'];
  return <div className="editor-pane" role="tabpanel" aria-label={tab.name} hidden={!active}>
    <EditorError><Suspense fallback={<div className="load-state" role="status">편집기를 준비하는 중…</div>}>
      {Editor ? <Editor {...props} /> : tab.format.kind === 'pdf' ? <PdfView bytes={tab.bytes} /> : <PreviewView tab={tab} />}
    </Suspense></EditorError>
  </div>;
}

const newItems = [
  { kind: 'hangul', title: '한글 문서', description: '글과 표가 있는 문서 작성', filename: '제목 없는 문서.hwpx', Icon: FileText },
  { kind: 'text', title: '텍스트', description: '메모나 일반 텍스트 작성', filename: '제목 없는 텍스트.txt', Icon: File },
  { kind: 'python', title: 'Python', description: '코드를 작성하고 바로 실행', filename: 'main.py', Icon: Code2 },
] as const;

function Welcome({ open, create, showFormats }: { open: () => void; create: (name: string) => void; showFormats: () => void }) {
  return <div className="welcome-scroll"><section className="welcome">
    <div className="welcome-heading"><div className="welcome-mark"><Files size={26} strokeWidth={1.7} /></div>
      <h1>문서 작업 공간</h1><p>한글 문서부터 표, 슬라이드, 코드까지 한곳에서 열고 작업하세요.</p>
    </div>
    <button className="drop-area" onClick={open}>
      <span className="upload-icon"><Upload size={23} strokeWidth={1.8} /></span>
      <strong>파일을 끌어다 놓으세요</strong><span>또는 클릭해서 이 기기의 파일 선택</span>
      <span className="drop-shortcut"><kbd>Ctrl</kbd> <kbd>O</kbd></span>
    </button>
    <h2 className="section-title">새로 만들기</h2>
    <div className="new-grid">{newItems.map(({ kind, title, description, filename, Icon }) => <button key={kind} className="new-card" onClick={() => create(filename)}>
      <div className={`new-icon ${kind}`}><Icon size={21} strokeWidth={1.9} /></div>
      <div><strong>{title}</strong><span>{description}</span></div><Plus size={16} className="new-plus" />
    </button>)}</div>
    <div className="welcome-bottom"><span><ShieldCheck size={16} /> 파일은 이 브라우저에서 처리됩니다</span>
      <button className="text-button" onClick={showFormats}>지원 파일 형식</button></div>
  </section></div>;
}

function FormatList({ close }: { close: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const key = query.trim().toLowerCase().replace(/^\./, '');
  const groups = new Map<string, typeof formats>();
  for (const format of formats.filter(format => format.extension.includes(key) || format.group.includes(key))) {
    const group = groups.get(format.group) ?? [];
    group.push(format);
    groups.set(format.group, group);
  }
  return <div className="format-overlay" onClick={close}><section className="format-dialog" role="dialog" aria-modal="true" aria-label="파일 형식" onClick={event => event.stopPropagation()}>
    <div className="format-title"><h2>파일 형식</h2><button className="icon-button" aria-label="닫기" onClick={close}><X size={21} /></button></div>
    <label className="format-search"><Search size={17} /><input ref={input} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') close(); }} placeholder="확장자 또는 분류 검색" /></label>
    <div className="format-body">{[...groups].map(([group, groupFormats]) => <section key={group}><h3>{group}</h3><div className="format-chips">
      {groupFormats.map(format => <span className="format-chip" key={format.extension}><strong>.{format.extension}</strong><small>{support(format)}</small></span>)}
    </div></section>)}{groups.size === 0 && <p>일치하는 확장자가 없습니다.</p>}</div>
  </section></div>;
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState('');
  const [sidebar, showSidebar] = useState(true);
  const [formatList, setFormatList] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [availableSaves, setAvailableSaves] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [newMenu, showNewMenu] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeRef = useRef(active);
  const dragDepth = useRef(0);
  const saves = useRef(new Map<string, () => Promise<SavedFile>>());
  const busy = useRef(false);
  activeRef.current = active;
  const tab = tabs.find(item => item.id === active);
  const open = useCallback(() => fileInput.current?.click(), []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(undefined), message.error ? 8500 : 3600);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    if (!tabs.some(item => item.dirty)) return;
    const confirmUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener('beforeunload', confirmUnload);
    return () => window.removeEventListener('beforeunload', confirmUnload);
  }, [tabs]);

  const register = useCallback((id: string, callback?: () => Promise<SavedFile>) => {
    if (callback) saves.current.set(id, callback);
    else saves.current.delete(id);
    setAvailableSaves([...saves.current.keys()]);
  }, []);
  const markDirty = useCallback((id: string, dirty: boolean) => {
    setTabs(current => current.find(item => item.id === id)?.dirty === dirty ? current : current.map(item => item.id === id ? { ...item, dirty } : item));
  }, []);

  const save = useCallback(async (id: string) => {
    const action = saves.current.get(id);
    if (!action || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const result = await action();
      download(result.bytes, result.name);
      markDirty(id, result.dirty === true);
      setMessage({ text: `${result.name} 사본을 저장했습니다.`, error: false });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage({ text: fileError(error), error: true });
    } finally { busy.current = false; setSaving(false); }
  }, [markDirty]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key === 'o') { event.preventDefault(); open(); }
      if (key === 's') { event.preventDefault(); void save(activeRef.current); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, save]);

  function append(items: Tab[]) {
    if (items.length === 0) return;
    setTabs(previous => [...previous, ...items]);
    setActive(items.at(-1)!.id);
  }
  function create(name: string) {
    showNewMenu(false);
    append([{ id: crypto.randomUUID(), name, bytes: new Uint8Array(), blank: true, format: detectFormat(name), dirty: false }]);
  }
  async function openFiles(files: FileList | File[]) {
    const errors: string[] = [];
    const opened = await Promise.all([...files].map(async file => {
      try {
        if (file.size > maxFileBytes) throw new Error('100 MB를 초과합니다.');
        return { id: crypto.randomUUID(), name: file.name, format: detectFormat(file.name), bytes: new Uint8Array(await file.arrayBuffer()), dirty: false };
      } catch (error) { errors.push(`${file.name} · ${fileError(error)}`); return undefined; }
    }));
    append(opened.filter((item): item is NonNullable<typeof item> => !!item));
    if (errors.length) setMessage({ text: errors.join(' / '), error: true });
  }
  function close(id: string) {
    const index = tabs.findIndex(item => item.id === id);
    if (index < 0) return;
    if (tabs[index].dirty && !window.confirm(`‘${tabs[index].name}’의 저장하지 않은 변경 사항을 버리고 닫을까요?`)) return;
    if (active === id) setActive(tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? '');
    setTabs(tabs.filter(item => item.id !== id));
  }

  return <div className="app" onDragEnter={event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); dragDepth.current += 1; setDragging(true);
  }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) setDragging(false); }}
    onDrop={event => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault(); dragDepth.current = 0; setDragging(false); void openFiles(event.dataTransfer.files);
    }}>
    <input ref={fileInput} type="file" multiple hidden aria-label="문서 파일 열기" onChange={event => {
      if (event.target.files) void openFiles(event.target.files);
      event.target.value = '';
    }} />
    <header className="topbar">
      <button className="brand" onClick={() => setActive('')} aria-label="문서함 홈"><span><Files size={20} strokeWidth={2} /></span> 문서함</button>
      <div className="top-actions">
        <div className="new-menu"><button className="button" aria-expanded={newMenu} onClick={() => showNewMenu(!newMenu)}><Plus size={16} /> 새 문서</button>
          {newMenu && <div className="new-menu-options">{newItems.map(item => <button key={item.kind} onClick={() => create(item.filename)}><item.Icon size={16} /> {item.title}</button>)}</div>}
        </div>
        <button className="button" onClick={open}><FolderOpen size={17} /> 열기</button>
        <button className="button primary" disabled={!tab || !availableSaves.includes(tab.id) || saving} onClick={() => tab && void save(tab.id)}>
          <Download size={17} /> 사본 저장
        </button>
      </div>
      <button className="icon-button top-help" title="파일 형식" aria-label="파일 형식" onClick={() => setFormatList(true)}><CircleHelp size={20} /></button>
    </header>
    <div className="work-area">
      {sidebar && <aside className="sidebar" aria-label="작업 공간 탐색">
        <div className="side-top"><span>작업 공간</span><button className="icon-button" title="사이드바 접기" aria-label="사이드바 접기" onClick={() => showSidebar(false)}><PanelLeft size={16} /></button></div>
        <button className={`side-link${!tab ? ' chosen' : ''}`} onClick={() => setActive('')}><House size={17} /> 홈</button>
        <button className="side-link" onClick={() => setFormatList(true)}><LayoutGrid size={17} /> 파일 형식</button>
        <div className="side-doc-heading"><span>열린 문서</span><button className="icon-button" title="파일 추가" aria-label="파일 추가" onClick={open}><Plus size={16} /></button></div>
        <div className="side-files">{tabs.length ? tabs.map(item => <button key={item.id} className={`side-link side-file${item.id === active ? ' chosen' : ''}`} onClick={() => setActive(item.id)}>
          <FileIcon tab={item} /><span title={item.name}>{item.name}</span>{item.dirty && <i className="dirty-dot" aria-label="변경됨" />}
        </button>) : <p>아직 열린 문서가 없습니다.</p>}</div>
      </aside>}
      <main className="work-main">
        <div className="tabs-bar">
          {!sidebar && <button className="icon-button tabs-icon" title="사이드바 펼치기" aria-label="사이드바 펼치기" onClick={() => showSidebar(true)}><PanelLeft size={18} /></button>}
          <div className="tab-list" role="tablist" aria-label="열린 문서">
            <button className={`tab-home${!tab ? ' current' : ''}`} role="tab" aria-selected={!tab} onClick={() => setActive('')}><House size={16} /> 홈</button>
            {tabs.map(item => <div key={item.id} className={`document-tab${item.id === active ? ' current' : ''}`}>
              <button role="tab" aria-selected={item.id === active} onClick={() => setActive(item.id)} title={item.name}>
                <FileIcon tab={item} size={15} /><span>{item.name}</span>{item.dirty && <i className="dirty-dot" aria-label="변경됨" />}
              </button><button className="tab-close" title="탭 닫기" aria-label={`${item.name} 닫기`} onClick={() => close(item.id)}><X size={14} /></button>
            </div>)}
          </div>
          <button className="icon-button tabs-icon" aria-label="파일 열기" onClick={open}><Plus size={18} /></button>
        </div>
        {!tab && <Welcome open={open} create={create} showFormats={() => setFormatList(true)} />}
        {tabs.map(item => <EditorHost key={item.id} tab={item} active={item.id === active} register={register} markDirty={markDirty} save={save} />)}
      </main>
    </div>
    <footer className="statusbar"><span><ShieldCheck size={14} /> 로컬 작업</span>
      <span className="spacer" /><span>{tab ? `.${tab.format.extension} · ${tab.dirty ? '저장하지 않은 변경 사항' : support(tab.format)}` : '문서 작업 공간'}</span>
    </footer>
    {dragging && <div className="drag-overlay"><Upload size={34} /><strong>여기에 파일 놓기</strong></div>}
    {message && <div className={`toast${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>
      {message.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{message.text}</span>
      <button className="icon-button" aria-label="메시지 닫기" onClick={() => setMessage(undefined)}><X size={16} /></button>
    </div>}
    {formatList && <FormatList close={() => setFormatList(false)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
