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
  if (data?.type !== 'start') return;
  const {assets, source} = data;
  const urls = Object.fromEntries(assets.map(([name, type, buffer]) => [name, URL.createObjectURL(new Blob([buffer], {type}))]));
  const originalFetch = self.fetch.bind(self);
  const prefix = 'https://runtime.invalid/';
  self.fetch = (input, options) => {
    const address = typeof input === 'string' ? input : (input.url || input.href);
    const mapped = address.startsWith(prefix) && urls[address.slice(prefix.length)];
    return mapped ? originalFetch(mapped, options) : Promise.reject(new Error('네트워크 접근은 사용할 수 없습니다.'));
  };
  const pending = new Map();
  let inputId = 0;
  self.__webOfficeInput = prompt => new Promise(resolve => {
    const id = ++inputId;
    pending.set(id, resolve);
    self.postMessage({type: 'input-request', id, prompt: String(prompt ?? '')});
  });
  self.addEventListener('message', ({data}) => {
    if (data?.type !== 'input-response') return;
    const resolve = pending.get(data.id);
    if (resolve) { pending.delete(data.id); resolve(String(data.value ?? '')); }
  });
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
    python.setStdout({batched: text => output('stdout', text)});
    python.setStderr({batched: text => output('stderr', text)});
    python.globals.set('__webOfficeSource', source);
    self.postMessage({type: 'running'});
    await python.runPythonAsync("import ast\nimport inspect\nfrom js import __webOfficeInput\n\nasync def __webOfficeRead(prompt=''):\n    return await __webOfficeInput(str(prompt))\n\n__source_tree = ast.parse(__webOfficeSource, filename='main.py')\n__functions = [node for node in ast.walk(__source_tree) if isinstance(node, ast.FunctionDef)]\n__async_names = set()\nfor __fn in __functions:\n    if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'input' for node in ast.walk(__fn)):\n        __async_names.add(__fn.name)\n\n__changed = True\nwhile __changed:\n    __changed = False\n    for __fn in __functions:\n        if __fn.name not in __async_names and any(\n            isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in __async_names\n            for node in ast.walk(__fn)\n        ):\n            __async_names.add(__fn.name)\n            __changed = True\n\nclass __WebOfficeTransformer(ast.NodeTransformer):\n    def visit_FunctionDef(self, node):\n        node = self.generic_visit(node)\n        if node.name not in __async_names:\n            return node\n        kwargs = dict(name=node.name, args=node.args, body=node.body, decorator_list=node.decorator_list, returns=node.returns, type_comment=node.type_comment)\n        if hasattr(node, 'type_params'):\n            kwargs['type_params'] = node.type_params\n        return ast.copy_location(ast.AsyncFunctionDef(**kwargs), node)\n\n    def visit_Call(self, node):\n        node = self.generic_visit(node)\n        if not isinstance(node.func, ast.Name):\n            return node\n        if node.func.id == 'input':\n            node.func.id = '__webOfficeRead'\n            return ast.copy_location(ast.Await(value=node), node)\n        if node.func.id in __async_names:\n            return ast.copy_location(ast.Await(value=node), node)\n        return node\n\n__source_tree = __WebOfficeTransformer().visit(__source_tree)\nast.fix_missing_locations(__source_tree)\n__compiled = compile(__source_tree, 'main.py', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)\n__result = eval(__compiled, globals(), globals())\nif inspect.isawaitable(__result):\n    await __result", {filename: 'main.py'});
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
      port.onmessage = ({data}) => worker.postMessage(data, data.assets?.map(asset => asset[2]) ?? []);
      port.postMessage({type: 'ready'});
      addEventListener('pagehide', () => {worker.terminate(); URL.revokeObjectURL(url);}, {once: true});
    }, {once: true});
  </script>`;
}


type RunState = 'idle' | 'loading' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';
type ConsoleEntry = { type: 'stdout' | 'stderr' | 'input'; text: string };
type InputRequest = { id: number; prompt: string };
const labels: Record<RunState, string> = {
  idle: '실행 대기', loading: 'Python 준비 중', running: '실행 중', waiting: '입력 대기',
  done: '실행 완료', failed: '실행 오류', stopped: '실행 중지',
};

export default function PythonRunner({ source }: { source: () => string }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef<() => void>(undefined);
  const channelRef = useRef<MessagePort>(undefined);
  const rearmTimer = useRef<() => void>(undefined);
  const consoleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [request, setRequest] = useState<InputRequest | null>(null);
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<RunState>('idle');
  const busy = state === 'loading' || state === 'running' || state === 'waiting';

  useEffect(() => () => current.current?.(), []);
  useEffect(() => { if (request) inputRef.current?.focus(); }, [request]);
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [entries, request]);

  function append(type: ConsoleEntry['type'], text: string) {
    setEntries(previous => [...previous, { type, text }].slice(-1000));
  }

  function submitInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || !channelRef.current) return;
    channelRef.current.postMessage({ type: 'input-response', id: request.id, value: answer });
    append('input', request.prompt + answer);
    setRequest(null);
    setAnswer('');
    setState('running');
    rearmTimer.current?.();
  }

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
      if (channelRef.current === channel.port1) channelRef.current = undefined;
      rearmTimer.current = undefined;
      if (current.current === finish) current.current = undefined;
    };
    current.current = finish;
    channelRef.current = channel.port1;
    setEntries([]);
    setRequest(null);
    setAnswer('');
    setState('loading');

    const fail = (message: string) => {
      append('stderr', message);
      setRequest(null);
      setState('failed');
      finish();
    };
    const armTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fail('실행 제한 시간을 초과했습니다.'), 60_000);
    };
    rearmTimer.current = armTimer;
    armTimer();

    try {
      const assets = await Promise.all(Object.entries(assetTypes).map(async ([name, type]) => {
        const asset = await fetch(new URL('python-runtime/' + name, location.href), { signal: abort.signal });
        if (!asset.ok) throw new Error('Python 런타임 파일을 열 수 없습니다. (' + name + ')');
        return [name, type, await asset.arrayBuffer()] as const;
      }));
      if (abort.signal.aborted) return;

      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          channel.port1.postMessage({ type: 'start', assets, source: sourceSnapshot }, assets.map(asset => asset[2]));
        }
        if (data.type === 'running') setState('running');
        if (data.type === 'stdout' || data.type === 'stderr') append(data.type, String(data.text));
        if (data.type === 'input-request') {
          window.clearTimeout(timer);
          setRequest({ id: Number(data.id), prompt: String(data.prompt ?? '') });
          setState('waiting');
        }
        if (data.type === 'done' || data.type === 'failed') {
          setRequest(null);
          setState(data.type);
          finish();
        }
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
    <div className="editor-toolbar python-toolbar">
      <Terminal size={16} /><strong>Python 콘솔</strong><span role="status" className="muted">{labels[state]}</span>
      <span className="spacer" />
      <button className="button primary" onClick={run} disabled={busy}><Play size={15} /> 실행</button>
      <button className="button" disabled={!busy} onClick={() => {
        current.current?.();
        setRequest(null);
        setState('stopped');
      }}><Square size={14} /> 중지</button>
    </div>
    <div className="python-console" ref={consoleRef} role="log" aria-label="Python 입출력">
      {!entries.length && !request && <span className="python-placeholder">실행 결과가 이곳에 표시됩니다.</span>}
      {entries.map((entry, index) => <div key={index} className={'python-line ' + entry.type}>{entry.text}</div>)}
      {request && <form className="python-input-line" onSubmit={submitInput}>
        <label htmlFor="python-stdin">{request.prompt}</label>
        <input id="python-stdin" ref={inputRef} aria-label="Python input 입력" value={answer}
          onChange={event => setAnswer(event.target.value)} autoComplete="off" spellCheck={false} />
      </form>}
    </div>
    <div ref={host} hidden />
  </section>;
}
