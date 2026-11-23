import type { PropsWithChildren, ReactNode } from "react";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, type IconName, palette } from "@/components/icons";
import { Button, Field, Notice, Surface } from "@/components/ui";
import type { Problem } from "@/types";

/** Problem attached to an API failure, if the error came from the API. */
export function problemOf(error: unknown): Problem | undefined {
  return (error as { problem?: Problem } | null | undefined)?.problem;
}

export function isForbidden(error: unknown): boolean {
  return problemOf(error)?.status === 403;
}

export function isNotFound(error: unknown): boolean {
  return problemOf(error)?.status === 404;
}

/** Localised text of any failure (API errors resolve through apiErrors.*). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Notice tone="danger" role="alert">
      {errorMessage(error)}
    </Notice>
  );
}

export function SuccessText({ children }: PropsWithChildren) {
  return (
    <Notice tone="success" role="status" bold>
      {children}
    </Notice>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  return (
    <Text
      accessibilityRole="header"
      className="text-xl font-semibold text-ink"
    >
      {children}
    </Text>
  );
}

export function Muted({ children }: PropsWithChildren) {
  return <Text className="text-sm text-muted">{children}</Text>;
}

/** Shown instead of a section the current staff role may not open. */
export function PermissionNotice({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <Surface className="flex-row items-start gap-4">
      <View
        className="h-12 w-12 items-center justify-center rounded-2xl bg-amber-100"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="lock" size={22} color={palette.warning} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text
          accessibilityRole="header"
          className="text-lg font-semibold text-ink"
        >
          {t("organizer.access.deniedTitle")}
        </Text>
        <Text className="leading-6 text-muted">
          {message ?? t("organizer.access.deniedBody")}
        </Text>
      </View>
    </Surface>
  );
}

/** Demonstration banner: simulated flows never move real money. */
export function DemoNotice({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <Icon name="alert" size={18} color={palette.warning} />
      <View className="min-w-0 flex-1">
        <Text className="font-medium text-ink">{t("common.demo")}</Text>
        {children ? (
          <Text className="mt-1 text-sm leading-5 text-ink">{children}</Text>
        ) : null}
      </View>
    </View>
  );
}

type Tone = "good" | "bad" | "warn" | "neutral";

const TONES: Record<
  Tone,
  {
    box: string;
    text: string;
    color: string;
    darkBox: string;
    darkText: string;
    darkColor: string;
    icon: IconName | null;
  }
> = {
  good: {
    box: "border-mintsoft bg-mintsoft",
    text: "text-success",
    color: palette.brand,
    darkBox: "border-mint/40 bg-mint/15",
    darkText: "text-mint",
    darkColor: palette.mint,
    icon: "check",
  },
  bad: {
    box: "border-red-100 bg-red-50",
    text: "text-danger",
    color: palette.danger,
    darkBox: "border-red-300/40 bg-red-500/15",
    darkText: "text-red-200",
    darkColor: "#FECACA",
    icon: "close",
  },
  warn: {
    box: "border-amber-100 bg-amber-50",
    text: "text-warning",
    color: palette.warning,
    darkBox: "border-amber-200/40 bg-amber-400/15",
    darkText: "text-amber-100",
    darkColor: "#FEF3C7",
    icon: "alert",
  },
  neutral: {
    box: "border-line bg-white",
    text: "text-ink",
    color: palette.ink,
    darkBox: "border-white/20 bg-white/10",
    darkText: "text-white",
    darkColor: palette.white,
    icon: null,
  },
};

const GOOD = [
  "active",
  "published",
  "paid",
  "paid_demo",
  "free",
  "succeeded",
  "valid",
  "checked_in",
  "resolved",
  "accepted",
  "done",
  "verified",
];
const BAD = [
  "cancelled",
  "refunded",
  "failed",
  "timed_out",
  "suspended",
  "disabled",
  "expired",
  "exhausted",
  "missing",
];

export function toneOf(status: string): Tone {
  if (GOOD.includes(status)) return "good";
  if (BAD.includes(status)) return "bad";
  return "warn";
}

/** Status label: organizer wording first, then the shared status catalogue. */
export function useStatusLabel() {
  const { t } = useTranslation();
  return (status: string) =>
    t(`organizer.statuses.${status}`, {
      defaultValue: t(`status.${status}`, {
        defaultValue: status.replaceAll("_", " "),
      }),
    });
}

/** Text badge with an icon, so state is never conveyed by colour alone. */
export function Badge({
  status,
  label,
  tone,
  onDark,
}: {
  status: string;
  label?: string;
  tone?: Tone;
  /** Use on night cards. */
  onDark?: boolean;
}) {
  const statusLabel = useStatusLabel();
  const style = TONES[tone ?? toneOf(status)];
  return (
    <View
      className={`flex-row items-center gap-1 self-start rounded-lg border px-3 py-1 ${onDark ? style.darkBox : style.box}`}
    >
      {style.icon ? (
        <Icon
          name={style.icon}
          size={12}
          color={onDark ? style.darkColor : style.color}
        />
      ) : null}
      <Text
        className={`text-xs font-medium ${onDark ? style.darkText : style.text}`}
      >
        {label ?? statusLabel(status)}
      </Text>
    </View>
  );
}

interface Option<T extends string> {
  value: T;
  label: string;
}

