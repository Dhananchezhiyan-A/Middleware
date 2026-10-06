"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { useCreateRole, useRolePermissions, useUpdateRole } from "@/lib/queries/system";
import type { RoleListItem } from "@/lib/types";

export interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this (non-system) role. */
  role?: RoleListItem | null;
}

/** `leads:read` → group `leads` so the checkbox grid reads like the docs. */
function groupOf(permission: string): string {
  return permission.split(":")[0] ?? "other";
}

export function RoleDialog({ open, onOpenChange, role }: RoleDialogProps) {
  const editing = Boolean(role);
  const { toast } = useToast();
  const catalog = useRolePermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(role ? [...role.permissions] : []);
    setFormError(null);
  }, [open, role]);

  const groups = useMemo(() => {
    const items = catalog.data?.items ?? [];
    const map = new Map<string, string[]>();
    for (const permission of items) {
      const group = groupOf(permission);
      const list = map.get(group);
      if (list) list.push(permission);
      else map.set(group, [permission]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog.data]);

  const toggle = (permission: string) => {
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    );
  };

  const applyTemplate = (template: string) => {
    const entry = catalog.data?.templates[template];
    if (entry) setSelected([...entry.permissions]);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Name is required (lowercase letters, numbers and dashes).");
      return;
    }
    if (selected.length === 0) {
      setFormError("Select at least one permission.");
      return;
    }
    setFormError(null);
    try {
      if (editing && role) {
        await updateRole.mutateAsync({
          id: role.id,
          name: trimmedName,
          description: description.trim() || undefined,
          permissions: selected,
        });
        toast({ title: "Role updated", description: trimmedName, variant: "success" });
      } else {
        await createRole.mutateAsync({
          name: trimmedName,
          description: description.trim() || undefined,
          permissions: selected,
        });
        toast({ title: "Role created", description: trimmedName, variant: "success" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save role", description: errorMessage(err), variant: "error" });
    }
  };

  const busy = createRole.isPending || updateRole.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit role — ${role?.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            Permissions are enforced server-side; this grid only decides what the role may do.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel label="Name" required hint="lowercase slug" />
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="billing-ops"
                disabled={editing && role?.isSystem}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Description" />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this role is for"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Permissions" required hint={`${selected.length} selected`} />
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(catalog.data?.templates ?? {}).map((template) => (
                <Button
                  key={template}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template)}
                >
                  {template} template
                </Button>
              ))}
            </div>
          </div>

          {catalog.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading permission catalog…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map(([group, permissions]) => (
                <div key={group} className="rounded-md border border-border p-3">
                  <p className="mb-2 font-mono text-[11px] font-semibold uppercase text-muted-foreground">
                    {group}
                  </p>
                  <ul className="space-y-1.5">
                    {permissions.map((permission) => (
                      <li key={permission}>
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-primary"
                            checked={selected.includes(permission)}
                            onChange={() => toggle(permission)}
                          />
                          <span className="font-mono">{permission}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
