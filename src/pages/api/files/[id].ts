import type { APIRoute } from 'astro';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (!id) {
      return new Response('File ID is required', { status: 400 });
    }

    const env = locals.runtime?.env || {};
    const s3Endpoint = env.S3_ENDPOINT_URL || 'https://s3.eu-central-003.backblazeb2.com';
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY || 'K003lrhYvprO1GdP7KFOHHzFjubVkko';
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID || '0036c0456fc62aa0000000002';
    const s3BucketName = env.S3_BUCKET_NAME || 'CityPulse';
    const s3Region = env.S3_REGION_NAME || 'eu-central-003';

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

    // Initialize S3 client
    const s3 = new S3Client({
      endpoint: s3Endpoint,
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true,
    });

    const command = new GetObjectCommand({
      Bucket: s3BucketName,
      Key: attachment.r2_key,
    });

    const fileObject = await s3.send(command);

    if (!fileObject || !fileObject.Body) {
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

    // Convert S3 Body stream to Web Stream if available (standard on Cloudflare Workers)
    const bodyStream = typeof (fileObject.Body as any).transformToWebStream === 'function'
      ? (fileObject.Body as any).transformToWebStream()
      : fileObject.Body;

    return new Response(bodyStream as ReadableStream, {
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
    const user = locals.user;
    const { id } = params;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'File ID is required' }), { status: 400 });
    }

    const env = locals.runtime?.env || {};
    const s3Endpoint = env.S3_ENDPOINT_URL || 'https://s3.eu-central-003.backblazeb2.com';
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY || 'K003lrhYvprO1GdP7KFOHHzFjubVkko';
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID || '0036c0456fc62aa0000000002';
    const s3BucketName = env.S3_BUCKET_NAME || 'CityPulse';
    const s3Region = env.S3_REGION_NAME || 'eu-central-003';

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

    // Initialize S3 client
    const s3 = new S3Client({
      endpoint: s3Endpoint,
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true,
    });

    // Delete object from Backblaze B2/S3
    try {
      const command = new DeleteObjectCommand({
        Bucket: s3BucketName,
        Key: attachment.r2_key,
      });
      await s3.send(command);
    } catch (e) {
      console.error('Failed to delete from S3/B2:', attachment.r2_key, e);
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
