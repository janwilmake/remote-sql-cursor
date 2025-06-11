/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />
//@ts-check

import { DurableObject } from "cloudflare:workers";

export class DatabaseDO extends DurableObject {
  public sql: SqlStorage;
  static env: any;
  private currentVersion: number = 0;
  private id: string | undefined;
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
    this.id = state.id.toString();

    // Initialize migrations table and load current version
    this.initializeMigrations();
  }

  /**
   * Initialize the _migrations table and load the current version into memory
   */
  private initializeMigrations(): void {
    try {
      // Create _migrations table if it doesn't exist
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          errors TEXT DEFAULT NULL
        )
      `);

      // Get the current version (latest successfully applied migration)
      const cursor = this.sql.exec(`
        SELECT version FROM _migrations 
        WHERE errors IS NULL
        ORDER BY applied_at DESC 
        LIMIT 1
      `);

      const row = cursor.toArray()[0];

      if (row) {
        this.currentVersion = Number(row.version);
      }
    } catch (error) {
      console.error("Failed to initialize migrations:", error);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/query/raw" && request.method === "POST") {
      return await this.handleExecRequest(request);
    }

    // Handle other endpoints...
    return new Response(
      `Connected with DatabaseDO id=${this.id} - use 'exec' or raw POST /query/raw to stream statements.`,
      { status: 404 },
    );
  }

  /**
   * Apply migrations if newer versions are available
   */
  private async applyMigrations(migrations: {
    [version: number]: string[];
  }): Promise<any[]> {
    const results: any[] = [];

    // Sort version keys to ensure proper order
    const versionKeys = Object.keys(migrations)
      .map((version) => Number(version))
      .sort();

    // Filter out versions that are already applied
    const newVersions = versionKeys.filter(
      (version) => version > (this.currentVersion || 0),
    );

    if (newVersions.length === 0) {
      return results;
    }

    for (const version of newVersions) {
      const migrationQueries = migrations[version];
      const versionErrors: string[] = [];
      let versionSuccess = true;

      for (const query of migrationQueries) {
        try {
          const cursor = this.sql.exec(query);
          results.push({
            version,
            query,
            success: true,
            rowsRead: cursor.rowsRead,
            rowsWritten: cursor.rowsWritten,
          });
        } catch (error) {
          const errorMessage = error.message;
          versionErrors.push(`Query failed: ${query}. Error: ${errorMessage}`);

          results.push({
            version,
            query,
            success: false,
            error: errorMessage,
          });

          console.error(`Migration ${version} failed on query:`, query, error);
          versionSuccess = false;

          // Record the failed migration attempt with errors
          this.sql.exec(
            `INSERT INTO _migrations (version, errors) VALUES (?, ?)`,
            version,
            JSON.stringify(versionErrors),
          );

          // Stop applying migrations on error
          throw new Error(`Migration ${version} failed: ${errorMessage}`);
        }
      }

      if (versionSuccess) {
        // Record the successful migration
        this.sql.exec(`INSERT INTO _migrations (version) VALUES (?)`, version);
        this.currentVersion = version;
      }
    }

    return results;
  }

  handleExecRequest = async (request: Request): Promise<Response> => {
    try {
      // Parse the request body
      const {
        query,
        bindings = [],
        migrations,
      } = (await request.json()) as {
        query: string;
        bindings: any[];
        migrations?: { [version: string]: string[] };
      };

      // Create a TransformStream to stream the results
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Execute operations and stream results asynchronously
      (async () => {
        try {
          // Apply migrations if provided
          if (migrations) {
            const migrationResults = await this.applyMigrations(migrations);

            if (migrationResults.length > 0) {
              // Send migration results as metadata
              await writer.write(
                encoder.encode(
                  JSON.stringify({
                    metadata: {
                      migrations: migrationResults,
                      version: this.currentVersion,
                    },
                  }) + "\n",
                ),
              );
            }
          }

          if (!query || typeof query !== "string") {
            await writer.write(
              encoder.encode(
                JSON.stringify({ error: "Query is required" }) + "\n",
              ),
            );
            return;
          }

          // Execute the SQL query
          const cursor = this.sql.exec(query, ...bindings);

          // Send column names as metadata first
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: {
                  columnNames: cursor.columnNames,
                  databaseSize: this.sql.databaseSize,
                },
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
          console.error("Query:", query);
          console.error("Bindings:", bindings);
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
}

export {
  exec,
  RemoteSqlStorageCursor,
  SqlStorageRow,
  SqlStorageValue,
} from "./js";
