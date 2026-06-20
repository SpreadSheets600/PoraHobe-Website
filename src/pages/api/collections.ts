import type { APIRoute } from 'astro';
import { logActivity, buildCollectionTree } from '../../utils/db';
import type { Collection } from '../../utils/db';
import { env } from 'cloudflare:workers';

// Get collections (either tree format or list format)
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const format = url.searchParams.get('format') || 'tree';

    const { results } = await db
      .prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY name ASC')
      .bind(user.id)
      .all<Collection>();

    if (format === 'list') {
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tree = buildCollectionTree(results);
    return new Response(JSON.stringify(tree), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Fetch Collections Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// Create a collection
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await request.json();
    const { name, parent_id = null } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return new Response(JSON.stringify({ error: 'Folder name is required' }), { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    // Verify parent belongs to user if provided
    if (parent_id) {
      const parent = await db
        .prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?')
        .bind(parent_id, user.id)
        .first();
      
      if (!parent) {
        return new Response(JSON.stringify({ error: 'Parent folder not found' }), { status: 400 });
      }
    }

    await db
      .prepare(
        'INSERT INTO collections (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(id, user.id, name.trim(), parent_id || null, now)
      .run();

    await logActivity(db, user.id, 'create_collection', `Created folder: "${name}"`);

    return new Response(JSON.stringify({ id, success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Create Collection Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// Update/Rename/Move collection
export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await request.json();
    const { id, name, parent_id } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: 'Folder ID is required' }), { status: 400 });
    }

    // Verify ownership
    const collection = await db
      .prepare('SELECT id, name FROM collections WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .first<{ id: string; name: string }>();

    if (!collection) {
      return new Response(JSON.stringify({ error: 'Folder not found' }), { status: 404 });
    }

    // If moving, verify parent ownership
    if (parent_id) {
      if (parent_id === id) {
        return new Response(JSON.stringify({ error: 'Cannot move folder into itself' }), { status: 400 });
      }
      const parent = await db
        .prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?')
        .bind(parent_id, user.id)
        .first();
      
      if (!parent) {
        return new Response(JSON.stringify({ error: 'Parent folder not found' }), { status: 400 });
      }
    }

    await db
      .prepare(
        `UPDATE collections SET
          name = COALESCE(?, name),
          parent_id = ?
        WHERE id = ?`
      )
      .bind(
        name !== undefined ? name.trim() : null,
        parent_id !== undefined ? (parent_id || null) : undefined, // Keep existing if parent_id is omitted from payload, set to null if explicitly null
        id
      )
      .run();

    await logActivity(
      db,
      user.id,
      'edit_collection',
      `Modified folder: "${name || collection.name}"`
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Update Collection Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// Delete collection
export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { id } = await request.json();

    if (!id) {
      return new Response(JSON.stringify({ error: 'Folder ID is required' }), { status: 400 });
    }

    // Verify ownership
    const collection = await db
      .prepare('SELECT id, name FROM collections WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .first<{ id: string; name: string }>();

    if (!collection) {
      return new Response(JSON.stringify({ error: 'Folder not found' }), { status: 404 });
    }

    // Cascade delete of collection (D1 schema handles child collections and sets note collections to null)
    await db.prepare('DELETE FROM collections WHERE id = ?').bind(id).run();

    await logActivity(db, user.id, 'delete_collection', `Deleted folder: "${collection.name}"`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Delete Collection Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
