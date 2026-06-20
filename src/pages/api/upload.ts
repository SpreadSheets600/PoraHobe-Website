import type { APIRoute } from 'astro';
import { logActivity } from '../../utils/db';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const r2 = locals.runtime?.env?.R2;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!r2) {
      return new Response(
        JSON.stringify({ error: 'R2 storage binding missing. Configure R2 in Wrangler.' }),
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const noteId = formData.get('noteId') as string;

    if (!file || !noteId) {
      return new Response(
        JSON.stringify({ error: 'File and Note ID are required fields.' }),
        { status: 400 }
      );
    }

    // Verify ownership of the note
    const note = await db
      .prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?')
      .bind(noteId, user.id)
      .first();

    if (!note) {
      return new Response(JSON.stringify({ error: 'Note not found or unauthorized' }), {
        status: 404,
      });
    }

    // Generate unique R2 key
    const attachmentId = crypto.randomUUID();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const r2Key = `users/${user.id}/notes/${noteId}/${attachmentId}-${sanitizedFilename}`;

    // Upload to Cloudflare R2
    const fileBuffer = await file.arrayBuffer();
    await r2.put(r2Key, fileBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        userId: user.id,
        noteId: noteId,
        filename: file.name,
      },
    });

    const now = Date.now();

    // Insert attachment metadata in D1
    await db
      .prepare(
        'INSERT INTO attachments (id, note_id, filename, r2_key, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(attachmentId, noteId, file.name, r2Key, file.size, file.type, now)
      .run();

    await logActivity(
      db,
      user.id,
      'upload_file',
      `Uploaded file "${file.name}" to note`
    );

    return new Response(
      JSON.stringify({
        success: true,
        attachment: {
          id: attachmentId,
          filename: file.name,
          file_size: file.size,
          mime_type: file.type,
          created_at: now,
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('File Upload Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
