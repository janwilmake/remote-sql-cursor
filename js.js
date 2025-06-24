//@ts-check
/// <reference types="@cloudflare/workers-types" />

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
export class RemoteSqlStorageCursor {
  /**
   * @param {ReadableStream<Uint8Array>} stream - The readable stream containing query results
   */
  constructor(stream) {
    /** @private @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    this.reader = stream.getReader();
    /** @private @type {string} */
    this.buffer = "";
    /** @private @type {T[] | null} */
    this.cachedResults = null;
    /** @private @type {number} */
    this.currentIndex = 0;
    /** @private @type {string[]} */
    this._columnNames = [];
    /** @private @type {number} */
    this._rowsRead = 0;
    /** @private @type {number} */
    this._rowsWritten = 0;
    /** @private @type {boolean} */
    this.streamDone = false;
    /** @private @type {Array<{done?: boolean, value: T} | {done: true, value?: never}>} */
    this.pendingRows = [];
    /** @private @type {boolean} */
    this.reading = false;
    /** @private @type {boolean} */
    this.error = false;
    /** @private @type {string | null} */
    this.errorMessage = null;

    // Start reading from the stream immediately in the background
    this.startReading();
  }

  /**
   * Start reading from the stream in the background
   * @private
   */
  startReading() {
    if (this.reading || this.streamDone) return;

    this.reading = true;
    this.readFromStream().catch((err) => {
      console.error("Error reading from stream:", err);
      this.error = true;
      this.errorMessage = err.message;
    });
  }

  /**
   * Continuously read from the stream and process data
   * @private
   */
  async readFromStream() {
    try {
      while (!this.streamDone && this.reader) {
        const { done, value } = await this.reader.read();

        if (done) {
          this.streamDone = true;
          this.reader = null;

          // Process any remaining data in buffer
          this.processBufferContents();
          break;
        }

        // Decode and add to buffer
        const text = new TextDecoder().decode(value);
        this.buffer += text;

        // Process complete JSON objects
        this.processBufferContents();
      }
    } finally {
      this.reading = false;
    }
  }

