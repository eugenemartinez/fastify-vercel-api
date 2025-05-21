import { VercelRequest, VercelResponse } from '@vercel/node';
import { default as serverApp } from '../public/server'; // Assuming your Fastify instance is the default export or a named export 'app' or 'server'

// This is a common pattern to ensure the Fastify app is ready
// and then pass the Vercel req/res to the Fastify instance.
// Fastify instances are Node.js http.Server request listeners.

let isServerReady = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isServerReady) {
    await serverApp.ready(); // Ensure all plugins are loaded, routes are registered
    isServerReady = true;
  }
  serverApp.server.emit('request', req, res);
}