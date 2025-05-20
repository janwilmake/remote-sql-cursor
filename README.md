# remote-sql-cursor

Use the SqlStorageCursor from your durable objects anywhere.

Usage:

- install with `npm i remote-sql-cursor`

Examples:

- `proxy.ts` and `index.html` use `remote-sql-cursor` from the browser!
- `minimal-example.ts` shows usage directly from your worker
- `high-throughput-example.ts` shows streaming ±180mb at 8.7mb/s

Live Browser Streaming Demo: https://remote-sql-cursor.wilmake.com (does [not currently work](https://github.com/GoogleChrome/workbox/issues/1732) in safari)

Please [leave a comment and share](https://x.com/janwilmake/status/1921158321983082787)!

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

rpc does not allow accessing this since functions aren't serializable.

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

Is this feasable?

# Answer; yes;

Got a read speed of 8.7mb/second. After trying batching I saw the speed didn't really improve significantly, so this seems pretty reasonable for a durable object.

# CHANGELOG

- **May 8, 2025**: Initial implementation and post: https://x.com/janwilmake/status/1920274164889354247
- **May 9, 2025**: Use this in DORM v1@next (https://github.com/janwilmake/dorm)
- **May 10, 2025**: Made this work in the browser too, all we need is a js version of `database.ts` that uses the worker as backend rather than the DO, and we need to then proxy that request to the DO. I also fixed backpressure problems after finding issues while rendering from stream.
- **May 12, 2025**: 0.1.1 (BREAKING) - Added migrations support to easily do JIT migrations. This adds quite some complexity, so for some, 0.0.5 and below may suit needs better, but for my usecase this is exactly what I'd need, to ensure fast migrations everywhere, applying them only as soon as needed. Also added `makeStub` function for easy HTML-based usage, and improved types. Feedback: https://x.com/janwilmake/status/1921824728676770286
