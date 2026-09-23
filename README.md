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

- Start with the example, create a new schema, or import a `.dbml` or `.sql` file (up to 2 MB).
- Select PostgreSQL, MySQL, or SQL Server before importing SQL. The same dialect controls SQL code view and export.
- Edit DBML or SQL and press **Apply code** or **Cmd/Ctrl+Enter** to update the diagram. Invalid code leaves the last valid schema intact. Apply pending changes before switching languages or editing visually.
- Add tables and columns, edit names/types/key constraints, and add relationships through the diagram controls. Click a table to edit it. Drag its header to reposition it.
- Click a relationship line to remove it. Table/column deletions remove dependent foreign keys and indexes. Undo/redo restores the previous schema.
- Use **Arrange**, **Fit**, and zoom controls to navigate large diagrams.
- Export the active schema with **DBML** or **SQL**. These are schema files, not database backups; SQL is never executed.

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
