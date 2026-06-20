import type { APIRoute } from 'astro';
import { logActivity } from '../../utils/db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = env.DB;
    const user = locals.user;

    if (!db || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const s3Endpoint = env.S3_ENDPOINT_URL || 'https://s3.eu-central-003.backblazeb2.com';
    const s3SecretKey = env.S3_SECRET_ACCESS_KEY || 'K003lrhYvprO1GdP7KFOHHzFjubVkko';
    const s3AccessKeyId = env.S3_ACCESS_KEY_ID || '0036c0456fc62aa0000000002';
    const s3BucketName = env.S3_BUCKET_NAME || 'CityPulse';
    const s3Region = env.S3_REGION_NAME || 'eu-central-003';

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

    // Generate unique file path key (storing in D1 attachments as r2_key column)
    const attachmentId = crypto.randomUUID();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `users/${user.id}/notes/${noteId}/${attachmentId}-${sanitizedFilename}`;

    // Initialize modular AWS S3 client
    const s3 = new S3Client({
      endpoint: s3Endpoint,
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true, // Required for Backblaze B2 S3 API compat
    });

    const fileBuffer = await file.arrayBuffer();

    // Upload object to B2/S3
    const command = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: fileKey,
      Body: new Uint8Array(fileBuffer),
      ContentType: file.type,
    });

    await s3.send(command);

    const now = Date.now();

    // Insert attachment metadata in D1 (reusing the r2_key column name)
    await db
      .prepare(
        'INSERT INTO attachments (id, note_id, filename, r2_key, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(attachmentId, noteId, file.name, fileKey, file.size, file.type, now)
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
