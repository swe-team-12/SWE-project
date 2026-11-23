import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";

import type { Seat } from "@/types";
import { Icon, palette } from "./icons";
import { SegmentedControl } from "./design/SegmentedControl";

// e2e/web.spec.ts locates seats by these exact fills (available/selected),
// so no other shape inside the map may use them.
const SEAT_FILL: Record<Seat["status"], string> = {
  available: "#FFFFFF",
  selected: "#0C1F17",
  held: "#DDF6E4",
  sold: "#EEF2EF",
  unavailable: "#F6E3E6",
};

const SEAT_STROKE: Record<Seat["status"], string> = {
  available: "#B9C9BF",
  selected: "#0C1F17",
  held: "#17995A",
  sold: "#C9D4CD",
  unavailable: "#E2B7BF",
};

const HATCH: Partial<Record<Seat["status"], string>> = {
  sold: "#A9B8AF",
  unavailable: "#C2364A",
};

// Every state also has its own shape cue, so it never depends on colour
// alone: selected = dark square with a side bar and check, held = dashed
// outline, sold/unavailable = hatched (unavailable also gets a dash mark).
const marks: Record<Seat["status"], string> = {
  available: "",
  selected: "✓",
  held: "~",
  sold: "×",
  unavailable: "–",
};

const SEAT = 28;
const PITCH_X = 36;
const PITCH_Y = 38;
const PAD_X = 34;
const STAGE_H = 34;
const TOP = STAGE_H + 30;

const NEXT_KEYS = ["ArrowRight", "ArrowDown"];
const PREVIOUS_KEYS = ["ArrowLeft", "ArrowUp"];
const ALL = "__all__";

function isSelectable(seat: Seat): boolean {
  return seat.status === "available" || seat.status === "selected";
}

function focusSeat(seatId: string): void {
  if (typeof document === "undefined") return;
  (
    document.getElementById(`seat-${seatId}`) as { focus?(): void } | null
  )?.focus?.();
}

/** Diagonal hatch segments inside a size×size square at (x, y). */
function hatchLines(x: number, y: number, size: number): number[][] {
  const inset = 4;
  const span = size - inset * 2;
  const lines: number[][] = [];
  for (let c = 6; c < span * 2; c += 7) {
    const x1 = Math.max(0, c - span);
    const y1 = Math.min(c, span);
    const x2 = Math.min(c, span);
    const y2 = Math.max(0, c - span);
    lines.push([x + inset + x1, y + inset + y1, x + inset + x2, y + inset + y2]);
  }
  return lines;
}

/**
 * Places seats on a compact grid: the API coordinates are ranked per axis so
 * seats keep their relative order but get a finger-sized pitch.
 */
function layoutSeats<T extends Seat>(seats: T[]) {
  const xs = [...new Set(seats.map((seat) => seat.x))].sort((a, b) => a - b);
  const ys = [...new Set(seats.map((seat) => seat.y))].sort((a, b) => a - b);
  // Large jumps between neighbouring x values are aisles between sections.
  const steps = xs.slice(1).map((value, index) => value - xs[index]);
  const typical = steps.length ? [...steps].sort((a, b) => a - b)[0] : 1;
  const columnOf = new Map<number, number>();
  let column = 0;
  xs.forEach((value, index) => {
    if (index > 0) column += steps[index - 1] > typical * 1.3 ? 2 : 1;
    columnOf.set(value, column);
  });
  const rowOf = new Map(ys.map((value, index) => [value, index]));
  const columns = column + 1;
  const width = Math.max(PAD_X * 2 + columns * PITCH_X, 240);
  const height = TOP + ys.length * PITCH_Y + 12;
  const placed = seats.map((seat) => ({
    seat,
    px: PAD_X + (columnOf.get(seat.x) ?? 0) * PITCH_X + (PITCH_X - SEAT) / 2,
    py: TOP + (rowOf.get(seat.y) ?? 0) * PITCH_Y,
  }));
  const rowLabels = ys.map((value) => {
    const first = seats.find((seat) => seat.y === value);
    return { label: first?.row ?? "", y: TOP + (rowOf.get(value) ?? 0) * PITCH_Y };
  });
  return { placed, width, height, rowLabels };
}

