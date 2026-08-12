"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createClient } from "@/lib/supabase/client";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
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

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setPending(true);
    setFormError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (error) {
      setFormError(error.message);
      setPending(false);
      return;
    }

    // Honest copy: never reveal whether the account exists.
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-muted/40 px-4 py-6">
        <h2 className="text-base font-medium">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for that email, a password reset link is on its
          way. Follow the link to set a new password, then sign in.
        </p>
      </div>
    );
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={pending} className="mt-2">
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </Form>
  );
}
