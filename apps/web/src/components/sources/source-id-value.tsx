"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function SourceIdValue({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const { toast } = useToast();

  const copy = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(id);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = id;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }
    }

    toast(
      copied
        ? { title: "Source ID copied", variant: "success" }
        : { title: "Could not copy Source ID", variant: "error" },
    );
  };

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        title={id}
      >
        {id}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy Source ID"
        title="Copy Source ID"
        onClick={() => void copy()}
      >
        <Copy />
      </Button>
    </div>
  );
}