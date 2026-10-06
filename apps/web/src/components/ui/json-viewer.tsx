"use client";

import { prettyJson } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface JsonViewerProps {
  value: unknown;
  className?: string;
  /** Cap height with internal scrolling (default 24rem). */
  maxHeight?: string;
  emptyLabel?: string;
}

/** Pretty-printed, scrollable JSON block with mono font. */
export function JsonViewer({ value, className, maxHeight = "24rem", emptyLabel }: JsonViewerProps) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "object" && Object.keys(value as object).length === 0);

  if (isEmpty) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        {emptyLabel ?? "No data"}
      </div>
    );
  }

  return (
    <pre
      style={{ maxHeight }}
      className={cn(
        "overflow-auto scrollbar-thin rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {prettyJson(value)}
    </pre>
  );
}
