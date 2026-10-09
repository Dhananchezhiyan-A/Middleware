import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { EMPTY, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: number | null | undefined;
  icon: LucideIcon;
  hint?: string;
  tone?: "default" | "success" | "danger" | "warning";
  /** When set the card becomes a link that carries the metric's filter to a detail page. */
  href?: string;
}

const tones = {
  default: "bg-primary/12 text-primary",
  success: "bg-emerald-500/12 text-emerald-500",
  danger: "bg-red-500/12 text-red-500",
  warning: "bg-amber-500/12 text-amber-500",
} as const;

export function StatCard({ label, value, icon: Icon, hint, tone = "default", href }: StatCardProps) {
  const body = (
    <CardContent className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
          {value === null || value === undefined ? EMPTY : formatNumber(value)}
        </p>
        {hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tones[tone])}>
        <Icon className="size-4" />
      </span>
      {href ? (
        <ArrowUpRight
          className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary"
          aria-hidden
        />
      ) : null}
    </CardContent>
  );

  if (!href) return <Card>{body}</Card>;

  return (
    <Link
      href={href}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${label} — open details`}
    >
      <Card className="transition-colors group-hover:border-primary/45 group-hover:bg-accent/30">
        {body}
      </Card>
    </Link>
  );
}
