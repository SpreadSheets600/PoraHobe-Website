import { defineMiddleware } from 'astro:middleware';
import { verifyJWT } from './utils/crypto';
import { env } from 'cloudflare:workers';

// Public paths that do not require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/register'];

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const jwtSecret = env.JWT_SECRET || 'porahobe-super-secret-jwt-key-change-in-prod';
  
  // Parse session cookie
  const sessionToken = context.cookies.get('session_token')?.value;

  if (sessionToken) {
    const userPayload = await verifyJWT(sessionToken, jwtSecret);
    if (userPayload) {
      context.locals.user = {
        id: userPayload.id,
        username: userPayload.username,
        role: userPayload.role || 'user',
      };
    }
  }

  // Check if path is public
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));

  // If user is not logged in and path is protected, redirect to login
  if (!context.locals.user && !isPublic) {
    // If it's an API request, return 401
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/login');
  }

  // If user is logged in and trying to access login page, redirect to home
  if (context.locals.user && path === '/login') {
    return context.redirect('/');
  }

  // CSRF Protection for state-changing requests (POST, PUT, DELETE)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(context.request.method)) {
    const origin = context.request.headers.get('origin');
    const host = context.request.headers.get('host');
    
    if (origin) {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        return new Response(JSON.stringify({ error: 'CSRF Validation Failed' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  return next();
});
