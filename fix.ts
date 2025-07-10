import { exec, Streamable } from "./do";
import { DurableObject } from "cloudflare:workers";
type Env = {
  ExampleObject: DurableObjectNamespace;
};

@Streamable({})
export class ExampleObject extends DurableObject {
  public sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;

    this.sql.exec(`CREATE TABLE IF NOT EXISTS test_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )`);

    if (
      this.sql.exec(`SELECT COUNT(*) as count FROM test_data`).one().count === 0
    ) {
      console.log("Inserting");
      this.sql.exec(
        `INSERT INTO test_data (name, value) VALUES ('Sample 1', 100),('Sample 2', 200),('Sample 3', 300)`,
      );
    }
  }

  async fetch(request: Request) {
    const items = this.sql.exec("SELECT * FROM test_data").toArray();
    return new Response("Hello, World!" + JSON.stringify(items));
  }
}

export default {
  fetch: async (request: Request, env: Env) => {
    try {
      const stub = env.ExampleObject.get(env.ExampleObject.idFromName("123f"));
      return stub.fetch(request);
    } catch (e) {
      return new Response(e.message);
    }
  },
};
