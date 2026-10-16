"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DatePresets, RuleOperators, type RuleOperator } from "@middleware/types";
import {
  ConditionsEditor,
  type ConditionFormRow,
  type ConditionFormValues,
} from "@/components/automation/conditions-editor";
import { RoutingConstraints } from "@/components/automation/routing-constraints";
import {
  RoutingPreviewResult,
  type RoutingPreviewResultProps,
} from "@/components/automation/routing-preview";
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
import {
  normalizeConditions,
  operatorNeedsValue,
  operatorTakesList,
} from "@/lib/rule-condition";
import {
  useCreateRoutingRule,
  usePreviewRouting,
  useUpdateRoutingRule,
  type RoutingPreviewBody,
} from "@/lib/queries/automation";
import { useDestinations, useSources } from "@/lib/queries/integrations";
import { Select } from "@/components/ui/select";
import type { RoutingRule, StructuredRoutingConditions } from "@/lib/types";

const conditionRowSchema = z.object({
  field: z.string().trim().max(120),
  operator: z.enum(RuleOperators),
  value: z.string().max(500),
});

const ruleSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().max(1000),
    priority: z
      .string()
      .regex(/^\d+$/, "Whole number required")
      .refine((v) => Number(v) >= 1 && Number(v) <= 10_000, "Between 1 and 10000"),
    enabled: z.boolean(),
    stopOnMatch: z.boolean(),
    match: z.enum(["ALL", "ANY"]),
    sourceId: z.string(),
    sourceAccountId: z.string(),
    datePreset: z
      .string()
      .refine((v) => v === "" || (DatePresets as readonly string[]).includes(v), "Pick a date filter"),
    dateFrom: z.string(),
    dateTo: z.string(),
    timeFrom: z.string(),
    timeTo: z.string(),
    months: z.array(z.number().int().min(1).max(12)).max(12),
    days: z.array(z.number().int().min(1).max(7)).max(7),
    conditions: z.array(conditionRowSchema).max(20),
    anyGroups: z.array(z.array(conditionRowSchema).min(1).max(20)).max(5),
    destinationIds: z.array(z.string().min(1)).min(1, "Select at least one destination"),
  })
  .superRefine((values, ctx) => {
    const hasRow = (row: ConditionFormRow) => row.field.trim() !== "";
    const hasFieldCondition =
      values.conditions.some(hasRow) || values.anyGroups.some((group) => group.some(hasRow));
    const hasConstraint = Boolean(
      values.sourceId ||
        values.sourceAccountId ||
        values.datePreset ||
        (values.timeFrom && values.timeTo) ||
        values.months.length > 0 ||
        values.days.length > 0,
    );

    if (!hasFieldCondition && !hasConstraint) {
      ctx.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "Add at least one condition (source, date/time or lead field).",
      });
    }

    const needsFrom = values.datePreset === "before" || values.datePreset === "between";
    const needsTo = values.datePreset === "after" || values.datePreset === "between";
    if (needsFrom && !values.dateFrom) {
      ctx.addIssue({ code: "custom", path: ["dateFrom"], message: "From date is required" });
    }
    if (needsTo && !values.dateTo) {
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: "To date is required" });
    }

    if (Boolean(values.timeFrom) !== Boolean(values.timeTo)) {
      ctx.addIssue({
        code: "custom",
        path: ["timeTo"],
        message: "Set both time bounds (or neither)",
      });
    }

    const checkRows = (rows: ConditionFormRow[], path: (string | number)[]) => {
      rows.forEach((row, index) => {
        if (row.field.trim() === "") return;
        if (operatorNeedsValue(row.operator) && row.value.trim() === "") {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "value"],
            message: `Value required for ${row.operator}`,
          });
        }
      });
    };
    checkRows(values.conditions, ["conditions"]);
    values.anyGroups.forEach((group, index) => checkRows(group, ["anyGroups", index]));
  });

type RuleForm = ConditionFormValues;

export interface RoutingRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this rule (PATCH bumps its version). */
  rule?: RoutingRule | null;
  /** Set with `rule` to clone an existing rule into a brand new one. */
  duplicate?: boolean;
}

/* ------------------------------- form helpers ------------------------------ */

function toWire(row: ConditionFormRow) {
  const operator = row.operator as RuleOperator;
  const trimmed = row.value.trim();
  if (!operatorNeedsValue(operator)) return { field: row.field.trim(), operator };
  if (operatorTakesList(operator)) {
    return {
      field: row.field.trim(),
      operator,
      value: trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    };
  }
  return { field: row.field.trim(), operator, value: trimmed };
}

