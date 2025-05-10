import { DurableObject } from "cloudflare:workers";

export class DatabaseDO extends DurableObject {
  private storage: DurableObjectStorage;
  static env: any;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/query/raw" && request.method === "POST") {
      return await this.handleExecRequest(request);
    }

    // Handle other endpoints...
    return new Response(String(this.storage.sql.databaseSize), { status: 404 });
  }

  handleExecRequest = async (request: Request): Promise<Response> => {
    try {
      // Parse the request body
      const { query, bindings = [] } = (await request.json()) as {
        query: string;
        bindings: any[];
      };

      if (!query || typeof query !== "string") {
        return new Response(JSON.stringify({ error: "Query is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Create a TransformStream to stream the results
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Execute the query and stream results asynchronously
      (async () => {
        try {
          // Execute the SQL query
          const cursor = this.storage.sql.exec(query, ...bindings);

          // Send column names as metadata first
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: { columnNames: cursor.columnNames },
              }) + "\n",
            ),
          );

          // Stream each row as it comes
          for (const row of cursor) {
            await writer.write(encoder.encode(JSON.stringify({ row }) + "\n"));
          }

          // Send final metadata with stats
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: {
                  rowsRead: cursor.rowsRead,
                  rowsWritten: cursor.rowsWritten,
                },
              }) + "\n",
            ),
          );
        } catch (error) {
          console.error("SQL execution error:", error);
          // Send error information
          await writer.write(
            encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
          );
        } finally {
          // Always close the writer when done
          await writer.close();
        }
      })();

      // Return the readable stream immediately
      return new Response(readable, {
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

  // Other methods for your Durable Object...
}
