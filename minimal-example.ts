import { exec } from "./js";
import { StreamableObject } from "./do";

export class ExampleObject extends StreamableObject {
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    state.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER)`,
    );
  }
}

export interface Env {
  ExampleObject: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a DO name based on the pathname (or use a fixed name)
    const name = url.pathname.slice(1) || "default";
    const stub = env.ExampleObject.get(env.ExampleObject.idFromName(name));

    // Insert a new item each refresh with current timestamp
    await exec(
      stub,
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
    //@ts-ignore
    const stub = env.ExampleObject.get(env.ExampleObject.idFromName(name));
    let count = 0;

    for await (const row of exec<Item>(stub, `SELECT * FROM items`)) {
      console.log({ row });
      count++;
    }

    return new Response(
      `Total items at DO with name '${name}': ${count}\n\nStreamed to you by 'remote-sql-cursor'.\n\nChange the path to use a different Durable Object.`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
