import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button, Field, Surface } from "@/components/ui";
import { useAuth } from "@/providers/AuthProvider";

const schema = z.object({
  email: z.email(),
  password: z.string().min(10),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const { control, handleSubmit, setError, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      router.replace("/");
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Sign-in failed",
      });
    }
  });
  return (
    <ScrollView contentContainerClassName="items-center py-8">
      <Surface className="w-full max-w-lg gap-6 p-7">
        <View className="gap-2">
          <Text className="text-3xl font-black text-ink">
            {t("common.signIn")}
          </Text>
          <Text className="text-muted">{t("ui.signInHelp")}</Text>
        </View>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Field
              label={t("common.email")}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
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
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              secureTextEntry
              autoComplete="current-password"
            />
          )}
        />
        {formState.errors.root ? (
          <Text className="rounded-xl bg-red-50 p-3 text-danger">
            {formState.errors.root.message}
          </Text>
        ) : null}
        <Button
          label={t("common.signIn")}
          onPress={() => void submit()}
          loading={formState.isSubmitting}
        />
        <Link href="/forgot-password" asChild>
          <Pressable className="min-h-11 items-center justify-center">
            <Text className="font-bold text-brand">
              {t("ui.forgotPassword")}
            </Text>
          </Pressable>
        </Link>
        <Link href="/register" asChild>
          <Pressable className="min-h-11 items-center justify-center">
            <Text className="font-bold text-brand">
              {t("common.createAccount")}
            </Text>
          </Pressable>
        </Link>
      </Surface>
    </ScrollView>
  );
}
