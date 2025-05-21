import Fastify, { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Use direct default imports
import fastifySwagger, { SwaggerOptions } from '@fastify/swagger';
import fastifySwaggerUi, { FastifySwaggerUiOptions } from '@fastify/swagger-ui';


import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const server: FastifyInstance<Server, IncomingMessage, ServerResponse> = Fastify({
  logger: true,
});

// --- Register Plugins ---

// Register @fastify/swagger
const swaggerPluginOptions: SwaggerOptions = {
  openapi: {
    info: {
      title: 'Fastify Experiment API',
      description: 'API documentation for the Fastify experiment application.',
      version: '1.0.0',
    },
  },
};
server.register(fastifySwagger, swaggerPluginOptions);

// Register @fastify/swagger-ui *after* @fastify/swagger has completed its registration
server.after(err => {
  if (err) {
    console.error('Error during @fastify/swagger registration or preceding plugins:', err);
    // throw err; // This would stop the server
  }
  console.log('@fastify/swagger (and preceding plugins) loaded, now registering @fastify/swagger-ui');

  const swaggerUiPluginOptions: FastifySwaggerUiOptions = {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  };
  server.register(fastifySwaggerUi, swaggerUiPluginOptions);
});

// --- End of Swagger plugin registration ---

// --- MINIMAL TEST ROUTE (Registered as a plugin) ---
const testRoutes: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/test', {
    schema: {
      description: 'A simple test endpoint',
      tags: ['Test'],
      summary: 'Simple Test',
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    return { message: 'Hello from test route!' };
  });
};
server.register(testRoutes);
// --- END OF MINIMAL TEST ROUTE ---


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

