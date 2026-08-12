"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createClient } from "@/lib/supabase/client";
import { signupSchema, type SignupValues } from "@/lib/sales-profile/schema";
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

export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { display_name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupValues) {
    setPending(true);
    setFormError(null);

    const displayName = values.display_name.trim();
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { display_name: displayName } },
    });

    if (error) {
      setFormError(error.message);
      setPending(false);
      return;
    }

    // If a session was issued immediately, create the profiles row (RLS
    // permits it: id = auth.uid()) and go straight to onboarding. If email
    // confirmation is required, there is no session yet — the profile row is
    // created lazily on first sign-in by the protected layout, and the user
    // is told to check their inbox.
    if (data.user && data.session) {
      await supabase.from("profiles").insert({
        id: data.user.id,
        display_name: displayName,
        timezone: null,
        onboarding_state: "not_started",
      });
      router.replace("/settings/sales-profile");
      router.refresh();
      return;
    }

    setCheckEmail(true);
    setPending(false);
  }

  if (checkEmail) {
    return (
      <div className="rounded-lg border bg-muted/40 px-4 py-6">
        <h2 className="text-base font-medium">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a confirmation link to your inbox. Confirm your email, then
          sign in to complete your Sales Profile.
        </p>
        <Button
          variant="outline"
          size="lg"
          className="mt-4"
          onClick={() => router.push("/login")}
        >
          Go to sign in
        </Button>
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
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
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </Form>
  );
}
