import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from "react-native";
import { useTranslation } from "react-i18next";

export function Surface({
  children,
  className = "",
  ...props
}: PropsWithChildren<ViewProps>) {
  return (
    <View
      className={`rounded-3xl border border-line bg-panel p-5 shadow-panel ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress?(): void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  testID,
}: ButtonProps) {
  const palette = {
    primary: "bg-brand border-brand",
    secondary: "bg-white border-brand",
    danger: "bg-danger border-danger",
    ghost: "bg-transparent border-transparent",
  }[variant];
  const text =
    variant === "secondary" || variant === "ghost"
      ? "text-brand"
      : "text-white";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border px-5 py-3 ${palette} ${disabled ? "opacity-50" : "active:opacity-80"}`}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "secondary" ? "#007C83" : "white"}
        />
      ) : (
        icon
      )}
      <Text className={`text-center text-base font-bold ${text}`}>{label}</Text>
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Field({ label, error, ...props }: FieldProps) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#829AB1"
        className={`min-h-12 rounded-2xl border bg-white px-4 py-3 text-base text-ink ${error ? "border-danger" : "border-line"}`}
        {...props}
      />
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const normalized = status.toLowerCase();
  const tone = [
    "valid",
    "paid",
    "published",
    "active",
    "completed",
    "success",
  ].some((value) => normalized.includes(value))
    ? "bg-emerald-50 text-success"
    : ["cancel", "refund", "invalid", "suspend", "failed"].some((value) =>
          normalized.includes(value),
        )
      ? "bg-red-50 text-danger"
      : "bg-amber-50 text-warning";
  return (
    <View className={`self-start rounded-full px-3 py-1 ${tone.split(" ")[0]}`}>
      <Text className={`text-xs font-bold uppercase ${tone.split(" ")[1]}`}>
        {t(`status.${normalized}`, {
          defaultValue: status.replaceAll("_", " "),
        })}
      </Text>
    </View>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View className="min-h-48 items-center justify-center gap-3">
      <ActivityIndicator color="#007C83" size="large" />
      <Text className="text-muted">{label ?? t("common.loading")}</Text>
    </View>
  );
}

export function ErrorBlock({
  message,
  retry,
}: {
  message: string;
  retry?(): void;
}) {
  const { t } = useTranslation();
  return (
    <Surface className="items-start gap-4 border-red-200 bg-red-50">
      <Text className="text-lg font-bold text-danger">
        {t("ui.somethingWrong")}
      </Text>
      <Text className="text-ink">{message}</Text>
      {retry ? (
        <Button
          label={t("common.tryAgain")}
          onPress={retry}
          variant="secondary"
        />
      ) : null}
    </Surface>
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Surface className="min-w-40 flex-1 gap-2">
      <Text className="text-sm font-semibold text-muted">{label}</Text>
      <Text className="text-3xl font-black text-ink">{value}</Text>
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
    </Surface>
  );
}
