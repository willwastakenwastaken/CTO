"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createClient } from "@/lib/supabase/client";
import {
  compactList,
  GUARDRAIL_EXAMPLES,
  OBJECTION_DEFAULTS,
  salesProfileSchema,
  textOrNull,
  type SalesProfileValues,
} from "@/lib/sales-profile/schema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface SalesProfileInitialValues {
  salesProfileId: string | null;
  product_name: string | null;
  description: string | null;
  pricing: string | null;
  ideal_customer: string | null;
  benefits: string | null;
  problems_solved: string | null;
  differentiators: string | null;
  call_goal: string | null;
  preferred_cta: string | null;
  sales_process: string | null;
  objections: string[];
  guardrails: string[];
}

interface SalesProfileFormProps {
  userId: string;
  onboardingState: "complete" | "not_started";
  initial: SalesProfileInitialValues;
}

type TextFieldName =
  | "product_name"
  | "description"
  | "pricing"
  | "ideal_customer"
  | "benefits"
  | "problems_solved"
  | "differentiators"
  | "call_goal"
  | "preferred_cta"
  | "sales_process";

interface TextFieldDef {
  name: TextFieldName;
  label: string;
  hint?: string;
  textarea?: boolean;
  required?: boolean;
}

const TEXT_FIELDS: TextFieldDef[] = [
  {
    name: "product_name",
    label: "Product or service name",
    hint: "What you sell — used when coaching you in calls.",
    required: true,
  },
  {
    name: "description",
    label: "Concise description",
    hint: "What it is and who it's for, in a sentence or two.",
    textarea: true,
  },
  {
    name: "pricing",
    label: "Pricing model",
    hint: "e.g. monthly subscription, per-seat, project-based.",
  },
  {
    name: "ideal_customer",
    label: "Ideal customer",
    hint: "Who benefits most — industry, size, role.",
    textarea: true,
  },
  {
    name: "benefits",
    label: "Main benefits",
    hint: "The outcomes customers get.",
    textarea: true,
  },
  {
    name: "problems_solved",
    label: "Problems solved",
    hint: "The pains you remove.",
    textarea: true,
  },
  {
    name: "differentiators",
    label: "Differentiators",
    hint: "Why a buyer would pick you over the alternative.",
    textarea: true,
  },
  {
    name: "call_goal",
    label: "Normal call objective",
    hint: "e.g. qualify fit and book a demo.",
  },
  {
    name: "preferred_cta",
    label: "Preferred call to action",
    hint: "What you usually ask for at the end of a call.",
  },
  {
    name: "sales_process",
    label: "Sales process",
    hint: "The steps a deal goes through, in your words.",
    textarea: true,
  },
];

function buildDefaultValues(
  initial: SalesProfileInitialValues
): SalesProfileValues {
  return {
    product_name: initial.product_name ?? "",
    description: initial.description ?? "",
    pricing: initial.pricing ?? "",
    ideal_customer: initial.ideal_customer ?? "",
    benefits: initial.benefits ?? "",
    problems_solved: initial.problems_solved ?? "",
    differentiators: initial.differentiators ?? "",
    call_goal: initial.call_goal ?? "",
    preferred_cta: initial.preferred_cta ?? "",
    sales_process: initial.sales_process ?? "",
    objections: compactList(initial.objections),
    // New users get the spec's guardrail examples pre-filled; they are
    // editable and removable. Existing profiles keep their saved values.
    guardrails:
      initial.guardrails.length > 0
        ? compactList(initial.guardrails)
        : [...GUARDRAIL_EXAMPLES],
  };
}

