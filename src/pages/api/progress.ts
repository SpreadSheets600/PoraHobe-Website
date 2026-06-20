import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { linkId, progress } = await request.json();

    if (!linkId || progress === undefined) {
      return new Response(JSON.stringify({ error: 'LinkId and progress are required' }), {
        status: 400,
      });
    }

    // Verify ownership: the link belongs to a note owned by the user
    const link = await db
      .prepare(
        `SELECT l.id 
         FROM links l 
         JOIN notes n ON l.note_id = n.id 
         WHERE l.id = ? AND n.user_id = ?`
      )
      .bind(linkId, user.id)
      .first();

    if (!link) {
      return new Response(JSON.stringify({ error: 'Link not found or unauthorized' }), {
        status: 404,
      });
    }

    // Update watch progress
    await db
      .prepare('UPDATE links SET watch_progress = ? WHERE id = ?')
      .bind(Math.round(progress), linkId)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Update Progress API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
