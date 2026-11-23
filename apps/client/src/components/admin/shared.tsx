import { Link, type Href } from "expo-router";
import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import {
  Button,
  ErrorBlock,
  LoadingBlock,
  Notice as UiNotice,
  SegmentedControl,
} from "@/components/ui";
import i18n from "@/i18n";
import { apiErrorText } from "@/lib/apiErrorText";

/**
 * User-facing text for a failed request. Problems returned by the API are
 * localised by their code; anything else (the request never reached the
 * server) gets the translated connectivity message.
 */
export function errorText(error: unknown): string {
  const problem = (error as { problem?: { code?: string; detail: string } })
    ?.problem;
  if (problem) return apiErrorText(problem);
  return i18n.t("apiErrors.network_error");
}

export function problemCode(error: unknown): string | undefined {
  return (error as { problem?: { code?: string } })?.problem?.code;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

/** Top-level section switcher: a pill segmented control (tablist). The
 * selected tab is exposed to assistive tech and drawn as a filled pill. */
export function Tabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<NoInfer<T>>[];
  value: T;
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <SegmentedControl<T>
      label={label}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}

/** Single-choice filter or picker rendered as a row of toggle chips. The
 * selected chip is filled and carries a check icon, not colour alone. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<NoInfer<T>>[];
  value: T | undefined;
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink">{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-2"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(option.value)}
              className={`min-h-11 max-w-full flex-row items-center gap-1.5 rounded-full border px-4 py-2 active:opacity-80 ${selected ? "border-ink bg-ink" : "border-line bg-white"}`}
            >
              {selected ? (
                <Icon name="check" size={14} color={palette.mint} />
              ) : null}
              <Text
                className={`shrink text-sm ${selected ? "font-semibold text-white" : "font-semibold text-ink"}`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Inline confirmation step for destructive or irreversible actions, styled
 * like the attendee confirmation cards (tinted card, icon, two buttons). */
export function ConfirmPanel({
  title,
  message,
  confirmLabel,
  danger,
  loading,
  disabled,
  error,
  onConfirm,
  onCancel,
  children,
}: PropsWithChildren<{
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  onConfirm(): void;
  onCancel(): void;
}>) {
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="alert"
      className={`w-full gap-3 rounded-3xl border p-4 ${danger ? "border-red-100 bg-red-50" : "border-amber-200 bg-amber-50"}`}
    >
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-white">
          <Icon
            name="alert"
            size={18}
            color={danger ? palette.danger : palette.warning}
          />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-semibold text-ink">{title}</Text>
          {message ? (
            <Text className="text-sm leading-5 text-muted">{message}</Text>
          ) : null}
        </View>
      </View>
      {children}
      {error ? (
        <Text accessibilityRole="alert" className="font-medium text-danger">
          {error}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-3">
        <Button
          label={confirmLabel}
          variant={danger ? "danger" : "dark"}
          onPress={onConfirm}
          loading={loading}
          disabled={disabled}
        />
        <Button
          label={t("common.cancel")}
          variant="secondary"
          disabled={loading}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

/** Loading, error (with retry) and empty states shared by every list. */
export function ListState({
  loading,
  error,
  retry,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: unknown;
  retry?(): void;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={errorText(error)} retry={retry} />;
  if (empty)
    return (
      <View className="items-center gap-2 rounded-3xl border border-dashed border-line bg-white/60 px-4 py-8">
        <Icon name="search" size={22} color={palette.muted} />
        <Text className="text-center text-muted">{emptyText}</Text>
      </View>
    );
  return null;
}

export function TextLink({
  href,
  label,
  accessibilityLabel,
}: {
  href: Href;
  label: string;
  accessibilityLabel?: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel ?? label}
        className="min-h-8 justify-center self-start"
      >
        <Text className="font-medium text-brand underline">{label}</Text>
      </Pressable>
    </Link>
  );
}

/** One record in a monitoring list: details on the left, status and actions on the right. */
export function Row({
  children,
  aside,
  below,
}: PropsWithChildren<{ aside?: ReactNode; below?: ReactNode }>) {
  return (
    <View className="gap-3 rounded-3xl border border-line bg-white p-4">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-52 flex-1 gap-1">{children}</View>
        {aside ? (
          <View className="max-w-full flex-row flex-wrap items-center gap-2">
            {aside}
          </View>
        ) : null}
      </View>
      {below}
    </View>
  );
}

/** Red "escalated" chip: a flag icon plus the word, never colour alone. */
export function EscalatedChip() {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-lg border border-red-100 bg-red-50 px-3 py-1">
      <Icon name="alert" size={13} color={palette.danger} />
      <Text className="text-xs font-medium text-danger">
        {t("supportX.escalated")}
      </Text>
    </View>
  );
}

export function Meta({ children }: PropsWithChildren) {
  return <Text className="text-sm text-muted">{children}</Text>;
}

export function Notice({
  tone,
  children,
}: PropsWithChildren<{ tone: "success" | "warning" | "danger" }>) {
  return (
    <UiNotice tone={tone} role="alert" bold>
      {children}
    </UiNotice>
  );
}

export function eventManageHref(id: string): Href {
  return { pathname: "/organizer/events/[id]", params: { id } };
}

export function eventPublicHref(id: string): Href {
  return { pathname: "/events/[id]", params: { id } };
}

export function supportCaseHref(id: string): Href {
  return { pathname: "/support/[id]", params: { id } };
}
