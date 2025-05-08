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
for await (const row of exec(stub, `SELECT * FROM items`)) {
  // Streams, row by row!
  console.log({ item });
}
```

Is this feasable?

# Answer; yes;

Got a read speed of 8.7mb/second. After trying batching I saw the speed didn't really improve significantly, so this seems pretty reasonable for a durable object.

# Next steps

Make this work in the browser too. It'd be cool to
