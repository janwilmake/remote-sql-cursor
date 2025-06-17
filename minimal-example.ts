import { exec } from "./js";
export { StreamableObject } from "./do";
export interface Env {
  DATABASE: DurableObjectNamespace;
}

const migrations = {
  1: [
    `CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER)`,
  ],
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a DO name based on the pathname (or use a fixed name)
    const name = url.pathname.slice(1) || "default";
    const id = env.DATABASE.idFromName(name);
    const stub = env.DATABASE.get(id);

    // Insert a new item each refresh with current timestamp
    await exec(
      stub,
      migrations,
      `INSERT INTO items (name, created_at) VALUES (?, ?)`,
      `Item ${Date.now()}`,
      Date.now(),
    ).toArray();

    type Item = {
      id: number;
      name: string;
      created_at: number;
    };

    // Stream and count all items
    let count = 0;
    for await (const row of exec<Item>(
      stub,
      migrations,
      `SELECT * FROM items`,
    )) {
      console.log({ row });
      count++;
    }

    return new Response(
      `Total items at DO with name '${name}': ${count}\n\nStreamed to you by 'remote-sql-cursor'.\n\nChange the path to use a different Durable Object.`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
