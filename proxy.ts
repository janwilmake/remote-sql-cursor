//@ts-check
/// <reference types="@cloudflare/workers-types" />

import { DatabaseDO } from "./do";
import { exec } from "./database-js";

/**
 * Worker script that routes requests to Durable Object instances based on pathname
 */
export default {
  /**
   * Handle incoming fetch requests
   * @param {Request} request - The incoming request
   * @param {any} env - Environment bindings including Durable Object namespaces
   * @param {ExecutionContext} ctx - Worker execution context
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    try {
      // Add CORS headers to allow browser access
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      // Handle preflight OPTIONS request
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: corsHeaders,
        });
      }

      const stub = env.DATABASE.get(
        env.DATABASE.idFromName("large-dataset-demo"),
      );

      // Forward the request to the Durable Object
      const response = await stub.fetch(
        new Request(request.url, {
          method: request.method,
          body: request.body,
          headers: request.headers,
        }),
      );

      // Add CORS headers to the response
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      // Return response with CORS headers
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      console.error("Worker error:", error);

      // Return an error response
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};

// Export the Durable Object class
export { DatabaseDO };
