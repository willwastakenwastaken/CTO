import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isProtectedPath,
  isPublicAuthPath,
  loginRedirectUrl,
} from "@/lib/auth/guards";

/**
 * Session refresh + route guard (Next.js 16 renamed `middleware.ts` to
 * `proxy.ts`; the export is `proxy` instead of `middleware`).
 *
 * - Refreshes the Supabase session cookies on every matched request.
 * - Unauthenticated users are redirected away from protected routes to
 *   /login?next=<path> so they return where they were headed.
 * - Authenticated users are redirected off /login and /signup to /home.
 *
 * Protected prefixes are also enforced (defense in depth) by
 * app/(protected)/layout.tsx.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "SignalDesk cannot start: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set. Copy .env.example and fill in both values (Supabase Project Settings -> API)."
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: use getUser() (not getSession()) so an expired access token is
  // refreshed and the returned user is verified against the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user) {
    if (isProtectedPath(pathname)) {
      return NextResponse.redirect(
        new URL(loginRedirectUrl(pathname), request.url)
      );
    }
    return response;
  }

  if (isPublicAuthPath(pathname)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/home";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/login",
    "/signup",
    "/forgot-password",
    "/home/:path*",
    "/prospects/:path*",
    "/calls/:path*",
    "/pipeline/:path*",
    "/coach/:path*",
    "/settings/:path*",
  ],
};
