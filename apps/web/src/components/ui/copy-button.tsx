"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  value: string;
  /** Show the label next to the icon (otherwise icon-only). */
  label?: string;
  /** Fires after the value is on the clipboard (e.g. show a success toast). */
  onCopied?: () => void;
}

export function CopyButton({ value, label, className, onCopied, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for insecure contexts.
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    onCopied?.();
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={cn(className)}
      aria-label={label ?? "Copy"}
      {...props}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </Button>
  );
}

/** Read-only mono value with a copy affordance. */
export function CopyableValue({
  value,
  display,
  className,
  onCopied,
}: {
  value: string;
  display?: string;
  className?: string;
  onCopied?: () => void;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="truncate font-mono text-xs">{display ?? value}</span>
      <CopyButton
        value={value}
        size="icon-sm"
        variant="ghost"
        className="size-6 [&>svg]:size-3"
        onCopied={onCopied}
      />
    </span>
  );
}
