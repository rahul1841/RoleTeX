"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { HistoryIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Spinner } from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import type { JdCreateRequest, JdDetail, JdUpdateRequest } from "@/lib/api/types";
import { useCreateJd, useUpdateJd } from "@/hooks/use-jds";
import { JdField, jdDescribedBy } from "./field";
import { describeJdFailure } from "./errors";
import {
  JD_MAX_REQUEST_BYTES,
  JD_TITLE_MAX,
  formatNumber,
  measureJd,
  requestBytes,
} from "./limits";
import { JdSizeAdvisory, JdSizeBar, JdSizeMeter } from "./jd-size-meter";
import { jdFormSchema, type JdFormValues } from "./schema";

export interface JdFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Present puts the dialog in edit mode. Absent creates.
   *
   * The whole `JdDetail` rather than an id, because edit mode diffs the draft
   * against the stored title and content to decide what to send.
   */
  jd?: JdDetail | null;
  /** Handed the saved record, so the caller can select or re-render it. */
  onSaved?: (jd: JdDetail) => void;
}

/**
 * Create or edit one job description.
 *
 * WHAT MAKES EDIT DIFFERENT FROM A NORMAL FORM: `PUT /api/jds/{id}` does not
 * overwrite. It archives the current revision, increments `version`, and prunes
 * the oldest archived snapshots past the server's per-JD cap (verified: with
 * the default cap of 20, the 23rd edit leaves versions 23…4 and silently drops
 * 1…3). Saving is closer to committing than to editing, so the dialog names the
 * version it is about to create rather than leaving the user to discover a
 * history they did not know they were writing.
 *
 * The form itself is a separate component mounted inside <DialogContent>. Base
 * UI's portal defaults to `keepMounted: false`, so it unmounts when the dialog
 * closes and mounts fresh when it reopens — which is how the draft is reset
 * without an effect that pokes state on every open. The two mutations stay out
 * here because the shell needs `isPending` to refuse to close over a save in
 * flight, and the form inside it is gone by the time that would matter.
 */
