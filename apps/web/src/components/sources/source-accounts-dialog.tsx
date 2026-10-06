"use client";

import { useState } from "react";
import { Plus, Save, Settings2, Trash2 } from "lucide-react";
import { AccountDialog } from "@/components/sources/account-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyableValue, CopyButton } from "@/components/ui/copy-button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  useDeleteSourceAccount,
  useSourceAccounts,
  useUpdateSourceAccount,
} from "@/lib/queries/integrations";
import { Select } from "@/components/ui/select";
import type { SourceItem } from "@/lib/types";

export interface SourceAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceItem | null;
}

/** Inbound accounts for one source: public URL, provider, requirements, removal. */
export function SourceAccountsDialog({ open, onOpenChange, source }: SourceAccountsDialogProps) {
  const { toast } = useToast();
  const sourceId = source?.id ?? null;
  const accounts = useSourceAccounts(sourceId, open);
  const remove = useDeleteSourceAccount();
  const update = useUpdateSourceAccount();

  const [accountDialog, setAccountDialog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState("generic");
  const [requiredFields, setRequiredFields] = useState<string[]>([]);

  const doDelete = async (accountId: string) => {
    try {
      await remove.mutateAsync(accountId);
      toast({ title: "Account deleted", variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete account", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  const rows = accounts.data ?? [];
  const examplePayload = JSON.stringify(
    {
      externalLeadId: "DIRECT-TEST-001",
      name: "Arun Kumar",
      email: "arun@example.com",
      phone: "+919876543210",
      city: "Chennai",
      state: "Tamil Nadu",
      budget: 7500000,
      project: "DCT Residency",
    },
    null,
    2,
  );

  const beginEdit = (account: (typeof rows)[number]) => {
    const config = account.config ?? {};
    setProvider(typeof config.provider === "string" ? config.provider : "generic");
    setRequiredFields(Array.isArray(config.requiredFields) ? config.requiredFields.filter((v): v is string => typeof v === "string") : []);
    setEditingAccount(account.id);
  };

  const saveSettings = async (accountId: string) => {
    const account = rows.find((row) => row.id === accountId);
    if (!account) return;
    try {
      await update.mutateAsync({
        accountId,
        config: { ...(account.config ?? {}), provider, requiredFields },
      });
      setEditingAccount(null);
      toast({ title: "Webhook settings saved", variant: "success" });
    } catch (err) {
      toast({ title: "Could not save settings", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Inbound accounts — {source?.name ?? ""}</DialogTitle>
            <DialogDescription>
              Send a POST request to this URL with your lead data. Middleware will automatically
              process and create the lead.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {accounts.data ? `${rows.length} account${rows.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
            <Button size="sm" variant="outline" onClick={() => setAccountDialog(true)}>
              <Plus /> New account
            </Button>
          </div>

          {accounts.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          ) : null}

          {accounts.error ? (
            <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
          ) : null}

          {!accounts.isLoading && !accounts.error && rows.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              description="Create an account to get a webhook URL."
            />
          ) : null}

          {rows.length > 0 ? (
            <ul className="space-y-3">
              {rows.map((account) => (
                <li key={account.id} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
                        <span>created {formatDateTime(account.createdAt)} · public id</span>
                        <span className="font-mono">{account.publicId}</span>
                        <CopyButton
                          value={account.publicId}
                          size="icon-sm"
                          variant="ghost"
                          className="size-5 [&>svg]:size-3"
                          aria-label="Copy public ID"
                          onCopied={() => toast({ title: "Public ID copied", variant: "success" })}
                        />
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => beginEdit(account)}>
                        <Settings2 /> Configure
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete account"
                        onClick={() => setPendingDelete(account.id)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">Webhook URL</p>
                    <CopyableValue
                      value={account.webhookUrl}
                      onCopied={() => toast({ title: "Webhook URL copied", variant: "success" })}
                    />
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Method: <span className="font-medium text-foreground">POST</span>
                    {" · "}Provider: {String(account.config?.provider ?? "generic")}
                    {" · "}Required: {Array.isArray(account.config?.requiredFields) && account.config.requiredFields.length
                      ? account.config.requiredFields.join(", ")
                      : "none"}
                  </p>

                  {editingAccount === account.id ? (
                    <div className="mt-3 space-y-3 rounded-md border border-border p-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium">Provider</label>
                        <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
                          <option value="generic">Generic</option>
                          <option value="meta">Meta</option>
                          <option value="google">Google</option>
                          <option value="linkedin">LinkedIn</option>
                          <option value="tiktok">TikTok</option>
                        </Select>
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="text-[11px] font-medium">Required fields</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {["name", "email", "phone"].map((field) => (
                            <label key={field} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={requiredFields.includes(field)}
                                onChange={(event) =>
                                  setRequiredFields((current) =>
                                    event.target.checked
                                      ? [...current, field]
                                      : current.filter((item) => item !== field),
                                  )
                                }
                              />
                              {field}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingAccount(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => void saveSettings(account.id)} disabled={update.isPending}>
                          <Save /> Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
            <div>
              <p className="text-xs font-medium">Lead fields</p>
              <p className="text-[11px] text-muted-foreground">Automatically detected and mapped where possible; provider-specific and unknown fields are retained.</p>
            </div>
            <div>
              <p className="text-xs font-medium">Example payload</p>
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] text-foreground">{examplePayload}</pre>
              <CopyButton
                value={examplePayload}
                label="Copy example payload"
                onCopied={() => toast({ title: "Example payload copied", variant: "success" })}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {source ? (
        <AccountDialog
          open={accountDialog}
          onOpenChange={setAccountDialog}
          sourceId={source.id}
          sourceName={source.name}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete account?"
        description="The webhook URL stops working immediately. Accounts that still have leads attached cannot be deleted."
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={() => doDelete(pendingDelete ?? "")}
      />
    </>
  );
}
