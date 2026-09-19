"use client";

/**
 * The table element's inspector controls (Task D5, spec §5.4 tables row,
 * §6.4, §8.2 element toolbars).
 *
 * The grid edits **rendered** cells: row 0 is the stored header (`columns`)
 * when the wire carries one, otherwise the first body row. Cell text commits
 * through the pure `tableOps` helpers on the editor's single-slide
 * `slide_update` path; the write is run-preserving (the first run's font
 * carries the new text, every other cell field survives), exactly like the C
 * plain-text editor for text elements.
 *
 * Row and column add/remove are bounds-safe: a declared
 * `min_rows`/`max_rows`/`min_columns`/`max_columns` wins, otherwise the fork
 * editor's caps apply (1…8 rows, 1…6 columns). Deleting the stored header
 * promotes the first body row into it (the fork's string-grid semantics); the
 * last renderable row and column stay.
 *
 * Honest states: a malformed element (no arrays) shows that there are no
 * addressable cells; a table without a stored header says so instead of
 * pretending the first row is a header; a bound that blocks an action prints
 * the bound's value.
 */
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import {
  addTableColumn,
  addTableRow,
  removeTableColumn,
  removeTableRow,
  setTableCellText,
  tableBounds,
  tableCellText,
  tableColumnCount,
  tableHasHeader,
  tableRenderedRowCount,
} from "@/lib/presentation/tableOps";
import type { TableElement } from "@/lib/presentation/types";

export type TableControlsProps = {
  element: TableElement;
  onUpdate: (
    reason: string,
    updater: (element: TableElement) => TableElement,
  ) => void;
};

export function TableControls({ element, onUpdate }: TableControlsProps) {
  const bounds = tableBounds(element);
  const renderedRows = tableRenderedRowCount(element);
  const columnCount = tableColumnCount(element);
  const header = tableHasHeader(element);

  const canAddRow = renderedRows < bounds.maxRows;
  const canRemoveRow = renderedRows > 1 && renderedRows > bounds.minRows;
  const canAddColumn = columnCount < bounds.maxColumns;
  const canRemoveColumn = columnCount > 1 && columnCount > bounds.minColumns;

  const rowIndexes = Array.from({ length: renderedRows }, (_, index) => index);
  const columnIndexes = Array.from(
    { length: columnCount },
    (_, index) => index,
  );

  return (
    <div data-editor-table-controls="" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-editor-table-add-row=""
          disabled={!canAddRow}
          onClick={() =>
            onUpdate("table-row-add", (current) => addTableRow(current))
          }
        >
          <Plus aria-hidden="true" className="size-4" />
          Add row
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-editor-table-add-column=""
          disabled={!canAddColumn}
          onClick={() =>
            onUpdate("table-column-add", (current) => addTableColumn(current))
          }
        >
          <Plus aria-hidden="true" className="size-4" />
          Add column
        </Button>
        <span className="font-mono text-label-sm text-muted-foreground">
          {renderedRows}×{columnCount}
        </span>
      </div>

      {renderedRows === 0 ? (
        <p
          data-editor-table-empty=""
          className="text-label-sm text-muted-foreground"
        >
          This table stores no columns or rows, so there are no cells to edit.
          Adding a row or column creates the first one; nothing is invented
          here.
        </p>
      ) : (
        <>
          {header ? (
            <p className="text-label-sm text-muted-foreground">
              Row 1 is the stored header; removing it promotes the next row.
            </p>
          ) : (
            <p
              data-editor-table-note=""
              className="text-label-sm text-muted-foreground"
            >
              No header row is stored on the wire. The renderer still draws the
              first row bold; every stored row is body content here.
            </p>
          )}

          <div className="overflow-x-auto">
            <div className="flex flex-col gap-1">
              {rowIndexes.map((rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-1">
                  <span className="w-14 shrink-0 truncate text-label-sm text-muted-foreground">
                    {rowIndex === 0 && header ? "Header" : `Row ${rowIndex + 1}`}
                  </span>
                  {columnIndexes.map((columnIndex) => (
                    <span key={columnIndex} className="w-24 shrink-0">
                      <Input
                        size="sm"
                        className="h-8"
                        type="text"
                        value={tableCellText(element, rowIndex, columnIndex)}
                        data-editor-table-cell={`${rowIndex}-${columnIndex}`}
                        aria-label={`Cell ${rowIndex + 1},${columnIndex + 1}`}
                        onChange={(event) =>
                          onUpdate("table-cell", (current) =>
                            setTableCellText(
                              current,
                              rowIndex,
                              columnIndex,
                              event.target.value,
                            ),
                          )
                        }
                      />
                    </span>
                  ))}
                  <IconButton
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={`Remove row ${rowIndex + 1}`}
                    data-editor-table-remove-row={rowIndex}
                    disabled={!canRemoveRow}
                    onClick={() =>
                      onUpdate("table-row-remove", (current) =>
                        removeTableRow(current, rowIndex),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </IconButton>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <span className="w-14 shrink-0" />
                {columnIndexes.map((columnIndex) => (
                  <span
                    key={columnIndex}
                    className="flex w-24 shrink-0 justify-center"
                  >
                    <IconButton
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-label={`Remove column ${columnIndex + 1}`}
                      data-editor-table-remove-column={columnIndex}
                      disabled={!canRemoveColumn}
                      onClick={() =>
                        onUpdate("table-column-remove", (current) =>
                          removeTableColumn(current, columnIndex),
                        )
                      }
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </IconButton>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {!canAddRow ? (
            <p
              data-editor-table-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] The row count is at its limit ({bounds.maxRows}).
            </p>
          ) : null}
          {!canRemoveRow ? (
            <p
              data-editor-table-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] The row count is at its minimum ({bounds.minRows}); the last
              renderable row is kept.
            </p>
          ) : null}
          {!canAddColumn ? (
            <p
              data-editor-table-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] The column count is at its limit ({bounds.maxColumns}).
            </p>
          ) : null}
          {!canRemoveColumn ? (
            <p
              data-editor-table-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] The column count is at its minimum ({bounds.minColumns}); the
              last renderable column is kept.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