// --- CRUD Routes for Items (Registered as a plugin) ---
const itemsRoutes: FastifyPluginAsync = async (fastify, options) => {
  // Create Item (POST /items)
  fastify.post<{ Body: CreateItemDto; Reply: Item | { error: string } }>(
    '/items',
    {
      schema: {
        description: 'Create a new item',
        tags: ['Items'],
        summary: 'Creates a new item',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the item' },
            description: { type: 'string', nullable: true, description: 'Optional description of the item' },
          },
        },
        response: {
          201: {
            description: 'Successful creation',
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              description: { type: 'string', nullable: true },
            },
          },
          400: {
            description: 'Invalid input',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Server error',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, description } = request.body;
      if (!name) {
        reply.status(400).send({ error: 'Name is required' });
        return;
      }
      try {
        const result = await pool.query<Item>(
          'INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *',
          [name, description || null]
        );
        reply.status(201).send(result.rows[0]);
      } catch (err: any) {
        fastify.log.error(err); // Use fastify.log inside plugin
        reply.status(500).send({ error: 'Failed to create item: ' + err.message });
      }
    }
  );

  // Get All Items (GET /items)
  fastify.get<{ Reply: Item[] | { error: string } }>(
    '/items',
    {
      schema: {
        description: 'Get all items',
        tags: ['Items'],
        summary: 'Retrieves a list of all items',
        response: {
          200: {
            description: 'A list of items',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                description: { type: 'string', nullable: true },
              },
            },
          },
          500: { description: 'Server Error', type: 'object', properties: { error: { type: 'string' } } }
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await pool.query<Item>('SELECT * FROM items ORDER BY id ASC');
        reply.send(result.rows);
      } catch (err: any) {
        fastify.log.error(err); // Use fastify.log inside plugin
        reply.status(500).send({ error: 'Failed to retrieve items: ' + err.message });
      }
    }
  );

  // Get Single Item (GET /items/:id)
  fastify.get<{ Params: ItemParams; Reply: Item | { error: string } }>(
    '/items/:id',
    {
      schema: {
        description: 'Get a single item by ID',
        tags: ['Items'],
        summary: 'Retrieves a specific item by its ID',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The ID of the item to retrieve' },
          },
        },
        response: {
          200: { description: 'The item', type: 'object', properties: { id: { type: 'integer'}, name: {type: 'string'}, description: {type: 'string', nullable: true}}},
          400: { description: 'Invalid ID', type: 'object', properties: { error: { type: 'string' } } },
          404: { description: 'Item not found', type: 'object', properties: { error: { type: 'string' } } },
          500: { description: 'Server Error', type: 'object', properties: { error: { type: 'string' } } }
        },
      },
    },
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
        fastify.log.error(err); // Use fastify.log inside plugin
        reply.status(500).send({ error: 'Failed to retrieve item: ' + err.message });
      }
    }
  );

  // Update Item (PUT /items/:id)
  fastify.put<{ Body: UpdateItemDto; Params: ItemParams; Reply: Item | { error: string } }>(
    '/items/:id',
    {
      schema: {
        description: 'Update an existing item',
        tags: ['Items'],
        summary: 'Updates an item by its ID',
        params: { type: 'object', properties: { id: { type: 'string', description: 'The ID of the item to update' }}},
        body: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', nullable: true }}},
        response: {
          200: { description: 'The updated item', type: 'object', properties: { id: { type: 'integer'}, name: {type: 'string'}, description: {type: 'string', nullable: true}}},
          400: { description: 'Invalid input or ID', type: 'object', properties: { error: { type: 'string' } } },
          404: { description: 'Item not found', type: 'object', properties: { error: { type: 'string' } } },
          500: { description: 'Server Error', type: 'object', properties: { error: { type: 'string' } } }
        },
      },
    },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        reply.status(400).send({ error: 'Invalid item ID' });
        return;
      }
      const { name, description } = request.body;

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

      values.push(id);

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
        fastify.log.error(err); // Use fastify.log inside plugin
        reply.status(500).send({ error: 'Failed to update item: ' + err.message });
      }
    }
  );

  // Delete Item (DELETE /items/:id)
  fastify.delete<{ Params: ItemParams; Reply: { message: string } | { error: string } }>(
    '/items/:id',
    {
      schema: {
        description: 'Delete an item',
        tags: ['Items'],
        summary: 'Deletes an item by its ID',
        params: { type: 'object', properties: { id: { type: 'string', description: 'The ID of the item to delete' }}},
        response: {
          200: {
            description: 'Successful deletion',
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: { description: 'Invalid ID', type: 'object', properties: { error: { type: 'string' } } },
          404: { description: 'Item not found', type: 'object', properties: { error: { type: 'string' } } },
          500: { description: 'Server Error', type: 'object', properties: { error: { type: 'string' } } }
        },
      },
    },
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
        fastify.log.error(err); // Use fastify.log inside plugin
        reply.status(500).send({ error: 'Failed to delete item: ' + err.message });
      }
    });
};
server.register(itemsRoutes); // Register the items routes plugin
// --- END OF CRUD Routes for Items ---


// Add this section to inspect the generated spec:
try {
  console.log('--- Registered Routes by Fastify (for context) ---');
  console.log(server.printRoutes());
  console.log('-------------------------------------------------');
  console.log('--- Generated Swagger Spec by server.swagger() ---');
  // Ensure server.swagger() is called only if the plugin has registered it
  if (server.swagger) {
    console.log(JSON.stringify(server.swagger(), null, 2));
  } else {
    console.log('server.swagger() is not available. @fastify/swagger might not be correctly initialized.');
  }
  console.log('-------------------------------------------------');
} catch (e) {
  console.error('Error during pre-start inspection:', e);
}


// --- Server Start ---
const start = async () => {
  try {
    // Wait for all plugins to be loaded, including routes
    await server.ready(); 
    
    // Now it's safe to inspect the swagger spec if needed, though the earlier log is fine
    if (server.swagger && process.env.NODE_ENV !== 'production') { // Conditional log
        console.log('--- Final Swagger Spec (after server.ready) ---');
        console.log(JSON.stringify(server.swagger(), null, 2));
        console.log('---------------------------------------------');
    }


    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
        await server.listen({ port, host: '0.0.0.0' });
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Ensure server starts only when this file is run directly (for local dev)
// and not when imported (e.g., by Vercel's runtime or tests)
if (require.main === module && (process.env.NODE_ENV !== 'production' || !process.env.VERCEL)) {
    start();
}

export default server;