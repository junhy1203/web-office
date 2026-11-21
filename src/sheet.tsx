import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { attribute, children, descendants, first } from './files';
import { columnIndex, columnName, element, OfficePackage } from './office';
import { Toolbar } from './office-ui';
import { decodeText, encodeText, parseDelimited, writeDelimited } from './text';
import { previewFormula } from './formulas';
import type { EditorProps } from './workspace';

const rowsPerPage = 60;
const columnsPerPage = 14;

interface Grid {
  rowCount: number;
  columnCount: number;
  read(row: number, column: number): string;
  write?(row: number, column: number, value: string): void;
  display?(row: number, column: number, value: string): string;
  style?(row: number, column: number): CSSProperties;
  color?(row: number, column: number, color: string): void;
  addRow?(): void;
  addColumn?(): void;
}

function GridEditor({ grid, onChange, children: tools }: { grid: Grid; onChange: () => void; children?: React.ReactNode }) {
  const [selection, setSelection] = useState({ row: 0, column: 0 });
  const [firstRow, setFirstRow] = useState(0);
  const [firstColumn, setFirstColumn] = useState(0);
  const write = (row: number, column: number, value: string) => {
    if (grid.read(row, column) === value) return;
    grid.write?.(row, column, value);
    onChange();
  };
  const columnCount = Math.min(columnsPerPage, grid.columnCount - firstColumn);
  const rowCount = Math.min(rowsPerPage, grid.rowCount - firstRow);
  return <>
    <Toolbar>{tools}<span className="tool-divider" /><strong className="cell-address">{columnName(selection.column)}{selection.row + 1}</strong>
      <input className="formula-input" aria-label="셀 값 또는 수식" value={grid.read(selection.row, selection.column)} readOnly={!grid.write}
        onChange={event => write(selection.row, selection.column, event.target.value)} />
      {grid.color && <label className="inline-label">채우기 <input aria-label="셀 배경색" type="color" defaultValue="#fff4b9"
        onChange={event => { grid.color?.(selection.row, selection.column, event.target.value); onChange(); }} /></label>}
    </Toolbar>
    <div className="grid-scroll">
      <table className="data-grid"><thead><tr><th aria-label="행 번호" />
        {Array.from({ length: columnCount }, (_, index) => <th key={index}>{columnName(firstColumn + index)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: rowCount }, (_, index) => {
          const row = firstRow + index;
          return <tr key={row}><th>{row + 1}</th>{Array.from({ length: columnCount }, (_, offset) => {
            const column = firstColumn + offset;
            const address = `${columnName(column)}${row + 1}`;
            const selected = selection.row === row && selection.column === column;
            const value = grid.read(row, column);
            return <td key={column} className={selected ? 'cell-selected' : undefined} style={grid.style?.(row, column)}>
              {grid.write ? <input aria-label={address} value={selected ? value : grid.display?.(row, column, value) ?? value}
                onFocus={() => setSelection({ row, column })} onChange={event => write(row, column, event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    const nextRow = event.currentTarget.closest('tr')?.nextElementSibling;
                    nextRow?.children[offset + 1]?.querySelector('input')?.focus();
                  }
                }} /> : grid.display?.(row, column, value) ?? value}
            </td>;
          })}</tr>;
        })}</tbody></table>
    </div>
    <div className="editor-toolbar grid-footer">
      {grid.addRow && <button className="button" onClick={() => { grid.addRow?.(); onChange(); setFirstRow(Math.floor(grid.rowCount / rowsPerPage) * rowsPerPage); }}><Plus size={14} /> 행</button>}
      {grid.addColumn && <button className="button" onClick={() => { grid.addColumn?.(); onChange(); setFirstColumn(Math.floor(grid.columnCount / columnsPerPage) * columnsPerPage); }}><Plus size={14} /> 열</button>}
      <span className="spacer" />
      <button className="icon-button" aria-label="이전 행" disabled={firstRow === 0} onClick={() => setFirstRow(firstRow - rowsPerPage)}><ChevronLeft size={16} /></button>
      <span>{firstRow + 1}–{firstRow + rowCount}행</span>
      <button className="icon-button" aria-label="다음 행" disabled={firstRow + rowCount >= grid.rowCount} onClick={() => setFirstRow(firstRow + rowsPerPage)}><ChevronRight size={16} /></button>
      <button className="icon-button" aria-label="이전 열" disabled={firstColumn === 0} onClick={() => setFirstColumn(firstColumn - columnsPerPage)}><ChevronLeft size={16} /></button>
      <span>{columnName(firstColumn)}–{columnName(firstColumn + columnCount - 1)}열</span>
      <button className="icon-button" aria-label="다음 열" disabled={firstColumn + columnCount >= grid.columnCount} onClick={() => setFirstColumn(firstColumn + columnsPerPage)}><ChevronRight size={16} /></button>
    </div>
  </>;
}