export function JdFormDialog({
  open,
  onOpenChange,
  jd,
  onSaved,
}: JdFormDialogProps) {
  const create = useCreateJd();
  const update = useUpdateJd();
  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A save is a round trip that may already have created a version;
        // closing over it would hide the result of a write still happening.
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <JdForm
          jd={jd ?? null}
          create={create}
          update={update}
          pending={pending}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

type CreateMutation = ReturnType<typeof useCreateJd>;
type UpdateMutation = ReturnType<typeof useUpdateJd>;

function JdForm({
  jd,
  create,
  update,
  pending,
  onClose,
  onSaved,
}: {
  jd: JdDetail | null;
  create: CreateMutation;
  update: UpdateMutation;
  pending: boolean;
  onClose: () => void;
  onSaved?: (jd: JdDetail) => void;
}) {
  const fieldId = React.useId();
  const titleId = `${fieldId}-title`;
  const contentId = `${fieldId}-content`;

  const isEdit = Boolean(jd);
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<JdFormValues>({
    resolver: zodResolver(jdFormSchema),
    // Correct on mount because this component only exists while the dialog is
    // open; there is no stale draft to clear.
    defaultValues: { title: jd?.title ?? "", content: jd?.content ?? "" },
  });

  // `useWatch` rather than `watch()`: it subscribes to one field and returns
  // its value, where `watch()` hands back a function the React Compiler cannot
  // memoize safely and therefore skips optimizing the whole component for.
  const title = useWatch({ control, name: "title" });
  const content = useWatch({ control, name: "content" });

  // The exact object the mutation will send, so the byte figure the user sees
  // is the byte figure the middleware will count — not an estimate.
  const body = React.useMemo(
    () => buildBody({ jd, title, content }),
    [jd, title, content],
  );
  const size = React.useMemo(() => measureJd(content, body), [content, body]);

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    const payload = buildBody({ jd, ...values });

    // `JdUpdateRequest` allows both fields to be absent and the route answers
    // 422 `nothing_to_update` for it. Catching it here saves a round trip and
    // puts the caret where the change has to happen.
    if (jd && Object.keys(payload).length === 0) {
      setError(
        "content",
        {
          type: "manual",
          message:
            "Nothing has changed yet. Edit the title or the text before saving a new version.",
        },
        { shouldFocus: true },
      );
      return;
    }

    // The last line of defence in front of the ASGI body cap. The meter has
    // been saying this the whole time the user was typing; this is what stops
    // a submit that would come back as an unattributable 413.
    if (requestBytes(payload) > JD_MAX_REQUEST_BYTES) {
      setError(
        "content",
        {
          type: "manual",
          message: `This request would be over the server's ${formatNumber(
            JD_MAX_REQUEST_BYTES,
          )}-byte limit and would be rejected before it was read. Shorten the text.`,
        },
        { shouldFocus: true },
      );
      return;
    }

    try {
      const response = jd
        ? await update.mutateAsync({ id: jd.id, body: payload })
        : await create.mutateAsync(payload as JdCreateRequest);

      toast.success(
        jd ? `Saved as version ${response.jd.version}` : "Job description saved",
        {
          description: jd
            ? `Version ${jd.version} is kept in this job description's history.`
            : response.jd.title,
        },
      );
      onSaved?.(response.jd);
      onClose();
    } catch (error) {
      // A 422 the server pinned to a field belongs on that field. Everything
      // else — 409 quota, 413 size, 429, a dropped connection — is a
      // whole-request failure and goes to <ErrorState> in full.
      if (!applyJdFieldErrors(error, setError)) setFailure(error);
    }
  });

  const failureCopy = failure
    ? describeJdFailure(failure, isEdit ? "Could not save" : "Could not create")
    : null;
  const currentVersion = jd?.version ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit job description" : "New job description"}
        </DialogTitle>
        <DialogDescription>
          {isEdit ? (
            <>
              Saving stores this as version {currentVersion + 1}. Version{" "}
              {currentVersion} is archived, not overwritten.
            </>
          ) : (
            <>
              Paste the posting as published. Tailoring reads it verbatim, so the
              requirements and responsibilities matter and the boilerplate does
              not.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {failureCopy ? (
          <div className="border-destructive/25 bg-destructive/5 space-y-2 rounded-lg border p-3">
            <ErrorState error={failure} title={failureCopy.title} variant="bare" />
            {failureCopy.hint ? (
              <p className="text-foreground/80 pl-7 text-xs text-pretty">
                {failureCopy.hint}
              </p>
            ) : null}
          </div>
        ) : null}

        <JdField
          id={titleId}
          label="Title"
          error={errors.title?.message}
          hint="How you will recognise it in the library — the role and the company."
          meter={
            title.length > JD_TITLE_MAX * 0.75 ? (
              <span
                aria-hidden="true"
                className={
                  title.length > JD_TITLE_MAX
                    ? "text-destructive font-mono text-[0.6875rem] font-medium tabular-nums"
                    : "text-muted-foreground font-mono text-[0.6875rem] tabular-nums"
                }
              >
                {formatNumber(title.length)}/{formatNumber(JD_TITLE_MAX)}
              </span>
            ) : null
          }
        >
          <Input
            id={titleId}
            autoComplete="off"
            placeholder="Senior Platform Engineer — Northwind"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={jdDescribedBy(titleId, {
              error: errors.title,
              hint: true,
            })}
            {...register("title")}
          />
        </JdField>

        <JdField
          id={contentId}
          label="Job description"
          error={errors.content?.message}
          meter={<JdSizeMeter report={size} />}
        >
          <div className="space-y-1.5">
            <Textarea
              id={contentId}
              // `field-sizing-fixed` overrides the primitive's grow-with-content
              // default: a 20,000-character paste would otherwise expand the
              // textarea to the height of the whole posting and push the footer
              // somewhere the user has to go hunting for.
              className="field-sizing-fixed max-h-[42vh] min-h-56 resize-y font-mono text-xs leading-relaxed"
              spellCheck={false}
              placeholder="Paste the full posting here…"
              aria-invalid={Boolean(errors.content)}
              aria-describedby={jdDescribedBy(contentId, {
                error: errors.content,
              })}
              {...register("content")}
            />
            <JdSizeBar report={size} />
          </div>
        </JdField>

        <JdSizeAdvisory report={size} />

        {isEdit && currentVersion >= 20 ? (
          <p className="border-warning-border bg-warning text-warning-foreground flex gap-2 rounded-md border px-2.5 py-1.5 text-xs text-pretty">
            <HistoryIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This job description already has a long history. The server keeps
              only its most recent snapshots, so saving again will drop the
              oldest one permanently.
            </span>
          </p>
        ) : null}

        {/* Neither button is disabled by validation state. A disabled submit
            gives a keyboard user nothing to press and no explanation;
            submitting reports the reason and moves focus to the field that has
            to change. */}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {isEdit ? `Save as version ${currentVersion + 1}` : "Save job description"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/**
 * The request body for the current draft.
 *
 * Create sends both fields. Edit sends only what differs from the stored
 * record, which is what keeps a rename a ~100-byte request against a 64 KB cap
 * instead of a 20 KB one, and what lets the form detect "nothing changed"
 * without asking the server.
 */
function buildBody({
  jd,
  title,
  content,
}: {
  jd: JdDetail | null;
  title: string;
  content: string;
}): JdCreateRequest | JdUpdateRequest {
  const trimmedTitle = title.trim();
  if (!jd) return { title: trimmedTitle, content };

  const body: JdUpdateRequest = {};
  if (trimmedTitle !== jd.title) body.title = trimmedTitle;
  if (content !== jd.content) body.content = content;
  return body;
}

/**
 * Pin a server-side validation failure to the input that caused it.
 *
 * `parseApiError` has already flattened FastAPI's 422 into strings shaped
 * `"content: String should have at most 20000 characters"` — the `body` prefix
 * is stripped there — so the field name is the part before the first colon.
 * Anything the server did not attribute to a field, and every non-422, is left
 * for the caller to render at form level.
 */
function applyJdFieldErrors(
  error: unknown,
  setError: UseFormSetError<JdFormValues>,
): boolean {
  if (!isApiError(error) || error.code !== "invalid_request") return false;

  let applied = false;
  for (const entry of error.fieldErrors) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    const field = entry.slice(0, separator).trim();
    const message = entry.slice(separator + 1).trim() || entry;
    if (field !== "title" && field !== "content") continue;
    setError(field, { type: "server", message }, { shouldFocus: !applied });
    applied = true;
  }
  return applied;
}
