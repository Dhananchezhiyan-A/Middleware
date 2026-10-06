"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { SourceTypes } from "@middleware/types";
import { sourceCreateSchema, sourceUpdateSchema } from "@middleware/validation";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SourceIdValue } from "@/components/sources/source-id-value";
import { errorMessage } from "@/lib/api";
import { useCreateSource, useUpdateSource } from "@/lib/queries/integrations";
import type { SourceItem } from "@/lib/types";

type CreateValues = z.input<typeof sourceCreateSchema>;

export interface SourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this source (name/config only). */
  source?: SourceItem | null;
}

export function SourceDialog({ open, onOpenChange, source }: SourceDialogProps) {
  const editing = Boolean(source);
  const { toast } = useToast();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const [configText, setConfigText] = useState("{}");
  const [configError, setConfigError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    // The resolver schema differs between create and update; both validate the
    // same form shape, so the small cast keeps react-hook-form's generics happy.
    resolver: zodResolver(
      editing ? sourceUpdateSchema : sourceCreateSchema,
    ) as unknown as Resolver<CreateValues>,
    defaultValues: { type: "WEBHOOK", code: "", name: "", config: {} },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing && source
        ? { name: source.name }
        : { type: "WEBHOOK", code: "", name: "", config: {} },
    );
    setConfigText(source?.config ? JSON.stringify(source.config, null, 2) : "{}");
    setConfigError(null);
  }, [open, editing, source, reset]);

  const parseConfig = (): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(configText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setConfigError("Config must be a JSON object.");
        return null;
      }
      setConfigError(null);
      return parsed as Record<string, unknown>;
    } catch {
      setConfigError("Invalid JSON.");
      return null;
    }
  };

  const onSubmit = handleSubmit(async (values: CreateValues) => {
    const config = parseConfig();
    if (!config) return;
    try {
      if (editing && source) {
        await updateSource.mutateAsync({ id: source.id, name: values.name, config });
        toast({ title: "Source updated", description: source.name, variant: "success" });
      } else {
        await createSource.mutateAsync({
          type: String(values.type),
          code: String(values.code),
          name: String(values.name),
          config,
        });
        toast({ title: "Source created", description: values.name, variant: "success" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save source", description: errorMessage(err), variant: "error" });
    }
  });

  const busy = isSubmitting || createSource.isPending || updateSource.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit source" : "New source"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the display name and raw configuration for this source."
              : "A source is an inbound channel: webhook, API, form or file."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel label="Type" required />
              <Select disabled={editing} {...register("type")}>
                {SourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Code" required hint={editing ? "immutable" : "lowercase slug"} />
              <Input
                placeholder="google-ads-main"
                disabled={editing}
                {...register("code")}
              />
              {errors.code ? (
                <p className="text-[11px] text-destructive">{String(errors.code.message)}</p>
              ) : null}
            </div>
          </div>

          {editing && source ? (
            <div className="space-y-1.5">
              <FieldLabel label="Source ID" />
              <SourceIdValue id={source.id} />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <FieldLabel label="Name" required />
            <Input placeholder="Google Ads â€” Main account" {...register("name")} />
            {errors.name ? (
              <p className="text-[11px] text-destructive">{String(errors.name.message)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Config (JSON)" hint="stored as-is" />
            <Textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder="{}"
            />
            {configError ? <p className="text-[11px] text-destructive">{configError}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Savingâ€¦" : editing ? "Save changes" : "Create source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
