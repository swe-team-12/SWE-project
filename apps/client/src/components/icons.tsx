import { Platform } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Small line-icon set drawn with react-native-svg (no icon font needed).
 * Icons are decorative: they are hidden from assistive technology, so the
 * control that contains one must carry its own accessible label.
 *
 * Props: `name` (see IconName), `size` in px (default 20), `color` (any SVG
 * colour, default ink) and `strokeWidth` (default 2).
 */

// Design tokens as raw values for SVG/QR drawing (mirrors tailwind.config.js).
export const palette = {
  ink: "#0C1F17",
  night: "#07140E",
  muted: "#5C6F65",
  canvas: "#EDF3EE",
  white: "#FFFFFF",
  brand: "#0F7B45",
  aqua: "#17995A",
  mint: "#6BE892",
  mintsoft: "#DDF6E4",
  line: "#DBE5DE",
  danger: "#C2364A",
  warning: "#A15C00",
} as const;

const paths = {
  "chevron-left": ["M15 18l-6-6 6-6"],
  "chevron-right": ["M9 18l6-6-6-6"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "arrow-right": ["M5 12h14", "M13 6l6 6-6 6"],
  bell: [
    "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9",
    "M13.73 21a2 2 0 01-3.46 0",
  ],
  search: ["M21 21l-4.35-4.35"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  calendar: ["M3 9h18", "M8 3v4", "M16 3v4"],
  pin: ["M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"],
  ticket: [
    "M3 8a2 2 0 002-2h14a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H5a2 2 0 00-2-2v-2a2 2 0 000-4z",
    "M14 6v12",
  ],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  clock: ["M12 7v5l3 2"],
  user: ["M4 21a8 8 0 0116 0"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  receipt: [
    "M6 3h12v18l-3-2-3 2-3-2-3 2z",
    "M9 8h6",
    "M9 12h6",
  ],
  help: ["M9.5 9a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2", "M12 17h.01"],
  mail: ["M3 7l9 6 9-6"],
  lock: ["M8 11V8a4 4 0 018 0v3"],
  sparkle: [
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  ],
  alert: ["M12 8v5", "M12 16.5h.01"],
  qr: ["M14 14h3v3h-3z", "M20 14v2", "M14 20h2", "M18 18h3v3"],
  wheelchair: [
    "M10 7v6h6l2 5",
    "M14 18.5A5 5 0 117 11",
  ],
  card: ["M3 10h18"],
} as const;

export type IconName = keyof typeof paths;

// Extra closed shapes that some icons need besides their stroked paths.
function Extras({ name, color }: { name: IconName; color: string }) {
  switch (name) {
    case "search":
      return <Circle cx="11" cy="11" r="7" />;
    case "calendar":
      return <Rect x="3" y="5" width="18" height="16" rx="3" />;
    case "pin":
      return <Circle cx="12" cy="10" r="2.5" />;
    case "clock":
    case "help":
    case "alert":
      return <Circle cx="12" cy="12" r="9" />;
    case "user":
      return <Circle cx="12" cy="8" r="4" />;
    case "mail":
      return <Rect x="3" y="5" width="18" height="14" rx="3" />;
    case "lock":
      return <Rect x="5" y="11" width="14" height="10" rx="3" />;
    case "qr":
      return (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" />
        </>
      );
    case "wheelchair":
      return <Circle cx="10" cy="4" r="1.6" fill={color} />;
    case "card":
      return <Rect x="3" y="5" width="18" height="14" rx="3" />;
    default:
      return null;
  }
}

export function Icon({
  name,
  size = 20,
  color = palette.ink,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(Platform.OS === "web"
        ? { "aria-hidden": true, focusable: false }
        : {
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants",
          })}
    >
      <Extras name={name} color={color} />
      {paths[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
