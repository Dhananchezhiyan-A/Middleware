"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import { useCreateSourceAccount } from "@/lib/queries/integrations";

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  sourceName: string;
}

/** Creates an inbound account (webhook endpoint) under a source. */
export function AccountDialog({
  open,
  onOpenChange,
  sourceId,
  sourceName,
}: AccountDialogProps) {
  const { toast } = useToast();
  const create = useCreateSourceAccount();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("generic");
  const [requiredFields, setRequiredFields] = useState<string[]>(["name", "phone"]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setProvider("generic");
    setRequiredFields(["name", "phone"]);
  }, [open]);

  const submit = async () => {
    try {
      await create.mutateAsync({
        sourceId,
        name: name.trim(),
        config: { provider, requiredFields },
      });
      onOpenChange(false);
      toast({ title: "Account created", description: name.trim(), variant: "success" });
    } catch (err) {
      toast({ title: "Could not create account", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New inbound account</DialogTitle>
          <DialogDescription>
            An account under <span className="font-medium text-foreground">{sourceName}</span> has
            its own unguessable webhook URL. Providers can POST lead data directly to it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel label="Name" required hint="e.g. Meta — EU account" />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Meta — EU account"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Provider" />
            <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="generic">Generic</option>
              <option value="meta">Meta</option>
              <option value="google">Google</option>
              <option value="linkedin">LinkedIn</option>
              <option value="tiktok">TikTok</option>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Required lead fields</legend>
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
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Creating…" : <><Plus /> Create account</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
