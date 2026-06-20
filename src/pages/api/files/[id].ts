import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const r2 = locals.runtime?.env?.R2;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (!r2) {
      return new Response('R2 storage binding missing', { status: 500 });
    }

    if (!id) {
      return new Response('File ID is required', { status: 400 });
    }

    // Verify ownership of the note that has this attachment
    const attachment: any = await db
      .prepare(
        `SELECT a.*, n.user_id 
         FROM attachments a 
         JOIN notes n ON a.note_id = n.id 
         WHERE a.id = ?`
      )
      .bind(id)
      .first();

    if (!attachment) {
      return new Response('File not found', { status: 404 });
    }

    if (attachment.user_id !== user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    // Fetch the object from Cloudflare R2
    const fileObject = await r2.get(attachment.r2_key);

    if (!fileObject) {
      return new Response('File not found in storage', { status: 404 });
    }

    // Prepare headers
    const headers = new Headers();
    headers.set('Content-Type', attachment.mime_type || 'application/octet-stream');
    headers.set('Content-Length', attachment.file_size.toString());
    
    // Serve inline for images/pdfs, and as attachments for other files
    const inlineTypes = ['image/', 'application/pdf', 'video/', 'audio/'];
    const isInline = inlineTypes.some((type) => attachment.mime_type?.startsWith(type));
    
    if (isInline) {
      headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
    } else {
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
    }

    // Stream the body from R2
    return new Response(fileObject.body as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('Fetch File API Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

// DELETE file
export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const r2 = locals.runtime?.env?.R2;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!r2) {
      return new Response(JSON.stringify({ error: 'R2 binding missing' }), { status: 500 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'File ID is required' }), { status: 400 });
    }

    // Check ownership
    const attachment: any = await db
      .prepare(
        `SELECT a.id, a.filename, a.r2_key, n.user_id 
         FROM attachments a 
         JOIN notes n ON a.note_id = n.id 
         WHERE a.id = ?`
      )
      .bind(id)
      .first();

    if (!attachment) {
      return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
    }

    if (attachment.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // Delete from R2
    try {
      await r2.delete(attachment.r2_key);
    } catch (e) {
      console.error('Failed to delete from R2:', attachment.r2_key, e);
    }

    // Delete metadata from D1
    await db.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Delete File API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
