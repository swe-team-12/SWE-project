import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button, Field, Surface } from "@/components/ui";
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
        router.replace("/login");
      }
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Registration failed",
      });
    }
  });
  return (
    <ScrollView contentContainerClassName="items-center py-8">
      <Surface className="w-full max-w-lg gap-6 p-7">
        <View className="gap-2">
          <Text className="text-3xl font-black text-ink">
            {t("ui.registerTitle")}
          </Text>
          <Text className="text-muted">{t("ui.registerHelp")}</Text>
        </View>
        <Controller
          control={control}
          name="display_name"
          render={({ field, fieldState }) => (
            <Field
              label={t("ui.fullName")}
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              autoComplete="name"
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
              error={fieldState.error?.message}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
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
              error={fieldState.error?.message ?? t("ui.passwordHint")}
              secureTextEntry
              autoComplete="new-password"
            />
          )}
        />
        {formState.errors.root ? (
          <Text className="rounded-xl bg-red-50 p-3 text-danger">
            {formState.errors.root.message}
          </Text>
        ) : null}
        <Button
          label={t("ui.createVerify")}
          onPress={() => void submit()}
          loading={formState.isSubmitting}
        />
      </Surface>
    </ScrollView>
  );
}
