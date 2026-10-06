"use client";

import { useEffect, useMemo, useState } from "react";
import { DestinationTypes } from "@middleware/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { typeInfo } from "@/lib/destination-config";
import {
  useCreateDestination,
  useDestinationTypes,
  useUpdateDestination,
} from "@/lib/queries/integrations";
import type { DestinationItem } from "@/lib/types";

export interface DestinationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination?: DestinationItem | null;
}

interface ExtraState {
  text: string;
  error: string | null;
}

/** Create/edit a destination: named config fields + a JSON bag for the rest. */
export function DestinationDialog({ open, onOpenChange, destination }: DestinationDialogProps) {
  const editing = Boolean(destination);
  const { toast } = useToast();
  const create = useCreateDestination();
  const update = useUpdateDestination();
  const serverTypes = useDestinationTypes();

  const [type, setType] = useState<string>("WEBHOOK");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");
  const [rateLimit, setRateLimit] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<ExtraState>({ text: "{}", error: null });

  const activeType = editing ? (destination?.type ?? type) : type;
  const info = typeInfo(activeType);
  const requiredKeys = useMemo(
    () => serverTypes.data?.find((item) => item.type === activeType)?.requiredConfigKeys ?? [],
    [serverTypes.data, activeType],
  );

  useEffect(() => {
    if (!open) return;
    const config = destination?.config ?? {};
    const picked: Record<string, string> = {};
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      const field = info?.fields.find((f) => f.key === key);
      if (field) picked[key] = value === null || value === undefined ? "" : String(value);
      else rest[key] = value;
    }
    setType(destination?.type ?? "WEBHOOK");
    setName(destination?.name ?? "");
    setStatus(destination?.status ?? "ACTIVE");
    setRateLimit(
      destination?.rateLimitPerSec === null || destination?.rateLimitPerSec === undefined
        ? ""
        : String(destination.rateLimitPerSec),
    );
    setValues(picked);
    setExtra({ text: JSON.stringify(rest, null, 2), error: null });
  }, [open, destination, info]);

  const parseExtra = (): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(extra.text || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setExtra((s) => ({ ...s, error: "Additional config must be a JSON object." }));
        return null;
      }
      setExtra((s) => ({ ...s, error: null }));
      return parsed as Record<string, unknown>;
    } catch {
      setExtra((s) => ({ ...s, error: "Invalid JSON." }));
      return null;
    }
  };

  const submit = async () => {
    const rest = parseExtra();
    if (!rest) return;
    const config: Record<string, unknown> = { ...rest };
    for (const field of info?.fields ?? []) {
      const raw = values[field.key];
      if (raw === undefined || raw === "") continue;
      config[field.key] = coerce(field.key, raw);
    }

    try {
      if (editing && destination) {
        await update.mutateAsync({
          id: destination.id,
          name: name.trim(),
          status,
          config,
          rateLimitPerSec: rateLimit === "" ? null : Number(rateLimit),
        });
        toast({ title: "Destination updated", description: name, variant: "success" });
      } else {
        await create.mutateAsync({
          type,
          name: name.trim(),
          config,
          ...(rateLimit === "" ? {} : { rateLimitPerSec: Number(rateLimit) }),
        });
        toast({ title: "Destination created", description: name, variant: "success" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save destination", description: errorMessage(err), variant: "error" });
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit destination" : "New destination"}</DialogTitle>
          <DialogDescription>
            Destinations receive routed leads. Secrets are never part of this config — they go
            through the separate write-only credential form.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel label="Type" required hint={editing ? "immutable" : undefined} />
            <Select
              disabled={editing}
              value={activeType}
              onChange={(event) => setType(event.target.value)}
            >
              {DestinationTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel label="Name" required hint="must be unique" />
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Salesforce — Production" />
          </div>
          {editing ? (
            <div className="space-y-1.5">
              <FieldLabel label="Status" />
              <Select value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE")}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <FieldLabel label="Rate limit" hint="requests / second, blank = adapter default" />
            <Input
              inputMode="numeric"
              value={rateLimit}
              onChange={(event) => setRateLimit(event.target.value)}
              placeholder="—"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel label="Configuration" />
            {requiredKeys.length > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                required: <code className="font-mono">{requiredKeys.join(", ")}</code>
              </span>
            ) : null}
          </div>

          {info ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {info.fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <FieldLabel label={field.label} hint={field.hint} />
                  {field.options ? (
                    <Select
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((s) => ({ ...s, [field.key]: event.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={values[field.key] ?? ""}
                      placeholder={field.placeholder ?? "—"}
                      onChange={(event) =>
                        setValues((s) => ({ ...s, [field.key]: event.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <FieldLabel label="Additional config (JSON)" hint="merged into config" />
            <textarea
              value={extra.text}
              onChange={(event) => setExtra({ text: event.target.value, error: null })}
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {extra.error ? <p className="text-[11px] text-destructive">{extra.error}</p> : null}
          </div>

          {info ? (
            <p className="text-[11px] text-muted-foreground">
              Adapter docs: {info.fields.map((f) => f.key).join(", ")} · credential{" "}
              {info.credentialTypes.join(" / ")}
              {info.credentialRequired ? " (required)" : " (optional)"}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create destination"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Config values arrive as strings from inputs; keep JSON types sensible. */
function coerce(key: string, raw: string): unknown {
  if (key === "timeoutMs" || key === "rateLimitPerSec") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  return raw;
}
