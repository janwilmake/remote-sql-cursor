# Fix `remote-sql-cursor` (2025-07-10)

```sql
-- works fine
SELECT * FROM "main".sqlite_schema
SELECT * FROM "main"."_migrations"  LIMIT 50 OFFSET 0;

-- does NOT work
UPDATE "main"."test_data" SET "value" = 101 WHERE "id" = 1 RETURNING rowid, *
```

- ✅ Test this within `remote-sql-cursor` directly and see if it occurs there too, fix it. `/query/stream` should work for anything!
- ✅ Add a tiny test-suite to `remote-sql-cursor`

# Auth

- ✅ add required basic-auth to `remote-sql-cursor` as well (exposes `/query/stream`). Huge hard-to-notice security flaw if people expose their DOs!!!! This needs to be fixed for sake of DORM.

generally, all endpoints I'm adding need auth.

- ✅ we don't want to make things too complex
- ✅ we don't want users to accidentally expose things publicly

# ❌apply it

- Apply new `@Streamable` in DORM example.
- Confirm `remote-sql-cursor` 'exec' function works with the `browsableRequest` middleware.
- If so, I can use this in DORM to 1) have easy pattern to make aggregate readonly and 2) make it possible to easily access studio for client with any amount of mirrors.

Worth an update if this gets solved!

Instead of this, I ended up going with a simplified RPC approach in https://github.com/janwilmake/queryable-object

# ❌ Streaming 1GB Table

Post showcasing streaming using `high-throughput-example.ts` - use a simple js script that replaces log to show rows as they stream in

Huge unlock and must still be proven!

Proved that this is NOT possible. Also good!