function LegendSwatch({ status }: { status: Seat["status"] }) {
  const hatch = HATCH[status];
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 22 22"
      {...({ "aria-hidden": true } as object)}
    >
      <Rect
        x={1}
        y={1}
        width={status === "selected" ? 16 : 20}
        height={20}
        rx={6}
        fill={SEAT_FILL[status]}
        stroke={SEAT_STROKE[status]}
        strokeWidth={1.5}
        strokeDasharray={status === "held" ? "3 2" : undefined}
      />
      {status === "selected" ? (
        <Rect x={18.5} y={3} width={3} height={16} rx={1.5} fill={palette.mint} />
      ) : null}
      {hatch
        ? hatchLines(1, 1, 20).map(([x1, y1, x2, y2]) => (
            <Line
              key={`${x1}-${y1}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={hatch}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))
        : null}
    </Svg>
  );
}

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
  const [focusedId, setFocusedId] = useState<string>();
  const [chosenSection, setSection] = useState<string>();
  const categoryLabels: Record<string, string> = {
    premium: t("ui.premiumSeatCategory"),
    standard: t("ui.standardSeatCategory"),
    accessible: t("ui.accessibleSeatCategory"),
  };
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
  const sections = useMemo(() => {
    const grouped = new Map<string, typeof display>();
    for (const seat of display)
      grouped.set(seat.section, [...(grouped.get(seat.section) ?? []), seat]);
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [display]);
  const sectionNames = sections.map(([name]) => name);
  const firstSelectedSection = display.find(
    (seat) => seat.status === "selected",
  )?.section;
  const section =
    chosenSection === ALL || sectionNames.includes(chosenSection ?? "")
      ? chosenSection!
      : sectionNames.length > 1
        ? (firstSelectedSection ?? sectionNames[0])
        : ALL;
  const visible =
    section === ALL
      ? display
      : (sections.find(([name]) => name === section)?.[1] ?? []);
  // Cheap (one pass per axis); the React Compiler memoizes it.
  const layout = layoutSeats(visible);
  const selectable = visible.filter(isSelectable);
  // Roving tab stop: the map is a single tab stop and the arrow keys move
  // between selectable seats, so keyboard users are not forced through
  // every seat to leave the map.
  const tabStopId =
    selectable.find((seat) => seat.id === focusedId)?.id ??
    selectable.find((seat) => seat.status === "selected")?.id ??
    selectable[0]?.id;

  const seatLabel = (seat: Seat) =>
    t("ui.seatAccessibilityLabel", {
      section: seat.section,
      row: seat.row,
      number: seat.number,
      category: categoryLabels[seat.price_category] ?? seat.price_category,
      accessibility:
        seat.is_accessible && seat.price_category !== "accessible"
          ? t("ui.accessibleSeatSuffix")
          : "",
      status: t(`status.${seat.status}`),
    });

  const onSeatKeyDown = (
    event: { key: string; preventDefault(): void },
    seat: Seat,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(seat);
      return;
    }
    const index = selectable.findIndex((item) => item.id === seat.id);
    const target = NEXT_KEYS.includes(event.key)
      ? selectable[index + 1]
      : PREVIOUS_KEYS.includes(event.key)
        ? selectable[index - 1]
        : event.key === "Home"
          ? selectable[0]
          : event.key === "End"
            ? selectable[selectable.length - 1]
            : undefined;
    if (!target) return;
    event.preventDefault();
    setFocusedId(target.id);
    focusSeat(target.id);
  };

  const availableIn = (items: Seat[]) =>
    items.filter((seat) => seat.status === "available").length;

  const renderSeat = ({
    seat,
    px,
    py,
  }: {
    seat: (typeof visible)[number];
    px: number;
    py: number;
  }): ReactNode[] => {
    const enabled = isSelectable(seat);
    const select = enabled ? () => onSelect(seat) : undefined;
    const isSelected = seat.status === "selected";
    // react-native-svg's responder shim currently forwards React Native
    // responder props to DOM nodes. On web, a null onPress prevents that shim
    // and preserves the DOM-safe onClick.
    const pressProps =
      Platform.OS === "web" ? { onClick: select, onPress: null } : { onPress: select };
    const webProps =
      Platform.OS === "web"
        ? {
            id: `seat-${seat.id}`,
            // Not "button": react-native-web turns role="button" into an HTML
            // <button>, which does not render inside an SVG.
            role: "checkbox",
            tabIndex: seat.id === tabStopId ? 0 : -1,
            "aria-checked": isSelected,
            "aria-disabled": !enabled,
            onFocus: () => setFocusedId(seat.id),
            onKeyDown: enabled
              ? (event: { key: string; preventDefault(): void }) =>
                  onSeatKeyDown(event, seat)
              : undefined,
            style: { cursor: enabled ? "pointer" : "not-allowed" },
          }
        : {};
    const passive = {
      ...pressProps,
      "aria-hidden": true,
      style: { pointerEvents: "none", userSelect: "none" },
    };
    const hatch = HATCH[seat.status];
    const width = isSelected ? SEAT - 5 : SEAT;
    const label =
      seat.status === "sold" || seat.status === "unavailable"
        ? seat.status === "unavailable"
          ? marks.unavailable
          : ""
        : seat.number;
    return [
      <Rect
        key={seat.id}
        x={px}
        y={py}
        width={width}
        height={SEAT}
        rx={8}
        fill={SEAT_FILL[seat.status]}
        stroke={SEAT_STROKE[seat.status]}
        strokeWidth={isSelected ? 2 : 1.5}
        strokeDasharray={seat.status === "held" ? "4 3" : undefined}
        {...({
          ...pressProps,
          ...webProps,
        } as unknown as ComponentProps<typeof Rect>)}
        accessibilityLabel={seatLabel(seat)}
      />,
      isSelected ? (
        <Rect
          key={`${seat.id}-bar`}
          x={px + SEAT - 3}
          y={py + 3}
          width={4}
          height={SEAT - 6}
          rx={2}
          fill={palette.mint}
          {...(passive as unknown as ComponentProps<typeof Rect>)}
        />
      ) : null,
      ...(hatch
        ? hatchLines(px, py, SEAT).map(([x1, y1, x2, y2]) => (
            <Line
              key={`${seat.id}-h-${x1}-${y1}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={hatch}
              strokeWidth={1.5}
              strokeLinecap="round"
              {...(passive as unknown as ComponentProps<typeof Line>)}
            />
          ))
        : []),
      label ? (
        <SvgText
          key={`${seat.id}-mark`}
          x={px + width / 2}
          y={py + SEAT / 2 + 4}
          textAnchor="middle"
          fill={isSelected ? palette.white : palette.ink}
          fontSize={seat.number.length > 2 ? 9 : 11}
          fontWeight="bold"
          {...(passive as unknown as ComponentProps<typeof SvgText>)}
        >
          {label}
        </SvgText>
      ) : null,
      seat.is_accessible ? (
        <SvgText
          key={`${seat.id}-a11y`}
          x={px + width - 1}
          y={py + 1}
          textAnchor="middle"
          fill={isSelected ? palette.mint : palette.brand}
          fontSize={10}
          fontWeight="bold"
          {...(passive as unknown as ComponentProps<typeof SvgText>)}
        >
          {"♿︎"}
        </SvgText>
      ) : null,
    ];
  };

  const legendStatuses = Object.keys(SEAT_FILL) as Seat["status"][];

  return (
    <View className="gap-4">
      {sectionNames.length > 1 && !listMode ? (
        <View className="gap-2">
          <View className="flex-row flex-wrap items-end justify-between gap-2">
            <View>
              <Text className="text-xl font-semibold text-ink">
                {section === ALL
                  ? t("checkout.allSections")
                  : t("checkout.seatSection", { section })}
              </Text>
              <Text className="text-sm text-muted">
                {t("checkout.sectionAvailability", {
                  available: availableIn(visible),
                  total: visible.length,
                })}
              </Text>
            </View>
          </View>
          <SegmentedControl
            label={t("checkout.sectionTabs")}
            value={section}
            onChange={(value) => {
              setSection(value);
              setFocusedId(undefined);
            }}
            options={[
              ...sectionNames.map((name) => ({
                value: name,
                label: name,
                accessibilityLabel: t("checkout.seatSection", { section: name }),
              })),
              { value: ALL, label: t("checkout.allSections") },
            ]}
          />
        </View>
      ) : null}
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <View className="flex-row flex-wrap gap-x-4 gap-y-2">
          {legendStatuses.map((status) => (
            <View className="flex-row items-center gap-1.5" key={status}>
              <LegendSwatch status={status} />
              <Text className="text-xs font-semibold text-ink">
                {t(`status.${status}`)}
              </Text>
            </View>
          ))}
          <View className="flex-row items-center gap-1.5">
            <View className="h-[22px] w-[22px] items-center justify-center rounded-md border border-line bg-white">
              <Icon name="wheelchair" size={14} color={palette.brand} />
            </View>
            <Text className="text-xs font-semibold text-ink">
              {t("checkout.accessibleSeatLegend")}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => setListMode((value) => !value)}
          accessibilityRole="button"
          className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 active:opacity-80"
        >
          <Icon name={listMode ? "pin" : "filter"} size={16} />
          <Text className="font-medium text-ink">
            {listMode ? t("ui.visualMap") : t("ui.accessibleList")}
          </Text>
        </Pressable>
      </View>
      <Text className="text-xs text-muted">
        {listMode ? t("checkout.seatListHelp") : t("checkout.seatMapHelp")}
      </Text>
      {listMode ? (
        <ScrollView className="max-h-96 rounded-3xl border border-line bg-white p-3">
          <View className="gap-4">
            {sections.map(([name, sectionSeats]) => (
              <View className="gap-2" key={name}>
                <Text
                  accessibilityRole="header"
                  className="text-sm font-semibold text-ink"
                >
                  {t("checkout.seatSection", { section: name })}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {sectionSeats.map((seat) => {
                    const enabled = isSelectable(seat);
                    const checked = seat.status === "selected";
                    return (
                      <Pressable
                        key={seat.id}
                        disabled={!enabled}
                        onPress={() => onSelect(seat)}
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked,
                          disabled: !enabled,
                        }}
                        aria-checked={checked}
                        aria-disabled={!enabled}
                        accessibilityLabel={seatLabel(seat)}
                        className={`min-h-12 min-w-28 justify-center rounded-2xl border px-3 ${checked ? "border-ink bg-ink" : "border-line bg-white"} ${enabled ? "" : "opacity-60"}`}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <Text
                            className={`font-medium ${checked ? "text-white" : "text-ink"}`}
                          >
                            {seat.section}-{seat.row}-{seat.number}
                          </Text>
                          {seat.is_accessible ? (
                            <Icon
                              name="wheelchair"
                              size={16}
                              color={checked ? palette.mint : palette.muted}
                            />
                          ) : null}
                        </View>
                        <Text
                          className={`text-xs ${checked ? "text-mint" : "text-muted"}`}
                        >
                          {marks[seat.status]} {t(`status.${seat.status}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          horizontal
          className="rounded-3xl border border-line bg-canvas"
          contentContainerClassName="min-w-full justify-center"
        >
          <Svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            accessibilityLabel={t("ui.seatMapLabel")}
          >
            <Rect
              x={PAD_X}
              y={12}
              width={layout.width - PAD_X * 2}
              height={STAGE_H - 6}
              rx={14}
              fill={palette.night}
            />
            <SvgText
              x={layout.width / 2}
              y={12 + (STAGE_H - 6) / 2 + 4}
              textAnchor="middle"
              fill={palette.mint}
              fontSize="11"
              fontWeight="bold"
              letterSpacing={2}
            >
              {t("ui.stage")}
            </SvgText>
            {layout.rowLabels.map((row) => (
              <SvgText
                key={`row-${row.y}`}
                x={PAD_X / 2}
                y={row.y + SEAT / 2 + 4}
                textAnchor="middle"
                fill={palette.muted}
                fontSize="11"
                fontWeight="bold"
              >
                {row.label}
              </SvgText>
            ))}
            {layout.placed.map(renderSeat)}
          </Svg>
        </ScrollView>
      )}
      <Text className="text-sm font-medium text-ink" accessibilityLiveRegion="polite">
        {t("checkout.seatsSelectedCount", { count: selected.length })}
      </Text>
    </View>
  );
}
