// Import the exec utility from your database.ts file
import { DatabaseDO, exec } from "./database";

export interface Env {
  DATABASE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a DO name based on the pathname (or use a fixed name)
    const name = url.pathname.slice(1) || "default";
    const id = env.DATABASE.idFromName(name);
    const stub = env.DATABASE.get(id);

    // Create the items table if it doesn't exist
    await exec(
      stub,
      `CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER)`,
    ).toArray();

    // Insert a new item each refresh with current timestamp
    await exec(
      stub,
      `INSERT INTO items (name, created_at) VALUES (?, ?)`,
      `Item ${Date.now()}`,
      Date.now(),
    ).toArray();

    // Stream and count all items
    let count = 0;
    for await (const row of exec<{
      id: number;
      name: string;
      created_at: number;
    }>(stub, `SELECT * FROM items`)) {
      console.log({ row });
      count++;
    }

    return new Response(`Total items: ${count}`, {
      headers: { "Content-Type": "text/plain" },
    });
  },
};

// Register the Durable Object
export { DatabaseDO };
