"use client";

import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { userCreateSchema, userUpdateSchema } from "@middleware/validation";
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
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { useCreateUser, useRoles, useUpdateUser } from "@/lib/queries/system";
import type { RoleListItem, UserListItem } from "@/lib/types";

type FormValues = z.input<typeof userCreateSchema> & { status?: string };

export interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this user (name/role/status only). */
  user?: UserListItem | null;
}

export function UserDialog({ open, onOpenChange, user }: UserDialogProps) {
  const editing = Boolean(user);
  const { user: me } = useAuth();
  const { toast } = useToast();
  const roles = useRoles();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // Create and update validate different shapes; one cast keeps RHF's
    // generics happy while each mode still gets its real schema.
    resolver: zodResolver(
      editing ? userUpdateSchema : userCreateSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: { email: "", name: "", password: "", roleId: "", status: "ACTIVE" },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing && user
        ? { name: user.name ?? "", roleId: user.role.id, status: user.status }
        : { email: "", name: "", password: "", roleId: "", status: "ACTIVE" },
    );
  }, [open, editing, user, reset]);

  const isSelf = editing && user !== null && user !== undefined && me?.id === user.id;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (editing && user) {
        await updateUser.mutateAsync({
          id: user.id,
          name: values.name ? String(values.name) : undefined,
          roleId: String(values.roleId),
          status: values.status as string,
        });
        toast({ title: "User updated", description: user.email, variant: "success" });
      } else {
        await createUser.mutateAsync({
          email: String(values.email),
          name: String(values.name),
          password: String(values.password),
          roleId: String(values.roleId),
        });
        toast({ title: "User created", description: String(values.email), variant: "success" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save user", description: errorMessage(err), variant: "error" });
    }
  });

  const busy = isSubmitting || createUser.isPending || updateUser.isPending;
  const roleOptions: RoleListItem[] = roles.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "New user"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Change the display name, role or status. Disabling your own account is refused by the API."
              : "Create a login with a role — permissions come from the role, never from the user."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {!editing ? (
            <>
              <div className="space-y-1.5">
                <FieldLabel label="Email" required />
                <Input type="email" placeholder="teammate@company.com" {...register("email")} />
                {errors.email ? (
                  <p className="text-[11px] text-destructive">{String(errors.email.message)}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <FieldLabel label="Password" required hint="12+ chars, upper + lower + digit" />
                <Input type="password" autoComplete="new-password" {...register("password")} />
                {errors.password ? (
                  <p className="text-[11px] text-destructive">{String(errors.password.message)}</p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel label="Name" required />
              <Input placeholder="Jane Doe" {...register("name")} />
              {errors.name ? (
                <p className="text-[11px] text-destructive">{String(errors.name.message)}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Role" required />
              <Select {...register("roleId")}>
                <option value="">Select a role…</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
              {errors.roleId ? (
                <p className="text-[11px] text-destructive">{String(errors.roleId.message)}</p>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <FieldLabel
                label="Status"
                hint={isSelf ? "you cannot disable your own account" : undefined}
              />
              <Select disabled={isSelf} {...register("status")}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INVITED">INVITED</option>
                <option value="DISABLED" disabled={isSelf}>
                  DISABLED
                </option>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
