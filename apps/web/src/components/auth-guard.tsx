"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoading } from "@/components/loading";
import { useAuth } from "@/lib/auth";

/**
 * Route protection for the (app) group.
 *
 * On mount the auth store mints an access token via POST /auth/refresh (httpOnly
 * cookie) and hydrates the user through GET /auth/me. Unauthenticated visitors
 * are redirected to /login.
 *
 * NOTE: this is UX-only. Every API route re-checks authentication and
 * permissions server-side.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "loading") return <FullScreenLoading label="Restoring your session…" />;
  if (status === "unauthenticated") return <FullScreenLoading label="Redirecting to sign in…" />;

  return <>{children}</>;
}
