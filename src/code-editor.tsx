import { useEffect, useMemo, useRef, useState } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { openSearchPanel } from '@codemirror/search';
import { StreamLanguage } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { c, cpp, csharp, java, kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import { Search } from 'lucide-react';
import { decodeText, encodeText, type TextEncoding } from './text';
import type { EditorProps } from './workspace';
import PythonRunner from './python';

function language(extension: string) {
  if (['py', 'pyw'].includes(extension)) return python();
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(extension)) return javascript({ typescript: ['ts', 'tsx'].includes(extension), jsx: ['jsx', 'tsx'].includes(extension) });
  if (['html', 'htm', 'xhtml', 'vue', 'svelte', 'astro'].includes(extension)) return html();
  if (['css', 'scss', 'less'].includes(extension)) return css();
  if (['md', 'markdown', 'mdx', 'rmd', 'qmd'].includes(extension)) return markdown();
  if (['json', 'jsonl', 'ndjson', 'json5', 'excalidraw'].includes(extension)) return json();
  const modes = { yaml, yml: yaml, sh: shell, bash: shell, zsh: shell, fish: shell, c, h: c, cpp, cc: cpp, hpp: cpp, cs: csharp, java, kt: kotlin, kts: kotlin, scala, sc: scala, dart, rs: rust, go, rb: ruby, sql: standardSQL, xml, svg: xml, xsd: xml, xsl: xml, xslt: xml, graphml: xml };
  const mode = modes[extension as keyof typeof modes];
  return mode ? StreamLanguage.define(mode) : [];
}

const labels: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'cp949': 'CP949', 'windows-1252': 'Windows-1252',
};
const locale = EditorState.phrases.of({
  Find: '찾기', Replace: '바꾸기', next: '다음', previous: '이전', all: '모두',
  'replace all': '모두 바꾸기', replace: '바꾸기', 'match case': '대소문자 구분',
  regexp: '정규식', 'by word': '단어 단위', 'close': '닫기', 'Go to line': '줄 이동',
});

export default function CodeEditor({ tab, active, onDirty, setSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(undefined);
  const gutter = useMemo(() => new Compartment(), []);
  const [preferred, setPreferred] = useState<TextEncoding>();
  const [asUtf8, setAsUtf8] = useState(false);
  const file = useMemo(() => decodeText(tab.bytes, preferred), [tab.bytes, preferred]);
  const [position, setPosition] = useState('1:1');
  const callback = useRef(onDirty);
  callback.current = onDirty;
  const extension = tab.format.extension;
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: file.value,
        extensions: [basicSetup, locale, language(extension), gutter.of([]),
          EditorView.contentAttributes.of({ 'aria-label': '텍스트 편집기', spellcheck: 'false' }),
          EditorState.readOnly.of(!tab.format.editable), EditorView.editable.of(tab.format.editable),
          EditorView.updateListener.of(update => {
            if (update.docChanged) callback.current(update.state.doc.toString() !== file.value);
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setPosition(`${line.number}:${head - line.from + 1}`);
            }
          }),
        ],
      }),
    });
    editor.current = view;
    return () => { view.destroy(); editor.current = undefined; };
  }, [file, extension, gutter, tab.format.editable]);
  useEffect(() => { if (active) editor.current?.requestMeasure(); }, [active]);
  useEffect(() => {
    if (!tab.format.editable) return;
    setSave(async () => {
      const value = editor.current?.state.doc.toString() ?? file.value;
      return { bytes: !asUtf8 && value === file.value ? tab.bytes : encodeText(value, file, asUtf8), name: tab.name };
    });
    return () => setSave();
  }, [file, asUtf8, tab.bytes, tab.name, tab.format.editable, setSave]);

  function changeEncoding(value: TextEncoding) {
    if (tab.dirty && !window.confirm('인코딩을 바꾸면 현재 변경 사항을 잃습니다. 계속할까요?')) return;
    try { decodeText(tab.bytes, value); }
    catch { window.alert('이 인코딩으로 원본을 읽을 수 없습니다.'); return; }
    setPreferred(value);
    callback.current(false);
  }

  return <div className="code-workspace">
    <div className="editor-toolbar">
      <button className="button" onClick={() => editor.current && openSearchPanel(editor.current)}><Search size={16} /> 찾기</button>
      <span className="spacer" />
      <label className="inline-label">인코딩 <select value={file.encoding} onChange={event => changeEncoding(event.target.value as TextEncoding)}>
        {Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      {tab.format.editable && file.encoding !== 'utf-8' && <label className="inline-label"><input type="checkbox" checked={asUtf8} onChange={event => setAsUtf8(event.target.checked)} /> UTF-8로 저장</label>}
      <span className="muted">{file.newline === '\r\n' ? 'CRLF' : file.newline === '\r' ? 'CR' : 'LF'} · {position}</span>
    </div>
    <div className="code-host" ref={host} />
    {(extension === 'py' || extension === 'pyw') && <PythonRunner source={() => editor.current?.state.doc.toString() ?? file.value} />}
  </div>;
}
