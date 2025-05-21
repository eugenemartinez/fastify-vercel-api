import { IncomingMessage, ServerResponse } from 'http'; // Standard Node.js HTTP types
import { default as serverApp } from '../src/server'; // Assuming your Fastify instance is the default export

// This is a common pattern to ensure the Fastify app is ready
// and then pass the Vercel req/res to the Fastify instance.
// Fastify instances are Node.js http.Server request listeners.

let isServerReady = false;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!isServerReady) {
    await serverApp.ready(); // Ensure all plugins are loaded, routes are registered
    isServerReady = true;
  }
  // The Vercel req/res objects are compatible enough to be emitted directly
  // to Fastify's underlying http.Server instance.
  serverApp.server.emit('request', req, res);
}