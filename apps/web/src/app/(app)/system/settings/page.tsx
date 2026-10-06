"use client";

import { type ReactNode } from "react";
import { CheckCircle2, Server, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useHealth } from "@/lib/queries/core";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const health = useHealth();

  const checks = Object.entries(health.data?.checks ?? {});

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Settings"
        description="Your account and live system health."
      />

      <div className="space-y-4">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserRound className="size-4" /> Your account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Row label="Email" value={user?.email ?? "—"} />
              <Row label="Name" value={user?.name ?? "—"} />
              <Row label="Role" value={user ? <Badge variant="outline">{user.role}</Badge> : "—"} />
              <Row
                label="Permissions"
                value={<span className="tabular-nums">{formatNumber(user?.permissions.length)}</span>}
              />
            </div>
          </CardContent>
        </Card>

        {/* Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4" /> System health
            </CardTitle>
            <CardDescription>
              {health.data
                ? `Version ${health.data.version ?? "—"} · up ${formatNumber(health.data.uptimeSec)}s`
                : "Live API health probe."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Skeleton className="h-16" />
            ) : health.error ? (
              <p className="text-xs text-destructive">{errorMessage(health.error)}</p>
            ) : (
              <div className="space-y-1.5">
                {checks.map(([name, check]) => (
                  <div key={name} className="flex items-center justify-between gap-4 text-xs">
                    <span className="flex items-center gap-2 font-mono">
                      {check.ok ? (
                        <CheckCircle2 className="size-3.5 text-success" />
                      ) : (
                        <span className="size-2 rounded-full bg-destructive" />
                      )}
                      {name}
                    </span>
                    <span className="text-muted-foreground">
                      {check.ok
                        ? `${formatNumber(check.latencyMs)}ms`
                        : (check.error ?? "unhealthy")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
