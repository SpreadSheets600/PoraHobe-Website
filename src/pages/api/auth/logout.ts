import type { APIRoute } from 'astro';
import { logActivity } from '../../../utils/db';

export const POST: APIRoute = async ({ locals, cookies }) => {
  try {
    const db = locals.runtime?.env?.DB;
    const user = locals.user;

    if (db && user) {
      await logActivity(db, user.id, 'logout', `Logged out successfully`);
    }

    // Delete the session cookie
    cookies.delete('session_token', {
      path: '/',
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Logout API Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