function toFormRows(list: unknown): ConditionFormRow[] {
  if (!Array.isArray(list)) return [];
  const rows = normalizeConditions(list);
  const mapped = rows
    .filter((row) => row.field.trim() !== "")
    .map((row) => ({
      field: row.field,
      operator: row.operator,
      value: Array.isArray(row.value) ? row.value.join(", ") : String(row.value ?? ""),
    }));
  return mapped.length > 0 ? mapped : [{ field: "", operator: "EQ", value: "" }];
}

function toFormGroups(value: unknown): ConditionFormRow[][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const groups = (value as { unknown?: unknown; anyGroups?: unknown }).anyGroups;
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((group) => Array.isArray(group))
    .map((group) => toFormRows(group))
    .filter((group) => group.some((row) => row.field.trim() !== ""));
}

/** Reads the two stored `conditions` shapes into flat form fields. */
function ruleToForm(rule: RoutingRule | null | undefined): RuleForm {
  const empty: RuleForm = {
    name: "",
    description: "",
    priority: "100",
    enabled: true,
    stopOnMatch: false,
    match: "ALL",
    sourceId: "",
    sourceAccountId: "",
    datePreset: "",
    dateFrom: "",
    dateTo: "",
    timeFrom: "",
    timeTo: "",
    months: [],
    days: [],
    conditions: [{ field: "", operator: "EQ", value: "" }],
    anyGroups: [],
    destinationIds: [],
  };
  if (!rule) return empty;

  const raw = rule.conditions;
  const structured =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as unknown as Record<string, unknown>)
      : null;
  const date = structured?.date as { preset?: string; from?: string; to?: string } | undefined;
  const time = structured?.time as { from?: string; to?: string } | undefined;
  const numbers = (value: unknown, max: number): number[] =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is number =>
            typeof entry === "number" && Number.isInteger(entry) && entry >= 1 && entry <= max,
        )
      : [];

  const rows = Array.isArray(raw) ? toFormRows(raw) : toFormRows(structured?.conditions);

  return {
    name: rule.name,
    description: rule.description ?? "",
    priority: String(rule.priority),
    enabled: rule.enabled,
    stopOnMatch: rule.stopOnMatch,
    match: structured?.match === "ANY" ? "ANY" : "ALL",
    sourceId: typeof structured?.sourceId === "string" ? structured.sourceId : "",
    sourceAccountId: typeof structured?.sourceAccountId === "string" ? structured.sourceAccountId : "",
    datePreset: typeof date?.preset === "string" ? date.preset : "",
    dateFrom: typeof date?.from === "string" ? date.from : "",
    dateTo: typeof date?.to === "string" ? date.to : "",
    timeFrom: typeof time?.from === "string" ? time.from : "",
    timeTo: typeof time?.to === "string" ? time.to : "",
    months: numbers(structured?.months, 12),
    days: numbers(structured?.days, 7),
    conditions: rows.length > 0 ? rows : [{ field: "", operator: "EQ", value: "" }],
    anyGroups: toFormGroups(structured),
    destinationIds: rule.destinations.map((destination) => destination.id),
  };
}

/** Form fields → the structured `conditions` JSON the API stores. */
function buildConditions(values: RuleForm): StructuredRoutingConditions {
  const conditions = values.conditions.filter((row) => row.field.trim() !== "").map(toWire);
  const anyGroups = values.anyGroups
    .map((group) => group.filter((row) => row.field.trim() !== "").map(toWire))
    .filter((group) => group.length > 0);

  const out: StructuredRoutingConditions = { match: values.match, conditions };
  if (values.sourceId) out.sourceId = values.sourceId;
  if (values.sourceAccountId) out.sourceAccountId = values.sourceAccountId;
  if (values.datePreset) {
    out.date = {
      preset: values.datePreset,
      ...(values.dateFrom ? { from: values.dateFrom } : {}),
      ...(values.dateTo ? { to: values.dateTo } : {}),
    };
  }
  if (values.timeFrom && values.timeTo) {
    out.time = { from: values.timeFrom, to: values.timeTo };
  }
  if (values.months.length > 0) out.months = values.months;
  if (values.days.length > 0) out.days = values.days;
  if (anyGroups.length > 0) out.anyGroups = anyGroups;
  return out;
}

/* -------------------------------- component -------------------------------- */

