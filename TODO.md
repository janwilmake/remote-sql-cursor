# Fix `remote-sql-cursor`

```sql
-- works fine
SELECT * FROM "main".sqlite_schema
SELECT * FROM "main"."_migrations"  LIMIT 50 OFFSET 0;

-- does NOT work
UPDATE "main"."test_data" SET "value" = 101 WHERE "id" = 1 RETURNING rowid, *
```

- Test this within `remote-sql-cursor` directly and see if it occurs there too, fix it. `/query/stream` should work for anything!
- Add a tiny test-suite to `remote-sql-cursor`
- Add required basic-auth to `remote-sql-cursor` as well (exposes `/query/stream`)

Huge hard-to-notice security flaw if people expose their DOs!!!! This needs to be fixed for sake of DORM.

- Apply new `@Streamable` in DORM example.
- Confirm `remote-sql-cursor` 'exec' function works with the `browsableRequest` middleware.
- If so, I can use this in DORM to 1) have easy pattern to make aggregate readonly and 2) make it possible to easily access studio for client with any amount of mirrors.

Worth an update if this gets solved!

# Try actors again

Report encountered type errors to @BraydenWilmoth.

# Streaming 1GB Table

Post showcasing streaming using `high-throughput-example.ts` - use a simple js script that replaces log to show rows as they stream in

Huge unlock and must still be proven!

# Transferable & Syncable Objects

https://github.com/janwilmake/transferable-object

IDK. just cool to work on. Especially with new unlock above, this can be provably useful. For markdownfeed, I want a syncable object.

https://github.com/janwilmake/syncable-object

# Auth

DOAUTH: https://x.com/janwilmake/status/1921970022810812641 (https://github.com/janwilmake/x-oauth-template is a great start but needs to be updated to latest DORM)

Combi DORM + MCP (https://x.com/iannuttall/status/1920484902752981012)

# Remote Multi-Server Transactions

Making a remote transaction possible would be very useful https://letmeprompt.com/httpsdevelopersc-3mptgo0.

How transactions can be used: https://letmeprompt.com/httpsdevelopersc-vx7x1c0.

We MAY now be able to create a multi-DO transaction in DORM. See https://x.com/janwilmake/status/1926928095329587450 for potential feeback.

Also, the question of sending multiple queries to the DO is not answered, making things slow and potentially not ACID. especially when working with many DBs, allowing point-in-time recovery and transactions would be huge.
