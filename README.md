# DBX

A local database diagram editor with code and visual editing, DBML/SQL import and export, and an embedded Go web server.

## Run

Requires Go 1.26.5+ and Node.js 22+ with npm.

```sh
npm ci
npm run build
go run .
```

Open http://127.0.0.1:8080. To choose another address, use `go run . -addr 127.0.0.1:8090`.

For a standalone binary, build the frontend first, then run `go build -o dbx .`. The binary embeds the built frontend and needs no Node.js runtime.

## Editing

- Start with the example, use **File → New schema**, or use **File → Import file** to import a `.dbml` or `.sql` file (up to 2 MB).
- Select PostgreSQL, MySQL, or SQL Server before importing SQL. The same dialect controls SQL code view and export.
- Edit DBML or SQL and press **Apply code** or **Cmd/Ctrl+Enter** to update the diagram. Invalid code leaves the last valid schema intact. Apply pending changes before switching languages or editing visually.
- Add tables and columns, edit names/types/key constraints, and add relationships through the diagram controls. Click a table to edit it. Drag its header to reposition it.
- Click a relationship line to remove it. Table/column deletions remove dependent foreign keys and indexes. Undo/redo restores the previous schema.
- Use **Arrange**, **Fit**, and zoom controls to navigate large diagrams.
- Export the active schema with **File → Download DBML** or **File → Download SQL**. These are schema files, not database backups; SQL is never executed.

The last valid schema and diagram positions are saved in this browser's local storage. Nothing is uploaded to the Go server. Unapplied edits are not persisted; the page warns before closing with pending changes. Export files for durable copies.

## Format boundaries

Parsing and generation use [`@dbml/core`](https://dbml.dbdiagram.io/js-module/core/). SQL support follows that library's schema conversion capabilities; arbitrary SQL dumps, stored procedures, triggers, permissions and data statements are not guaranteed to round-trip. Single-file DBML is supported; multifile imports are not resolved.

Visual edits regenerate canonical DBML, so comments and original formatting may change. Schema notes, defaults, enums, indexes and relationships are retained through the model. Advanced constructs remain editable in code. Structural changes to tables with checks, expression indexes, records or dependency expressions must be made in code, where the corresponding expressions can be updated together.

The Go server binds to loopback by default. There are no user accounts, shared workspaces or server-side schema storage.

## Checks

```sh
npm test
npm run build
go test ./...
go vet ./...
```

Browser integration tests:

```sh
npx playwright install chromium
npm run test:e2e
```

To use an installed Chrome instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. The browser tests start their own Go server on port 8099 and cover code validation, visual edits, import/export, undo/redo and local persistence.

## Syntax highlighting

The code editor highlights DBML and SQL keywords, types, strings, identifiers, numbers and comments while you type. Native text selection, keyboard editing, scrolling, and Cmd/Ctrl+Enter still work. Invalid or unfinished code remains editable and does not replace the valid diagram.

## SQL views / ViewTable

Import `CREATE VIEW` statements from PostgreSQL, MySQL or SQL Server files. Views appear as purple nodes marked **VIEW**, retain their defining query, and export as `CREATE VIEW`, after their dependencies. SQL Server `GO` batch separators are supported.

To create one visually, choose **+ Table → Object type → SQL view**, enter the query and its output columns, then save. Click an existing view to edit its query, query dialect, name or columns. Types from directly selected source columns are inferred on import; computed expressions use `unknown` when their type cannot be inferred. Explicit projection aliases and view column lists are supported. `SELECT *` requires the referenced table definitions to be present.

DBML stores views as ordinary `Table` declarations with `dbx_kind`, `dbx_query` and `dbx_dialect` metadata. The `ViewTable` shorthand is also accepted:

```dbml
Table orders {
  id integer
  amount decimal(10,2)
}

ViewTable order_report [dbx_dialect: 'postgres', dbx_query: 'SELECT id, amount FROM orders'] {
  id integer
  amount decimal(10,2)
}

Dep: orders -> order_report
```

Visual edits normalize the shorthand to `Table ... [dbx_kind: 'view', ...]` for DBML compatibility. Queries are parsed using [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser), and must be single SELECT queries supported by its selected dialect. Materialized views and advanced CREATE VIEW options are not supported. View queries are not automatically translated across dialects: select their original dialect for export or update the query and its dialect. Missing queries, unresolved wildcard columns, and cyclic view dependencies produce errors instead of emitting tables in place of views.

If a view depends on a table or column being renamed or removed, update the source structure and view query together in code. Schema changes are not executed against a database.

## Data lineage

DBML `Dep` declarations render as dashed arrows pointing from upstream sources to downstream tables or columns. Table-level, column-level, mixed-level and grouped dependencies are supported within the DBML parser's validation rules.

Use **+ Lineage** to connect whole tables or individual columns. Click an arrow (or focus it and press Enter) to inspect its transformation metadata, edit its endpoints/description, or delete it. Named dependency blocks retain their names, colors, notes and custom metadata through visual edits. A grouped dependency's description belongs to the whole block. Renaming a table or column updates its dependency endpoints; deleting one removes affected edges.

SQL view imports infer table-level lineage for known source tables and views. Add finer column-level lineage through code or the visual controls. Manually authored lineage and transformation metadata are retained in DBML exports; SQL has no equivalent declaration, so SQL exports contain schema/view definitions only. Applying edited SQL rebuilds lineage from the view queries.

## Workspace controls

File actions are grouped in the header’s **File** menu. Diagram editing, arrange, zoom and fit controls are icon buttons in the bottom toolbar, with tooltips on hover or keyboard focus. Schema statistics sit beside the tools (below them on narrow screens).

Status and error messages appear as floating notifications instead of taking workspace space. Status messages dismiss after five seconds and errors after nine seconds; hovering or focusing pauses the timer. Use the close button or Escape to dismiss immediately.
