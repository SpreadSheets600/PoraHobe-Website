import type { APIRoute } from 'astro';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { env } from 'cloudflare:workers';

function createS3Client(s3Endpoint: string, s3Region: string, s3AccessKeyId: string, s3SecretKey: string) {
  return new S3Client({
    requestHandler: new FetchHttpHandler(),
    endpoint: s3Endpoint,
    region: s3Region,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretKey,
    },
    forcePathStyle: true,
  });
}

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) return new Response('Unauthorized', { status: 401 });
    if (!id) return new Response('File ID is required', { status: 400 });

    const s3Endpoint = env.S3_ENDPOINT_URL;
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY;
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
    const s3BucketName = env.S3_BUCKET_NAME;
    const s3Region = env.S3_REGION_NAME;

    if (!s3Endpoint || !s3SecretKey || !s3AccessKeyId || !s3BucketName) {
      return new Response('S3 storage credentials missing', { status: 500 });
    }

    const attachment: any = await db
      .prepare(`SELECT a.*, n.user_id FROM attachments a JOIN notes n ON a.note_id = n.id WHERE a.id = ?`)
      .bind(id)
      .first();

    if (!attachment) return new Response('File not found', { status: 404 });
    if (attachment.user_id !== user.id) return new Response('Forbidden', { status: 403 });

    const s3 = createS3Client(s3Endpoint, s3Region, s3AccessKeyId, s3SecretKey);

    const command = new GetObjectCommand({
      Bucket: s3BucketName,
      Key: attachment.r2_key,
    });

    const fileObject = await s3.send(command);

    if (!fileObject || !fileObject.Body) {
      return new Response('File not found in storage', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', attachment.mime_type || 'application/octet-stream');
    headers.set('Content-Length', attachment.file_size.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');

    const inlineTypes = ['image/', 'application/pdf', 'video/', 'audio/'];
    const isInline = inlineTypes.some((type) => attachment.mime_type?.startsWith(type));

    if (isInline) {
      headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
    } else {
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
    }

    // CORS headers for cross-origin file access
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    // The body from S3 SDK with FetchHttpHandler is a ReadableStream
    const bodyStream = fileObject.Body as ReadableStream;

    return new Response(bodyStream, { status: 200, headers });
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

    const s3Endpoint = env.S3_ENDPOINT_URL;
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY;
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
    const s3BucketName = env.S3_BUCKET_NAME;
    const s3Region = env.S3_REGION_NAME;

    if (!s3Endpoint || !s3SecretKey || !s3AccessKeyId || !s3BucketName) {
      return new Response(JSON.stringify({ error: 'S3 storage credentials missing' }), { status: 500 });
    }

    const attachment: any = await db
      .prepare(`SELECT a.id, a.filename, a.r2_key, n.user_id FROM attachments a JOIN notes n ON a.note_id = n.id WHERE a.id = ?`)
      .bind(id)
      .first();

    if (!attachment) return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
    if (attachment.user_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    const s3 = createS3Client(s3Endpoint, s3Region, s3AccessKeyId, s3SecretKey);

    try {
      const command = new DeleteObjectCommand({ Bucket: s3BucketName, Key: attachment.r2_key });
      await s3.send(command);
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
