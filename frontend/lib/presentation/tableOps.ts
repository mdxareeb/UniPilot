/**
 * Pure table-cell operations for the native editor (Task D5, spec §5.4
 * "Tables" row, §6.4).
 *
 * The wire model is `TableElement` (types.ts): a header `columns` array of
 * `TableCell`s, a body `rows` matrix, and the engine's optional
 * `min_rows`/`max_rows`/`min_columns`/`max_columns` bounds. The renderer
 * (`TableElement.tsx`) renders `columns` as the first row when it is non-empty
 * and every body row after it — so this module addresses **rendered rows**:
 * row 0 is the stored header when `columns` is non-empty, otherwise the first
 * body row.
 *
 * Everything here is immutable, bounds-safe and returns the same element
 * reference when a write would be a no-op. A cell text write is
 * run-preserving exactly like the C plain-text editor: the new text becomes
 * one run carrying the old first run's font (a LaTeX first run degrades to
 * the cell/element font, the recorded §6.4 gap), and every other cell field
 * (`font`, `color`, `alignment`, unknown keys) is preserved.
 *
 * Bounds: a declared finite bound wins (clamped to a sane hard cap so a
 * malformed template cannot produce an unusable grid); otherwise the fork
 * editor's own caps apply — at least 1, at most 8 rows and 6 columns. Row
 * deletion never removes the header in place: like the fork's string-grid
 * delete, the first body row is promoted to header, and the last renderable
 * row is never removed.
 */
import { runsPlainText } from "./textRuns";
import { isTextRun } from "./elements";
import type { TableCell, TableElement, TextRunValue } from "./types";

export const TABLE_DEFAULT_MIN_ROWS = 1;
export const TABLE_DEFAULT_MAX_ROWS = 8;
export const TABLE_DEFAULT_MIN_COLUMNS = 1;
export const TABLE_DEFAULT_MAX_COLUMNS = 6;
/** Hard caps a declared bound is clamped into (a UI grid, not a data cap). */
export const TABLE_ROW_HARD_CAP = 50;
export const TABLE_COLUMN_HARD_CAP = 12;