export function SalesProfileForm({
  userId,
  onboardingState,
  initial,
}: SalesProfileFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customObjection, setCustomObjection] = useState("");

  const form = useForm<SalesProfileValues>({
    resolver: zodResolver(salesProfileSchema),
    defaultValues: buildDefaultValues(initial),
  });

  async function onSubmit(values: SalesProfileValues) {
    setPending(true);
    setStatus("idle");
    setErrorMessage(null);

    const payload = {
      name: null,
      product_name: textOrNull(values.product_name),
      description: textOrNull(values.description),
      pricing: textOrNull(values.pricing),
      ideal_customer: textOrNull(values.ideal_customer),
      benefits: textOrNull(values.benefits),
      problems_solved: textOrNull(values.problems_solved),
      differentiators: textOrNull(values.differentiators),
      call_goal: textOrNull(values.call_goal),
      preferred_cta: textOrNull(values.preferred_cta),
      sales_process: textOrNull(values.sales_process),
      objections: compactList(values.objections),
      guardrails: compactList(values.guardrails),
      is_default: true,
    };

    const supabase = createClient();
    let saveError: { message: string } | null = null;

    if (initial.salesProfileId) {
      const { error } = await supabase
        .from("sales_profiles")
        .update(payload)
        .eq("id", initial.salesProfileId)
        .eq("user_id", userId);
      saveError = error;
    } else {
      const { error } = await supabase
        .from("sales_profiles")
        .insert({ ...payload, user_id: userId });
      saveError = error;
    }

    if (saveError) {
      setStatus("error");
      setErrorMessage(saveError.message);
      setPending(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ onboarding_state: "complete" })
      .eq("id", userId);

    if (profileError) {
      setStatus("error");
      setErrorMessage(
        `Saved your profile, but couldn't mark onboarding complete (${profileError.message}). Your data is safe — please save again.`
      );
      setPending(false);
      return;
    }

    setPending(false);
    if (onboardingState !== "complete") {
      // First completion: head to the home dashboard.
      router.replace("/home");
      router.refresh();
    } else {
      setStatus("saved");
    }
  }

  const isOnboarding = onboardingState !== "complete";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-8"
        noValidate
      >
        <section aria-labelledby="offer-heading" className="grid gap-4">
          <h2 id="offer-heading" className="text-lg font-semibold">
            About your offer
          </h2>
          <div className="grid gap-4">
            {TEXT_FIELDS.slice(0, 3).map((def) => (
              <ProfileTextField key={def.name} form={form} def={def} />
            ))}
          </div>
        </section>

        <section aria-labelledby="customer-heading" className="grid gap-4">
          <h2 id="customer-heading" className="text-lg font-semibold">
            Who you sell to
          </h2>
          <div className="grid gap-4">
            {TEXT_FIELDS.slice(3, 7).map((def) => (
              <ProfileTextField key={def.name} form={form} def={def} />
            ))}
          </div>
        </section>

        <section aria-labelledby="calls-heading" className="grid gap-4">
          <h2 id="calls-heading" className="text-lg font-semibold">
            How you run calls
          </h2>
          <div className="grid gap-4">
            {TEXT_FIELDS.slice(7).map((def) => (
              <ProfileTextField key={def.name} form={form} def={def} />
            ))}
          </div>
        </section>

        <section aria-labelledby="objections-heading" className="grid gap-4">
          <h2 id="objections-heading" className="text-lg font-semibold">
            Common objections
          </h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            Pick the ones you hear most, or add your own. SignalDesk uses these
            to recognize objections and recommend responses.
          </p>
          <Controller
            control={form.control}
            name="objections"
            render={({ field }) => {
              const value = field.value ?? [];
              const isSelected = (item: string) =>
                value.some(
                  (o) => o.toLowerCase() === item.toLowerCase()
                );
              const toggle = (item: string) => {
                const exists = value.some(
                  (o) => o.toLowerCase() === item.toLowerCase()
                );
                field.onChange(
                  exists
                    ? value.filter(
                        (o) => o.toLowerCase() !== item.toLowerCase()
                      )
                    : [...value, item]
                );
              };
              const customSelected = value.filter(
                (o) =>
                  !OBJECTION_DEFAULTS.some(
                    (d) => d.toLowerCase() === o.toLowerCase()
                  )
              );
              const addCustom = () => {
                const trimmed = customObjection.trim();
                if (!trimmed) return;
                if (
                  !value.some(
                    (o) => o.toLowerCase() === trimmed.toLowerCase()
                  )
                ) {
                  field.onChange([...value, trimmed]);
                }
                setCustomObjection("");
              };

              return (
                <div className="grid gap-3">
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Common objections"
                  >
                    {OBJECTION_DEFAULTS.map((obj) => {
                      const selected = isSelected(obj);
                      return (
                        <button
                          key={obj}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggle(obj)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {obj}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={customObjection}
                      onChange={(e) => setCustomObjection(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustom();
                        }
                      }}
                      placeholder="Add a custom objection…"
                      aria-label="Custom objection"
                      className="max-w-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addCustom}
                    >
                      Add
                    </Button>
                  </div>
                  {customSelected.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" aria-label="Custom objections">
                      {customSelected.map((obj) => (
                        <li key={obj}>
                          <button
                            type="button"
                            onClick={() => toggle(obj)}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm hover:bg-muted"
                          >
                            {obj}
                            <span aria-hidden="true" className="text-muted-foreground">
                              ×
                            </span>
                            <span className="sr-only">Remove {obj}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            }}
          />
          <FormField
            control={form.control}
            name="objections"
            render={({ fieldState }) => (
              <>
                {fieldState.error ? (
                  <p className="text-sm text-destructive">
                    {fieldState.error.message}
                  </p>
                ) : null}
              </>
            )}
          />
        </section>

        <section aria-labelledby="guardrails-heading" className="grid gap-4">
          <h2 id="guardrails-heading" className="text-lg font-semibold">
            Guardrails
          </h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            Claims and commitments SignalDesk should never suggest. Edit or
            remove any example; add your own.
          </p>
          <Controller
            control={form.control}
            name="guardrails"
            render={({ field }) => {
              const rows = field.value ?? [];
              const updateRow = (index: number, value: string) => {
                const next = [...rows];
                next[index] = value;
                field.onChange(next);
              };
              const removeRow = (index: number) =>
                field.onChange(rows.filter((_, i) => i !== index));
              const addRow = () => field.onChange([...rows, ""]);
              return (
                <div className="grid gap-2">
                  {rows.length > 0 ? (
                    <ul className="grid gap-2">
                      {rows.map((row, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <Input
                            value={row}
                            onChange={(e) => updateRow(index, e.target.value)}
                            aria-label={`Guardrail ${index + 1}`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove guardrail ${index + 1}`}
                            onClick={() => removeRow(index)}
                          >
                            ×
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addRow}
                    >
                      Add guardrail
                    </Button>
                  </div>
                </div>
              );
            }}
          />
          <FormField
            control={form.control}
            name="guardrails"
            render={({ fieldState }) => (
              <>
                {fieldState.error ? (
                  <p className="text-sm text-destructive">
                    {fieldState.error.message}
                  </p>
                ) : null}
              </>
            )}
          />
        </section>

        <div className="border-t pt-6">
          {status === "saved" ? (
            <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-500">
              Sales Profile saved.
            </p>
          ) : status === "error" ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending
              ? "Saving…"
              : isOnboarding
                ? "Save & continue"
                : "Save Sales Profile"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ProfileTextField({
  form,
  def,
}: {
  form: UseFormReturn<SalesProfileValues>;
  def: TextFieldDef;
}) {
  return (
    <FormField
      control={form.control}
      name={def.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {def.label}
            {def.required ? (
              <span className="text-muted-foreground"> (required)</span>
            ) : null}
          </FormLabel>
          <FormControl>
            {def.textarea ? (
              <Textarea rows={3} {...field} />
            ) : (
              <Input {...field} />
            )}
          </FormControl>
          {def.hint ? (
            <p className="text-sm text-muted-foreground">{def.hint}</p>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
