"use client";

// Create/edit prospect form (RHF + Zod). Blank fields mean "unknown" — they
// are saved as empty and never fabricated. Used by /prospects/new (create,
// empty) and the Command Center edit mode (pre-filled, only submitted fields
// are overwritten).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  prospectFormSchema,
  type ProspectFormValues,
} from "@/lib/prospects/schema";
import { createProspectAction, updateProspectAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import { PIPELINE_STAGES } from "@/domain/pipeline/types";
import { humanizeStage } from "@/domain/utils/format";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Builds the form's default values from a prospect row (null -> ""). */
export function prospectFormDefaults(
  prospect:
    | {
        [K in keyof ProspectFormValues]?: ProspectFormValues[K] | null;
      }
    | null
    | undefined
): ProspectFormValues {
  return {
    first_name: prospect?.first_name ?? "",
    last_name: prospect?.last_name ?? "",
    title: prospect?.title ?? "",
    email: prospect?.email ?? "",
    phone: prospect?.phone ?? "",
    company: prospect?.company ?? "",
    website: prospect?.website ?? "",
    industry: prospect?.industry ?? "",
    size: prospect?.size ?? "",
    location: prospect?.location ?? "",
    stage: prospect?.stage ?? "new",
    next_action: prospect?.next_action ?? "",
    next_action_due_date: prospect?.next_action_due_date ?? "",
    tags: prospect?.tags ?? [],
    source: prospect?.source ?? "",
  };
}

interface ProspectFormProps {
  mode: "create" | "edit";
  /** Edit mode: the prospect being edited (server-loaded, pre-filled). */
  prospectId?: string;
  initial?: ProspectFormValues;
  /** Edit mode: link back to the Command Center without saving. */
  cancelHref?: string;
}

export function ProspectForm({ mode, prospectId, initial, cancelHref }: ProspectFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));

  const form = useForm<ProspectFormValues>({
    resolver: zodResolver(prospectFormSchema),
    defaultValues: prospectFormDefaults(initial),
  });

  async function onSubmit(values: ProspectFormValues) {
    setPending(true);
    setError(null);
    // Tags come from one comma-separated input; blank entries are dropped.
    const payload: ProspectFormValues = {
      ...values,
      tags: tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const result =
      mode === "create"
        ? await createProspectAction(payload)
        : await updateProspectAction(prospectId ?? "", payload);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/prospects/${result.data.prospectId}`);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-8" noValidate>
        <section aria-labelledby="contact-heading" className="grid gap-4">
          <h2 id="contact-heading" className="text-lg font-semibold">Contact</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="first_name" label="First name" hint="At least a name or company is required." />
            <TextField form={form} name="last_name" label="Last name" />
            <TextField form={form} name="title" label="Title" />
            <TextField form={form} name="email" label="Email" type="email" />
            <TextField form={form} name="phone" label="Phone" type="tel" />
          </div>
        </section>

        <section aria-labelledby="company-heading" className="grid gap-4">
          <h2 id="company-heading" className="text-lg font-semibold">Company</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="company" label="Company" />
            <TextField form={form} name="website" label="Website" type="url" placeholder="https://…" />
            <TextField form={form} name="industry" label="Industry" hint="Used to compute Opportunity Fit." />
            <TextField form={form} name="size" label="Company size" placeholder="e.g. 1-10" />
            <TextField form={form} name="location" label="Location" placeholder="e.g. Chicago, IL" />
            <TextField form={form} name="source" label="Source" placeholder="e.g. inbound, referral" />
          </div>
          <FormField
            control={form.control}
            name="tags"
            render={() => (
              <FormItem>
                <FormLabel>Tags</FormLabel>
                <FormControl>
                  <Input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="e.g. inbound, decision-maker"
                    aria-label="Tags (comma separated)"
                  />
                </FormControl>
                <p className="text-sm text-muted-foreground">
                  Separate multiple tags with commas.
                </p>
              </FormItem>
            )}
          />
        </section>

        <section aria-labelledby="pipeline-heading" className="grid gap-4">
          <h2 id="pipeline-heading" className="text-lg font-semibold">Pipeline</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="stage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stage</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value)}
                    >
                      <SelectTrigger aria-label="Pipeline stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PIPELINE_STAGES.map((stage) => (
                          <SelectItem key={stage} value={stage}>
                            {humanizeStage(stage)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="next_action_due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next action due date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <TextField
              form={form}
              name="next_action"
              label="Next action"
              className="sm:col-span-2"
              textarea
              hint="e.g. Send the pricing overview and book a demo."
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t pt-6">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : mode === "create" ? "Create prospect" : "Save changes"}
          </Button>
          {mode === "edit" && cancelHref ? (
            <Button asChild type="button" variant="ghost">
              <a href={cancelHref}>Cancel</a>
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}

type TextFieldName = Exclude<
  keyof ProspectFormValues,
  "stage" | "tags" | "next_action_due_date"
>;

function TextField({
  form,
  name,
  label,
  hint,
  placeholder,
  type,
  textarea,
  className,
}: {
  form: UseFormReturn<ProspectFormValues>;
  name: TextFieldName;
  label: string;
  hint?: string;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  className?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {textarea ? (
              <Textarea rows={2} placeholder={placeholder} {...field} />
            ) : (
              <Input
                type={type ?? "text"}
                placeholder={placeholder}
                {...field}
                value={field.value ?? ""}
              />
            )}
          </FormControl>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
