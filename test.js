// test-queries.js
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:3000";

// Test queries
const TEST_QUERIES = [
  {
    name: "Simple SELECT",
    query: 'SELECT * FROM "main".sqlite_schema LIMIT 5',
    bindings: [],
    expectRows: true,
  },
  {
    name: "CREATE TABLE",
    query:
      "CREATE TABLE IF NOT EXISTS test_data (id INTEGER PRIMARY KEY, value INTEGER)",
    bindings: [],
    expectRows: false,
  },
  {
    name: "INSERT with RETURNING",
    query: "INSERT INTO test_data (name,value) VALUES (?,?) RETURNING rowid, *",
    bindings: ["test", 100],
    expectRows: true,
  },
  {
    name: "UPDATE with RETURNING",
    query: "UPDATE test_data SET value = ? WHERE id = 5 RETURNING rowid, *",
    bindings: [101],
    expectRows: true,
  },

  {
    name: "Simple UPDATE without RETURNING",
    query: "UPDATE test_data SET value = ? WHERE id = 2",
    bindings: [102],
    expectRows: false,
  },
  {
    name: "Multiple INSERTs",
    query: "INSERT INTO test_data (name,value) VALUES (?,?), (?,?), (?,?)",
    bindings: ["test1", 200, "test2", 300, "test3", 400],
    expectRows: false,
  },
  {
    name: "SELECT with WHERE",
    query: "SELECT * FROM test_data WHERE value > ? LIMIT 10",
    bindings: [150],
    expectRows: true,
  },
];

async function streamQuery(query, bindings = []) {
  const response = await fetch(`${BASE_URL}/query/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, bindings }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  const results = [];
  let metadata = null;
  let finalMetadata = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.metadata) {
              if (parsed.metadata.columnNames) {
                metadata = parsed.metadata;
              } else {
                finalMetadata = parsed.metadata;
              }
            }

            if (parsed.row) {
              results.push(parsed.row);
            }
          } catch (parseError) {
            console.error("Failed to parse line:", line);
            throw parseError;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    metadata,
    finalMetadata,
    results,
    totalRows: results.length,
  };
}

function truncateOutput(obj, maxLength = 200) {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + "...[truncated]";
}

async function runTests() {
  console.log("🧪 Testing /query/stream endpoint...\n");

  let passed = 0;
  let failed = 0;

  for (const test of TEST_QUERIES) {
    try {
      console.log(`📋 ${test.name}`);
      console.log(`   Query: ${test.query}`);
      if (test.bindings.length > 0) {
        console.log(`   Bindings: ${JSON.stringify(test.bindings)}`);
      }

      const startTime = Date.now();
      const result = await streamQuery(test.query, test.bindings);
      const duration = Date.now() - startTime;

      // Validate expectations
      if (test.expectRows && result.totalRows === 0) {
        console.log(`   ❌ Expected rows but got none`);
        failed++;
      } else if (!test.expectRows && result.totalRows > 0) {
        console.log(`   ⚠️  Didn't expect rows but got ${result.totalRows}`);
        // This is just a warning, not a failure
      } else {
        console.log(`   ✅ Success`);
        passed++;
      }

      console.log(`   Duration: ${duration}ms`);
      console.log(`   Rows: ${result.totalRows}`);

      if (result.metadata?.columnNames) {
        console.log(`   Columns: ${result.metadata.columnNames.join(", ")}`);
      }

      if (result.totalRows > 0) {
        console.log(
          `   Sample data: ${truncateOutput(result.results.slice(0, 3))}`,
        );
      }

      if (result.finalMetadata) {
        console.log(
          `   Stats: read=${result.finalMetadata.rowsRead}, written=${result.finalMetadata.rowsWritten}`,
        );
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }

    console.log("");
  }

  console.log(`\n📊 Test Summary:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📝 Total: ${TEST_QUERIES.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Additional test for edge cases
async function runEdgeCaseTests() {
  console.log("\n🔍 Testing edge cases...\n");

  const edgeCases = [
    {
      name: "Empty query",
      query: "",
      bindings: [],
      shouldFail: true,
    },
    {
      name: "Invalid SQL",
      query: "INVALID SQL STATEMENT",
      bindings: [],
      shouldFail: true,
    },
    {
      name: "Query with semicolon",
      query: "SELECT 1 as test;",
      bindings: [],
      shouldFail: false,
    },
    {
      name: "Multiple statements (should fail)",
      query: "SELECT 1; SELECT 2;",
      bindings: [],
      shouldFail: true,
    },
  ];

  for (const test of edgeCases) {
    try {
      console.log(`📋 ${test.name}`);
      console.log(`   Query: ${test.query}`);

      const result = await streamQuery(test.query, test.bindings);

      if (test.shouldFail) {
        console.log(`   ❌ Expected failure but succeeded`);
      } else {
        console.log(`   ✅ Success (${result.totalRows} rows)`);
      }
    } catch (error) {
      if (test.shouldFail) {
        console.log(`   ✅ Expected failure: ${error.message}`);
      } else {
        console.log(`   ❌ Unexpected failure: ${error.message}`);
      }
    }

    console.log("");
  }
}

async function main() {
  try {
    await runTests();
    await runEdgeCaseTests();
  } catch (error) {
    console.error("Test runner failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
