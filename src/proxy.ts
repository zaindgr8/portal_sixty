import { NextResponse, type NextRequest } from 'next/server';
import { moduleForPath } from '@/lib/auth/modules';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';

// Twilio webhooks verify their own signature; the auth endpoint is how you sign in;
// sign-up and invite links are for people who don't have an account yet.
// /feeds/ are portal XML feeds (Bayut fetches them); the random token in the URL is their key.
// /api/proptech/cron checks CRON_SECRET itself. /api/ext/ is the Chrome extension, which signs in with its own pairing token (checked in each route).
const PUBLIC_PREFIXES = ['/api/auth', '/api/webhooks', '/api/signup', '/api/invite', '/feeds/', '/api/ext/', '/api/proptech/cron'];
const GUEST_PAGES = ['/login', '/signup', '/invite'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const user = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');

  if (GUEST_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // Signed-in people can still open an invite link (e.g. to accept it with a different account after signing out).
    return user && !pathname.startsWith('/invite') ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }
  if (!user) {
    if (isApi) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // The platform console is for platform admins only.
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
    if (user.platformAdmin) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: 'Platform admins only' }, { status: 403 });
    return NextResponse.redirect(new URL('/', req.url));
  }

  // Module access: a user only reaches the parts of the product they've been given.
  const mod = moduleForPath(pathname);
  if (mod && !user.modules.includes(mod)) {
    if (isApi) return NextResponse.json({ error: 'You do not have access to this module' }, { status: 403 });
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|logo.png|logo-mark.png).*)'],
};
