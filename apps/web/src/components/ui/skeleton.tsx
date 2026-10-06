import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/** Table-shaped loading placeholder. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((__, col) => (
            <Skeleton
              key={col}
              className={cn("h-4", col === 0 ? "w-32" : col === cols - 1 ? "w-20" : "flex-1")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export { cva, type VariantProps };
