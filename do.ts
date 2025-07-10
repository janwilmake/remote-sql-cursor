/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />
//@ts-check

import { DurableObject } from "cloudflare:workers";
export {
  RemoteSqlStorageCursor,
  exec,
  makeStub,
  SqlStorageRow,
  SqlStorageValue,
} from "./js";

// Validator function type
export type QueryValidator = (sql: string) => {
  isValid: boolean;
  error?: string;
};

export interface StreamableOptions {
  validator?: QueryValidator;
  authenticate?: (request: Request) => Promise<boolean> | boolean;
}

export class StreamableHandler {
  public sql: SqlStorage | undefined;
  public env: any;
  private supportedRoutes = ["/query/stream"];
  private validator?: QueryValidator;
  private options: StreamableOptions;

  constructor(
    sql: SqlStorage | undefined,
    env?: any,
    options?: StreamableOptions,
  ) {
    this.sql = sql;
    this.env = env;
    this.options = options || {};
    this.validator = options?.validator;
  }

  private isRequestInternal(request: Request): boolean {
    // Check for Cloudflare internal request headers
    const cfRay = request.headers.get("cf-ray");
    // In development, you might want to allow requests without these headers
    const isDev = this.env?.ENVIRONMENT === "development";
    // Internal stub calls won't have these headers
    return (!request.cf && !cfRay) || isDev;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!this.isRequestInternal(request) && !this.options.authenticate) {
      throw new Error(
        'External request detected without authentication set up. Please use authentication or pass "ENVIRONMENT=development" in your ".dev.vars".',
      );
    }

    // Check if this is a supported route that we should handle
    if (this.supportedRoutes.includes(path)) {
      if (path === "/query/stream" && request.method === "POST") {
        if (!this.isRequestInternal(request) && this.options.authenticate) {
          const isAuthed = await this.options.authenticate(request);
          if (!isAuthed) {
            return new Response("Unauthorized", { status: 401 });
          }
        }
        return await this.handleStreamingQuery(request);
      }
    }

    // Return 404 for unsupported routes so parent class can handle them
    return new Response("Not found", { status: 404 });
  }

  handleStreamingQuery = async (request: Request): Promise<Response> => {
    if (!this.sql) {
      return new Response(
        JSON.stringify({ error: "SQL storage not available" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      // Parse the request body
      const { query, bindings = [] } = (await request.json()) as {
        query: string;
        bindings: any[];
      };

      // Validate the query if validator is provided
      if (this.validator && query) {
        const validation = this.validator(query);
        if (!validation.isValid) {
          return new Response(
            JSON.stringify({ error: `Invalid query: ${validation.error}` }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      if (!query || typeof query !== "string") {
        return new Response(JSON.stringify({ error: "Query is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Create a ReadableStream to stream the results
      const stream = new ReadableStream({
        start: async (controller) => {
          const encoder = new TextEncoder();

          try {
            // Execute the SQL query
            const cursor = this.sql!.exec(query, ...bindings);

            const metadataPart = {
              metadata: {
                columnNames: cursor.columnNames,
                databaseSize: this.sql!.databaseSize,
              },
            };

            // Send column names as metadata first
            controller.enqueue(
              encoder.encode(JSON.stringify(metadataPart) + "\n"),
            );

            // Stream each row as it comes
            //@ts-ignore
            for (const row of cursor) {
              controller.enqueue(
                encoder.encode(JSON.stringify({ row }) + "\n"),
              );
            }

            // Send final metadata with stats
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  metadata: {
                    rowsRead: cursor.rowsRead,
                    rowsWritten: cursor.rowsWritten,
                  },
                }) + "\n",
              ),
            );

            // Close the stream
            controller.close();
          } catch (error) {
            console.error("SQL execution error:", error);
            console.error("Query:", query);
            console.error("Bindings:", bindings);

            // Send error information
            controller.enqueue(
              encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
            );

            // Close the stream with error
            controller.close();
          }
        },
      });

      // Return the readable stream
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (error) {
      console.error("Request handling error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

export function Streamable(options?: StreamableOptions) {
  return function <T extends { new (...args: any[]): any }>(constructor: T) {
    return class extends constructor {
      public _streamableHandler?: StreamableHandler;
      private _streamableOptions: StreamableOptions;

      constructor(...args: any[]) {
        super(...args);
        this._streamableOptions = options || {};
      }

      async fetch(request: Request): Promise<Response> {
        // Initialize handler if not already done
        if (!this._streamableHandler) {
          this._streamableHandler = new StreamableHandler(
            this.sql,
            this.env,
            this._streamableOptions,
          );
        }

        // Try streamable handler first
        const streamableResponse = await this._streamableHandler.fetch(request);

        // If streamable handler returns 404, try the parent class's fetch
        if (streamableResponse.status === 404) {
          return super.fetch(request);
        }

        return streamableResponse;
      }
    };
  };
}

export class StreamableObject<TEnv = any> extends DurableObject<TEnv> {
  public sql: SqlStorage | undefined;
  protected _streamableHandler?: StreamableHandler;
  protected readonly options?: StreamableOptions;

  constructor(
    state: DurableObjectState,
    env: TEnv,
    options?: StreamableOptions,
  ) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
    this.options = options;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this._streamableHandler) {
      this._streamableHandler = new StreamableHandler(
        this.sql,
        this.env,
        this.options,
      );
    }

    const streamableResponse = await this._streamableHandler.fetch(request);

    // If streamable handler returns 404, provide a default response
    if (streamableResponse.status === 404) {
      return new Response(
        `Connected with StreamableDurableObject id=${this.ctx.id.toString()} - use '/query/stream' for streaming queries.`,
        { status: 404 },
      );
    }

    return streamableResponse;
  }
}
