"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={
        className ??
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
      }
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <div className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, title = "Something went wrong", onRetry, className }: ErrorStateProps) {
  const message = errorMessage(error, "The request could not be completed.");
  const requestId =
    error && typeof error === "object" && "requestId" in error
      ? String((error as { requestId?: unknown }).requestId ?? "")
      : "";

  return (
    <div
      className={
        className ??
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
      }
      role="alert"
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md break-words text-xs leading-relaxed text-muted-foreground">{message}</p>
      {requestId ? (
        <p className="font-mono text-[11px] text-muted-foreground">requestId: {requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}
