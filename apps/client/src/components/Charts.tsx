import { Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";

const WIDTH = 560;
// The SVG viewBox is scaled down to fit narrow dashboard cards (~300px wide),
// so chart text needs a larger base size to stay legible after scaling.
const INK = "#102A43";
const LABEL_SIZE = 17;
const VALUE_SIZE = 16;

export function BarChart({
  rows,
}: {
  rows: { label: string; value: number; formatted?: string }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const height = Math.max(72, rows.length * 48 + 12);
  const summary = rows
    .map((row) => `${row.label}: ${row.formatted ?? row.value}`)
    .join("; ");
  return (
    <View
      className="gap-3"
      accessibilityRole="summary"
      accessibilityLabel={summary}
    >
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
        accessible={false}
      >
        {rows.map((row, index) => {
          const y = index * 48 + 8;
          const barWidth = Math.max(4, (row.value / max) * 220);
          return (
            <G key={row.label}>
              <SvgText
                x={0}
                y={y + 17}
                fill={INK}
                fontSize={LABEL_SIZE}
                fontWeight="700"
              >
                {row.label.slice(0, 18)}
              </SvgText>
              <Rect
                x={170}
                y={y}
                width={220}
                height={22}
                rx={11}
                fill="#E6EFF5"
              />
              <Rect
                x={170}
                y={y}
                width={barWidth}
                height={22}
                rx={11}
                fill="#00A7A5"
              />
              <SvgText
                x={400}
                y={y + 17}
                fill={INK}
                fontSize={VALUE_SIZE}
                fontWeight="700"
              >
                {row.formatted ?? row.value}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {rows.length === 0 ? <Text className="text-sm text-muted">—</Text> : null}
    </View>
  );
}

export function LineChart({
  points,
}: {
  points: { label: string; value: number; formatted?: string }[];
}) {
  const height = 226;
  const chartLeft = 32;
  const chartRight = WIDTH - 24;
  const chartTop = 20;
  const chartBottom = 166;
  const max = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map((point, index) => ({
    ...point,
    x:
      points.length <= 1
        ? chartLeft
        : chartLeft + (index / (points.length - 1)) * (chartRight - chartLeft),
    y: chartBottom - (point.value / max) * (chartBottom - chartTop),
  }));
  const summary = points
    .map((point) => `${point.label}: ${point.formatted ?? point.value}`)
    .join("; ");
  return (
    <View
      className="gap-3"
      accessibilityRole="summary"
      accessibilityLabel={summary}
    >
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
        accessible={false}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = chartBottom - fraction * (chartBottom - chartTop);
          return (
            <Line
              key={fraction}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke="#D9E2EC"
              strokeWidth={1}
            />
          );
        })}
        {coordinates.length > 1 ? (
          <Polyline
            points={coordinates
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
            fill="none"
            stroke="#007C83"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coordinates.map((point) => (
          <G key={point.label}>
            <Circle
              cx={point.x}
              cy={point.y}
              r={6}
              fill="#00A7A5"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
            <SvgText
              x={point.x}
              y={202}
              textAnchor="middle"
              fill={INK}
              fontSize={LABEL_SIZE}
              fontWeight="600"
            >
              {point.label.slice(5)}
            </SvgText>
          </G>
        ))}
      </Svg>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        {points.map((point) => (
          <Text key={point.label} className="text-sm font-semibold text-ink">
            {point.label}: {point.formatted ?? point.value}
          </Text>
        ))}
        {points.length === 0 ? (
          <Text className="text-sm text-muted">—</Text>
        ) : null}
      </View>
    </View>
  );
}

export function Funnel({
  values,
}: {
  values: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...values.map((item) => item.value));
  const height = Math.max(72, values.length * 50 + 10);
  const summary = values
    .map((item) => `${item.label}: ${item.value}`)
    .join("; ");
  return (
    <View accessibilityRole="summary" accessibilityLabel={summary}>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
        accessible={false}
      >
        {values.map((item, index) => {
          const width = Math.max(190, (item.value / max) * 500);
          const x = (WIDTH - width) / 2;
          const y = index * 50;
          return (
            <G key={item.label}>
              <Rect
                x={x}
                y={y}
                width={width}
                height={40}
                rx={12}
                fill={INK}
                opacity={1 - index * 0.08}
              />
              <SvgText
                x={WIDTH / 2}
                y={y + 25}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={LABEL_SIZE}
                fontWeight="700"
              >
                {item.label}: {item.value}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
