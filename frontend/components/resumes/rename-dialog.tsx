"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/common";
import { useRenameResume } from "@/hooks/use-resumes";
import { LIMITS } from "./resume-form";

const renameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A name is required.")
    .max(LIMITS.resumeName, `Keep it under ${LIMITS.resumeName} characters.`),
});

type RenameValues = z.infer<typeof renameSchema>;

/**
 * The form, mounted only while the dialog is open.
 *
 * Base UI unmounts a closed dialog's contents, so `useForm` re-initializes
 * from `defaultValues` on every open. That is what makes renaming a second
 * resume show *its* name rather than the previous one's, with no effect
 * watching the prop and re-seeding the form behind the user's back.
 */
function RenameForm({
  resume,
  onClose,
}: {
  resume: { id: string; name: string };
  onClose: () => void;
}) {
  const rename = useRenameResume();
  const form = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: resume.name },
  });
  const inputId = React.useId();
  const error = form.formState.errors.name?.message;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await rename.mutateAsync({ id: resume.id, name: values.name });
      toast.success("Renamed");
      onClose();
    } catch (thrown) {
      toast.error("Could not rename this resume", {
        description:
          thrown instanceof Error ? thrown.message : "Please try again.",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>Rename resume</DialogTitle>
        <DialogDescription>
          This is the name in your library. It does not appear in the PDF.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5 py-4">
        <Label htmlFor={inputId}>Name</Label>
        <Input
          id={inputId}
          autoFocus
          maxLength={LIMITS.resumeName}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...form.register("name")}
        />
        {error ? (
          <p
            id={`${inputId}-error`}
            role="alert"
            className="text-destructive text-xs"
          >
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={rename.isPending}>
          {rename.isPending ? <Spinner data-icon="inline-start" /> : null}
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

export interface RenameResumeDialogProps {
  /** The resume being renamed; `null` closes the dialog. */
  resume: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rename a resume.
 *
 * `PATCH /api/resumes/{id}` renames and nothing else — content changes go
 * through `PUT /content` and add a version, which a rename must not do. The
 * mutation is optimistic (see `useRenameResume`), so the list updates the
 * moment the request is away; a failure rolls the name back and says so.
 */
export function RenameResumeDialog({
  resume,
  onOpenChange,
}: RenameResumeDialogProps) {
  return (
    <Dialog open={Boolean(resume)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {resume ? (
          <RenameForm resume={resume} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
