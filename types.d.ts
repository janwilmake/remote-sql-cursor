/**
 * Type definitions for remote-sql-cursor
 * Version: 0.0.5
 *
 * A library for executing SQL queries against a remote database through
 * Cloudflare Durable Objects with streaming results
 */

/// <reference types="@cloudflare/workers-types" />

declare module "remote-sql-cursor" {
  /**
   * Valid values for SQL storage
   */
  export type SqlStorageValue = ArrayBuffer | string | number | null;

  /**
   * A row from a SQL query result
   */
  export type SqlStorageRow = Record<string, SqlStorageValue>;

  /**
   * Client-side cursor for iterating through SQL query results
   */
  export class RemoteSqlStorageCursor<T extends SqlStorageRow = SqlStorageRow>
    implements AsyncIterableIterator<T>
  {
    /**
     * Client-side implementation of SqlStorageCursor for processing streaming results
     * @param stream The readable stream containing query results
     */
    constructor(stream: ReadableStream<Uint8Array>);

    /**
     * Names of columns in the result set
     */
    readonly columnNames: string[];

    /**
     * Number of rows read
     */
    readonly rowsRead: number;

    /**
     * Number of rows written (for INSERT/UPDATE/DELETE queries)
     */
    readonly rowsWritten: number;

    /**
     * Get the next result from the cursor
     * @throws Error if there was an SQL error
     */
    next(): Promise<IteratorResult<T>>;

    /**
     * Convert cursor to array of all results
     */
    toArray(): Promise<T[]>;

    /**
     * Get only the first result
     * @throws Error if no rows are returned
     */
    one(): Promise<T>;

    /**
     * Iterate through raw values (array form of each row)
     */
    rawIterate<
      U extends SqlStorageValue[] = SqlStorageValue[],
    >(): AsyncIterableIterator<U>;

    /**
     * Get all results as arrays of values rather than objects
     */
    raw<U extends SqlStorageValue[] = SqlStorageValue[]>(): Promise<U[]>;

    /**
     * Make it iterable
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
  }

  /**
   * Execute a SQL query against a remote database
   *
   * @param stub The Durable Object stub or compatible interface with fetch method
   * @param query SQL query to execute
   * @param bindings Query parameter bindings
   * @returns A cursor for iterating through the query results
   * @throws Error if fetch fails or SQL execution fails
   *
   * @example
   * // Basic Query
   * const cursor = exec(durableObjectStub, "SELECT * FROM users WHERE age > ?", 21);
   */
  export function exec<T extends SqlStorageRow = SqlStorageRow>(
    stub: { fetch: (request: Request) => Promise<Response> },
    query: string,
    ...bindings: SqlStorageValue[]
  ): RemoteSqlStorageCursor<T>;

  /**
   * DatabaseDO - Durable Object implementation for handling SQL queries
   */
  export class DatabaseDO {
    constructor(state: DurableObjectState, env: any);
    fetch(request: Request): Promise<Response>;
    handleExecRequest(request: Request): Promise<Response>;
  }
}
