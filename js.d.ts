/**
 * Execute a SQL query against a remote database
 * @template {SqlStorageRow} T
 * @param {Object} stub - The Durable Object stub or compatible interface with fetch method
 * @param {string} query - SQL query to execute
 * @param {...SqlStorageValue} bindings - Query parameter bindings
 * @returns {RemoteSqlStorageCursor<T>}
 */
export function exec<T extends SqlStorageRow>(stub: any, query: string, ...bindings: SqlStorageValue[]): RemoteSqlStorageCursor<T>;
/**
 * @typedef {ArrayBuffer | string | number | null} SqlStorageValue
 */
/**
 * @typedef {Record<string, SqlStorageValue>} SqlStorageRow
 */
/**
 * Client-side implementation of SqlStorageCursor
 * @template {SqlStorageRow} T
 */
export class RemoteSqlStorageCursor<T extends SqlStorageRow> {
    /**
     * @param {ReadableStream<Uint8Array>} stream - The readable stream containing query results
     */
    constructor(stream: ReadableStream<Uint8Array>);
    /** @private @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    private reader;
    /** @private @type {string} */
    private buffer;
    /** @private @type {T[] | null} */
    private cachedResults;
    /** @private @type {number} */
    private currentIndex;
    /** @private @type {string[]} */
    private _columnNames;
    /** @private @type {number} */
    private _rowsRead;
    /** @private @type {number} */
    private _rowsWritten;
    /** @private @type {boolean} */
    private streamDone;
    /** @private @type {Array<{done?: boolean, value: T} | {done: true, value?: never}>} */
    private pendingRows;
    /** @private @type {boolean} */
    private reading;
    /** @private @type {boolean} */
    private error;
    /** @private @type {string | null} */
    private errorMessage;
    /**
     * Start reading from the stream in the background
     * @private
     */
    private startReading;
    /**
     * Continuously read from the stream and process data
     * @private
     */
    private readFromStream;
    /**
     * Process complete JSON objects from the buffer
     * @private
     */
    private processBufferContents;
    /**
     * Process metadata information from the stream
     * @private
     * @param {Object} metadata - Metadata object
     * @param {string[]} [metadata.columnNames] - Column names
     * @param {number} [metadata.rowsWritten] - Number of rows written
     */
    private processMetadata;
    /**
     * Check if reading is done and there are no more pending rows
     * @private
     * @returns {boolean}
     */
    private isComplete;
    /**
     * Get the next result from the cursor
     * @returns {Promise<{done?: false, value: T} | {done: true, value?: never}>}
     */
    next(): Promise<{
        done?: false;
        value: T;
    } | {
        done: true;
        value?: never;
    }>;
    /**
     * Wait for more data to be available
     * @private
     * @returns {Promise<{done?: false, value: T} | {done: true, value?: never}>}
     */
    private waitForMoreData;
    /**
     * Convert cursor to array of all results
     * @returns {Promise<T[]>}
     */
    toArray(): Promise<T[]>;
    /**
     * Get only the first result
     * @returns {Promise<T>}
     * @throws {Error} If no rows are returned
     */
    one(): Promise<T>;
    /**
     * Iterate through raw values (array form of each row)
     * @template {SqlStorageValue[]} U
     * @returns {AsyncIterableIterator<U>}
     */
    rawIterate<U extends SqlStorageValue[]>(): AsyncIterableIterator<U>;
    /**
     * Get all results as arrays of values rather than objects
     * @template {SqlStorageValue[]} U
     * @returns {Promise<U[]>}
     */
    raw<U extends SqlStorageValue[]>(): Promise<U[]>;
    /**
     * Get column names from the query
     * @returns {string[]}
     */
    get columnNames(): string[];
    /**
     * Get number of rows read
     * @returns {number}
     */
    get rowsRead(): number;
    /**
     * Get number of rows written (for INSERT/UPDATE/DELETE queries)
     * @returns {number}
     */
    get rowsWritten(): number;
    /**
     * Make it iterable
     * @returns {AsyncIterableIterator<T>}
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}
export function makeStub(basePath: string, baseHeaders?: any): {
    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    fetch: (request: Request) => Promise<Response>;
};
export type SqlStorageValue = ArrayBuffer | string | number | null;
export type SqlStorageRow = Record<string, SqlStorageValue>;