export function CsvEditor({ tab, onDirty, setSave }: EditorProps) {
  const file = useMemo(() => decodeText(tab.bytes), [tab.bytes]);
  const delimiter = tab.format.extension === 'tsv' ? '\t' : ',';
  const [rows] = useState(() => parseDelimited(file.value, delimiter));
  const [columns, setColumns] = useState(() => rows.reduce((max, row) => Math.max(max, row.length), 1));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setSave(async () => ({ bytes: revision ? encodeText(writeDelimited(rows, delimiter, file.value.endsWith('\n')), file) : tab.bytes, name: tab.name }));
    return () => setSave();
  }, [rows, delimiter, file, tab.bytes, tab.name, revision, setSave]);
  const grid: Grid = {
    rowCount: rows.length, columnCount: columns, read: (row, column) => rows[row]?.[column] ?? '',
    write(row, column, value) {
      while (rows[row].length < column) rows[row].push('');
      rows[row][column] = value;
    },
    addRow: () => { rows.push(Array(columns).fill('')); },
    addColumn: () => { for (const row of rows) row[columns] = ''; setColumns(columns + 1); },
  };
  return <div className="document-workspace"><GridEditor grid={grid} onChange={() => { onDirty(true); setRevision(value => value + 1); }}>
    <strong>{tab.format.extension.toUpperCase()}</strong>
  </GridEditor></div>;
}

function createWorksheet(office: OfficePackage, path: string, shared: string[], editable: boolean): Grid {
  const root = office.root(path);
  const data = first(root, 'sheetData');
  if (!data) throw new Error('워크시트 표를 찾을 수 없습니다.');
  const keys = new Map<string, Element>();
  const rows = new Map<number, Element>();
  let rowCount = editable ? 120 : 1;
  let columnCount = editable ? 28 : 1;
  for (const row of children(data, 'row')) {
    const index = Number(attribute(row, 'r'));
    if (index > 0) rows.set(index, row);
    for (const cell of children(row, 'c')) {
      const address = attribute(cell, 'r');
      keys.set(address, cell);
      const rowNumber = Number(address.match(/\d+$/)?.[0]);
      if (Number.isFinite(rowNumber)) rowCount = Math.max(rowNumber, rowCount);
      columnCount = Math.max(columnIndex(address) + 1, columnCount);
    }
  }
  const stylePath = office.partByType(office.main, 'styles');
  const styles = stylePath ? office.root(stylePath) : undefined;
  const fills = first(styles, 'fills');
  const formats = first(styles, 'cellXfs');
  const get = (row: number, column: number) => keys.get(columnName(column) + (row + 1));
  function ensure(row: number, column: number) {
    const address = columnName(column) + (row + 1);
    const existing = keys.get(address);
    if (existing) return existing;
    let rowNode = rows.get(row + 1);
    if (!rowNode) {
      rowNode = element(data!, 's', 'row');
      rowNode.setAttribute('r', String(row + 1));
      data!.insertBefore(rowNode, children(data!, 'row').find(candidate => Number(attribute(candidate, 'r')) > row + 1) ?? null);
      rows.set(row + 1, rowNode);
    }
    const cell = element(rowNode, 's', 'c');
    cell.setAttribute('r', address);
    rowNode.insertBefore(cell, children(rowNode, 'c').find(candidate => columnIndex(attribute(candidate, 'r')) > column) ?? null);
    keys.set(address, cell);
    const dimension = first(root, 'dimension');
    if (dimension) {
      const last = attribute(dimension, 'ref').split(':').at(-1) ?? 'A1';
      const lastRow = Math.max(row + 1, Number(last.match(/\d+$/)?.[0] ?? 1));
      const lastColumn = Math.max(column, columnIndex(last));
      dimension.setAttribute('ref', `A1:${columnName(lastColumn)}${lastRow}`);
    }
    return cell;
  }
  function readAddress(address: string) {
    const cell = keys.get(address);
    const formula = first(cell, 'f');
    if (formula?.textContent) return '=' + formula.textContent;
    const value = first(cell, 'v')?.textContent ?? '';
    const type = attribute(cell, 't');
    if (type === 's') return shared[Number(value)] ?? '';
    if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
    if (type === 'inlineStr') return cell ? descendants(cell, 't').map(part => part.textContent).join('') : '';
    return value;
  }
  return {
    rowCount, columnCount,
    read: (row, column) => readAddress(columnName(column) + (row + 1)),
    display: (row, column, value) => {
      if (!value.startsWith('=')) return value;
      return previewFormula(columnName(column) + (row + 1), readAddress) ?? (editable && office.dirty
        ? value : first(get(row, column), 'v')?.textContent || value);
    },
    write: editable ? (row, column, value) => {
      const cell = ensure(row, column);
      for (const child of Array.from(cell.children)) {
        if (['v', 'f', 'is'].includes(child.localName)) child.remove();
      }
      cell.removeAttribute('t');
      if (value.startsWith('=') && value.length > 1) {
        cell.prepend(element(cell, 's', 'f', value.slice(1)));
      } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))) {
        cell.prepend(element(cell, 's', 'v', value));
      } else if (/^(true|false)$/i.test(value)) {
        cell.setAttribute('t', 'b');
        cell.prepend(element(cell, 's', 'v', value.toLowerCase() === 'true' ? '1' : '0'));
      } else if (value) {
        cell.setAttribute('t', 'inlineStr');
        const item = element(cell, 's', 'is');
        const text = element(item, 's', 't', value);
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        item.append(text);
        cell.prepend(item);
      }
      const workbook = office.root();
      let calc = first(workbook, 'calcPr');
      if (!calc) {
        calc = element(workbook, 's', 'calcPr');
        const afterCalc = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];
        workbook.insertBefore(calc, Array.from(workbook.children).find(node => afterCalc.includes(node.localName)) ?? null);
      }
      calc.setAttribute('fullCalcOnLoad', '1');
      office.mark(path, office.main);
    } : undefined,
    style(row, column) {
      const format = formats && children(formats, 'xf')[Number(attribute(get(row, column), 's'))];
      const fill = fills && children(fills, 'fill')[Number(attribute(format, 'fillId'))];
      const rgb = attribute(first(first(fill, 'patternFill'), 'fgColor'), 'rgb');
      return /^[\da-f]{8}$/i.test(rgb) ? { backgroundColor: '#' + rgb.slice(2) } : {};
    },
    color: editable && fills && formats ? (row, column, color) => {
      const cell = ensure(row, column);
      const styleIndex = Number(attribute(cell, 's'));
      const format = children(formats, 'xf')[styleIndex];
      const fillId = children(fills, 'fill').length;
      const fill = element(fills, 's', 'fill');
      const pattern = element(fill, 's', 'patternFill');
      const foreground = element(pattern, 's', 'fgColor');
      pattern.setAttribute('patternType', 'solid');
      foreground.setAttribute('rgb', 'FF' + color.slice(1).toUpperCase());
      pattern.append(foreground);
      fill.append(pattern);
      fills.append(fill);
      fills.setAttribute('count', String(fillId + 1));
      const next = format?.cloneNode(true) as Element | undefined ?? element(formats, 's', 'xf');
      next.setAttribute('fillId', String(fillId));
      next.setAttribute('applyFill', '1');
      cell.setAttribute('s', String(children(formats, 'xf').length));
      formats.append(next);
      formats.setAttribute('count', String(children(formats, 'xf').length));
      office.mark(stylePath, path);
    } : undefined,
  };
}

