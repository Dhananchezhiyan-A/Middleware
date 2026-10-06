import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Full-viewport loading placeholder (auth bootstrap, route transitions). */
export function FullScreenLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="relative size-9">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export function PageLoading({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[50vh] items-center justify-center", className)}>
      <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}
