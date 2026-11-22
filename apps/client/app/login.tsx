import { zodResolver } from "@hookform/resolvers/zod";
import { type Href, Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { ResendVerification } from "@/components/ResendVerification";
import { AuthCard } from "@/components/design/AuthCard";
import { Icon, palette } from "@/components/icons";
import { Button, Field, Notice } from "@/components/ui";
import { safeRedirectPath } from "@/lib/loginRedirect";
import { useAuth } from "@/providers/AuthProvider";

const schema = z.object({
  email: z.email(),
  password: z.string().min(10),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const redirect = safeRedirectPath(params.redirect);
  const [resendOpen, setResendOpen] = useState(false);
  const { control, handleSubmit, setError, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      router.replace((redirect ?? "/") as Href);
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error && error.message
            ? error.message
            : t("attendee.auth.signInFailed"),
      });
    }
  });
  return (
    <AuthCard
      icon="lock"
      title={t("common.signIn")}
      subtitle={t("ui.signInHelp")}
      footer={
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: resendOpen }}
            onPress={() => setResendOpen((value) => !value)}
            className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-70"
          >
            <Icon name="mail" size={16} color={palette.brand} />
            <Text className="text-center font-bold text-brand">
              {t("attendee.auth.noVerificationEmail")}
            </Text>
          </Pressable>
          {resendOpen ? (
            <>
              <Text className="text-sm text-muted">
                {t("attendee.auth.resendHelp")}
              </Text>
              <ResendVerification />
            </>
          ) : null}
        </>
      }
    >
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Field
              label={t("common.email")}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
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
              onBlur={field.onBlur}
              error={
                fieldState.error
                  ? t("attendee.auth.passwordTooShort")
                  : undefined
              }
              secureTextEntry
              autoComplete="current-password"
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
          label={t("common.signIn")}
          onPress={() => void submit()}
          loading={formState.isSubmitting}
          size="lg"
          fullWidth
        />
        <Link href="/forgot-password" asChild>
          <Pressable className="min-h-11 items-center justify-center rounded-2xl active:opacity-70">
            <Text className="font-bold text-brand underline">
              {t("ui.forgotPassword")}
            </Text>
          </Pressable>
        </Link>
        <Link href="/register" asChild>
          <Pressable className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-line bg-canvas px-5 active:opacity-80">
            <Icon name="user" size={18} />
            <Text className="font-bold text-ink">
              {t("common.createAccount")}
            </Text>
          </Pressable>
        </Link>
    </AuthCard>
  );
}
