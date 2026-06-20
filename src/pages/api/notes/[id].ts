import type { APIRoute } from 'astro';
import { logActivity } from '../../../utils/db';
import { syncNoteLinks, syncBacklinks } from '../../../utils/links';
import { env } from 'cloudflare:workers';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Helper to sync note tags
async function syncNoteTags(
  db: import("@cloudflare/workers-types").D1Database,
  noteId: string,
  tagNames: string[]
): Promise<void> {
  await db.prepare('DELETE FROM note_tags WHERE note_id = ?').bind(noteId).run();
  if (!tagNames || tagNames.length === 0) return;

  for (let tagName of tagNames) {
    tagName = tagName.trim().toLowerCase();
    if (!tagName) continue;

    let tag = await db
      .prepare('SELECT id FROM tags WHERE name = ?')
      .bind(tagName)
      .first<{ id: string }>();

    let tagId = tag?.id;
    if (!tagId) {
      tagId = crypto.randomUUID();
      await db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').bind(tagId, tagName).run();
    }

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

// GET specific note details (including backlinks, tags, attachments, links, and recommendations)
export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Note ID is required' }), { status: 400 });
    }

    // Fetch Note
    const note: any = await db
      .prepare('SELECT n.*, c.name as collection_name FROM notes n LEFT JOIN collections c ON n.collection_id = c.id WHERE n.id = ? AND n.user_id = ?')
      .bind(id, user.id)
      .first();

    if (!note) {
      return new Response(JSON.stringify({ error: 'Note not found' }), { status: 404 });
    }

    note.is_favorite = !!note.is_favorite;
    note.is_pinned = !!note.is_pinned;

    // Fetch Tags
    const tagsResult = await db
      .prepare('SELECT t.name FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE nt.note_id = ?')
      .bind(id)
      .all();
    const tags = tagsResult.results.map((r: any) => r.name);

    // Fetch Attachments
    const attachmentsResult = await db
      .prepare('SELECT id, filename, file_size, mime_type, created_at FROM attachments WHERE note_id = ?')
      .bind(id)
      .all();
    const attachments = attachmentsResult.results;

    // Fetch Links
    const linksResult = await db
      .prepare('SELECT id, url, type, title, thumbnail_url, watch_progress FROM links WHERE note_id = ?')
      .bind(id)
      .all();
    const links = linksResult.results;

    // Fetch Backlinks (Incoming: notes linking to this note)
    const incomingResult = await db
      .prepare('SELECT n.id, n.title FROM backlinks b JOIN notes n ON b.source_note_id = n.id WHERE b.target_note_id = ? AND n.user_id = ?')
      .bind(id, user.id)
      .all();
    const incomingBacklinks = incomingResult.results;

    // Fetch Outgoing links (Notes this note links to)
    const outgoingResult = await db
      .prepare('SELECT n.id, n.title FROM backlinks b JOIN notes n ON b.target_note_id = n.id WHERE b.source_note_id = ? AND n.user_id = ?')
      .bind(id, user.id)
      .all();
    const outgoingBacklinks = outgoingResult.results;

    // Fetch Related/Recommended Notes (Same category or sharing any tag, excluding itself)
    let relatedNotes: any[] = [];
    if (note.category) {
      const relatedResult = await db
        .prepare('SELECT id, title, category, semester FROM notes WHERE category = ? AND id != ? AND user_id = ? LIMIT 3')
        .bind(note.category, id, user.id)
        .all();
      relatedNotes = relatedResult.results;
    }

    return new Response(
      JSON.stringify({
        ...note,
        tags,
        attachments,
        links,
        incomingBacklinks,
        outgoingBacklinks,
        relatedNotes,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Fetch Note ID Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// PUT update note
export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Note ID is required' }), { status: 400 });
    }

    const body = await request.json();
    const {
      title,
      content,
      collection_id = null,
      category,
      semester,
      topic,
      is_favorite,
      is_pinned,
      tags = [],
    } = body;

    // Verify ownership
    const note = await db
      .prepare('SELECT id, title FROM notes WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .first();

    if (!note) {
      return new Response(JSON.stringify({ error: 'Note not found' }), { status: 404 });
    }

    const now = Date.now();

    await db
      .prepare(
        `UPDATE notes SET
          title = COALESCE(?, title),
          content = COALESCE(?, content),
          collection_id = ?,
          category = COALESCE(?, category),
          semester = COALESCE(?, semester),
          topic = COALESCE(?, topic),
          is_favorite = COALESCE(?, is_favorite),
          is_pinned = COALESCE(?, is_pinned),
          updated_at = ?
        WHERE id = ?`
      )
      .bind(
        title !== undefined ? title : null,
        content !== undefined ? content : null,
        collection_id || null,
        category !== undefined ? category : null,
        semester !== undefined ? semester : null,
        topic !== undefined ? topic : null,
        is_favorite !== undefined ? (is_favorite ? 1 : 0) : null,
        is_pinned !== undefined ? (is_pinned ? 1 : 0) : null,
        now,
        id
      )
      .run();

    // Sync tags if provided
    if (tags !== undefined) {
      await syncNoteTags(db, id, tags);
    }

    // Sync links if content was updated
    if (content !== undefined) {
      await syncNoteLinks(db, id, content);
      await syncBacklinks(db, id, content);
    }

    await logActivity(db, user.id, 'edit_note', `Updated note: "${title || note.title}"`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Update Note Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// DELETE note
export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Note ID is required' }), { status: 400 });
    }

    // Verify ownership and get attachments
    const note = await db
      .prepare('SELECT id, title FROM notes WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .first<{ id: string; title: string }>();

    if (!note) {
      return new Response(JSON.stringify({ error: 'Note not found' }), { status: 404 });
    }

    // Find and delete S3/B2 attachments if any
    const attachments = (await db
      .prepare('SELECT r2_key FROM attachments WHERE note_id = ?')
      .bind(id)
      .all()
    ).results;

    if (attachments && attachments.length > 0) {
      const runtimeEnv = locals.runtime?.env || {};
      const s3Endpoint = runtimeEnv.S3_ENDPOINT_URL || 'https://s3.eu-central-003.backblazeb2.com';
      const s3SecretKey = runtimeEnv.S3_SECRET_ACCESS_KEY || 'K003lrhYvprO1GdP7KFOHHzFjubVkko';
      const s3AccessKeyId = runtimeEnv.S3_ACCESS_KEY_ID || '0036c0456fc62aa0000000002';
      const s3BucketName = runtimeEnv.S3_BUCKET_NAME || 'CityPulse';
      const s3Region = runtimeEnv.S3_REGION_NAME || 'eu-central-003';

      const s3 = new S3Client({
        endpoint: s3Endpoint,
        region: s3Region,
        credentials: {
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretKey,
        },
        forcePathStyle: true,
      });

      for (const att of attachments) {
        try {
          const command = new DeleteObjectCommand({
            Bucket: s3BucketName,
            Key: att.r2_key as string,
          });
          await s3.send(command);
        } catch (e) {
          console.error('Failed to delete file from S3:', att.r2_key, e);
        }
      }
    }

    // Cascade delete in DB (links, attachments, note_tags, backlinks are deleted automatically via ON DELETE CASCADE)
    await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();

    await logActivity(db, user.id, 'delete_note', `Deleted note: "${note.title}"`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Delete Note Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
