import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session-token';

// First line of defence: runs before any page or API route. It only checks the signed
// cookie (fast, no database). API handlers and the (app) layout re-check the role
// against the database, so this is never the only gate.

const ADMIN_PAGES = '/admin';
const ADMIN_API = '/api/admin';

function safeNext(path) {
  return path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
}

export async function middleware(req) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');

  // Sign-in and sign-up endpoints are public; handlers enforce their own rules.
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  if (isApi) {
    if (!session) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
    if (pathname.startsWith(ADMIN_API) && session.role !== 'admin') {
      return NextResponse.json({ error: 'You do not have permission to do that.' }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname === '/login' || pathname === '/register') {
    if (session) return NextResponse.redirect(new URL('/dashboard', req.url));
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', safeNext(pathname + search));
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith(ADMIN_PAGES) && session.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/search/:path*', '/watchlists/:path*', '/alerts/:path*', '/admin/:path*', '/api/:path*', '/login', '/register'],
};
