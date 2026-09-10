"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { BadgeCheckIcon, MailWarningIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSkeleton, ErrorState, LoadingState, Spinner } from "@/components/common";
import { ResendVerification } from "@/components/auth";
import type { User } from "@/lib/api/types";
import { useSession } from "@/hooks/use-session";
import { useUpdateMe } from "@/hooks/use-account";
import { SettingsPanel } from "./section";
import { SettingsField, describedBy } from "./field";
import { formatAbsolute } from "./format";

/** The server trims this and caps it at 160 (`UpdateMeRequest.name`). */
const profileSchema = z.object({
  name: z.string().trim().max(160, "That name is too long (160 characters maximum)."),
});

type ProfileValues = z.infer<typeof profileSchema>;

/**
 * Who this account is: the address it signs in with, whether that address has
 * been confirmed, and the display name.
 *
 * The address itself is deliberately not editable. There is no route for it —
 * changing a sign-in identity safely needs confirmation at both addresses, and
 * this API does not offer that — so showing a disabled input would advertise a
 * capability that does not exist. It is rendered as the fact it is.
 */
export function ProfileForm() {
  const { user } = useSession();

  if (!user) {
    return (
      <LoadingState label="Loading your account">
        <CardSkeleton />
      </LoadingState>
    );
  }

  return (
    <div className="space-y-4">
      <IdentityPanel user={user} />
      <NameForm key={user.id} user={user} />
    </div>
  );
}

function IdentityPanel({ user }: { user: User }) {
  const created = formatAbsolute(user.created_at);

  return (
    <SettingsPanel className="px-4 py-3">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
        <dt className="text-muted-foreground text-sm">Email</dt>
        <dd className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm break-all">{user.email}</span>
            {user.email_verified ? (
              <span className="text-diff-added-foreground inline-flex items-center gap-1 text-xs font-medium">
                <BadgeCheckIcon aria-hidden="true" className="size-3.5" />
                Verified
              </span>
            ) : (
              <span className="text-warning-foreground inline-flex items-center gap-1 text-xs font-medium">
                <MailWarningIcon aria-hidden="true" className="size-3.5" />
                Not verified
              </span>
            )}
          </div>

          {!user.email_verified ? (
            <div className="bg-warning text-warning-foreground border-warning-border/70 space-y-2.5 rounded-md border px-2.5 py-2 text-xs">
              <p className="text-pretty">
                {user.verification_required
                  ? "This server requires a confirmed address before you can tailor or save anything, so nothing else will work until you open the link."
                  : "This server does not require a confirmed address, so everything still works — confirming it just proves the address is reachable."}
              </p>
              {/* Owned by the auth feature and reused verbatim: it is the same
                  action the global banner links here for, and it already tells
                  the truth about a server with no mail transport. */}
              <ResendVerification />
            </div>
          ) : null}
        </dd>

        {created ? (
          <>
            <dt className="text-muted-foreground text-sm">Member since</dt>
            <dd className="text-sm">{created}</dd>
          </>
        ) : null}
      </dl>
    </SettingsPanel>
  );
}

function NameForm({ user }: { user: User }) {
  const updateMe = useUpdateMe();
  const [failure, setFailure] = React.useState<unknown>(null);

  const serverName = user.name ?? "";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: serverName },
  });

  React.useEffect(() => {
    reset({ name: serverName });
  }, [serverName, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      // ONLY `name` travels. `default_provider` and `default_model` are omitted
      // on purpose: an absent key means "leave it alone" to backend/app/auth.py, which
      // is exactly what a rename should do to settings it has no opinion about.
      // Sending them as null here would silently wipe the tailoring defaults.
      await updateMe.mutateAsync({ name: values.name.trim() });
      toast.success("Saved your display name");
    } catch (error) {
      setFailure(error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <SettingsField
        id="display-name"
        label="Display name"
        error={errors.name?.message}
        hint="Shown in the header and on your account menu. Leave it blank to remove it."
        className="max-w-md"
      >
        <Input
          {...register("name")}
          id="display-name"
          autoComplete="name"
          placeholder="Your name"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("display-name", {
            error: errors.name,
            hint: true,
          })}
        />
      </SettingsField>

      {failure ? (
        <ErrorState error={failure} title="Could not save your name" />
      ) : null}

      <Button type="submit" size="sm" disabled={!isDirty || isSubmitting}>
        {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
        Save name
      </Button>
    </form>
  );
}
