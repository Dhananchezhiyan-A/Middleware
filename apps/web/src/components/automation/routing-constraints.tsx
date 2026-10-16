"use client";

import {
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from "react-hook-form";
import { FieldLabel } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ConditionFormValues } from "@/components/automation/conditions-editor";
import { useSourceAccounts, useSources } from "@/lib/queries/integrations";
import { cn } from "@/lib/utils";

export interface RoutingConstraintsProps {
  register: UseFormRegister<ConditionFormValues>;
  watch: UseFormWatch<ConditionFormValues>;
  setValue: UseFormSetValue<ConditionFormValues>;
}

function RadioRow({
  name,
  value,
  current,
  onChange,
  title,
  hint,
}: {
  name: string;
  value: string;
  current: string;
  onChange: () => void;
  title: string;
  hint?: string;
}) {
  const active = current === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs",
        active ? "border-primary bg-primary/10" : "border-border bg-background/40",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={active}
        onChange={onChange}
        className="mt-0.5 size-3.5 accent-[var(--color-primary,#6366f1)]"
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{title}</span>
        {hint ? <span className="block text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Non-lead-field constraints of a routing rule:
 * source / source account plus the rule's match mode (ALL/ANY) and routing
 * mode (match-all vs stop-after-first).
 */
export function RoutingConstraints({
  register,
  watch,
  setValue,
}: RoutingConstraintsProps) {
  const sources = useSources();
  const sourceId = watch("sourceId") || "";
  const accounts = useSourceAccounts(sourceId || null, Boolean(sourceId));
  const match = watch("match") ?? "ALL";
  const stopOnMatch = watch("stopOnMatch") ?? false;

  return (
    <div className="space-y-4">
      {/* --- Source ------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel label="Source" hint="any source when empty" />
          <Select
            aria-label="Source filter"
            {...register("sourceId")}
            disabled={sources.isLoading}
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
          <FieldLabel label="Source account" hint="requires a source" />
          <Select
            aria-label="Source account filter"
            {...register("sourceAccountId")}
            disabled={!sourceId || accounts.isLoading}
          >
            <option value="">Any account</option>
            {(accounts.data ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* --- Modes -------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel label="Condition match" hint="how the clauses above combine" />
          <div className="grid gap-2">
            <RadioRow
              name="routing-match"
              value="ALL"
              current={match}
              onChange={() => setValue("match", "ALL", { shouldDirty: true })}
              title="Match ALL (AND)"
              hint="Every clause must be true"
            />
            <RadioRow
              name="routing-match"
              value="ANY"
              current={match}
              onChange={() => setValue("match", "ANY", { shouldDirty: true })}
              title="Match ANY (OR)"
              hint="One clause being true is enough"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel label="Routing mode" hint="how this rule relates to the rest" />
          <div className="grid gap-2">
            <RadioRow
              name="routing-mode"
              value="all"
              current={stopOnMatch ? "stop" : "all"}
              onChange={() => setValue("stopOnMatch", false, { shouldDirty: true })}
              title="Match all applicable rules"
              hint="Every matching rule contributes its destinations"
            />
            <RadioRow
              name="routing-mode"
              value="stop"
              current={stopOnMatch ? "stop" : "all"}
              onChange={() => setValue("stopOnMatch", true, { shouldDirty: true })}
              title="Stop after first match"
              hint="Lower-priority rules are not evaluated"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
