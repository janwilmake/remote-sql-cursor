// large-dataset-example.ts
import { exec, makeStub } from "./js"; // Import the database implementation
import { StreamableObject } from "./do";

export class ExampleObject extends StreamableObject {
  constructor(state: any, env: any) {
    // Add authentication and validator options
    const options = {
      authenticate: async (request: Request) => {
        // Simple API key authentication
        const authHeader = request.headers.get("Authorization");
        const apiKey = env.API_KEY || "demo-key-123";

        if (!authHeader) {
          return false;
        }

        // Support both "Bearer token" and "token" formats
        const token = authHeader.startsWith("Bearer ")
          ? authHeader.substring(7)
          : authHeader;

        return token === apiKey;
      },
      validator: (sql: string) => {
        // Basic SQL validation - prevent destructive operations in demo
        const normalizedSql = sql.toLowerCase().trim();

        // Allow SELECT queries
        if (normalizedSql.startsWith("select")) {
          return { isValid: true };
        }

        // Allow INSERT, UPDATE, DELETE for demo purposes
        if (
          normalizedSql.startsWith("insert") ||
          normalizedSql.startsWith("update") ||
          normalizedSql.startsWith("delete")
        ) {
          return { isValid: true };
        }

        // Allow CREATE TABLE for demo
        if (normalizedSql.startsWith("create table")) {
          return { isValid: true };
        }

        // Block potentially dangerous operations
        const dangerousPatterns = [
          "drop table",
          "drop database",
          "truncate",
          "alter table",
          "create index",
          "drop index",
        ];

        for (const pattern of dangerousPatterns) {
          if (normalizedSql.includes(pattern)) {
            return {
              isValid: false,
              error: `Operation '${pattern}' is not allowed in demo mode`,
            };
          }
        }

        return {
          isValid: false,
          error: "Query type not allowed in demo mode",
        };
      },
    };

    super(state, env, options);

    // Initialize the demo table
    state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS large_users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  }

  direct() {
    const array = this.sql?.exec("SELECT id,name FROM large_users").toArray();
    return new Response(JSON.stringify({ length: array?.length, array }));
  }
}

export interface Env {
  ExampleObject: DurableObjectNamespace<ExampleObject>;
  API_KEY?: string; // Optional API key for authentication
}

