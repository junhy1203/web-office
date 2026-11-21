import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { attribute, blobOf } from './files';
import type { OfficePackage } from './office';

const supportedImage = /\.(png|jpe?g|gif|webp|avif|bmp|apng|ico)$/i;
export function PartImage({ office, path, style, alt }: { office: OfficePackage; path: string; style?: CSSProperties; alt: string }) {
  const image = useMemo(() => {
    const bytes = office.parts.get(path);
    return bytes && supportedImage.test(path) ? URL.createObjectURL(blobOf(bytes)) : '';
  }, [office, path]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  return image ? <img src={image} alt={alt} style={style} draggable={false} /> : <span className="asset-placeholder">이미지 미리보기 제한</span>;
}

export function InlineText({ value, update, label, onSelect }: { value: string; update?: (value: string) => void; label: string; onSelect?: () => void }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (host.current && host.current.textContent !== value) host.current.textContent = value;
  }, [value]);
  if (!update) return <span>{value}</span>;
  return <span ref={host} className="inline-edit" role="textbox" aria-label={label} contentEditable suppressContentEditableWarning
    onInput={event => update(event.currentTarget.textContent ?? '')} onFocus={onSelect}
    onPaste={event => {
      event.preventDefault();
      const pasted = event.clipboardData.getData('text/plain').replace(/\r?\n/g, ' ');
      document.execCommand('insertText', false, pasted);
    }} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.currentTarget.blur();
      }
    }} />;
}

export function hexColor(node: Element | undefined, name = 'val') {
  const value = attribute(node, name);
  return /^[\da-f]{6}$/i.test(value) ? `#${value}` : undefined;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="editor-toolbar">{children}</div>;
}
