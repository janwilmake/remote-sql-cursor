# remote-sql-cursor

Use the `SqlStorageCursor` from your durable objects anywhere.

Usage:

```
npm i remote-sql-cursor
```

> [!WARNING]
>
> [queryable-object](https://github.com/janwilmake/queryable-object) is a simplified alternative that exchanges streaming for simplicity. It is not made available over HTTP but RPC so not for everything, but quite useful in many ways!

# Benefits

Use a nearly identical `exec` cursor API outside of the DO boundary.

```ts
import { exec } from "remote-sql-cursor";
export default {
  fetch: () => {
    const stub = env.ExampleObject.get(env.ExampleObject.idFromName("root"));
    //insert one
    await exec(stub, `INSERT INTO items (name) VALUES ('hello')`).toArray();
    // get 'em all
    let count = 0;
    for await (const row of exec<Item>(stub, `SELECT * FROM items`)) {
      console.log({ row });
      count++;
    }
    return new Response(`We/ve got ${count} of em`);
  },
};
```

# Examples:

- `proxy.ts` and `proxy95.html` use `remote-sql-cursor` from the browser (does [not currently work](https://github.com/GoogleChrome/workbox/issues/1732) in safari)
- `minimal-example.ts` shows usage directly from your worker
- `high-throughput-example.ts` shows streaming ±180mb at 8.7mb/s

Please [leave a comment and share](https://x.com/janwilmake/status/1921158321983082787)

# Try it

```sh
curl --no-buffer -X POST https://remote-sql-cursor.wilmake.com/query/stream \
  -H "Authorization: demo-key-123" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT id, name FROM large_users"}' -s | \
  awk '/^{"row":/ { count++; printf "\rCount: %d", count; fflush() } END { print "" }'
```

# Limitations

- Locally my server is silently restarting when remote-sql-cursor is running queries, and it's not clear why: `Reloading local server...` is all information that's available. In production it works fine though!
- My hypothesis was that TTFB for remote queries is lower for large queries (Demo: [streaming in 120k rows of a few columns of a table totaling 470MB](120krows.mov)). That said, as you can see at https://remote-sql-cursor.wilmake.com/direct, the streaming row-by-row setup also significantly reduces actual speed. Direct is much faster because it doesn't have the overhead of streaming each row separately.
- Although the data in the SQL table can be up to 10GB, the max result from the SQL query can not exceed the memory. If you try you will retrieve `{"error":"Durable Object's isolate exceeded its memory limit and was reset."}`. It seems that, although SQLite can be configured such that it uses less memory and streams results, this is normally not the case, and Cloudflare does not support it.

# Potential improvements

If in the future, Cloudflare would start supporting true SQLite streaming [like mentioned here](https://github.com/typeorm/typeorm/issues/11243) this library would possibly become even more useful. For now, the main benefit sits in the `cursor` interface, not as much in the streaming.

# The problem

The Durable object sqlite storage has a function exec. its interface is:

```ts
interface SqlStorage {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): SqlStorageCursor<T>;
  get databaseSize(): number;
  Cursor: typeof SqlStorageCursor;
  Statement: typeof SqlStorageStatement;
}
declare abstract class SqlStorageStatement {}
type SqlStorageValue = ArrayBuffer | string | number | null;
declare abstract class SqlStorageCursor<
  T extends Record<string, SqlStorageValue>,
> {
  next():
    | {
        done?: false;
        value: T;
      }
    | {
        done: true;
        value?: never;
      };
  toArray(): T[];
  one(): T;
  raw<U extends SqlStorageValue[]>(): IterableIterator<U>;
  columnNames: string[];
  get rowsRead(): number;
  get rowsWritten(): number;
  [Symbol.iterator](): IterableIterator<T>;
}
```

RPC does not allow accessing this since functions aren't serializable.

I want to create the same interface `SqlStorageCursor` in any client by streaming the response through fetch via a Streams API, then capture that into this SqlStorageCursor immediately without await.

Ultimately i should be able to call:

```ts
let count = 0;
for await (const row of exec(stub, `SELECT * FROM items`)) {
  // Streams, row by row!
  count++;
  console.log({ item });
}
```

Is this feasible?

# Answer; yes;

Got a read speed of 8.7mb/second. After trying batching I saw the speed didn't really improve significantly, so this seems pretty reasonable for a durable object.

# CHANGELOG

- **May 8, 2025**: Initial implementation and post: https://x.com/janwilmake/status/1920274164889354247
- **May 9, 2025**: Use this in DORM v1@next (https://github.com/janwilmake/dorm)
- **May 10, 2025**: Made this work in the browser too, all we need is a js version of `database.ts` that uses the worker as backend rather than the DO, and we need to then proxy that request to the DO. I also fixed backpressure problems after finding issues while rendering from stream.
- **May 12, 2025**: 0.1.1 (BREAKING) - Added migrations support to easily do JIT migrations. This adds quite some complexity, so for some, 0.0.5 and below may suit needs better, but for my usecase this is exactly what I'd need, to ensure fast migrations everywhere, applying them only as soon as needed. Also added `makeStub` function for easy HTML-based usage, and improved types. Feedback: https://x.com/janwilmake/status/1921824728676770286
- **June 17, 2025**: 0.1.3 - Added optional validator, added mixin decorator `@Streamable` (and refactored DO), renamed endpoint to `/query/stream` to not conflict with `@Browsable`
- **July 8, 2025**: 0.1.8 (BREAKING) - removed migrations functionality in favor of https://github.com/janwilmake/migratable-object (post: https://x.com/janwilmake/status/1942519892776722572)
- **July 10, 2025**: 0.2.1 - 1) migrated to `ReadableStream` from `TransformerStream` to avoid strange crashes, and 2) added mandatory auth for remote requests. Tested streaming large results, and added limitations section to the readme

# TODO

## Remote Multi-Server Transactions

Making a remote transaction possible would be very useful https://letmeprompt.com/httpsdevelopersc-3mptgo0.

How transactions can be used: https://letmeprompt.com/httpsdevelopersc-vx7x1c0.

We MAY now be able to create a multi-DO transaction in DORM. See https://x.com/janwilmake/status/1926928095329587450 for potential feeback.

Also, the question of sending multiple queries to the DO is not answered, making things slow and potentially not ACID. especially when working with many DBs, allowing point-in-time recovery and transactions would be huge.
