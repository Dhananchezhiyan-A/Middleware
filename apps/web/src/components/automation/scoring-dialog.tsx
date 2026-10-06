"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { RuleOperators, type RuleOperator } from "@middleware/types";
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
import { useCreateScoring } from "@/lib/queries/automation";
import type { RuleCondition, ScoringRule } from "@/lib/types";

interface RuleDraft {
  label: string;
  field: string;
  operator: RuleOperator | "";
  value: string;
  points: string;
}

function emptyRule(): RuleDraft {
  return { label: "", field: "", operator: "", value: "", points: "" };
}

/** Array operators take comma-separated input; numeric comparisons coerce when possible. */
function conditionValue(operator: RuleOperator, raw: string): RuleCondition["value"] {
  const trimmed = raw.trim();
  if (operator === "IN" || operator === "NOT_IN") {
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (operator === "GT" || operator === "GTE" || operator === "LT" || operator === "LTE") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }
  if (operator === "EXISTS" || operator === "NOT_EXISTS") return null;
  return trimmed;
}

const NUMERIC_OPERATORS: ReadonlySet<string> = new Set(["GT", "GTE", "LT", "LTE"]);
const ARRAY_OPERATORS: ReadonlySet<string> = new Set(["IN", "NOT_IN"]);
const NULLARY_OPERATORS: ReadonlySet<string> = new Set(["EXISTS", "NOT_EXISTS"]);

export interface ScoringDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create a scoring rule set: named, versioned and immutable after creation. */
export function ScoringDialog({ open, onOpenChange }: ScoringDialogProps) {
  const { toast } = useToast();
  const create = useCreateScoring();

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<RuleDraft[]>([emptyRule()]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEnabled(true);
    setRules([emptyRule()]);
    setFormError(null);
  }, [open]);

  const update = (index: number, patch: Partial<RuleDraft>) => {
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const submit = async () => {
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const usable = rules.filter((rule) => rule.field.trim() || rule.label.trim());
    if (usable.length === 0) {
      setFormError("Add at least one rule.");
      return;
    }
    const built: ScoringRule[] = [];
    for (const [index, rule] of usable.entries()) {
      const label = rule.label.trim() || `${rule.field.trim()} ${rule.operator}`;
      if (!rule.field.trim()) {
        setFormError(`Rule ${index + 1}: the condition field is required.`);
        return;
      }
      if (!rule.operator) {
        setFormError(`Rule ${index + 1}: pick an operator.`);
        return;
      }
      const points = Number(rule.points);
      if (!Number.isInteger(points)) {
        setFormError(`Rule ${index + 1}: points must be a whole number.`);
        return;
      }
      if (
        !NULLARY_OPERATORS.has(rule.operator) &&
        !ARRAY_OPERATORS.has(rule.operator) &&
        !rule.value.trim()
      ) {
        setFormError(`Rule ${index + 1}: a comparison value is required.`);
        return;
      }
      built.push({
        id: `r-${Date.now()}-${index}`,
        label,
        condition: {
          field: rule.field.trim(),
          operator: rule.operator,
          value: conditionValue(rule.operator, rule.value),
        },
        points,
      });
    }
    setFormError(null);
    try {
      await create.mutateAsync({ name: name.trim(), enabled, rules: built });
      toast({ title: "Rule set created", description: name.trim(), variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not create rule set", description: errorMessage(err), variant: "error" });
    }
  };

  const busy = create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New scoring rule set</DialogTitle>
          <DialogDescription>
            Rules evaluate top to bottom and add points to the lead score. Creation is immutable —
            a new set becomes a new version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <FieldLabel label="Name" required />
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="inbound-qualified-v2"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enabled
            </label>
          </div>

          <div className="space-y-2">
            <FieldLabel label="Rules" required hint="label, condition and points" />
            {rules.map((rule, index) => {
              const nullary = rule.operator ? NULLARY_OPERATORS.has(rule.operator) : false;
              const arrayLike = rule.operator ? ARRAY_OPERATORS.has(rule.operator) : false;
              const numeric = rule.operator ? NUMERIC_OPERATORS.has(rule.operator) : false;
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_130px_1fr_76px_auto]"
                >
                  <Input
                    value={rule.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    placeholder="label"
                    aria-label={`Rule ${index + 1} label`}
                  />
                  <Input
                    value={rule.field}
                    onChange={(event) => update(index, { field: event.target.value })}
                    placeholder="company_size"
                    className="font-mono text-xs"
                    aria-label={`Rule ${index + 1} field`}
                  />
                  <Select
                    value={rule.operator}
                    onChange={(event) =>
                      update(index, { operator: event.target.value as RuleOperator | "" })
                    }
                    aria-label={`Rule ${index + 1} operator`}
                  >
                    <option value="">operator…</option>
                    {RuleOperators.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={nullary ? "" : rule.value}
                    onChange={(event) => update(index, { value: event.target.value })}
                    placeholder={
                      nullary
                        ? "— no value"
                        : arrayLike
                          ? "a, b, c"
                          : numeric
                            ? "number"
                            : "value"
                    }
                    disabled={nullary}
                    className="font-mono text-xs"
                    aria-label={`Rule ${index + 1} value`}
                  />
                  <Input
                    type="number"
                    value={rule.points}
                    onChange={(event) => update(index, { points: event.target.value })}
                    placeholder="pts"
                    className="text-right"
                    aria-label={`Rule ${index + 1} points`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove rule ${index + 1}`}
                    disabled={rules.length === 1}
                    onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRules((current) => [...current, emptyRule()])}
            >
              <Plus /> Add rule
            </Button>
          </div>

          {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create rule set"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
