// Web Crypto helpers for Password Hashing (PBKDF2) and JWT (HMAC-SHA256)
// Works natively in Cloudflare Workers and standard environments.

const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 32; // 256 bits

// Base64Url helper functions
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate random bytes as hex
function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Hash password with PBKDF2
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  const saltBuffer = encoder.encode(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    HASH_LENGTH * 8
  );
  
  const hashHex = Array.from(new Uint8Array(derivedBits), (byte) => byte.toString(16).padStart(2, '0')).join('');
  
  // Format: iterations.salt.hash
  return `${PBKDF2_ITERATIONS}.${salt}.${hashHex}`;
}

// Verify password against stored hash
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('.');
    if (parts.length !== 3) return false;
    
    const iterations = parseInt(parts[0], 10);
    const salt = parts[1];
    const hashHex = parts[2];
    
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const baseKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const saltBuffer = encoder.encode(salt);
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: iterations,
        hash: 'SHA-256',
      },
      baseKey,
      HASH_LENGTH * 8
    );
    
    const calculatedHashHex = Array.from(new Uint8Array(derivedBits), (byte) => byte.toString(16).padStart(2, '0')).join('');
    
    return calculatedHashHex === hashHex;
  } catch (e) {
    console.error('Password verification error:', e);
    return false;
  }
}

// Sign JWT token
export async function signJWT(payload: Record<string, any>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const encodedHeader = arrayBufferToBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = arrayBufferToBase64Url(encoder.encode(JSON.stringify(payload)));
  
  const tokenInput = `${encodedHeader}.${encodedPayload}`;
  
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(tokenInput)
  );
  
  const encodedSignature = arrayBufferToBase64Url(signatureBuffer);
  
  return `${tokenInput}.${encodedSignature}`;
}

// Verify JWT token
export async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const tokenInput = `${encodedHeader}.${encodedPayload}`;
    
    const encoder = new TextEncoder();
    
    const secretKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureBuffer = base64UrlToArrayBuffer(encodedSignature);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      secretKey,
      signatureBuffer,
      encoder.encode(tokenInput)
    );
    
    if (!isValid) return null;
    
    const decodedPayload = new TextDecoder().decode(base64UrlToArrayBuffer(encodedPayload));
    const payload = JSON.parse(decodedPayload);
    
    // Check expiration if 'exp' is present
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return null; // Expired
    }
    
    return payload;
  } catch (e) {
    console.error('JWT verification error:', e);
    return null;
  }
}