export type TableBounds = {
  minRows: number;
  maxRows: number;
  minColumns: number;
  maxColumns: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function declaredBound(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

/** The declared wire bounds, clamped into the editor's hard caps. */
export function tableBounds(element: TableElement): TableBounds {
  const minRows = clamp(
    declaredBound(element.min_rows, TABLE_DEFAULT_MIN_ROWS),
    1,
    TABLE_ROW_HARD_CAP,
  );
  const maxRows = clamp(
    declaredBound(element.max_rows, TABLE_DEFAULT_MAX_ROWS),
    minRows,
    TABLE_ROW_HARD_CAP,
  );
  const minColumns = clamp(
    declaredBound(element.min_columns, TABLE_DEFAULT_MIN_COLUMNS),
    1,
    TABLE_COLUMN_HARD_CAP,
  );
  const maxColumns = clamp(
    declaredBound(element.max_columns, TABLE_DEFAULT_MAX_COLUMNS),
    minColumns,
    TABLE_COLUMN_HARD_CAP,
  );
  return { minRows, maxRows, minColumns, maxColumns };
}

function readColumns(element: TableElement): TableCell[] {
  return Array.isArray(element.columns) ? element.columns : [];
}

function readRows(element: TableElement): TableCell[][] {
  return Array.isArray(element.rows)
    ? element.rows.map((row) => (Array.isArray(row) ? row : []))
    : [];
}

/** Whether the wire stores a header row (`columns` is non-empty). */
export function tableHasHeader(element: TableElement): boolean {
  return readColumns(element).length > 0;
}

/** How many rows the renderer draws (the header included when stored). */
export function tableRenderedRowCount(element: TableElement): number {
  const columns = readColumns(element);
  return columns.length > 0 ? 1 + readRows(element).length : readRows(element).length;
}

/** How many columns the renderer draws (the widest row, floored at 1). */
export function tableColumnCount(element: TableElement): number {
  return Math.max(
    1,
    readColumns(element).length,
    ...readRows(element).map((row) => row.length),
  );
}

type LocatedCell = {
  cell: TableCell | undefined;
  list: TableCell[];
  columnIndex: number;
  where: "columns" | "rows";
  bodyIndex: number;
};

/**
 * Resolves a rendered cell address to its stored list. Answers `null` when
 * the address names no stored row; the cell itself may still be `undefined`
 * (a column the row does not store, which the renderer pads visually).
 */
function locateCell(
  element: TableElement,
  rowIndex: number,
  columnIndex: number,
): LocatedCell | null {
  const columns = readColumns(element);
  const rows = readRows(element);
  const header = columns.length > 0;
  if (rowIndex === 0 && header) {
    return {
      cell: columns[columnIndex],
      list: columns,
      columnIndex,
      where: "columns",
      bodyIndex: -1,
    };
  }
  const bodyIndex = rowIndex - (header ? 1 : 0);
  if (bodyIndex < 0 || bodyIndex >= rows.length) return null;
  return {
    cell: rows[bodyIndex][columnIndex],
    list: rows[bodyIndex],
    columnIndex,
    where: "rows",
    bodyIndex,
  };
}

/** The plain text a rendered cell displays (LaTeX contributes its source). */
export function tableCellText(
  element: TableElement,
  rowIndex: number,
  columnIndex: number,
): string {
  const located = locateCell(element, rowIndex, columnIndex);
  return located === null ? "" : runsPlainText(located.cell?.runs);
}

/**
 * The run array a plain-text write produces: one run carrying the text and
 * the old first run's own fields (a LaTeX first run keeps its font only), the
 * same rule as `setTextOnElement` for text elements.
 */
function runsWithText(
  cell: TableCell | undefined,
  text: string,
): TextRunValue[] {
  const runs = Array.isArray(cell?.runs) ? cell.runs : [];
  const first = runs[0];
  if (isTextRun(first)) {
    const base = { ...(first as Record<string, unknown>) };
    delete base.text;
    return [{ ...base, text } as TextRunValue];
  }
  const firstFont =
    typeof first === "object" && first !== null
      ? (first as { font?: unknown }).font
      : undefined;
  const font = firstFont ?? cell?.font ?? null;
  return [{ text, ...(font ? { font } : {}) } as TextRunValue];
}

/** A list padded to hold `index`, materializing only the cells it must. */
function padCells(list: TableCell[], index: number): TableCell[] {
  const next = list.slice();
  while (next.length <= index) next.push({ runs: [] });
  return next;
}

/**
 * Writes one rendered cell's plain text, preserving every other cell field
 * and every other cell byte-for-byte. A cell the wire does not store (a
 * padded column) is created; an unaddressable row or an unchanged text is a
 * no-op. The cell text is not length-capped — the wire declares none.
 */
export function setTableCellText(
  element: TableElement,
  rowIndex: number,
  columnIndex: number,
  text: string,
): TableElement {
  if (
    !Number.isInteger(rowIndex) ||
    !Number.isInteger(columnIndex) ||
    rowIndex < 0 ||
    columnIndex < 0 ||
    typeof text !== "string"
  ) {
    return element;
  }
  const located = locateCell(element, rowIndex, columnIndex);
  if (located === null) return element;
  if (runsPlainText(located.cell?.runs) === text) return element;

  const nextList = padCells(located.list, columnIndex);
  nextList[columnIndex] = {
    ...(located.cell ?? {}),
    runs: runsWithText(located.cell, text),
  };

  if (located.where === "columns") return { ...element, columns: nextList };
  const rows = readRows(element);
  return {
    ...element,
    rows: rows.map((row, index) => (index === located.bodyIndex ? nextList : row)),
  };
}

/** Appends one empty body row; refused at the declared/default row maximum. */
export function addTableRow(element: TableElement): TableElement {
  const bounds = tableBounds(element);
  if (tableRenderedRowCount(element) >= bounds.maxRows) return element;
  const columnCount = tableColumnCount(element);
  const row: TableCell[] = Array.from({ length: columnCount }, () => ({
    runs: [],
  }));
  return { ...element, rows: [...readRows(element), row] };
}

/**
 * Removes one rendered row. Deleting the stored header promotes the first
 * body row into `columns` (the fork's string-grid semantics); a header-only
 * table and the last renderable row are refused, as are writes below a
 * declared `min_rows`.
 */
export function removeTableRow(
  element: TableElement,
  rowIndex: number,
): TableElement {
  const bounds = tableBounds(element);
  const rendered = tableRenderedRowCount(element);
  if (rendered <= 1 || rendered <= bounds.minRows) return element;
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rendered) {
    return element;
  }
  const columns = readColumns(element);
  const rows = readRows(element);
  if (columns.length > 0 && rowIndex === 0) {
    const [promoted, ...rest] = rows;
    if (promoted === undefined) return element;
    return { ...element, columns: promoted, rows: rest };
  }
  const bodyIndex = rowIndex - (columns.length > 0 ? 1 : 0);
  if (bodyIndex < 0 || bodyIndex >= rows.length) return element;
  return {
    ...element,
    rows: rows.filter((_, index) => index !== bodyIndex),
  };
}

/**
 * Appends one empty column to the header (when stored) and every body row,
 * padding rows that stored fewer cells than the rendered width first so the
 * new cell lands at the new column's index. A fully empty element initializes
 * a 1×1 body row — the first renderable cell — so the action always produces
 * something to edit. Refused at the declared/default column maximum.
 */
export function addTableColumn(element: TableElement): TableElement {
  const bounds = tableBounds(element);
  if (tableColumnCount(element) >= bounds.maxColumns) return element;
  if (tableRenderedRowCount(element) === 0) {
    return { ...element, rows: [[{ runs: [] }]] };
  }
  const columnCount = tableColumnCount(element);
  const columns = readColumns(element);
  const rows = readRows(element);
  const extend = (list: TableCell[]): TableCell[] => [
    ...padCells(list, columnCount - 1),
    { runs: [] },
  ];
  return {
    ...element,
    ...(columns.length > 0 ? { columns: extend(columns) } : {}),
    rows: rows.map(extend),
  };
}

/**
 * Removes one column from the header and every body row. Refused at the last
 * remaining column and below a declared `min_columns`; rows too short to
 * store the column are returned untouched.
 */
export function removeTableColumn(
  element: TableElement,
  columnIndex: number,
): TableElement {
  const bounds = tableBounds(element);
  const columnCount = tableColumnCount(element);
  if (columnCount <= 1 || columnCount <= bounds.minColumns) return element;
  if (
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= columnCount
  ) {
    return element;
  }
  const columns = readColumns(element);
  const rows = readRows(element);
  const removeAt = (list: TableCell[]): TableCell[] =>
    list.length > columnIndex
      ? list.filter((_, index) => index !== columnIndex)
      : list;
  const nextColumns = removeAt(columns);
  const nextRows = rows.map(removeAt);
  const changed =
    nextColumns.length !== columns.length ||
    nextRows.some((row, index) => row.length !== (rows[index]?.length ?? 0));
  if (!changed) return element;
  return { ...element, columns: nextColumns, rows: nextRows };
}
