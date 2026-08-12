"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createClient } from "@/lib/supabase/client";
import {
  accountSettingsSchema,
  type AccountSettingsValues,
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

interface AccountSettingsFormProps {
  userId: string;
  initial: { display_name: string | null; timezone: string | null };
}

export function AccountSettingsForm({
  userId,
  initial,
}: AccountSettingsFormProps) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<AccountSettingsValues>({
    resolver: zodResolver(accountSettingsSchema),
    defaultValues: {
      display_name: initial.display_name ?? "",
      timezone: initial.timezone ?? "",
    },
  });

  async function onSubmit(values: AccountSettingsValues) {
    setPending(true);
    setStatus("idle");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: values.display_name?.trim() || null,
        timezone: values.timezone?.trim() || null,
      })
      .eq("id", userId);

    setPending(false);
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("saved");
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <FormControl>
                <Input
                  placeholder="America/New_York"
                  aria-describedby="timezone-hint"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div>
          {status === "saved" ? (
            <p className="mb-2 text-sm text-emerald-600 dark:text-emerald-500">
              Saved.
            </p>
          ) : status === "error" ? (
            <p
              role="alert"
              className="mb-2 text-sm text-destructive"
            >
              Couldn&apos;t save: {errorMessage}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save account"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
