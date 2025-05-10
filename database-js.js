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
    this.done = false;
    /** @private @type {Promise<{done?: boolean, value: T} | {done: true, value?: never}> | null} */
    this.pendingChunk = null;
    /** @private @type {boolean} */
    this.pendingNextChunk = false;

    // Start reading the first chunk immediately
    this.prepareNextChunk();
  }

  /**
   * Prepares the next chunk for reading
   * @private
   * @returns {void}
   */
  prepareNextChunk() {
    if (this.done || this.pendingNextChunk) return;

    this.pendingNextChunk = true;
    this.pendingChunk = this.readNextChunk();
  }

  /**
   * Reads the next chunk from the stream
   * @private
   * @returns {Promise<{done?: boolean, value: T} | {done: true, value?: never}>}
   */
  async readNextChunk() {
    if (this.done) {
      return { done: true };
    }

    try {
      /** @type {ReadableStreamReadResult<Uint8Array>} */
      const { done, value } = await this.reader.read();

      if (done) {
        this.done = true;
        this.reader = null;

        // Process any remaining data in buffer
        if (this.buffer.trim()) {
          try {
            /** @type {any} */
            const data = JSON.parse(this.buffer);
            if (data.row) {
              this._rowsRead++;
              return { value: /** @type {T} */ (data.row) };
            } else if (data.metadata) {
              // Handle metadata
              this.processMetadata(data.metadata);
            } else if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            console.error("Error parsing final buffer:", e);
          }
        }

        return { done: true };
      }

      // Decode and add to buffer
      const text = new TextDecoder().decode(value);
      this.buffer += text;

      // Process complete JSON objects
      /** @type {Array<{value: T, done?: false}>} */
      const results = [];

      // Look for complete JSON objects separated by newlines
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || ""; // Keep the last potentially incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          /** @type {any} */
          const data = JSON.parse(line);
          if (data.row) {
            this._rowsRead++;
            results.push({ value: /** @type {T} */ (data.row) });
          } else if (data.metadata) {
            this.processMetadata(data.metadata);
          } else if (data.error) {
            throw new Error(data.error);
          }
        } catch (e) {
          console.error("Error parsing JSON:", e, "Line:", line);
        }
      }

      if (results.length > 0) {
        // Reset the pending flag as we're about to return
        this.pendingNextChunk = false;
        return results[0]; // Return the first result
      } else {
        // No complete objects yet, read more
        return await this.readNextChunk();
      }
    } catch (error) {
      console.error("Error reading from stream:", error);
      this.done = true;
      throw error;
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
   * Get the next result from the cursor
   * @returns {Promise<{done?: false, value: T} | {done: true, value?: never}>}
   */
  async next() {
    if (this.cachedResults) {
      if (this.currentIndex < this.cachedResults.length) {
        return {
          value: this.cachedResults[this.currentIndex++],
        };
      }
      return { done: true };
    }

    if (!this.pendingChunk) {
      this.prepareNextChunk();
    }

    const result = this.pendingChunk;
    this.pendingChunk = null;

    // Prepare next chunk if this wasn't the end
    result
      .then((r) => {
        if (!r.done) {
          this.prepareNextChunk();
        }
      })
      .catch((err) => {
        console.error("Error preparing next chunk:", err);
      });

    return result;
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
      next: () => this.next(),
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
 * @param {string} query - SQL query to execute
 * @param {...SqlStorageValue} bindings - Query parameter bindings
 * @returns {RemoteSqlStorageCursor<T>}
 */
export function exec(stub, query, ...bindings) {
  // Start the fetch but don't await it
  const fetchPromise = stub.fetch(
    new Request("http://internal/query/raw", {
      method: "POST",
      duplex: "half",
      body: JSON.stringify({ query, bindings }),
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
