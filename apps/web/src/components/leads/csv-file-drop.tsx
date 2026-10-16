"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CsvFileDropProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  /** True while the picked file is being read/validated. */
  busy?: boolean;
  /** Validation message for the file that was picked (null = none). */
  error?: string | null;
}

/**
 * Drag & drop + click-to-browse picker for a CSV file.
 *
 * The file is only READ here — the actual upload happens after the user has
 * reviewed the preview and confirmed the column mapping.
 */
export function CsvFileDrop({ onFile, disabled = false, busy = false, error }: CsvFileDropProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file: File | null | undefined) => {
    if (file && !disabled) onFile(file);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Choose a CSV file to import"
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) accept(event.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors",
          "hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          dragging && "border-primary bg-primary/5",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <FileSpreadsheet className="size-5" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Drop a CSV file here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          .csv · UTF-8 · up to 10 MB and 100,000 rows · nothing is imported until you confirm
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,application/vnd.ms-excel"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          accept(event.target.files?.[0] ?? null);
          // Allow re-picking the same file (which re-runs validation).
          event.target.value = "";
        }}
      />

      {busy ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading file…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
