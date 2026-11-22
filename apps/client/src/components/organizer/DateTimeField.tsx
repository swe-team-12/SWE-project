import { createElement } from "react";
import { Platform, Text, TextInput, View } from "react-native";

import { Icon, palette } from "@/components/icons";

interface DateTimeFieldProps {
  label: string;
  /** "YYYY-MM-DDTHH:mm" (date-time) or "YYYY-MM-DD" (date); "" when empty. */
  value: string;
  onChange(value: string): void;
  mode?: "datetime" | "date";
  error?: string;
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Date or date-time input. On the web it is the browser's native picker; on
 * devices without one the person types "YYYY-MM-DD HH:MM" (never raw ISO).
 */
export function DateTimeField({
  label,
  value,
  onChange,
  mode = "datetime",
  error,
  hint,
  disabled,
  testID,
}: DateTimeFieldProps) {
  const describedBy = error ?? hint;
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {Platform.OS === "web" ? (
        createElement("input", {
          type: mode === "date" ? "date" : "datetime-local",
          value,
          disabled,
          "aria-label": label,
          "aria-invalid": error ? true : undefined,
          "data-testid": testID,
          onChange: (event: { target: { value: string } }) =>
            onChange(event.target.value),
          style: {
            height: 56,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: error ? "#C2364A" : "#DBE5DE",
            backgroundColor: disabled ? "#EDF3EE" : "#FFFFFF",
            color: "#0C1F17",
            paddingLeft: 16,
            paddingRight: 12,
            fontSize: 16,
            fontFamily: "inherit",
            boxSizing: "border-box",
            width: "100%",
            minWidth: 0,
          },
        })
      ) : (
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={describedBy}
          testID={testID}
          editable={!disabled}
          value={value.replace("T", " ")}
          onChangeText={onChange}
          placeholder={mode === "date" ? "2026-12-31" : "2026-12-31 18:00"}
          placeholderTextColor="#8A9A91"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          className={`h-14 rounded-2xl border bg-white px-4 py-0 text-base leading-6 text-ink ${error ? "border-danger" : "border-line"}`}
        />
      )}
      {error ? (
        <View className="flex-row items-start gap-1">
          <Icon name="alert" size={16} color={palette.danger} />
          <Text accessibilityRole="alert" className="flex-1 text-sm text-danger">
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text className="text-xs text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