export default function SheetEditor({ tab, onDirty, setSave }: EditorProps) {
  const office = useMemo(() => new OfficePackage(tab.bytes), [tab.bytes]);
  const sheets = useMemo(() => {
    const links = office.links(office.main);
    return children(first(office.root(), 'sheets') ?? office.root(), 'sheet').flatMap(sheet => {
      const path = links.get(attribute(sheet, 'id'))?.path;
      return path ? [{ name: attribute(sheet, 'name'), path }] : [];
    });
  }, [office]);
  const shared = useMemo(() => {
    const path = office.partByType(office.main, 'sharedStrings');
    return path ? descendants(office.root(path), 'si').map(item => descendants(item, 't').map(text => text.textContent).join('')) : [];
  }, [office]);
  const [selected, setSelected] = useState(0);
  const [, refresh] = useState(0);
  const editable = tab.format.editable;
  const grid = useMemo(() => sheets[selected] && createWorksheet(office, sheets[selected].path, shared, editable), [office, sheets, selected, shared, editable]);
  useEffect(() => {
    if (!editable) return;
    setSave(async () => ({ bytes: office.save(), name: tab.name }));
    return () => setSave();
  }, [editable, office, setSave, tab.name]);
  if (!grid) throw new Error('표에서 워크시트를 찾을 수 없습니다.');
  return <div className="document-workspace"><GridEditor key={selected} grid={grid} onChange={() => { onDirty(true); refresh(value => value + 1); }}>
    <label className="inline-label">시트 <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
      {sheets.map((sheet, index) => <option key={sheet.path} value={index}>{sheet.name}</option>)}
    </select></label>
  </GridEditor></div>;
}
