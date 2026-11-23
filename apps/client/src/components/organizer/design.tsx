import type { PropsWithChildren, ReactNode } from "react";
import { Text, View } from "react-native";

import { Icon, type IconName, palette } from "@/components/icons";
import { DarkCard, LabeledValue, SectionTitle, Surface } from "@/components/ui";

/*
 * Organizer-only layout pieces built on the shared design primitives.
 *
 * SectionCard  white card with a SectionTitle (title, subtitle?, action?).
 * HeroStats    night card with headline label/value pairs (sold, gross, net).
 * ProgressMeter sold/capacity bar with its numbers as text (never colour-only).
 * RowCard      one record in a list: a soft inset row inside a white card.
 * IconTile     small rounded icon square used in card headers.
 */

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  testID,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: ReactNode;
  testID?: string;
}>) {
  return (
    <Surface className="gap-4" testID={testID}>
      <SectionTitle title={title} subtitle={subtitle} action={action} />
      {children}
    </Surface>
  );
}

export function HeroStats({
  kicker,
  items,
  children,
  testID,
}: PropsWithChildren<{
  kicker?: string;
  items: { label: string; value: string }[];
  testID?: string;
}>) {
  return (
    <DarkCard className="gap-5" testID={testID}>
      {kicker ? (
        <View className="flex-row items-center gap-2">
          <View className="h-8 w-8 items-center justify-center rounded-xl bg-mint/15">
            <Icon name="calendar" size={16} color={palette.mint} />
          </View>
          <Text className="flex-1 text-sm font-semibold text-white/75">
            {kicker}
          </Text>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-x-6 gap-y-4">
        {items.map((item) => (
          <View key={item.label} className="min-w-40 flex-1 basis-40">
            <LabeledValue
              label={item.label}
              value={item.value}
              size="xl"
              tone="dark"
            />
          </View>
        ))}
      </View>
      {children}
    </DarkCard>
  );
}

export function ProgressMeter({
  label,
  value,
  max,
  valueText,
  tone = "light",
}: {
  label: string;
  value: number;
  max: number;
  valueText: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      className="gap-2"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${valueText}`}
      accessibilityValue={{ min: 0, max: Math.max(max, 1), now: value }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text
          className={`text-xs font-semibold ${dark ? "text-white/65" : "text-muted"}`}
        >
          {label}
        </Text>
        <Text
          className={`text-sm font-semibold ${dark ? "text-white" : "text-ink"}`}
        >
          {valueText}
        </Text>
      </View>
      <View
        className={`h-2 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-mintsoft"}`}
      >
        <View
          className={`h-2 rounded-full ${dark ? "bg-mint" : "bg-brand"}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </View>
    </View>
  );
}

export function RowCard({
  children,
  testID,
  className = "",
}: PropsWithChildren<{ testID?: string; className?: string }>) {
  return (
    <View
      testID={testID}
      className={`gap-2 rounded-2xl border border-line bg-canvas/60 p-4 ${className}`}
    >
      {children}
    </View>
  );
}

export function IconTile({
  name,
  tone = "light",
}: {
  name: IconName;
  tone?: "light" | "dark" | "danger" | "warning";
}) {
  const styles = {
    light: ["bg-mintsoft", palette.brand],
    dark: ["bg-mint/15", palette.mint],
    danger: ["bg-red-100", palette.danger],
    warning: ["bg-amber-100", palette.warning],
  }[tone];
  return (
    <View
      className={`h-10 w-10 items-center justify-center rounded-2xl ${styles[0]}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name={name} size={18} color={styles[1]} />
    </View>
  );
}
