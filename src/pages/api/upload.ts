import type { APIRoute } from 'astro';
import { logActivity } from '../../utils/db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const s3Endpoint = env.S3_ENDPOINT_URL;
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY;
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
    const s3BucketName = env.S3_BUCKET_NAME;
    const s3Region = env.S3_REGION_NAME;

    if (!s3Endpoint || !s3SecretKey || !s3AccessKeyId || !s3BucketName) {
      return new Response(
        JSON.stringify({ error: 'S3 storage credentials missing in environment.' }),
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

    const note = await db
      .prepare('SELECT id, user_id FROM notes WHERE id = ?')
      .bind(noteId)
      .first<{ id: string; user_id: string }>();

    if (note && note.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized note access' }), { status: 403 });
    }

    const attachmentId = crypto.randomUUID();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `users/${user.id}/notes/${noteId}/${attachmentId}-${sanitizedFilename}`;

    const s3 = new S3Client({
      requestHandler: new FetchHttpHandler(),
      endpoint: s3Endpoint,
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true,
    });

    const fileBuffer = await file.arrayBuffer();

    const command = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: fileKey,
      Body: new Uint8Array(fileBuffer),
      ContentType: file.type,
    });

    await s3.send(command);
    const now = Date.now();

    await db
      .prepare('INSERT INTO attachments (id, note_id, filename, r2_key, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(attachmentId, noteId, file.name, fileKey, file.size, file.type, now)
      .run();

    await logActivity(db, user.id, 'upload_file', `Uploaded file "${file.name}" to note`);

    return new Response(
      JSON.stringify({
        success: true,
        attachment: { id: attachmentId, filename: file.name, file_size: file.size, mime_type: file.type, created_at: now },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('File Upload Error:', error);
    const message = error?.message || error?.toString() || 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
