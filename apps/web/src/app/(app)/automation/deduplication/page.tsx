"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { MatchedFields } from "@middleware/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useDedup, useSaveDedup } from "@/lib/queries/automation";

const STRATEGY_HINTS: Record<string, string> = {
  EXTERNAL_ID: "Same external id = duplicate.",
  PHONE: "Same phone number = duplicate.",
  EMAIL: "Same email address = duplicate.",
  PHONE_EMAIL: "Same phone AND email = duplicate.",
  CUSTOM: "Compare the custom match fields listed below.",
};

export default function DeduplicationPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const config = useDedup();
  const save = useSaveDedup();
  const canWrite = can("dedup:write");

  const [enabled, setEnabled] = useState(true);
  const [strategy, setStrategy] = useState<string>("EXTERNAL_ID");
  const [matchFields, setMatchFields] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.data) return;
    setEnabled(config.data.enabled);
    setStrategy(config.data.strategy);
    setMatchFields(config.data.matchFields.join(", "));
  }, [config.data]);

  const submit = async () => {
    const fields = matchFields
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (fields.length > 10) {
      setFormError("At most 10 match fields.");
      return;
    }
    setFormError(null);
    try {
      await save.mutateAsync({ enabled, strategy, matchFields: fields });
      toast({ title: "Deduplication saved", description: strategy, variant: "success" });
    } catch (err) {
      toast({ title: "Could not save settings", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Deduplication"
        description="Decide when an incoming lead counts as a duplicate. Duplicates are kept and linked — never silently dropped."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Match strategy</CardTitle>
          <CardDescription>
            Applied during the DEDUPLICATION stage, before routing. Existing duplicates remain
            browsable under Leads → Duplicates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {config.isLoading ? (
            <Skeleton className="h-40" />
          ) : config.error ? (
            <p className="text-xs text-destructive">{errorMessage(config.error)}</p>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={enabled}
                  disabled={!canWrite}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Deduplication enabled
              </label>

              <div className="space-y-1.5">
                <FieldLabel label="Strategy" required hint={STRATEGY_HINTS[strategy]} />
                <Select
                  value={strategy}
                  onChange={(event) => setStrategy(event.target.value)}
                  disabled={!canWrite}
                >
                  {MatchedFields.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <FieldLabel
                  label="Custom match fields"
                  hint="comma-separated lead fields — only used with the CUSTOM strategy (max 10)"
                />
                <Input
                  value={matchFields}
                  onChange={(event) => setMatchFields(event.target.value)}
                  disabled={!canWrite || strategy !== "CUSTOM"}
                  placeholder="company_domain, zip_code"
                  className="font-mono text-xs"
                />
              </div>

              {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}

              <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                <p className="text-[11px] text-muted-foreground">
                  {config.data?.updatedAt
                    ? `Last saved ${formatDateTime(config.data.updatedAt)}`
                    : "Not saved yet in this session."}
                </p>
                {canWrite ? (
                  <Button size="sm" onClick={() => void submit()} disabled={save.isPending}>
                    <Save /> {save.isPending ? "Saving…" : "Save"}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
