"use client";

import { useFieldArray, type Control, type FieldErrors, type UseFormRegister, type UseFormWatch } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { RuleOperators } from "@middleware/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { operatorNeedsValue, operatorTakesList } from "@/lib/rule-condition";

/** Dotted paths the worker's condition engine can resolve. */
export const FIELD_SUGGESTIONS = [
  "score",
  "canonical.email",
  "canonical.phone",
  "canonical.name.first",
  "canonical.name.last",
  "canonical.city",
  "canonical.state",
  "canonical.country",
  "canonical.budget",
  "canonical.project",
  "source.type",
  "source.code",
  "custom.budget",
];

export interface ConditionFormRow {
  field: string;
  operator: string;
  value: string;
}

export interface ConditionFormValues {
  name: string;
  description: string;
  priority: string;
  enabled: boolean;
  stopOnMatch: boolean;
  conditions: ConditionFormRow[];
  destinationIds: string[];
}

export interface ConditionsEditorProps {
  control: Control<ConditionFormValues>;
  register: UseFormRegister<ConditionFormValues>;
  watch: UseFormWatch<ConditionFormValues>;
  errors: FieldErrors<ConditionFormValues>;
  maxRows?: number;
}

/** Ordered condition builder: field → operator → value, one row per condition. */
export function ConditionsEditor({
  control,
  register,
  watch,
  errors,
  maxRows = 20,
}: ConditionsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "conditions" });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">
          Conditions <span className="font-normal text-muted-foreground">(all must match)</span>
        </p>
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
        const operator = watch(`conditions.${index}.operator`) ?? "EQ";
        const needsValue = operatorNeedsValue(operator);
        const takesList = operatorTakesList(operator);
        const fieldError = errors.conditions?.[index]?.field?.message;
        const valueError = errors.conditions?.[index]?.value?.message;

        return (
          <div
            key={row.id}
            className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background/40 p-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          >
            <div className="space-y-1">
              <Input
                list="condition-fields"
                placeholder="canonical.city"
                aria-label={`Condition ${index + 1} field`}
                {...register(`conditions.${index}.field`)}
              />
              {fieldError ? <p className="text-[11px] text-destructive">{fieldError}</p> : null}
            </div>

            <Select aria-label={`Condition ${index + 1} operator`} {...register(`conditions.${index}.operator`)}>
              {RuleOperators.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>

            <div className="space-y-1">
              {needsValue ? (
                <Input
                  placeholder={takesList ? "value1, value2" : "value"}
                  aria-label={`Condition ${index + 1} value`}
                  {...register(`conditions.${index}.value`)}
                />
              ) : (
                <div className="flex h-9 items-center px-3 text-xs text-muted-foreground">
                  no value required
                </div>
              )}
              {valueError ? <p className="text-[11px] text-destructive">{valueError}</p> : null}
            </div>

            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove condition ${index + 1}`}
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
