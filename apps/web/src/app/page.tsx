"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoading } from "@/components/loading";
import { useAuth } from "@/lib/auth";

/**
 * "/" → /dashboard when authenticated, /login otherwise.
 */
export default function IndexPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return <FullScreenLoading />;
}
