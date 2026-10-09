"use client";

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from "react-hook-form";
import { DatePresets, DAY_NAMES, MONTH_NAMES, type DatePreset } from "@middleware/types";
import type { ReactNode } from "react";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ConditionFormValues } from "@/components/automation/conditions-editor";
import { useSourceAccounts, useSources } from "@/lib/queries/integrations";
import { cn } from "@/lib/utils";

export interface RoutingConstraintsProps {
  register: UseFormRegister<ConditionFormValues>;
  watch: UseFormWatch<ConditionFormValues>;
  setValue: UseFormSetValue<ConditionFormValues>;
  errors: FieldErrors<ConditionFormValues>;
}

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  before: "Before a date",
  after: "After a date",
  between: "Between two dates",
};

const RANGE_PRESETS = new Set<string>(["before", "after", "between"]);

function toggleNumber(list: number[], value: number): number[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return next.sort((a, b) => a - b);
}

function ChipToggle({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background/40 text-muted-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
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
 * source / source account, date, time window, months, weekdays plus the rule's
 * match mode (ALL/ANY) and routing mode (match-all vs stop-after-first).
 *
 * Date/time/month/day are evaluated in APP_TIMEZONE (server-side) — the
 * browser clock is never used for the decision.
 */
export function RoutingConstraints({
  register,
  watch,
  setValue,
  errors,
}: RoutingConstraintsProps) {
  const sources = useSources();
  const sourceId = watch("sourceId") || "";
  const accounts = useSourceAccounts(sourceId || null, Boolean(sourceId));
  const datePreset = watch("datePreset") || "";
  const months = watch("months") ?? [];
  const days = watch("days") ?? [];
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

      {/* --- Date --------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel label="Date" hint="in the application timezone" />
          <Select aria-label="Date filter" {...register("datePreset")}>
            <option value="">Any date</option>
            {DatePresets.map((preset) => (
              <option key={preset} value={preset}>
                {DATE_PRESET_LABELS[preset]}
              </option>
            ))}
          </Select>
          {errors.datePreset ? (
            <p className="text-[11px] text-destructive">{String(errors.datePreset.message)}</p>
          ) : null}
        </div>

        {RANGE_PRESETS.has(datePreset) ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <FieldLabel label="From" required={datePreset !== "after"} />
              <Input type="date" aria-label="Date from" {...register("dateFrom")} />
              {errors.dateFrom ? (
                <p className="text-[11px] text-destructive">{String(errors.dateFrom.message)}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="To" required={datePreset !== "before"} />
              <Input type="date" aria-label="Date to" {...register("dateTo")} />
              {errors.dateTo ? (
                <p className="text-[11px] text-destructive">{String(errors.dateTo.message)}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* --- Time window -------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel label="Time from" hint="09:00–18:00 window, app timezone" />
          <Input type="time" aria-label="Time from" {...register("timeFrom")} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel label="Time to" hint="wraps past midnight when later" />
          <Input type="time" aria-label="Time to" {...register("timeTo")} />
        </div>
      </div>
      {errors.timeFrom ? (
        <p className="text-[11px] text-destructive">{String(errors.timeFrom.message)}</p>
      ) : null}

      {/* --- Months / weekdays -------------------------------------------- */}
      <div className="space-y-2">
        <FieldLabel label="Months" hint="none selected = every month" />
        <div className="flex flex-wrap gap-1.5">
          {MONTH_NAMES.map((name, index) => {
            const value = index + 1;
            return (
              <ChipToggle
                key={name}
                ariaLabel={name}
                active={months.includes(value)}
                onClick={() => setValue("months", toggleNumber(months, value), { shouldDirty: true })}
              >
                {name.slice(0, 3)}
              </ChipToggle>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Weekdays" hint="ISO: Monday–Sunday, none = every day" />
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((name, index) => {
            const value = index + 1;
            return (
              <ChipToggle
                key={name}
                ariaLabel={name}
                active={days.includes(value)}
                onClick={() => setValue("days", toggleNumber(days, value), { shouldDirty: true })}
              >
                {name.slice(0, 3)}
              </ChipToggle>
            );
          })}
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
