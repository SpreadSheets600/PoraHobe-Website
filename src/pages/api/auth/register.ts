import type { APIRoute } from 'astro';
import { hashPassword, signJWT } from '../../../utils/crypto';
import { logActivity } from '../../../utils/db';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const db = locals.runtime?.env?.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { username, password, inviteCode } = body;

    // Validation
    if (!username || typeof username !== 'string' || username.length < 3) {
      return new Response(JSON.stringify({ error: 'Username must be at least 3 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Invite only check
    const env = locals.runtime?.env || {};
    const inviteOnly = env.INVITE_ONLY === 'true';
    const serverInviteCode = env.INVITE_CODE || 'PORAHOBE2026';

    if (inviteOnly) {
      if (!inviteCode || inviteCode !== serverInviteCode) {
        return new Response(JSON.stringify({ error: 'Invalid or missing invite code' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Check if user exists
    const existingUser = await db
      .prepare('SELECT id FROM users WHERE username = ?')
      .bind(username.toLowerCase())
      .first();

    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username is already taken' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create user
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const role = 'user';

    await db
      .prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, username.toLowerCase(), passwordHash, role, now)
      .run();

    // Create a default collection
    const defaultCollectionId = crypto.randomUUID();
    await db
      .prepare('INSERT INTO collections (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(defaultCollectionId, userId, 'Getting Started', null, now)
      .run();

    // Add a default welcome note
    const welcomeNoteId = crypto.randomUUID();
    const welcomeContent = `# Welcome to PoraHobe! 🎓

PoraHobe is your private-first Notes & Study Material Sharing Platform. Here are some quick tips:

*   **Markdown Support**: Write standard markdown.
*   **LaTeX Math**: Render math like $$E = mc^2$$ or inline $a^2 + b^2 = c^2$.
*   **Media Sharing**: Attach YouTube videos or Google Drive links.
*   **Code Formatting**: Use standard code blocks for syntax highlighting.
*   **Bento Dashboard**: Go to the home dashboard to see statistics, bookmarks, and activity logs.

Feel free to delete this note and create your own!`;

    await db
      .prepare(
        'INSERT INTO notes (id, user_id, collection_id, title, content, category, semester, topic, is_favorite, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        welcomeNoteId,
        userId,
        defaultCollectionId,
        'Welcome to PoraHobe',
        welcomeContent,
        'General',
        'All',
        'Intro',
        0,
        1,
        now,
        now
      )
      .run();

    // Create session token
    const jwtSecret = env.JWT_SECRET || 'porahobe-super-secret-jwt-key-change-in-prod';
    const sessionToken = await signJWT(
      { id: userId, username: username.toLowerCase(), role },
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

    await logActivity(db, userId, 'register', `Created account and logged in`);

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Registration API Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
