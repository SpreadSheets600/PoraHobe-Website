import type { APIRoute } from 'astro';
import { verifyPassword, signJWT } from '../../../utils/crypto';
import { logActivity } from '../../../utils/db';
import type { User } from '../../../utils/db';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const db = env.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Query user
    const user = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind(username.toLowerCase())
      .first<User>();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid username or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return new Response(JSON.stringify({ error: 'Invalid username or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create session token
    const jwtSecret = env.JWT_SECRET || 'porahobe-super-secret-jwt-key-change-in-prod';
    const sessionToken = await signJWT(
      { id: user.id, username: user.username, role: user.role },
      jwtSecret
    );

    // Set cookie
    cookies.set('session_token', sessionToken, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    await logActivity(db, user.id, 'login', `Logged in successfully`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Login API Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