  /**
   * Process complete JSON objects from the buffer
   * @private
   */
  processBufferContents() {
    // Look for complete JSON objects separated by newlines
    const lines = this.buffer.split("\n");

    // Keep the last potentially incomplete line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        /** @type {any} */
        const data = JSON.parse(line);

        if (data.row) {
          this._rowsRead++;
          this.pendingRows.push({ value: /** @type {T} */ (data.row) });
        } else if (data.metadata) {
          this.processMetadata(data.metadata);
        } else if (data.error) {
          this.error = true;
          this.errorMessage = data.error;
          console.error("Error from server:", data.error);
        }
      } catch (e) {
        console.error("Error parsing JSON:", e, "Line:", line);
      }
    }

    // If stream is done and we have remaining buffer content, try to parse it
    if (this.streamDone && this.buffer.trim()) {
      try {
        /** @type {any} */
        const data = JSON.parse(this.buffer);
        if (data.row) {
          this._rowsRead++;
          this.pendingRows.push({ value: /** @type {T} */ (data.row) });
        } else if (data.metadata) {
          this.processMetadata(data.metadata);
        } else if (data.error) {
          this.error = true;
          this.errorMessage = data.error;
        }
      } catch (e) {
        // Ignore partially received JSON at the end
      }
      this.buffer = "";
    }
  }

  /**
   * Process metadata information from the stream
   * @private
   * @param {Object} metadata - Metadata object
   * @param {string[]} [metadata.columnNames] - Column names
   * @param {number} [metadata.rowsWritten] - Number of rows written
   */
  processMetadata(metadata) {
    if (metadata.columnNames) {
      this._columnNames = metadata.columnNames;
    }
    if (metadata.rowsWritten !== undefined) {
      this._rowsWritten = metadata.rowsWritten;
    }
  }

  /**
   * Check if reading is done and there are no more pending rows
   * @private
   * @returns {boolean}
   */
  isComplete() {
    return this.streamDone && this.pendingRows.length === 0;
  }

  /**
   * Get the next result from the cursor
   * @returns {Promise<{done?: false, value: T} | {done: true, value?: never}>}
   */
  async next() {
    // If we have cached results, return from there
    if (this.cachedResults) {
      if (this.currentIndex < this.cachedResults.length) {
        return {
          value: this.cachedResults[this.currentIndex++],
        };
      }
      return { done: true };
    }

    // If there's an error, throw it
    if (this.error) {
      throw new Error(this.errorMessage || "Unknown error in SQL cursor");
    }

    // If we have pending rows, return the next one
    if (this.pendingRows.length > 0) {
      const first = this.pendingRows.shift();
      //@ts-ignore
      return first;
    }

    // If the stream is done and we have no more rows, we're done
    if (this.isComplete()) {
      return { done: true };
    }

    // Otherwise, wait for more data
    return await this.waitForMoreData();
  }

  /**
   * Wait for more data to be available
   * @private
   * @returns {Promise<{done?: false, value: T} | {done: true, value?: never}>}
   */
  async waitForMoreData() {
    // Ensure reading is happening
    if (!this.reading && !this.streamDone) {
      this.startReading();
    }

    // Wait for new data or completion
    return new Promise((resolve, reject) => {
      const checkData = () => {
        // If there's an error, reject
        if (this.error) {
          return reject(
            new Error(this.errorMessage || "Unknown error in SQL cursor"),
          );
        }

        // If we have rows now, resolve with the next one
        if (this.pendingRows.length > 0) {
          const first = this.pendingRows.shift();
          //@ts-ignore
          return resolve(first);
        }

        // If stream is done and no more data, we're done
        if (this.isComplete()) {
          return resolve({ done: true });
        }

        // Otherwise, check again soon
        setTimeout(checkData, 10);
      };

      checkData();
    });
  }

  /**
   * Convert cursor to array of all results
   * @returns {Promise<T[]>}
   */
  async toArray() {
    if (this.cachedResults) {
      return this.cachedResults;
    }

    /** @type {T[]} */
    const results = [];

    // Use iterator to collect all rows
    let nextResult = await this.next();
    while (!nextResult.done) {
      results.push(nextResult.value);
      nextResult = await this.next();
    }

    this.cachedResults = results;
    return results;
  }

  /**
   * Get only the first result
   * @returns {Promise<T>}
   * @throws {Error} If no rows are returned
   */
  async one() {
    if (this.cachedResults) {
      if (this.cachedResults.length === 0) {
        throw new Error("No rows returned");
      }
      return this.cachedResults[0];
    }

    const result = await this.next();
    if (result.done || !("value" in result)) {
      throw new Error("No rows returned");
    }

    return result.value;
  }

  /**
   * Iterate through raw values (array form of each row)
   * @template {SqlStorageValue[]} U
   * @returns {AsyncIterableIterator<U>}
   */
  async *rawIterate() {
    let nextResult = await this.next();
    while (!nextResult.done) {
      yield /** @type {U} */ (Object.values(nextResult.value));
      nextResult = await this.next();
    }
  }

  /**
   * Get all results as arrays of values rather than objects
   * @template {SqlStorageValue[]} U
   * @returns {Promise<U[]>}
   */
  async raw() {
    /** @type {U[]} */
    const results = [];
    for await (const row of this.rawIterate()) {
      //@ts-ignore
      results.push(row);
    }
    return results;
  }

  /**
   * Get column names from the query
   * @returns {string[]}
   */
  get columnNames() {
    return this._columnNames;
  }

  /**
   * Get number of rows read
   * @returns {number}
   */
  get rowsRead() {
    return this._rowsRead;
  }

  /**
   * Get number of rows written (for INSERT/UPDATE/DELETE queries)
   * @returns {number}
   */
  get rowsWritten() {
    return this._rowsWritten;
  }

  /**
   * Make it iterable
   * @returns {AsyncIterableIterator<T>}
   */
  [Symbol.asyncIterator]() {
    return {
      next: () =>
        // @ts-ignore
        this.next(),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

/**
 * Execute a SQL query against a remote database
 * @template {SqlStorageRow} T
 * @param {Object} stub - The Durable Object stub or compatible interface with fetch method
 * @param {{[version:number]:string[]}|undefined} migrations - Migrations to apply incase not applied
 * @param {string} query - SQL query to execute
 * @param {...SqlStorageValue} bindings - Query parameter bindings
 * @returns {RemoteSqlStorageCursor<T>}
 */
export function exec(stub, migrations, query, ...bindings) {
  // Start the fetch but don't await it
  const fetchPromise = stub.fetch(
    new Request("http://internal/query/stream", {
      // Updated endpoint
      method: "POST",
      //@ts-ignore
      duplex: "half",
      body: JSON.stringify({ migrations, query, bindings }),
    }),
  );

  // Create a ReadableStream and writer that we control
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Process the fetch in the background
  (async () => {
    try {
      const response = await fetchPromise;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL execution failed: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      // Pipe the response body to our transform stream
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch (error) {
      console.error("Error in fetch:", error);
      const encoder = new TextEncoder();
      await writer.write(
        encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
      );
    } finally {
      await writer.close();
    }
  })();

  // Return cursor immediately with our controlled stream
  return new RemoteSqlStorageCursor(readable);
}

/**
 * Create a stub object that mimics the Durable Object stub
 *
 * @param {string} basePath the origin of the proxy to your DO
 * @param {*} baseHeaders headers object (defaults to { "Content-Type": "application/json" })
 */
export const makeStub = (
  basePath,
  baseHeaders = { "Content-Type": "application/json" },
) => ({
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  fetch: async (request) => {
    const url = new URL(request.url);
    const actualUrl = new URL(basePath);
    // append request to endpoint pathname
    actualUrl.pathname =
      (actualUrl.pathname === "/" ? "" : actualUrl.pathname) + url.pathname;

    const headers = baseHeaders;
    request.headers.forEach((value, key) => {
      // overwrite with provided headers
      headers[key] = value;
    });

    // Forward the request to your worker
    const response = await fetch(actualUrl, {
      method: request.method,
      headers,
      //@ts-ignore
      duplex: "half",
      body: request.body,
    });

    return response;
  },
});
