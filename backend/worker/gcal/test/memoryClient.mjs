/**
 * In-memory Supabase client for the gcal tests: models exactly the query
 * shapes `repo.mjs` uses (select/insert/upsert/update/delete with
 * eq/neq/is/not filters, maybeSingle, and rpc). Not a general fake.
 */
export function createMemoryClient() {
  const state = {
    calls: [],
    tables: {
      integration_connections: [],
      google_calendars: [],
      events: [],
      tasks: [],
      integration_runs: [],
      usage_events: [],
    },
    rpcHandlers: new Map(),
  };

  function matches(row, conds) {
    for (const cond of conds) {
      const value = row[cond.column];
      if (cond.kind === "eq" && value !== cond.value) return false;
      if (cond.kind === "neq" && value === cond.value) return false;
      if (cond.kind === "is" && value !== cond.value) return false;
      if (cond.kind === "not-is" && value === cond.value) return false;
    }
    return true;
  }

  function run(op, table, conds, payload, selectAfter) {
    state.calls.push(`${table}:${op}`);
    const rows = state.tables[table] ?? [];
    if (op === "select") {
      const found = rows.filter((row) => matches(row, conds));
      return { data: found, error: null };
    }
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const value of list) rows.push({ ...value });
      if (selectAfter) {
        return { data: list.map((value) => ({ id: value.id ?? "inserted" })), error: null };
      }
      return { data: null, error: null };
    }
    if (op === "upsert") {
      const list = Array.isArray(payload.values) ? payload.values : [payload.values];
      const keys = String(payload.onConflict ?? "id")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      const affected = [];
      for (const value of list) {
        const existing = rows.find((row) =>
          keys.every((key) => row[key] === value[key]),
        );
        if (existing) {
          Object.assign(existing, value);
          affected.push(existing);
        } else {
          const row = { ...value };
          rows.push(row);
          affected.push(row);
        }
      }
      return selectAfter
        ? { data: affected.map((row) => ({ ...row })), error: null }
        : { data: null, error: null };
    }
    if (op === "update") {
      for (const row of rows) {
        if (matches(row, conds)) Object.assign(row, payload);
      }
      return { data: null, error: null };
    }
    if (op === "delete") {
      const removed = rows.filter((row) => matches(row, conds));
      state.tables[table] = rows.filter((row) => !matches(row, conds));
      return { data: removed.map((row) => ({ id: row.id })), error: null };
    }
    return { data: null, error: null };
  }

  function builder(op, table, payload, selectAfter) {
    const conds = [];
    const api = {
      eq: (column, value) => {
        conds.push({ column, value, kind: "eq" });
        return api;
      },
      neq: (column, value) => {
        conds.push({ column, value, kind: "neq" });
        return api;
      },
      is: (column, value) => {
        conds.push({ column, value, kind: "is" });
        return api;
      },
      not: (column, kind, value) => {
        conds.push({ column, value, kind: `not-${kind}` });
        return api;
      },
      order: () => api,
      limit: () => api,
      select: () => ({
        maybeSingle: () => ({
          then: (resolve) => {
            const { data, error } = run(op, table, conds, payload, true);
            resolve(error ? { data: null, error } : { data: data.length > 0 ? data[0] : null, error: null });
          },
        }),
        then: (resolve) => resolve(run(op, table, conds, payload, true)),
      }),
      maybeSingle: () => ({
        then: (resolve) => {
          const { data, error } = run(op, table, conds, payload, selectAfter);
          resolve({ data: data.length > 0 ? data[0] : null, error });
        },
      }),
      then: (resolve) => resolve(run(op, table, conds, payload, selectAfter)),
    };
    return api;
  }

  return {
    state,
    from: (table) => {
      if (!(table in state.tables)) state.tables[table] = [];
      return {
        select: () => builder("select", table, null),
        insert: (values) => builder("insert", table, values, false),
        upsert: (values, options) =>
          builder(
            "upsert",
            table,
            { values, onConflict: options?.onConflict ?? "id" },
            false,
          ),
        update: (values) => builder("update", table, values, false),
        delete: () => builder("delete", table, null, true),
      };
    },
    rpc: async (name, args) => {
      state.calls.push(`rpc:${name}`);
      const handler = state.rpcHandlers.get(name);
      return handler ? handler(args) : { data: null, error: null };
    },
  };
}
