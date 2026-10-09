"use client";

import {
  useFieldArray,
  type Control,
  type FieldArrayPath,
  type FieldErrors,
  type UseFormRegister,
  type UseFormWatch,
} from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  FIELD_SUGGESTIONS,
  operatorNeedsValue,
  operatorTakesList,
  operatorsForField,
} from "@/lib/rule-condition";

export interface ConditionFormRow {
  field: string;
  operator: string;
  value: string;
}

/**
 * Full routing-rule form state. Kept in one shape because react-hook-form's
 * Control/Register/Watch types are invariant — every editor below must see the
 * SAME type.
 */
export interface ConditionFormValues {
  name: string;
  description: string;
  priority: string;
  enabled: boolean;
  /** false = "all matching rules" (match-all), true = "stop after first match". */
  stopOnMatch: boolean;
  /** How the clauses below combine: ALL (AND) or ANY (OR). */
  match: "ALL" | "ANY";
  /** "" = any source. */
  sourceId: string;
  sourceAccountId: string;
  /** "" = no date constraint. */
  datePreset: string;
  dateFrom: string;
  dateTo: string;
  /** "" = no time window. */
  timeFrom: string;
  timeTo: string;
  /** 1..12, empty = any month. */
  months: number[];
  /** 1..7 Monday..Sunday, empty = any weekday. */
  days: number[];
  conditions: ConditionFormRow[];
  /** Nested OR groups — each group is one clause (any row inside may match). */
  anyGroups: ConditionFormRow[][];
  destinationIds: string[];
}

export interface ConditionsEditorProps {
  control: Control<ConditionFormValues>;
  register: UseFormRegister<ConditionFormValues>;
  watch: UseFormWatch<ConditionFormValues>;
  errors: FieldErrors<ConditionFormValues>;
  maxRows?: number;
}

interface ConditionRowsProps extends Omit<ConditionsEditorProps, "maxRows"> {
  /** RHF path of the row array: `"conditions"` or `"anyGroups.0"`. */
  name: FieldArrayPath<ConditionFormValues>;
  maxRows?: number;
  label: string;
}

/** Reads a row error from a nested path without repeating the path math. */
function rowError(
  errors: FieldErrors<ConditionFormValues>,
  name: FieldArrayPath<ConditionFormValues>,
  index: number,
): { field?: string; value?: string } {
  let node: unknown = errors;
  for (const segment of name.split(".")) {
    if (!node || typeof node !== "object") return {};
    node = (node as Record<string, unknown>)[segment];
  }
  const row = Array.isArray(node) ? node[index] : undefined;
  const typed = (row ?? {}) as { field?: { message?: string }; value?: { message?: string } };
  return { field: typed.field?.message, value: typed.value?.message };
}

/**
 * One ordered list of `field → operator → value` rows. The operator list is
 * filtered by the field's type (text/number/date/enum) so an invalid operator
 * can never be picked for the chosen field.
 */
function ConditionRows({
  control,
  register,
  watch,
  errors,
  name,
  maxRows = 20,
  label,
}: ConditionRowsProps) {
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= maxRows}
          onClick={() => append({ field: "", operator: "EQ", value: "" })}
        >
          <Plus /> Add condition
        </Button>
      </div>

      <datalist id="condition-fields">
        {FIELD_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No conditions — add at least one so the rule is explicit about when it fires.
        </p>
      ) : null}

      {fields.map((row, index) => {
        const fieldPath = `${name}.${index}.field` as FieldArrayPath<ConditionFormValues>;
        const operatorPath = `${name}.${index}.operator` as FieldArrayPath<ConditionFormValues>;
        const valuePath = `${name}.${index}.value` as FieldArrayPath<ConditionFormValues>;
        const fieldValue = String(watch(fieldPath) ?? "");
        const operator = String(watch(operatorPath) ?? "EQ");
        const needsValue = operatorNeedsValue(operator);
        const takesList = operatorTakesList(operator);
        const error = rowError(errors, name, index);

        return (
          <div
            key={row.id}
            className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background/40 p-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          >
            <div className="space-y-1">
              <Input
                list="condition-fields"
                placeholder="canonical.city"
                aria-label={`${label} ${index + 1} field`}
                {...register(fieldPath)}
              />
              {error.field ? <p className="text-[11px] text-destructive">{error.field}</p> : null}
            </div>

            <Select aria-label={`${label} ${index + 1} operator`} {...register(operatorPath)}>
              {operatorsForField(fieldValue, operator).map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>

            <div className="space-y-1">
              {needsValue ? (
                <Input
                  placeholder={takesList ? "value1, value2" : "value"}
                  aria-label={`${label} ${index + 1} value`}
                  {...register(valuePath)}
                />
              ) : (
                <div className="flex h-9 items-center px-3 text-xs text-muted-foreground">
                  no value required
                </div>
              )}
              {error.value ? <p className="text-[11px] text-destructive">{error.value}</p> : null}
            </div>

            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${label} ${index + 1}`}
                disabled={fields.length <= 1}
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A single OR group: any row inside may match; the group itself is one clause. */
function OrGroup({
  control,
  register,
  watch,
  errors,
  index,
  maxRows,
  onRemove,
}: {
  control: Control<ConditionFormValues>;
  register: UseFormRegister<ConditionFormValues>;
  watch: UseFormWatch<ConditionFormValues>;
  errors: FieldErrors<ConditionFormValues>;
  index: number;
  maxRows?: number;
  onRemove: () => void;
}) {
  const name = `anyGroups.${index}` as FieldArrayPath<ConditionFormValues>;
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          OR group {index + 1}
          <span className="ml-2 font-normal normal-case tracking-normal">
            any one of these rows may match
          </span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 /> Remove group
        </Button>
      </div>
      <ConditionRows
        control={control}
        register={register}
        watch={watch}
        errors={errors}
        name={name}
        maxRows={maxRows}
        label={`Group ${index + 1} conditions`}
      />
    </div>
  );
}

/**
 * Lead-field condition builder.
 *
 * - Top-level rows are combined with the rule's match mode (ALL → AND,
 *   ANY → OR).
 * - Each OR group is one clause: any row inside it may match.
 */
export function ConditionsEditor({
  control,
  register,
  watch,
  errors,
  maxRows = 20,
}: ConditionsEditorProps) {
  const { fields: groups, append: appendGroup, remove: removeGroup } = useFieldArray({
    control,
    name: "anyGroups",
  });
  const match = watch("match") ?? "ALL";

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-foreground">
        Lead conditions{" "}
        <span className="font-normal text-muted-foreground">
          {match === "ALL" ? "(all must match)" : "(any may match)"}
        </span>
      </p>

      <ConditionRows
        control={control}
        register={register}
        watch={watch}
        errors={errors}
        name="conditions"
        maxRows={maxRows}
        label="Conditions"
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">
            OR groups{" "}
            <span className="font-normal text-muted-foreground">
              (optional — each group is ONE clause)
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={groups.length >= 5}
            onClick={() => appendGroup([{ field: "", operator: "EQ", value: "" }])}
          >
            <Plus /> Add OR group
          </Button>
        </div>

        {groups.map((group, index) => (
          <OrGroup
            key={group.id}
            control={control}
            register={register}
            watch={watch}
            errors={errors}
            index={index}
            maxRows={maxRows}
            onRemove={() => removeGroup(index)}
          />
        ))}
      </div>
    </div>
  );
}
