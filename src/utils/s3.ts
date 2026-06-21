/**
 * S3 client using native fetch + aws4 for signing in Cloudflare Workers.
 */

// @ts-ignore - aws4 has no types
import aws4 from 'aws4';

interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function parseEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return { hostname: url.hostname };
}

async function signAndFetch(
  config: S3Config,
  method: string,
  path: string,
  body?: Uint8Array | string,
  contentType?: string,
): Promise<Response> {
  const { hostname } = parseEndpoint(config.endpoint);

  const opts: any = {
    host: hostname,
    path: `/${config.bucket}${path}`,
    method,
    service: 's3',
    region: config.region,
    headers: {} as Record<string, string>,
  };

  if (body !== undefined) {
    opts.body = body instanceof Uint8Array ? body : body;
    if (body instanceof Uint8Array) {
      opts.headers['Content-Length'] = body.byteLength.toString();
    }
  }

  if (contentType) {
    opts.headers['Content-Type'] = contentType;
  }

  aws4.sign(opts, {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const url = `${config.endpoint}/${config.bucket}${path}`;
  return await fetch(url, { method, headers: opts.headers, body });
}

export async function s3PutObject(config: S3Config, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await signAndFetch(config, 'PUT', `/${key}`, body, contentType);

  if (!response.ok) {
    const text = await response.text().catch(() => 'No response body');
    throw new Error(`S3 PUT failed (${response.status}): ${text}`);
  }
}

export async function s3GetObject(config: S3Config, key: string): Promise<Response> {
  const response = await signAndFetch(config, 'GET', `/${key}`);

  if (!response.ok) {
    const text = await response.text().catch(() => 'No response body');
    throw new Error(`S3 GET failed (${response.status}): ${text}`);
  }

  return response;
}

export async function s3DeleteObject(config: S3Config, key: string): Promise<void> {
  await signAndFetch(config, 'DELETE', `/${key}`);
}

export function getS3Config(env: {
  S3_ENDPOINT_URL?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_BUCKET_NAME?: string;
  S3_REGION_NAME?: string;
}): S3Config {
  return {
    endpoint: env.S3_ENDPOINT_URL!,
    region: env.S3_REGION_NAME || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    bucket: env.S3_BUCKET_NAME!,
  };
}
