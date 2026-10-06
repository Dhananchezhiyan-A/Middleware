"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ArrowRight, LockKeyhole, ShieldCheck, Waypoints } from "lucide-react";
import { loginSchema } from "@middleware/validation";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormValues = z.input<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { status, login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login({
        email: values.email,
        password: values.password,
      });
      router.push("/dashboard");
    } catch (err) {
      setFormError(errorMessage(err, "Unable to sign in."));
    }
  });

  const busy = isSubmitting || status === "loading";

  return (
    <div className="flex min-h-screen">
      {/* Brand panel ------------------------------------------------------- */}
      <aside className="relative hidden w-1/2 max-w-xl flex-col justify-between overflow-hidden border-r border-border bg-zinc-950 p-10 lg:flex">
        <div
          aria-hidden
          className="absolute -left-32 -top-32 size-[32rem] rounded-full bg-indigo-600/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -right-24 size-[26rem] rounded-full bg-sky-500/10 blur-3xl"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Waypoints className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Lead Integration &amp; Distribution Middleware
          </span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-zinc-50">
            Route every lead to the right destination — reliably.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Lead intake, validation, deduplication, scoring and delivery with full
            observability across the entire pipeline.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-zinc-300">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-indigo-400" />
              Server-side permission checks on every request
            </li>
            <li className="flex items-start gap-2.5">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-indigo-400" />
              Refresh tokens in httpOnly cookies — access tokens stay in memory
            </li>
            <li className="flex items-center gap-2.5">
              <Waypoints className="mt-0.5 size-4 shrink-0 text-indigo-400" />
              Deterministic routing rules, field mappings and delivery retries
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-zinc-500">
          © {new Date().getFullYear()} Lead Middleware — Phase 1
        </p>
      </aside>

      {/* Form --------------------------------------------------------------- */}
      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Waypoints className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Lead Middleware</span>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use your credentials to continue.
            </p>
          </div>

          {formError ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="email" label="Email" required />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={Boolean(errors.email)}
                className={cn(errors.email && "border-destructive focus-visible:ring-destructive")}
                {...register("email")}
              />
              {errors.email ? (
                <p className="text-[11px] text-destructive">{errors.email.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="password" label="Password" required />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                aria-invalid={Boolean(errors.password)}
                className={cn(
                  errors.password && "border-destructive focus-visible:ring-destructive",
                )}
                {...register("password")}
              />
              {errors.password ? (
                <p className="text-[11px] text-destructive">{errors.password.message}</p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              {!busy ? <ArrowRight /> : null}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Sessions are bound to this device. Signing out revokes the refresh token immediately.
          </p>
        </div>
      </main>
    </div>
  );
}
