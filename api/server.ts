import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const server: FastifyInstance<Server, IncomingMessage, ServerResponse> = Fastify({
  logger: true,
});

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // For cloud deployment requiring SSL (like NeonDB from your .env example)
  // you might need to add SSL configuration here if not handled by the connection string directly
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  server.log.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  server.log.error('Error connecting to PostgreSQL database', err);
  process.exit(1); // Exit if DB connection fails
});


// --- Item Types and DTOs ---
interface Item {
  id: number;
  name: string;
  description?: string | null; // Allow null from DB
}

interface CreateItemDto {
  name: string;
  description?: string;
}

interface UpdateItemDto {
  name?: string;
  description?: string;
}

interface ItemParams {
  id: string; // Route params are strings initially
}

// --- CRUD Routes for Items ---

// Create Item (POST /items)
server.post<{ Body: CreateItemDto; Reply: Item | { error: string } }>(
  '/items',
  async (request, reply) => {
    const { name, description } = request.body;
    if (!name) {
      reply.status(400).send({ error: 'Name is required' });
      return;
    }
    try {
      const result = await pool.query<Item>(
        'INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *',
        [name, description || null] // Ensure description is null if not provided
      );
      reply.status(201).send(result.rows[0]);
    } catch (err: any) {
      server.log.error(err);
      reply.status(500).send({ error: 'Failed to create item: ' + err.message });
    }
  }
);

// Get All Items (GET /items)
server.get<{ Reply: Item[] | { error: string } }>('/items', async (request, reply) => {
  try {
    const result = await pool.query<Item>('SELECT * FROM items ORDER BY id ASC');
    reply.send(result.rows);
  } catch (err: any) {
    server.log.error(err);
    reply.status(500).send({ error: 'Failed to retrieve items: ' + err.message });
  }
});

// Get Single Item (GET /items/:id)
server.get<{ Params: ItemParams; Reply: Item | { error: string } }>(
  '/items/:id',
  async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({ error: 'Invalid item ID' });
      return;
    }
    try {
      const result = await pool.query<Item>('SELECT * FROM items WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        reply.status(404).send({ error: 'Item not found' });
      } else {
        reply.send(result.rows[0]);
      }
    } catch (err: any) {
      server.log.error(err);
      reply.status(500).send({ error: 'Failed to retrieve item: ' + err.message });
    }
  }
);

// Update Item (PUT /items/:id)
server.put<{ Body: UpdateItemDto; Params: ItemParams; Reply: Item | { error: string } }>(
  '/items/:id',
  async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({ error: 'Invalid item ID' });
      return;
    }
    const { name, description } = request.body;

    // Build the update query dynamically
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      reply.status(400).send({ error: 'No update fields provided' });
      return;
    }

    values.push(id); // Add id for the WHERE clause

    try {
      const result = await pool.query<Item>(
        `UPDATE items SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        reply.status(404).send({ error: 'Item not found' });
      } else {
        reply.send(result.rows[0]);
      }
    } catch (err: any) {
      server.log.error(err);
      reply.status(500).send({ error: 'Failed to update item: ' + err.message });
    }
  }
);

// Delete Item (DELETE /items/:id)
server.delete<{ Params: ItemParams; Reply: { message: string } | { error: string } }>(
  '/items/:id',
  async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({ error: 'Invalid item ID' });
      return;
    }
    try {
      const result = await pool.query('DELETE FROM items WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Item not found' });
      } else {
        reply.send({ message: 'Item deleted successfully' });
      }
    } catch (err: any) {
      server.log.error(err);
      reply.status(500).send({ error: 'Failed to delete item: ' + err.message });
    }
  }
);


// --- Server Start ---
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    // For local development, server.listen is fine.
    // For Vercel, we don't call listen() in api/index.ts; Vercel handles the listening.
    // We only call listen() when running the server directly (e.g. npm run dev or npm start)
    if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) { // Only listen if not on Vercel or specifically not in production
        await server.listen({ port, host: '0.0.0.0' });
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Only call start() if this file is run directly (e.g. local development)
// and not when imported as a module (e.g. by Vercel's api/index.ts)
if (require.main === module) {
    start();
}

export default server; // Ensure this line is present and correct