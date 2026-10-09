"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface ActiveFilterProps {
  /** Chips describing the filter carried over from the drill-down. */
  chips: string[];
  /** Path the filter is cleared to (query string dropped). */
  clearHref: string;
  label?: string;
  /** Also reset local toolbar state when the filter is cleared. */
  onClear?: () => void;
}

/**
 * Banner shown above list pages opened from a dashboard card so the applied
 * filter is always visible — "Active Filter: Received: Last 24 Hours".
 */
export function ActiveFilter({
  chips,
  clearHref,
  label = "Active Filter",
  onClear,
}: ActiveFilterProps) {
  const router = useRouter();
  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/35 bg-primary/5 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
        {label}
      </span>
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-md border border-primary/30 bg-background px-2 py-0.5 text-xs text-foreground"
        >
          {chip}
        </span>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-xs"
        onClick={() => {
          onClear?.();
          router.push(clearHref);
        }}
      >
        <X /> Clear filter
      </Button>
    </div>
  );
}
