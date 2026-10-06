"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RuleOperators, type RuleOperator } from "@middleware/types";
import {
  ConditionsEditor,
  type ConditionFormValues,
} from "@/components/automation/conditions-editor";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { normalizeConditions, operatorNeedsValue, operatorTakesList } from "@/lib/rule-condition";
import { useCreateRoutingRule, useUpdateRoutingRule } from "@/lib/queries/automation";
import { useDestinations } from "@/lib/queries/integrations";
import type { RoutingRule } from "@/lib/types";

const ruleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(1000),
  priority: z
    .string()
    .regex(/^\d+$/, "Whole number required")
    .refine((v) => Number(v) >= 1 && Number(v) <= 10_000, "Between 1 and 10000"),
  enabled: z.boolean(),
  stopOnMatch: z.boolean(),
  conditions: z
    .array(
      z.object({
        field: z.string().trim().min(1, "Field is required").max(120),
        operator: z.enum(RuleOperators),
        value: z.string().max(500),
      }),
    )
    .min(1, "Add at least one condition")
    .max(20),
  destinationIds: z.array(z.string().min(1)).min(1, "Select at least one destination"),
});

/**
 * Form state is deliberately the editor's own shape (`operator: string`) rather
 * than `z.input<typeof ruleSchema>` (which narrows `operator` to the enum
 * union): react-hook-form's Control/Register/Watch types are invariant, so the
 * two must be the SAME type for `<ConditionsEditor>` to accept them. The zod
 * schema still validates on submit — the resolver below is cast for that.
 */
type RuleForm = ConditionFormValues;

export interface RoutingRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this rule (PATCH bumps its version). */
  rule?: RoutingRule | null;
}

export function RoutingRuleDialog({ open, onOpenChange, rule }: RoutingRuleDialogProps) {
  const editing = Boolean(rule);
  const { toast } = useToast();
  const destinations = useDestinations();
  const createRule = useCreateRoutingRule();
  const updateRule = useUpdateRoutingRule();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema) as unknown as Resolver<RuleForm>,
    defaultValues: {
      name: "",
      description: "",
      priority: "100",
      enabled: true,
      stopOnMatch: true,
      conditions: [{ field: "", operator: "EQ", value: "" }],
      destinationIds: [],
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    const existingConditions = rule ? normalizeConditions(rule.conditions) : [];
    reset(
      rule
        ? {
            name: rule.name,
            description: rule.description ?? "",
            priority: String(rule.priority),
            enabled: rule.enabled,
            stopOnMatch: rule.stopOnMatch,
            conditions: existingConditions.length > 0
              ? existingConditions.map((c) => ({
                  field: c.field,
                  operator: c.operator,
                  value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? ""),
                }))
              : [{ field: "", operator: "EQ" as const, value: "" }],
            destinationIds: rule.destinations.map((d) => d.id),
          }
        : {
            name: "",
            description: "",
            priority: "100",
            enabled: true,
            stopOnMatch: true,
            conditions: [{ field: "", operator: "EQ", value: "" }],
            destinationIds: [],
          },
    );
  }, [open, rule, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const missingValue = values.conditions.find(
      (c) => operatorNeedsValue(c.operator) && c.value.trim() === "",
    );
    if (missingValue) {
      setFormError(`"${missingValue.field || "unnamed"}" needs a value for ${missingValue.operator}.`);
      return;
    }
    setFormError(null);

    const conditions = values.conditions.map((c) => {
      const operator = c.operator as RuleOperator;
      const trimmed = c.value.trim();
      if (!operatorNeedsValue(operator)) return { field: c.field.trim(), operator };
      if (operatorTakesList(operator)) {
        return {
          field: c.field.trim(),
          operator,
          value: trimmed.split(",").map((part) => part.trim()).filter(Boolean),
        };
      }
      return { field: c.field.trim(), operator, value: trimmed };
    });

    const body = {
      name: values.name,
      description: values.description.trim() || undefined,
      enabled: values.enabled,
      priority: Number(values.priority),
      stopOnMatch: values.stopOnMatch,
      conditions,
      destinationIds: values.destinationIds,
    };

    try {
      if (editing && rule) {
        await updateRule.mutateAsync({ id: rule.id, ...body });
        toast({ title: "Routing rule updated", description: values.name, variant: "success" });
      } else {
        await createRule.mutateAsync(body);
        toast({ title: "Routing rule created", description: values.name, variant: "success" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save routing rule", description: errorMessage(err), variant: "error" });
    }
  });

  const busy = isSubmitting || createRule.isPending || updateRule.isPending;
  const destinationIds = watch("destinationIds") ?? [];

  const toggleDestination = (id: string, checked: boolean) => {
    const next = checked
      ? [...destinationIds.filter((value) => value !== id), id]
      : destinationIds.filter((value) => value !== id);
    setValue("destinationIds", next, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit routing rule" : "New routing rule"}</DialogTitle>
          <DialogDescription>
            Rules run in ascending priority order. Every condition must match (logical AND).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <FieldLabel label="Name" required />
              <Input placeholder="High budget — route to CRM" {...register("name")} />
              {errors.name ? (
                <p className="text-[11px] text-destructive">{String(errors.name.message)}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Priority" required hint="1 runs first" />
              <Input type="number" min={1} max={10000} {...register("priority")} />
              {errors.priority ? (
                <p className="text-[11px] text-destructive">{String(errors.priority.message)}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Description" />
            <Textarea rows={2} placeholder="Optional context for other operators" {...register("description")} />
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Switch
                checked={watch("enabled")}
                onCheckedChange={(next) => setValue("enabled", next, { shouldDirty: true })}
                ariaLabel="Rule enabled"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Switch
                checked={watch("stopOnMatch")}
                onCheckedChange={(next) => setValue("stopOnMatch", next, { shouldDirty: true })}
                ariaLabel="Stop on match"
              />
              Stop evaluating after a match
            </label>
          </div>

          <ConditionsEditor control={control} register={register} watch={watch} errors={errors} />

          <div className="space-y-2">
            <FieldLabel label="Destinations" required hint="order is preserved" />
            {destinations.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading destinations…</p>
            ) : (destinations.data ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No destinations exist yet — create one under Integrations → Destinations.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(destinations.data ?? []).map((destination) => (
                  <label
                    key={destination.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-[var(--color-primary,#6366f1)]"
                      checked={destinationIds.includes(destination.id)}
                      onChange={(event) => toggleDestination(destination.id, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{destination.name}</span>
                      <span className="block text-muted-foreground">{destination.type}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.destinationIds ? (
              <p className="text-[11px] text-destructive">{String(errors.destinationIds.message)}</p>
            ) : null}
          </div>

          {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
