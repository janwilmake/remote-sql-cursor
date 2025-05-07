// large-dataset-example.ts
import { DatabaseDO, exec } from "./database"; // Import the database implementation

export interface Env {
  DATABASE: DurableObjectNamespace;
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
      const id = env.DATABASE.idFromName("large-dataset-demo");
      const stub = env.DATABASE.get(id);

      // Initialize the database
      if (path === "/init") {
        // Create a large data table
        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `CREATE TABLE IF NOT EXISTS large_users (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              data TEXT NOT NULL,
              created_at INTEGER NOT NULL
            )`,
            }),
          }),
        );

        return new Response(
          JSON.stringify(
            {
              message: "Database initialized successfully",
              endpoints: {
                insert: "/insert?count=100", // Default 100 records
                read: "/read",
                count: "/count",
                clear: "/clear",
              },
            },
            null,
            2,
          ),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
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

        // Use a stream to provide progress updates
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Process in the background
        (async () => {
          try {
            await writer.write(encoder.encode('{\n  "progress": [\n'));

            let insertedTotal = 0;
            const timestamp = Date.now();

            // Insert in batches
            for (
              let batchStart = 0;
              batchStart < count;
              batchStart += batchSize
            ) {
              const currentBatchSize = Math.min(batchSize, count - batchStart);
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

              // Execute batch insert
              await stub.fetch(
                new Request("http://internal/exec", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    query: `INSERT INTO large_users (id, name, data, created_at) VALUES ${placeholders}`,
                    bindings: values,
                  }),
                }),
              );

              insertedTotal += currentBatchSize;

              // Progress update
              if (batchStart > 0) {
                await writer.write(encoder.encode(",\n"));
              }
              await writer.write(
                encoder.encode(
                  `    {"inserted": ${insertedTotal}, "total": ${count}}`,
                ),
              );
            }

            // Complete the response
            await writer.write(encoder.encode("\n  ],\n"));
            await writer.write(
              encoder.encode(
                `  "message": "Successfully inserted ${count} records of 4KB each",\n`,
              ),
            );
            await writer.write(
              encoder.encode(
                `  "totalSize": "${(count * 4).toFixed(2)}KB (${(
                  (count * 4) /
                  1024
                ).toFixed(2)}MB)",\n`,
              ),
            );
            await writer.write(
              encoder.encode(
                `  "timestamp": "${new Date(timestamp).toISOString()}"\n`,
              ),
            );
            await writer.write(encoder.encode("}\n"));
          } catch (error) {
            console.error("Error during insertion:", error);
            try {
              await writer.write(
                encoder.encode(`\n  ],\n  "error": "${error.message}"\n}\n`),
              );
            } catch (e) {
              // Already closed or other error
            }
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
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

        // Set up a streaming response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Process in the background
        (async () => {
          try {
            interface LargeUser {
              id: number;
              name: string;
              created_at: number;
              data: string;
            }

            const query = limit
              ? `SELECT id, name, created_at, data FROM large_users ORDER BY id LIMIT ${limit}`
              : `SELECT id, name, created_at, data FROM large_users ORDER BY id`;

            const cursor = exec<LargeUser>(stub, query);
            let count = 0;
            let totalDataSize = 0;

            // Start JSON output
            await writer.write(encoder.encode("{\n"));

            if (!compact) {
              await writer.write(encoder.encode('  "records": [\n'));
            } else {
              await writer.write(
                encoder.encode(
                  '  "records_summary": "Streaming records with compact mode enabled",\n',
                ),
              );
            }

            // Stream process each user
            let first = true;
            const startTime = Date.now();

            for await (const user of cursor) {
              count++;
              totalDataSize += user.data.length;

              // Only output full records in non-compact mode
              if (!compact) {
                // Add comma between items
                if (!first) {
                  await writer.write(encoder.encode(",\n"));
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
                await writer.write(
                  encoder.encode("    " + JSON.stringify(outputUser)),
                );
              } else if (count % 1000 === 0) {
                // In compact mode, just report progress every 1000 records
                const elapsedSec = (Date.now() - startTime) / 1000;
                const rps = Math.round(count / elapsedSec);

                await writer.write(
                  encoder.encode(
                    `  "progress_update_${count}": "Processed ${count} records (${rps} records/sec)",\n`,
                  ),
                );
              }
            }

            if (!compact) {
              await writer.write(encoder.encode("\n  ],\n"));
            }

            // Add summary information
            const elapsedSec = (Date.now() - startTime) / 1000;
            await writer.write(encoder.encode(`  "summary": {\n`));
            await writer.write(
              encoder.encode(`    "total_records": ${count},\n`),
            );
            await writer.write(
              encoder.encode(
                `    "total_data_size": "${(
                  totalDataSize /
                  (1024 * 1024)
                ).toFixed(2)}MB",\n`,
              ),
            );
            await writer.write(
              encoder.encode(
                `    "elapsed_seconds": ${elapsedSec.toFixed(2)},\n`,
              ),
            );
            await writer.write(
              encoder.encode(
                `    "records_per_second": ${Math.round(count / elapsedSec)}\n`,
              ),
            );
            await writer.write(encoder.encode(`  }\n`));
            await writer.write(encoder.encode("}\n"));
          } catch (error) {
            console.error("Error processing stream:", error);
            // Try to write an error if we haven't started writing yet
            try {
              await writer.write(
                encoder.encode(JSON.stringify({ error: error.message })),
              );
            } catch (e) {
              // Ignore, probably already writing
            }
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "chunked",
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
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Clear all data
      if (path === "/clear") {
        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `DELETE FROM large_users`,
            }),
          }),
        );

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
      - /init         : Initialize the database
      - /insert?count=100000 : Insert records (default 100)
      - /read         : Read all records (streams response)
      - /read?limit=1000 : Read limited records
      - /read?compact=true : Compact output (better performance)
      - /count        : Count records
      - /clear        : Delete all records
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

// Register the Durable Object
export { DatabaseDO };
