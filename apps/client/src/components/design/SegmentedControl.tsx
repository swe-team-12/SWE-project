import { Pressable, Text, View } from "react-native";

// Kept free of expo-router so components rendered in plain jest tests
// (SeatMap) can use it. Re-exported from ui.tsx.

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = "light",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange(value: T): void;
  label: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={`flex-row flex-wrap gap-1 self-start rounded-2xl p-1 ${dark ? "bg-white/10" : "border border-line bg-white/70"}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            onPress={() => onChange(option.value)}
            className={`min-h-11 min-w-11 items-center justify-center rounded-xl px-4 ${active ? (dark ? "bg-mint" : "bg-ink") : "bg-transparent"}`}
          >
            <Text
              className={`font-bold ${active ? (dark ? "text-ink" : "text-white") : dark ? "text-white/75" : "text-muted"}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