export function RoutingRuleDialog({
  open,
  onOpenChange,
  rule,
  duplicate = false,
}: RoutingRuleDialogProps) {
  const editing = Boolean(rule) && !duplicate;
  const { toast } = useToast();
  const destinations = useDestinations();
  const sources = useSources();
  const createRule = useCreateRoutingRule();
  const updateRule = useUpdateRoutingRule();
  const preview = usePreviewRouting();
  const [formError, setFormError] = useState<string | null>(null);

  // Sample lead used by the in-dialog preview.
  const [sampleSource, setSampleSource] = useState("");
  const [sampleEmail, setSampleEmail] = useState("");
  const [sampleScore, setSampleScore] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema) as unknown as Resolver<RuleForm>,
    defaultValues: ruleToForm(null),
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSampleSource(ruleToForm(rule).sourceId);
    setSampleEmail("");
    setSampleScore("");
    reset(ruleToForm(rule));
  }, [open, rule, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      preview.reset();
      setFormError(null);
    }
    onOpenChange(next);
  };

  const runPreview = async () => {
    const values = getValues();
    const body: RoutingPreviewBody = {
      rules: [
        {
          name: values.name.trim() || "Draft rule",
          priority: Number(values.priority) || 100,
          enabled: values.enabled,
          stopOnMatch: values.stopOnMatch,
          conditions: buildConditions(values),
          destinationIds: values.destinationIds,
        },
      ],
      receivedAt: new Date().toISOString(),
      ...(sampleSource ? { sourceId: sampleSource } : {}),
      ...(sampleEmail.trim() ? { canonical: { email: sampleEmail.trim() } } : {}),
      ...(sampleScore.trim() !== "" && Number.isFinite(Number(sampleScore))
        ? { score: Number(sampleScore) }
        : {}),
    };
    await preview.mutateAsync(body).catch(() => undefined);
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = {
      name: values.name,
      description: values.description.trim() || undefined,
      enabled: values.enabled,
      priority: Number(values.priority),
      stopOnMatch: values.stopOnMatch,
      conditions: buildConditions(values),
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

  const previewProps: RoutingPreviewResultProps = {
    preview: preview.data,
    isLoading: preview.isPending,
    error: preview.error,
    onRetry: () => void runPreview(),
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit routing rule" : duplicate ? "Duplicate routing rule" : "New routing rule"}
          </DialogTitle>
          <DialogDescription>
            Rules run in ascending priority order. Choose how clauses combine (ALL/ANY), then pick
            the destinations this rule delivers to.
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
            <Textarea
              rows={2}
              placeholder="Optional context for other operators"
              {...register("description")}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-foreground">
            <Switch
              checked={watch("enabled")}
              onCheckedChange={(next) => setValue("enabled", next, { shouldDirty: true })}
              ariaLabel="Rule enabled"
            />
            Enabled
          </label>

          <section className="space-y-3 rounded-md border border-border p-3">
            <header>
              <p className="text-xs font-semibold">When does this rule fire?</p>
            </header>
            <RoutingConstraints register={register} watch={watch} setValue={setValue} />
          </section>

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
                      <span className="block truncate font-medium text-foreground">
                        {destination.name}
                      </span>
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

          {/* --- Routing preview (same engine as the pipeline) ------------- */}
          <section className="space-y-2 rounded-md border border-dashed border-border p-3">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">Routing preview</p>
                <p className="text-[11px] text-muted-foreground">
                  Dry run against a sample lead — nothing is saved, queued or delivered.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={preview.isPending}
                onClick={() => void runPreview()}
              >
                {preview.isPending ? "Running…" : "Run preview"}
              </Button>
            </header>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <FieldLabel label="Sample source" />
                <Select
                  aria-label="Sample source"
                  value={sampleSource}
                  onChange={(event) => setSampleSource(event.target.value)}
                >
                  <option value="">Any source</option>
                  {(sources.data ?? []).map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <FieldLabel label="Sample email" />
                <Input
                  aria-label="Sample email"
                  placeholder="lead@example.com"
                  value={sampleEmail}
                  onChange={(event) => setSampleEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel label="Sample score" />
                <Input
                  aria-label="Sample score"
                  type="number"
                  placeholder="70"
                  value={sampleScore}
                  onChange={(event) => setSampleScore(event.target.value)}
                />
              </div>
            </div>

            <RoutingPreviewResult {...previewProps} />
          </section>

          {(errors.conditions as { message?: string } | undefined)?.message ? (
            <p className="text-[11px] text-destructive">
              {String((errors.conditions as { message?: string }).message)}
            </p>
          ) : null}
          {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : duplicate ? "Create duplicate" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
