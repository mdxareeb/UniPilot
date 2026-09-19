/**
 * `table` elements (Task B3, spec §6.4).
 *
 * The fork's `renderTable`: header `columns` become the first row, every cell
 * is an equal grid track, and each cell renders its runs with the merged
 * table/cell/run font. The first row is forced bold unless the wire declares a
 * `bold` explicitly; cell fills become the cell background. The fork's
 * contrast-based text-color correction against a cell fill is deliberately not
 * ported (recorded as a concern) — declared colors render as declared.
 */
import {
  elementBox,
  tableCellBaseFont,
  tableCellFrameFont,
} from "@/lib/presentation/elements";
import type {
  Alignment,
  Font,
  HorizontalAlignment,
  TableCell,
  TableElement as TableElementModel,
} from "@/lib/presentation/types";
import { TextRuns } from "./DeckText";
import { useDeckFontFamily } from "./StageContext";
import {
  colorWithOpacity,
  fontTextStyle,
  frameStyle,
  horizontalAlign,
  textAlign,
  transformCss,
  type RenderMode,
} from "./style";

const TABLE_BASE_FONT: Font = {
  family: "Arial",
  size: 18,
  color: "#111827",
  line_height: 1.15,
};

function normalizedRows(element: TableElementModel): TableCell[][] {
  const columns = Array.isArray(element.columns) ? element.columns : [];
  const body = (Array.isArray(element.rows) ? element.rows : []).map((row) =>
    Array.isArray(row) ? row : [],
  );
  return columns.length ? [columns, ...body] : body;
}

function cellAlignment(cell: TableCell | undefined): HorizontalAlignment | null {
  const value: unknown = cell?.alignment;
  if (typeof value === "string") return value as HorizontalAlignment;
  if (typeof value === "object" && value !== null) {
    const horizontal = (value as Alignment).horizontal;
    if (typeof horizontal === "string") return horizontal;
  }
  return null;
}

function cellFill(cell: TableCell | undefined): string | undefined {
  const value: unknown = cell?.color;
  if (typeof value === "string") return colorWithOpacity(value, null);
  if (typeof value === "object" && value !== null) {
    const fill = value as { color?: unknown; opacity?: unknown };
    return colorWithOpacity(
      typeof fill.color === "string" ? fill.color : null,
      typeof fill.opacity === "number" ? fill.opacity : null,
    );
  }
  return undefined;
}

export function TableElement({
  element,
  mode,
}: {
  element: TableElementModel;
  mode: RenderMode;
}) {
  const resolveFamily = useDeckFontFamily();
  const box = elementBox(element);
  const rows = normalizedRows(element);
  const tableName =
    typeof element.name === "string" && element.name !== ""
      ? element.name
      : undefined;

  if (rows.length === 0) {
    return (
      <div
        data-deck-table=""
        data-deck-table-name={tableName}
        style={{
          ...frameStyle(box, mode),
          ...transformCss(element.rotation),
          overflow: "hidden",
        }}
      />
    );
  }

  const rowCount = Math.max(1, rows.length);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const tableFont: Font = TABLE_BASE_FONT;

  const cells = rows.flatMap((row, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => {
      const cell = row[columnIndex];
      const header = rowIndex === 0;
      const baseFont = tableCellBaseFont(tableFont, cell, header);
      const frameFont = tableCellFrameFont(baseFont, cell);
      const alignment = cellAlignment(cell);
      const background = cellFill(cell);
      return (
        <div
          key={`${rowIndex}-${columnIndex}`}
          data-deck-table-cell={`${rowIndex}-${columnIndex}`}
          style={{
            ...fontTextStyle(frameFont, resolveFamily, { includeTextDecoration: false }),
            display: "flex",
            alignItems: "center",
            justifyContent: horizontalAlign(alignment),
            border: "1px solid #D1D5DB",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            padding: "4px 6px",
            textAlign: textAlign(alignment),
            verticalAlign: "middle",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: background ?? "transparent",
          }}
        >
          <TextRuns runs={cell?.runs} baseFont={baseFont} />
        </div>
      );
    }),
  );

  return (
    <div
      data-deck-table=""
      data-deck-table-name={tableName}
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        display: "grid",
        gridTemplateColumns: `repeat(${columnCount},minmax(0,1fr))`,
        gridTemplateRows: `repeat(${rowCount},minmax(0,1fr))`,
        overflow: "hidden",
      }}
    >
      {cells}
    </div>
  );
}