export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Option<NoInfer<T>>[];
  value: T;
  onChange(value: NoInfer<T>): void;
  disabled?: boolean;
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
              accessibilityState={{ selected, checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              className={`min-h-11 flex-row items-center gap-2 rounded-2xl border px-4 py-2 ${selected ? "border-ink bg-ink" : "border-line bg-white"} ${disabled ? "opacity-50" : "active:opacity-80"}`}
            >
              <View
                className={`h-4 w-4 items-center justify-center rounded-full border-2 ${selected ? "border-mint bg-mint" : "border-muted bg-white"}`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {selected ? <View className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
              </View>
              <Text
                className={`shrink font-medium ${selected ? "text-white" : "text-ink"}`}
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

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      testID={testID}
      className={`min-h-11 flex-row items-center gap-3 ${disabled ? "opacity-50" : ""}`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-lg border-2 ${checked ? "border-ink bg-ink" : "border-muted bg-white"}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {checked ? <Icon name="check" size={14} color={palette.mint} /> : null}
      </View>
      <Text className="flex-1 text-base text-ink">{label}</Text>
    </Pressable>
  );
}

export function MultiChoice({
  label,
  hint,
  options,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Option<string>[];
  values: string[];
  onChange(values: string[]): void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-ink">{label}</Text>
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
      {options.map((option) => {
        const checked = values.includes(option.value);
        return (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={checked}
            onChange={() =>
              onChange(
                checked
                  ? values.filter((item) => item !== option.value)
                  : [...values, option.value],
              )
            }
          />
        );
      })}
    </View>
  );
}

/**
 * A destructive or irreversible action: the first press only opens a
 * confirmation step (optionally asking for a reason); nothing happens until
 * the person confirms.
 */
export function ConfirmButton({
  label,
  message,
  confirmLabel,
  onConfirm,
  reason,
  variant = "danger",
  loading,
  disabled,
  testID,
}: {
  label: string;
  message: string;
  confirmLabel?: string;
  onConfirm(reason: string): void;
  reason?: { label: string; minLength?: number };
  variant?: "danger" | "secondary";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const minLength = reason?.minLength ?? 3;
  const reasonMissing = !!reason && text.trim().length < minLength;
  if (!open) {
    return (
      <Button
        label={label}
        variant={variant}
        onPress={() => setOpen(true)}
        loading={loading}
        disabled={disabled}
        testID={testID}
      />
    );
  }
  return (
    <View
      accessibilityLiveRegion="polite"
      className="w-full gap-3 rounded-2xl border border-red-100 bg-red-50 p-4"
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-9 w-9 items-center justify-center rounded-xl bg-white"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name="alert" size={18} color={palette.danger} />
        </View>
        <Text className="flex-1 font-medium text-ink">{label}</Text>
      </View>
      <Text className="text-sm leading-5 text-muted">{message}</Text>
      {reason ? (
        <Field
          label={reason.label}
          value={text}
          onChangeText={setText}
          multiline
          error={
            text.length > 0 && reasonMissing
              ? t("organizer.validation.reasonTooShort", { count: minLength })
              : undefined
          }
        />
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={confirmLabel ?? t("organizer.common.confirm")}
          variant="danger"
          disabled={reasonMissing}
          loading={loading}
          testID={testID ? `${testID}-confirm` : undefined}
          onPress={() => {
            onConfirm(text.trim());
            setOpen(false);
            setText("");
          }}
        />
        <Button
          label={t("organizer.common.keep")}
          variant="secondary"
          onPress={() => {
            setOpen(false);
            setText("");
          }}
        />
      </View>
    </View>
  );
}

export function Pager({
  offset,
  limit,
  total,
  count,
  onChange,
}: {
  offset: number;
  limit: number;
  /** Total matches when the server reports it. */
  total: number | null;
  /** Rows on the current page. */
  count: number;
  onChange(offset: number): void;
}) {
  const { t } = useTranslation();
  const hasNext = total === null ? count >= limit : offset + count < total;
  if (offset === 0 && !hasNext) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <Button
        label={t("organizer.common.previous")}
        variant="secondary"
        size="sm"
        iconName="chevron-left"
        disabled={offset === 0}
        onPress={() => onChange(Math.max(0, offset - limit))}
      />
      <Text className="text-sm text-muted">
        {total === null
          ? t("organizer.common.rangeOpen", {
              from: count ? offset + 1 : 0,
              to: offset + count,
            })
          : t("organizer.common.range", {
              from: count ? offset + 1 : 0,
              to: offset + count,
              total,
            })}
      </Text>
      <Button
        label={t("organizer.common.next")}
        variant="secondary"
        size="sm"
        iconName="chevron-right"
        disabled={!hasNext}
        onPress={() => onChange(offset + limit)}
      />
    </View>
  );
}

/**
 * Section switcher: a horizontally scrollable segmented control (pill
 * container, active segment filled ink) so many tabs fit on a phone.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: Option<NoInfer<T>>[];
  value: T;
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="grow-0"
    >
      <View
        accessibilityRole="tablist"
        accessibilityLabel={label}
        className="flex-row gap-1 rounded-2xl border border-line bg-white/70 p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.value === value;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => onChange(tab.value)}
              testID={`tab-${tab.value}`}
              className={`min-h-11 items-center justify-center rounded-xl px-4 ${selected ? "bg-ink" : "bg-transparent active:bg-white"}`}
            >
              <Text
                className={`${selected ? "font-semibold text-white" : "font-medium text-muted"}`}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** Label/value line used in record lists. */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Text className="text-sm leading-5 text-ink">
      <Text className="text-muted">{label}: </Text>
      <Text className="font-semibold">{value}</Text>
    </Text>
  );
}

/** Copies text where a clipboard exists; false means "select it manually". */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS !== "web") return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function numberOrNull(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
}

export function isWholeNumber(text: string): boolean {
  return /^\d+$/.test(text.trim());
}
