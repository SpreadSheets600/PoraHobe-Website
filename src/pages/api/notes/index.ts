import type { APIRoute } from 'astro';
import { logActivity } from '../../../utils/db';
import { syncNoteLinks } from '../../../utils/links';

// Helper to sync note tags
async function syncNoteTags(
  db: import("@cloudflare/workers-types").D1Database,
  noteId: string,
  tagNames: string[]
): Promise<void> {
  // Clear existing mappings
  await db.prepare('DELETE FROM note_tags WHERE note_id = ?').bind(noteId).run();

  if (!tagNames || tagNames.length === 0) return;

  for (let tagName of tagNames) {
    tagName = tagName.trim().toLowerCase();
    if (!tagName) continue;

    // Get or create tag
    let tag = await db
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(tagName)
      .first<{ id: string }>();

    let tagId = tag?.id;

    if (!tagId) {
      tagId = crypto.randomUUID();
      await db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').bind(tagId, tagName).run();
    }

    // Link note to tag
    try {
      await db
        .prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)')
        .bind(noteId, tagId)
        .run();
    } catch (e) {
      // Ignore duplicates
    }
  }
}

// Fetch all notes (with filtering)
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const collectionId = url.searchParams.get('collection_id');
    const search = url.searchParams.get('search');
    const tag = url.searchParams.get('tag');
    const category = url.searchParams.get('category');
    const semester = url.searchParams.get('semester');
    const isFavorite = url.searchParams.get('is_favorite');
    const isPinned = url.searchParams.get('is_pinned');

    let query = `
      SELECT n.*, c.name as collection_name,
      (SELECT group_concat(t.name) FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE nt.note_id = n.id) as tags
      FROM notes n
      LEFT JOIN collections c ON n.collection_id = c.id
      WHERE n.user_id = ?
    `;
    const params: any[] = [user.id];

    if (collectionId) {
      if (collectionId === 'root') {
        query += ' AND n.collection_id IS NULL';
      } else {
        query += ' AND n.collection_id = ?';
        params.push(collectionId);
      }
    }

    if (category) {
      query += ' AND n.category = ?';
      params.push(category);
    }

    if (semester) {
      query += ' AND n.semester = ?';
      params.push(semester);
    }

    if (isFavorite === '1') {
      query += ' AND n.is_favorite = 1';
    }

    if (isPinned === '1') {
      query += ' AND n.is_pinned = 1';
    }

    if (search) {
      query += ' AND (n.title LIKE ? OR n.content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (tag) {
      query += ` AND n.id IN (
        SELECT nt.note_id FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE t.name = ?
      )`;
      params.push(tag.toLowerCase());
    }

    // Sort by pinned first, then updated_at descending
    query += ' ORDER BY n.is_pinned DESC, n.updated_at DESC';

    const { results } = await db.prepare(query).bind(...params).all();

    // Map tags string to array
    const formattedResults = results.map((r: any) => ({
      ...r,
      tags: r.tags ? r.tags.split(',') : [],
      is_favorite: !!r.is_favorite,
      is_pinned: !!r.is_pinned,
    }));

    return new Response(JSON.stringify(formattedResults), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Fetch Notes Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// Create a new note
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      content = '',
      collection_id = null,
      category = 'General',
      semester = 'All',
      topic = 'General',
      is_favorite = 0,
      is_pinned = 0,
      tags = [],
    } = body;

    if (!title || typeof title !== 'string') {
      return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });
    }

    const noteId = crypto.randomUUID();
    const now = Date.now();

    await db
      .prepare(
        `INSERT INTO notes (
          id, user_id, collection_id, title, content, category, semester, topic, is_favorite, is_pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        noteId,
        user.id,
        collection_id || null,
        title,
        content,
        category,
        semester,
        topic,
        is_favorite ? 1 : 0,
        is_pinned ? 1 : 0,
        now,
        now
      )
      .run();

    // Sync tags
    await syncNoteTags(db, noteId, tags);

    // Sync URLs parsed from content (YouTube, Google Drive, External)
    await syncNoteLinks(db, noteId, content);

    // Log action
    await logActivity(db, user.id, 'create_note', `Created note: "${title}"`);

    return new Response(JSON.stringify({ id: noteId, success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Create Note Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
