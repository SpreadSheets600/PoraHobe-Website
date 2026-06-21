/**
 * Minimal S3-compatible client for Cloudflare Workers.
 * Uses native fetch() with AWS Signature V4 to avoid SDK compatibility issues.
 */

const encoder = new TextEncoder();

async function sha256(data: ArrayBuffer | Uint8Array | string): Promise<ArrayBuffer> {
  const dataBuf = typeof data === 'string' ? encoder.encode(data) : data;
  return await crypto.subtle.digest('SHA-256', dataBuf);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmacSha256(encoder.encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  return kSigning;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '').replace('T', 'T').slice(0, 15) + 'Z';
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function parseEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return { protocol: url.protocol, hostname: url.hostname };
}

async function signRequest(
  method: string,
  config: S3Config,
  path: string,
  payloadHash: string,
  contentType?: string,
): Promise<Headers> {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const { hostname } = parseEndpoint(config.endpoint);

  const canonicalUri = path;
  const canonicalQueryString = '';
  const headerEntries: [string, string][] = [
    ['host', hostname],
    ...(contentType ? [['content-type', contentType] as [string, string]] : []),
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ];
  headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const signedHeaders = headerEntries.map(([k]) => k).join(';');

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256(encoder.encode(canonicalRequest))].join('\n');

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signatureHex = Array.from(new Uint8Array(await hmacSha256(signingKey, stringToSign)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const headers = new Headers();
  headers.set('Host', hostname);
  headers.set('x-amz-date', amzDate);
  headers.set('x-amz-content-sha256', payloadHash);
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Authorization', `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`);

  return headers;
}

export async function s3PutObject(config: S3Config, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const payloadHash = Array.from(new Uint8Array(await sha256(body)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const headers = await signRequest('PUT', config, `/${key}`, payloadHash, contentType);
  headers.set('Content-Type', contentType);
  headers.set('Content-Length', body.byteLength.toString());

  const url = `${config.endpoint}/${config.bucket}/${key}`;
  const response = await fetch(url, { method: 'PUT', headers, body });

  if (!response.ok) {
    const text = await response.text().catch(() => 'No response body');
    throw new Error(`S3 PUT failed (${response.status}): ${text}`);
  }
}

export async function s3GetObject(config: S3Config, key: string): Promise<Response> {
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const headers = await signRequest('GET', config, `/${key}`, emptyHash);

  const url = `${config.endpoint}/${config.bucket}/${key}`;
  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    const text = await response.text().catch(() => 'No response body');
    throw new Error(`S3 GET failed (${response.status}): ${text}`);
  }

  return response;
}

export async function s3DeleteObject(config: S3Config, key: string): Promise<void> {
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const headers = await signRequest('DELETE', config, `/${key}`, emptyHash);

  const url = `${config.endpoint}/${config.bucket}/${key}`;
  await fetch(url, { method: 'DELETE', headers });
}

export function getS3Config(env: { S3_ENDPOINT_URL?: string; S3_SECRET_ACCESS_KEY?: string; S3_ACCESS_KEY_ID?: string; S3_BUCKET_NAME?: string; S3_REGION_NAME?: string }): S3Config {
  return {
    endpoint: env.S3_ENDPOINT_URL!,
    region: env.S3_REGION_NAME || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    bucket: env.S3_BUCKET_NAME!,
  };
}
