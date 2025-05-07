// example.ts
import { DatabaseDO, exec } from "./database"; // Import the database implementation

export interface Env {
  DATABASE: DurableObjectNamespace;
}

// Helper to generate random names
function getRandomName(): string {
  const firstNames = [
    "Alice",
    "Bob",
    "Charlie",
    "David",
    "Emma",
    "Frank",
    "Grace",
    "Hannah",
    "Ian",
    "Julia",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
  ];

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

  return `${firstName} ${lastName}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle demo endpoint
      if (path === "/demo") {
        // Get a reference to our Durable Object
        const id = env.DATABASE.idFromName("demo-database");
        const stub = env.DATABASE.get(id);

        // Create the users table if it doesn't exist
        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL
            )`,
            }),
          }),
        );

        // Insert a user with a random name
        const randomName = getRandomName();
        const timestamp = Date.now();

        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `INSERT INTO users (name, created_at) VALUES (?, ?)`,
              bindings: [randomName, timestamp],
            }),
          }),
        );

        // Read all users using our streaming cursor
        interface User {
          id: number;
          name: string;
          created_at: number;
        }

        const cursor = exec<User>(stub, `SELECT * FROM users ORDER BY id DESC`);
        const users: User[] = [];

        // Collect all users using async iteration
        for await (const user of cursor) {
          users.push(user);
        }

        // Return the result
        return new Response(
          JSON.stringify(
            {
              message: `Added new user: ${randomName}`,
              timestamp: new Date(timestamp).toISOString(),
              total_users: users.length,
              users: users,
            },
            null,
            2,
          ),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Alternative version that processes each row as it comes in
      if (path === "/demo-stream") {
        const id = env.DATABASE.idFromName("demo-database");
        const stub = env.DATABASE.get(id);

        // Create table and insert user (same as above)
        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL
            )`,
            }),
          }),
        );

        const randomName = getRandomName();
        const timestamp = Date.now();

        await stub.fetch(
          new Request("http://internal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `INSERT INTO users (name, created_at) VALUES (?, ?)`,
              bindings: [randomName, timestamp],
            }),
          }),
        );

        // Set up a streaming response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Process in the background
        (async () => {
          try {
            interface User {
              id: number;
              name: string;
              created_at: number;
            }

            const cursor = exec<User>(
              stub,
              `SELECT * FROM users ORDER BY id DESC`,
            );
            const users: User[] = [];

            // Stream process each user
            await writer.write(encoder.encode('{\n  "users": [\n'));

            let first = true;
            for await (const user of cursor) {
              users.push(user);

              // Add comma between items
              if (!first) {
                await writer.write(encoder.encode(",\n"));
              } else {
                first = false;
              }

              // Format the user as JSON
              await writer.write(encoder.encode("    " + JSON.stringify(user)));
            }

            // Close the array and add summary info
            await writer.write(encoder.encode("\n  ],\n"));
            await writer.write(
              encoder.encode(`  "message": "Added new user: ${randomName}",\n`),
            );
            await writer.write(
              encoder.encode(
                `  "timestamp": "${new Date(timestamp).toISOString()}",\n`,
              ),
            );
            await writer.write(
              encoder.encode(`  "total_users": ${users.length}\n`),
            );
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
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle root or unknown paths
      return new Response("Try /demo or /demo-stream endpoints", {
        headers: { "Content-Type": "text/plain" },
      });
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
