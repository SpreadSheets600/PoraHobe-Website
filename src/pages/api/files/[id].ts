import type { APIRoute } from 'astro';
import { s3GetObject, s3DeleteObject, getS3Config } from '../../../utils/s3';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) return new Response('Unauthorized', { status: 401 });
    if (!id) return new Response('File ID is required', { status: 400 });

    if (!env.S3_ENDPOINT_URL || !env.S3_SECRET_ACCESS_KEY || !env.S3_ACCESS_KEY_ID || !env.S3_BUCKET_NAME) {
      return new Response('S3 storage credentials missing', { status: 500 });
    }

    const attachment: any = await db
      .prepare(`SELECT a.*, n.user_id FROM attachments a JOIN notes n ON a.note_id = n.id WHERE a.id = ?`)
      .bind(id)
      .first();

    if (!attachment) return new Response('File not found', { status: 404 });
    if (attachment.user_id !== user.id) return new Response('Forbidden', { status: 403 });

    const config = getS3Config(env);
    const s3Response = await s3GetObject(config, attachment.r2_key);

    const headers = new Headers();
    headers.set('Content-Type', attachment.mime_type || 'application/octet-stream');
    headers.set('Content-Length', attachment.file_size.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    const inlineTypes = ['image/', 'application/pdf', 'video/', 'audio/'];
    const isInline = inlineTypes.some((type) => attachment.mime_type?.startsWith(type));

    if (isInline) {
      headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
    } else {
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
    }

    return new Response(s3Response.body, { status: 200, headers });
  } catch (error: any) {
    console.error('Fetch File API Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    if (!id) return new Response(JSON.stringify({ error: 'File ID is required' }), { status: 400 });

    if (!env.S3_ENDPOINT_URL || !env.S3_SECRET_ACCESS_KEY || !env.S3_ACCESS_KEY_ID || !env.S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: 'S3 storage credentials missing' }), { status: 500 });
    }

    const attachment: any = await db
      .prepare(`SELECT a.id, a.filename, a.r2_key, n.user_id FROM attachments a JOIN notes n ON a.note_id = n.id WHERE a.id = ?`)
      .bind(id)
      .first();

    if (!attachment) return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
    if (attachment.user_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    const config = getS3Config(env);
    try {
      await s3DeleteObject(config, attachment.r2_key);
    } catch (e) {
      console.error('Failed to delete from S3/B2:', attachment.r2_key, e);
    }

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
