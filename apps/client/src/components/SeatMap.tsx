import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";

import type { Seat } from "@/types";

const colors: Record<Seat["status"], string> = {
  available: "#FFFFFF",
  selected: "#00A7A5",
  held: "#F0B429",
  sold: "#9FB3C8",
  unavailable: "#C43D4B",
};

export function SeatMap({
  seats,
  selected,
  onSelect,
}: {
  seats: Seat[];
  selected: string[];
  onSelect(seat: Seat): void;
}) {
  const { t } = useTranslation();
  const [listMode, setListMode] = useState(false);
  const display = useMemo(
    () =>
      seats.map((seat) => ({
        ...seat,
        status: selected.includes(seat.id)
          ? ("selected" as const)
          : seat.status,
      })),
    [seats, selected],
  );
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <View className="flex-row flex-wrap gap-3">
          {Object.entries(colors).map(([status, color]) => (
            <View className="flex-row items-center gap-1" key={status}>
              <View
                className="h-3 w-3 rounded-full border border-line"
                style={{ backgroundColor: color }}
              />
              <Text className="text-xs capitalize text-muted">
                {t(`status.${status}`)}
              </Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => setListMode((value) => !value)}
          accessibilityRole="button"
          className="min-h-11 justify-center rounded-xl border border-brand px-3"
        >
          <Text className="font-bold text-brand">
            {listMode ? t("ui.visualMap") : t("ui.accessibleList")}
          </Text>
        </Pressable>
      </View>
      {listMode ? (
        <ScrollView className="max-h-96 rounded-2xl border border-line bg-white p-3">
          <View className="flex-row flex-wrap gap-2">
            {display.map((seat) => {
              const enabled =
                seat.status === "available" || seat.status === "selected";
              return (
                <Pressable
                  key={seat.id}
                  disabled={!enabled}
                  onPress={() => onSelect(seat)}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: seat.status === "selected",
                    disabled: !enabled,
                  }}
                  aria-checked={seat.status === "selected"}
                  aria-disabled={!enabled}
                  accessibilityLabel={t("ui.seatAccessibilityLabel", {
                    section: seat.section,
                    row: seat.row,
                    number: seat.number,
                    category: seat.price_category,
                    accessibility: seat.is_accessible
                      ? t("ui.accessibleSeatSuffix")
                      : "",
                    status: t(`status.${seat.status}`),
                  })}
                  className={`min-h-12 min-w-28 justify-center rounded-xl border px-3 ${seat.status === "selected" ? "border-brand bg-teal-50" : "border-line bg-white"}`}
                >
                  <Text className="font-bold text-ink">
                    {seat.section}-{seat.row}-{seat.number}{" "}
                    {seat.is_accessible ? "♿" : ""}
                  </Text>
                  <Text className="text-xs capitalize text-muted">
                    {t(`status.${seat.status}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          horizontal
          className="rounded-2xl border border-line bg-white"
        >
          <Svg
            width={460}
            height={280}
            viewBox="0 0 460 280"
            accessibilityLabel={t("ui.seatMapLabel")}
          >
            <Rect
              x="100"
              y="14"
              width="260"
              height="28"
              rx="8"
              fill="#102A43"
            />
            <SvgText
              x="230"
              y="33"
              textAnchor="middle"
              fill="white"
              fontSize="12"
              fontWeight="bold"
            >
              {t("ui.stage")}
            </SvgText>
            {[
              ["B", 76.5],
              ["A", 233.5],
              ["C", 390.5],
            ].map(([section, x]) => (
              <SvgText
                key={section}
                x={x}
                y="70"
                textAnchor="middle"
                fill="#627D98"
                fontSize="11"
                fontWeight="bold"
              >
                {section}
              </SvgText>
            ))}
            {display.map((seat) => {
              const enabled =
                seat.status === "available" || seat.status === "selected";
              // react-native-svg's responder shim currently forwards React
              // Native responder props to DOM <circle> nodes. On web, a null
              // onPress prevents that shim and preserves the DOM-safe onClick.
              const interactionProps =
                Platform.OS === "web"
                  ? ({
                      onClick: enabled ? () => onSelect(seat) : undefined,
                      onPress: null,
                    } as unknown as ComponentProps<typeof Circle>)
                  : { onPress: enabled ? () => onSelect(seat) : undefined };
              return (
                <Circle
                  key={seat.id}
                  cx={seat.x}
                  cy={seat.y}
                  r={seat.is_accessible ? 8 : 6}
                  fill={colors[seat.status]}
                  stroke={seat.status === "selected" ? "#102A43" : "#486581"}
                  strokeWidth={seat.status === "selected" ? 3 : 1}
                  {...interactionProps}
                  accessibilityLabel={t("ui.seatAccessibilityLabel", {
                    section: seat.section,
                    row: seat.row,
                    number: seat.number,
                    category: seat.price_category,
                    accessibility: seat.is_accessible
                      ? t("ui.accessibleSeatSuffix")
                      : "",
                    status: t(`status.${seat.status}`),
                  })}
                />
              );
            })}
          </Svg>
        </ScrollView>
      )}
    </View>
  );
}
