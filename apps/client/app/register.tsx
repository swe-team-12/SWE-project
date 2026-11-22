import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { ResendVerification } from "@/components/ResendVerification";
import { AuthCard, AuthLink } from "@/components/design/AuthCard";
import { Button, Field, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

const schema = z.object({
  display_name: z.string().min(2),
  email: z.email(),
  password: z
    .string()
    .min(10)
    .regex(/[A-Za-z]/)
    .regex(/[0-9]/),
});
type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: "", email: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    try {
      const result = await apiFetch<{
        development_verification_token?: string;
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ ...values, locale: i18n.language }),
        skipRefresh: true,
      });
      if (result.development_verification_token) {
        await apiFetch("/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({
            token: result.development_verification_token,
          }),
          skipRefresh: true,
        });
        await login(values.email, values.password);
        router.replace("/");
      } else {
        setPendingEmail(values.email);
      }
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error && error.message
            ? error.message
            : t("attendee.auth.registrationFailed"),
      });
    }
  });
  if (pendingEmail)
    return (
      <AuthCard icon="mail" title={t("attendee.auth.checkInboxTitle")}>
        <Text
          className="text-base leading-6 text-muted"
          accessibilityLiveRegion="polite"
        >
          {t("attendee.auth.checkInboxBody", { email: pendingEmail })}
        </Text>
        <ResendVerification defaultEmail={pendingEmail} lockEmail />
        <AuthLink href="/login" label={t("common.signIn")} />
      </AuthCard>
    );
  return (
    <AuthCard
      icon="user"
      title={t("ui.registerTitle")}
      subtitle={t("ui.registerHelp")}
      footer={<AuthLink href="/login" label={t("common.signIn")} />}
    >
        <Controller
          control={control}
          name="display_name"
          render={({ field, fieldState }) => (
            <Field
              label={t("ui.fullName")}
              value={field.value}
              onChangeText={field.onChange}
              error={
                fieldState.error ? t("attendee.auth.nameTooShort") : undefined
              }
              autoComplete="name"
              icon="user"
            />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Field
              label={t("common.email")}
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error ? t("ui.invalidEmail") : undefined}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              icon="mail"
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <Field
              label={t("common.password")}
              value={field.value}
              onChangeText={field.onChange}
              error={t("ui.passwordHint")}
              secureTextEntry
              autoComplete="new-password"
              icon="lock"
            />
          )}
        />
        {formState.errors.root ? (
          <Notice tone="danger" role="alert">
            {formState.errors.root.message}
          </Notice>
        ) : null}
        <Button
          label={t("ui.createVerify")}
          onPress={() => void submit()}
          loading={formState.isSubmitting}
          size="lg"
          fullWidth
        />
    </AuthCard>
  );
}