// Helper to generate random data of specified size in KB
function generateRandomData(sizeInKB: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = sizeInKB * 1024;
  let result = "";

  // Generate chunks for better performance
  const chunkSize = 1024;
  const numChunks = bytes / chunkSize;

  for (let i = 0; i < numChunks; i++) {
    let chunk = "";
    for (let j = 0; j < chunkSize; j++) {
      chunk += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    result += chunk;
  }

  return result;
}

// Helper to generate random user data
function generateUserData(id: number): { name: string; data: string } {
  const firstNames = [
    "Alice",
    "Bob",
    "Charlie",
    "David",
    "Emma",
    "Frank",
    "Grace",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
  ];

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

  return {
    name: `${firstName} ${lastName}`,
    data: generateRandomData(4), // 4KB of random data
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Get the database stub
      const id = env.ExampleObject.idFromName("large-dataset-demo");
      const stub = env.ExampleObject.get(id);

      // Handle the streaming query endpoint directly
      if (path === "/query/stream") {
        // Forward the request to the Durable Object
        return await stub.fetch(request);
      }

      if (path === "/direct") {
        return stub.direct();
      }

      // Insert large records
      if (path === "/insert") {
        const params = new URLSearchParams(url.search);
        const count = parseInt(params.get("count") || "100", 10);
        const batchSize = 25; // Insert in batches for better performance

        // Get current count to determine starting ID
        const countCursor = exec<{ count: number }>(
          stub,
          `SELECT COUNT(*) as count FROM large_users`,
        );
        const countResult = await countCursor.one();
        const startId = countResult.count;

        // Use ReadableStream to provide progress updates
        const stream = new ReadableStream({
          start: async (controller) => {
            const encoder = new TextEncoder();

            try {
              controller.enqueue(encoder.encode('{\n  "progress": [\n'));

              let insertedTotal = 0;
              const timestamp = Date.now();

              // Insert in batches using the streaming exec function
              for (
                let batchStart = 0;
                batchStart < count;
                batchStart += batchSize
              ) {
                const currentBatchSize = Math.min(
                  batchSize,
                  count - batchStart,
                );
                const placeholders = Array(currentBatchSize)
                  .fill("(?, ?, ?, ?)")
                  .join(", ");
                const values: any[] = [];

                // Prepare batch values
                for (let i = 0; i < currentBatchSize; i++) {
                  const id = startId + batchStart + i + 1;
                  const userData = generateUserData(id);

                  values.push(id, userData.name, userData.data, timestamp);
                }

                // Execute batch insert using the exec function
                const insertCursor = exec(
                  stub,
                  `INSERT INTO large_users (id, name, data, created_at) VALUES ${placeholders}`,
                  ...values,
                );

                // Wait for the insert to complete
                await insertCursor.toArray();

                insertedTotal += currentBatchSize;

                // Progress update
                if (batchStart > 0) {
                  controller.enqueue(encoder.encode(",\n"));
                }
                controller.enqueue(
                  encoder.encode(
                    `    {"inserted": ${insertedTotal}, "total": ${count}}`,
                  ),
                );
              }

              // Complete the response
              controller.enqueue(encoder.encode("\n  ],\n"));
              controller.enqueue(
                encoder.encode(
                  `  "message": "Successfully inserted ${count} records of 4KB each",\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `  "totalSize": "${(count * 4).toFixed(2)}KB (${(
                    (count * 4) /
                    1024
                  ).toFixed(2)}MB)",\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `  "timestamp": "${new Date(timestamp).toISOString()}"\n`,
                ),
              );
              controller.enqueue(encoder.encode("}\n"));

              controller.close();
            } catch (error) {
              console.error("Error during insertion:", error);
              controller.enqueue(
                encoder.encode(`\n  ],\n  "error": "${error.message}"\n}\n`),
              );
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Stream read all records
      if (path === "/read") {
        const params = new URLSearchParams(url.search);
        const limit = params.get("limit")
          ? parseInt(params.get("limit") as string, 10)
          : undefined;
        const compact = params.get("compact") === "true";

        // Set up a streaming response with ReadableStream
        const stream = new ReadableStream({
          start: async (controller) => {
            const encoder = new TextEncoder();

            try {
              type LargeUser = {
                id: number;
                name: string;
                created_at: number;
                data: string;
              };

              const query = limit
                ? `SELECT id, name, created_at, data FROM large_users ORDER BY id LIMIT ?`
                : `SELECT id, name, created_at, data FROM large_users ORDER BY id`;

              const bindings = limit ? [limit] : [];
              const cursor = exec<LargeUser>(stub, query, ...bindings);
              let count = 0;
              let totalDataSize = 0;

              // Start JSON output
              controller.enqueue(encoder.encode("{\n"));

              if (!compact) {
                controller.enqueue(encoder.encode('  "records": [\n'));
              } else {
                controller.enqueue(
                  encoder.encode(
                    '  "records_summary": "Streaming records with compact mode enabled",\n',
                  ),
                );
              }

              // Stream process each user
              let first = true;
              const startTime = Date.now();
              console.log({ first, startTime });
              for await (const user of cursor) {
                count++;
                totalDataSize += user.data.length;

                // Only output full records in non-compact mode
                if (!compact) {
                  // Add comma between items
                  if (!first) {
                    controller.enqueue(encoder.encode(",\n"));
                  } else {
                    first = false;
                  }

                  // For performance, we output minimal data
                  const outputUser = {
                    id: user.id,
                    name: user.name,
                    created_at: new Date(user.created_at).toISOString(),
                    data_size: `${(user.data.length / 1024).toFixed(2)}KB`,
                  };

                  // Format the user as JSON
                  controller.enqueue(
                    encoder.encode("    " + JSON.stringify(outputUser)),
                  );
                } else if (count % 1000 === 0) {
                  // In compact mode, just report progress every 1000 records
                  const elapsedSec = (Date.now() - startTime) / 1000;
                  const rps = Math.round(count / elapsedSec);

                  controller.enqueue(
                    encoder.encode(
                      `  "progress_update_${count}": "Processed ${count} records (${rps} records/sec)",\n`,
                    ),
                  );
                }
              }

              if (!compact) {
                controller.enqueue(encoder.encode("\n  ],\n"));
              }

              // Add summary information
              const elapsedSec = (Date.now() - startTime) / 1000;
              controller.enqueue(encoder.encode(`  "summary": {\n`));
              controller.enqueue(
                encoder.encode(`    "total_records": ${count},\n`),
              );
              controller.enqueue(
                encoder.encode(
                  `    "total_data_size": "${(
                    totalDataSize /
                    (1024 * 1024)
                  ).toFixed(2)}MB",\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `    "elapsed_seconds": ${elapsedSec.toFixed(2)},\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `    "records_per_second": ${Math.round(
                    count / elapsedSec,
                  )}\n`,
                ),
              );
              controller.enqueue(encoder.encode(`  }\n`));
              controller.enqueue(encoder.encode("}\n"));

              controller.close();
            } catch (error) {
              console.error("Error processing stream:", error);
              controller.enqueue(
                encoder.encode(JSON.stringify({ error: error.message })),
              );
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        });
      }

      // Get record count
      if (path === "/count") {
        const countCursor = exec<{ count: number }>(
          stub,
          `SELECT COUNT(*) as count FROM large_users`,
        );
        const result = await countCursor.one();

        return new Response(
          JSON.stringify(
            {
              count: result.count,
              estimated_size: `${((result.count * 4) / 1024).toFixed(2)}MB`,
            },
            null,
            2,
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // Clear all data
      if (path === "/clear") {
        const clearCursor = exec(stub, `DELETE FROM large_users`);

        // Wait for the delete to complete
        await clearCursor.toArray();

        return new Response(
          JSON.stringify(
            {
              message: "All records deleted successfully",
            },
            null,
            2,
          ),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Handle root or unknown paths
      return new Response(
        `
      Large Dataset Demo API
      
      Available endpoints:
      - /insert?count=100000 : Insert records (default 100)
      - /read         : Read all records (streams response)
      - /read?limit=1000 : Read limited records
      - /read?compact=true : Compact output (better performance)
      - /count        : Count records
      - /clear        : Delete all records
      - /query/stream : Stream SQL queries (requires Authorization header)
      
      SQL Streaming API:
      POST /query/stream
      Headers: Authorization: Bearer your-api-key (or just: your-api-key)
      Body: { "query": "SELECT * FROM large_users LIMIT 10", "bindings": [] }
      
      Example curl:
      curl -X POST https://your-worker.domain.com/query/stream \\
        -H "Authorization: ${env.API_KEY || "demo-key-123"}" \\
        -H "Content-Type: application/json" \\
        -d '{"query": "SELECT id, name FROM large_users LIMIT 5"}'
      `,
        {
          headers: { "Content-Type": "text/plain" },
        },
      );
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
