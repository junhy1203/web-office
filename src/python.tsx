import { useEffect, useRef, useState } from 'react';
import { Play, Square, Terminal } from 'lucide-react';
import { fileError } from './files';

const assetTypes = {
  'pyodide.js': 'text/javascript',
  'pyodide.asm.js': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
};

const runnerWorker = `
self.onmessage = async ({data}) => {
  const {assets, source, stdin} = data;
  const urls = Object.fromEntries(assets.map(([name, type, buffer]) => [name, URL.createObjectURL(new Blob([buffer], {type}))]));
  const originalFetch = self.fetch.bind(self);
  const prefix = 'https://runtime.invalid/';
  self.fetch = (input, options) => {
    const address = typeof input === 'string' ? input : (input.url || input.href);
    const mapped = address.startsWith(prefix) && urls[address.slice(prefix.length)];
    return mapped ? originalFetch(mapped, options) : Promise.reject(new Error('네트워크 접근은 사용할 수 없습니다.'));
  };
  const lines = stdin ? stdin.split(/\\r?\\n/) : [];
  let outputSize = 0;
  const output = (type, value) => {
    const remaining = 120000 - outputSize;
    if (remaining <= 0) return;
    const rendered = String(value).slice(0, remaining);
    outputSize += rendered.length + 1;
    self.postMessage({type, text: rendered});
  };
  try {
    importScripts(urls['pyodide.asm.js'], urls['pyodide.js']);
    const python = await loadPyodide({indexURL: prefix, stdLibURL: prefix + 'python_stdlib.zip'});
    python.setStdin({stdin: () => lines.shift() ?? null});
    python.setStdout({batched: text => output('stdout', text)});
    python.setStderr({batched: text => output('stderr', text)});
    self.postMessage({type: 'running'});
    await python.runPythonAsync(source, {filename: 'main.py'});
    self.postMessage({type: 'done'});
  } catch (error) {
    output('stderr', String(error));
    self.postMessage({type: 'failed'});
  } finally {
    Object.values(urls).forEach(url => URL.revokeObjectURL(url));
  }
};
`;

function runnerDocument(nonce: string) {
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script nonce="${nonce}">
    window.addEventListener('message', ({source, ports}) => {
      if (source !== parent || !ports[0]) return;
      const port = ports[0];
      const url = URL.createObjectURL(new Blob([${JSON.stringify(runnerWorker)}], {type: 'text/javascript'}));
      const worker = new Worker(url);
      worker.onmessage = ({data}) => port.postMessage(data);
      worker.onerror = (event) => port.postMessage({type: 'error', text: event.message || '격리된 실행기를 시작할 수 없습니다.'});
      port.onmessage = ({data}) => worker.postMessage(data, data.assets.map(asset => asset[2]));
      port.postMessage({type: 'ready'});
      addEventListener('pagehide', () => {worker.terminate(); URL.revokeObjectURL(url);}, {once: true});
    }, {once: true});
  </script>`;
}

type RunState = 'idle' | 'loading' | 'running' | 'done' | 'failed' | 'stopped';
const labels = { idle: '실행 대기', loading: 'Python 준비 중', running: '실행 중', done: '실행 완료', failed: '실행 오류', stopped: '실행 중지' };

export default function PythonRunner({ source }: { source: () => string }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef<() => void>(undefined);
  const [stdin, setStdin] = useState('');
  const [output, setOutput] = useState('');
  const [state, setState] = useState<RunState>('idle');
  const busy = state === 'loading' || state === 'running';
  useEffect(() => () => current.current?.(), []);

  async function run() {
    const sourceSnapshot = source();
    current.current?.();
    const abort = new AbortController();
    const frame = document.createElement('iframe');
    const channel = new MessageChannel();
    frame.hidden = true;
    frame.title = '격리된 Python 실행 환경';
    frame.setAttribute('sandbox', 'allow-scripts');
    const nonce = crypto.randomUUID().replaceAll('-', '');
    let timer = 0;
    const finish = () => {
      abort.abort();
      channel.port1.close();
      channel.port2.close();
      frame.remove();
      window.clearTimeout(timer);
      if (current.current === finish) current.current = undefined;
    };
    current.current = finish;
    setOutput('');
    setState('loading');
    const fail = (message: string) => {
      setOutput(previous => previous + message + '\n');
      setState('failed');
      finish();
    };
    timer = window.setTimeout(() => fail('실행 제한 시간을 초과했습니다.'), 60_000);
    try {
      const assets = await Promise.all(Object.entries(assetTypes).map(async ([name, type]) => {
        const asset = await fetch(new URL(`python-runtime/${name}`, location.href), { signal: abort.signal });
        if (!asset.ok) throw new Error(`Python 런타임 파일을 열 수 없습니다. (${name})`);
        return [name, type, await asset.arrayBuffer()] as const;
      }));
      if (abort.signal.aborted) return;
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'ready') channel.port1.postMessage({ assets, source: sourceSnapshot, stdin }, assets.map(asset => asset[2]));
        if (data.type === 'running') setState('running');
        if (data.type === 'stdout' || data.type === 'stderr') setOutput(previous => (previous + data.text + '\n').slice(0, 120_001));
        if (data.type === 'done' || data.type === 'failed') { setState(data.type); finish(); }
        if (data.type === 'error') fail(String(data.text));
      };
      frame.onload = () => frame.contentWindow?.postMessage('start', '*', [channel.port2]);
      frame.srcdoc = runnerDocument(nonce);
      host.current?.append(frame);
    } catch (error) {
      if (!abort.signal.aborted) fail(fileError(error));
    }
  }

  return <section className="python-panel" aria-label="Python 실행기">
    <div className="editor-toolbar">
      <Terminal size={17} /><strong>Python</strong><span role="status" className="muted">{labels[state]}</span>
      <span className="spacer" />
      <button className="button primary" onClick={run} disabled={busy}><Play size={15} /> 실행</button>
      <button className="button" disabled={!busy} onClick={() => { current.current?.(); setState('stopped'); }}><Square size={14} /> 중지</button>
    </div>
    <div className="python-streams">
      <label>입력<textarea placeholder="input()에 전달할 값을 한 줄씩 입력" value={stdin} onChange={event => setStdin(event.target.value)} /></label>
      <label>출력<pre role="log">{output || '실행 결과가 여기에 표시됩니다.'}</pre></label>
    </div>
    <div ref={host} />
  </section>;
}
