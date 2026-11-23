import { type Href, Link } from "expo-router";
import { type PropsWithChildren, type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, type IconName, palette } from "./icons";

/*
 * Shared presentational primitives (BiletFlow design language: soft green
 * canvas, white rounded cards, near-black "night" cards, mint pill CTAs).
 *
 * Existing exports keep their props; new optional props are additive.
 *
 * Surface      ViewProps + tone?: "light" | "night" | "mint" | "plain".
 * Button       label, onPress?, variant? ("primary" | "secondary" | "danger" |
 *              "ghost" | "dark" | "onDark"), size? ("sm" | "md" | "lg"),
 *              loading?, disabled?, icon? (ReactNode), iconName? (IconName),
 *              testID?, accessibilityLabel?, fullWidth?.
 * Field        TextInputProps + label, error?, hint?, icon? (IconName).
 * StatusBadge  status (translated through status.<status>), tone? ("light" |
 *              "dark") for use on night cards.
 * LoadingBlock label?.   ErrorBlock message, retry?.
 * Metric       label, value, hint?, icon? (IconName), tone? ("light"|"night").
 *
 * IconButton   icon (IconName), label (accessible name, required), onPress?,
 *              href? (renders a link), tone? ("light" | "dark" | "glass"),
 *              badge? (shows a small mint dot), size? (default 46).
 * ScreenHeader title, subtitle?, kicker?, backHref? or onBack? (shows a back
 *              icon button), backLabel?, right? (ReactNode), tone? ("light" |
 *              "dark"), titleSize? ("lg" | "xl"). The title is the page
 *              heading (accessibilityRole="header").
 * SegmentedControl options [{value,label,accessibilityLabel?}], value,
 *              onChange(value), label (group name), tone? ("light"|"dark"),
 *              scroll? (wraps when false, default false). Renders a tablist.
 * Chip         label, selected?, onPress? (button when set), icon? (IconName),
 *              tone? ("light" | "mint" | "dark" | "outlineMint"),
 *              accessibilityLabel?.
 * DarkCard     ViewProps; night card with white text expected inside.
 * Timeline     start, end (big labels), startCaption?, endCaption?, middle?
 *              (label above the line), tone? ("light" | "dark"). A start dot,
 *              solid then dashed line and an end dot.
 * LabeledValue label, value, align? ("left"|"center"|"right"), size? ("md" |
 *              "lg" | "xl"), tone? ("light" | "dark"), mono?.
 * TicketStub   children (top part), footer? (below the perforation),
 *              notchClassName? (background of the side notches, defaults to
 *              bg-night so it reads as cut-outs on a night panel), className?.
 * StickyActionBar children; white bar with rounded top for totals + CTA.
 * ClassCard    title, price, subtitle?, meta?, selected?, onPress?, disabled?,
 *              accessibilityLabel?; selectable ticket class tile (dark when
 *              selected), a radio when pressable.
 * SectionTitle title, action? (ReactNode), subtitle?.
 * Notice       children (text), tone? ("info" | "success" | "warning" |
 *              "danger"), icon? (IconName), role? ("alert" | "status").
 */

const surfaceTones = {
  light: "border border-line bg-panel shadow-panel",
  night: "bg-night shadow-float",
  mint: "border border-mint bg-mintsoft",
  plain: "border border-line bg-white/80",
} as const;

export function Surface({
  children,
  className = "",
  tone = "light",
  ...props
}: PropsWithChildren<ViewProps & { tone?: keyof typeof surfaceTones }>) {
  return (
    <View
      className={`rounded-3xl p-5 ${surfaceTones[tone]} ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}

type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "dark"
  | "onDark";

interface ButtonProps {
  label: string;
  onPress?(): void;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  iconName?: IconName;
  testID?: string;
  fullWidth?: boolean;
  /** Spoken name when the visible label alone is ambiguous (e.g. in a list). */
  accessibilityLabel?: string;
}

const buttonPalette: Record<
  ButtonVariant,
  { box: string; text: string; icon: string; spinner: string }
> = {
  primary: {
    box: "bg-mint border-mint",
    text: "text-ink",
    icon: palette.ink,
    spinner: palette.ink,
  },
  secondary: {
    box: "bg-white border-line",
    text: "text-ink",
    icon: palette.ink,
    spinner: palette.ink,
  },
  danger: {
    box: "bg-danger border-danger",
    text: "text-white",
    icon: palette.white,
    spinner: palette.white,
  },
  ghost: {
    box: "bg-transparent border-transparent",
    text: "text-brand",
    icon: palette.brand,
    spinner: palette.brand,
  },
  dark: {
    box: "bg-ink border-ink",
    text: "text-white",
    icon: palette.white,
    spinner: palette.white,
  },
  onDark: {
    box: "bg-white/10 border-white/25",
    text: "text-white",
    icon: palette.white,
    spinner: palette.white,
  },
};

const buttonSizes = {
  sm: { box: "min-h-11 px-4 py-2", text: "text-sm" },
  md: { box: "min-h-12 px-5 py-3", text: "text-base" },
  lg: { box: "min-h-14 px-6 py-3", text: "text-lg" },
} as const;

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  icon,
  iconName,
  testID,
  fullWidth,
  accessibilityLabel,
}: ButtonProps) {
  const tone = buttonPalette[variant];
  const sizing = buttonSizes[size];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      className={`flex-row items-center justify-center gap-2 rounded-xl border ${sizing.box} ${tone.box} ${fullWidth ? "w-full" : ""} ${disabled ? "opacity-50" : "active:opacity-80"}`}
    >
      {loading ? (
        <ActivityIndicator color={tone.spinner} />
      ) : (
        (icon ??
        (iconName ? <Icon name={iconName} size={18} color={tone.icon} /> : null))
      )}
      <Text className={`shrink text-center font-medium ${sizing.text} ${tone.text}`}>
        {label}
      </Text>
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  icon?: IconName;
}

export function Field({ label, error, hint, icon, ...props }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const input = (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor="#7D8F85"
      textAlignVertical={props.multiline ? "top" : "center"}
      className={`${props.multiline ? "min-h-14 py-3" : "h-14 py-0"} ${icon ? "flex-1 border-0 bg-transparent pl-0" : `rounded-2xl border bg-white ${error ? "border-danger" : "border-line"}`} px-4 text-base leading-6 text-ink`}
      {...props}
      // With an icon, the wrapper draws the border and the focus ring, so the
      // bare input inside it must not draw its own.
      style={
        icon
          ? [props.style, webOnly({ outlineStyle: "none", boxShadow: "none" })]
          : props.style
      }
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
    />
  );
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink">{label}</Text>
      {icon ? (
        <View
          className={`flex-row items-center rounded-2xl border bg-white pl-4 ${error ? "border-danger" : focused ? "border-brand" : "border-line"}`}
          style={
            focused
              ? webOnly({ boxShadow: "0 0 0 3px rgba(15, 123, 69, 0.18)" })
              : undefined
          }
        >
          <Icon name={icon} size={18} color={palette.muted} />
          {input}
        </View>
      ) : (
        input
      )}
      {hint && !error ? (
        <Text className="text-xs text-muted">{hint}</Text>
      ) : null}
      {error ? (
        <View className="flex-row items-start gap-1">
          <Icon name="alert" size={16} color={palette.danger} />
          <Text className="flex-1 text-sm text-danger">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const GOOD = ["valid", "paid", "published", "active", "completed", "success"];
const BAD = ["cancel", "refund", "invalid", "suspend", "failed"];

function statusTone(status: string): "good" | "bad" | "pending" {
  if (GOOD.some((value) => status.includes(value))) return "good";
  if (BAD.some((value) => status.includes(value))) return "bad";
  return "pending";
}

export function StatusBadge({
  status,
  tone = "light",
}: {
  status: string;
  tone?: "light" | "dark";
}) {
  const { t } = useTranslation();
  const normalized = status.toLowerCase();
  const kind = statusTone(normalized);
  const styles =
    tone === "dark"
      ? {
          good: ["bg-mint/15 border-mint/40", "text-mint", palette.mint],
          bad: ["bg-red-500/15 border-red-300/40", "text-red-200", "#FCA5A5"],
          pending: [
            "bg-amber-400/15 border-amber-200/40",
            "text-amber-100",
            "#FDE68A",
          ],
        }[kind]
      : {
          good: ["bg-mintsoft border-mintsoft", "text-success", palette.brand],
          bad: ["bg-red-50 border-red-100", "text-danger", palette.danger],
          pending: ["bg-amber-50 border-amber-100", "text-warning", palette.warning],
        }[kind];
  return (
    <View
      className={`flex-row items-center gap-1.5 self-start rounded-lg border px-2.5 py-1 ${styles[0]}`}
    >
      <View
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: styles[2] }}
      />
      <Text className={`text-xs font-medium ${styles[1]}`}>
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
    <View
      className="min-h-48 items-center justify-center gap-3"
      accessibilityLiveRegion="polite"
    >
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-panel">
        <ActivityIndicator color={palette.brand} />
      </View>
      <Text className="font-semibold text-muted">
        {label ?? t("common.loading")}
      </Text>
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
    <Surface className="gap-4" role="alert">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-red-50">
          <Icon name="alert" size={22} color={palette.danger} />
        </View>
        <Text className="flex-1 text-lg font-semibold text-danger">
          {t("ui.somethingWrong")}
        </Text>
      </View>
      <Text className="text-ink">{message}</Text>
      {retry ? (
        <View className="self-start">
          <Button
            label={t("common.tryAgain")}
            onPress={retry}
            variant="secondary"
          />
        </View>
      ) : null}
    </Surface>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
  tone = "light",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  tone?: "light" | "night";
}) {
  const dark = tone === "night";
  return (
    <Surface tone={tone} className="min-w-40 flex-1 gap-2">
      <View className="flex-row items-center gap-2">
        {icon ? (
          <View
            className={`h-8 w-8 items-center justify-center rounded-xl ${dark ? "bg-mint/15" : "bg-mintsoft"}`}
          >
            <Icon
              name={icon}
              size={16}
              color={dark ? palette.mint : palette.brand}
            />
          </View>
        ) : null}
        <Text
          className={`flex-1 text-sm font-semibold ${dark ? "text-white/70" : "text-muted"}`}
        >
          {label}
        </Text>
      </View>
      <Text
        className={`text-3xl font-semibold tracking-tight ${dark ? "text-white" : "text-ink"}`}
      >
        {value}
      </Text>
      {hint ? (
        <Text className={`text-xs ${dark ? "text-white/60" : "text-muted"}`}>
          {hint}
        </Text>
      ) : null}
    </Surface>
  );
}

// --- New primitives -------------------------------------------------------

const iconButtonTones = {
  light: { box: "border border-line bg-white", color: palette.ink },
  dark: { box: "bg-ink", color: palette.white },
  glass: { box: "border border-white/15 bg-white/10", color: palette.white },
} as const;

export function IconButton({
  icon,
  label,
  onPress,
  href,
  tone = "light",
  badge,
  size = 46,
}: {
  icon: IconName;
  label: string;
  onPress?(): void;
  href?: Href;
  tone?: keyof typeof iconButtonTones;
  badge?: boolean;
  size?: number;
}) {
  const styles = iconButtonTones[tone];
  const body = (
    <Pressable
      accessibilityRole={href ? "link" : "button"}
      accessibilityLabel={label}
      onPress={onPress}
      className={`items-center justify-center rounded-2xl active:opacity-80 ${styles.box}`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={20} color={styles.color} />
      {badge ? (
        <View className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border border-white bg-mint" />
      ) : null}
    </Pressable>
  );
  return href ? (
    <Link href={href} asChild>
      {body}
    </Link>
  ) : (
    body
  );
}

export function ScreenHeader({
  title,
  subtitle,
  kicker,
  backHref,
  onBack,
  backLabel,
  right,
  tone = "light",
  titleSize = "lg",
}: {
  title: string;
  subtitle?: ReactNode;
  kicker?: string;
  backHref?: Href;
  onBack?(): void;
  backLabel?: string;
  right?: ReactNode;
  tone?: "light" | "dark";
  titleSize?: "lg" | "xl";
}) {
  const { t } = useTranslation();
  const dark = tone === "dark";
  const hasBack = !!backHref || !!onBack;
  return (
    <View className="gap-4">
      {hasBack || right ? (
        <View className="flex-row items-center justify-between gap-3">
          {hasBack ? (
            <IconButton
              icon="chevron-left"
              label={backLabel ?? t("attendee.ux.back")}
              href={backHref}
              onPress={onBack}
              tone={dark ? "glass" : "light"}
            />
          ) : (
            <View />
          )}
          {right ? (
            <View className="min-w-0 shrink flex-row flex-wrap items-center justify-end gap-2">
              {right}
            </View>
          ) : null}
        </View>
      ) : null}
      <View className="gap-1">
        {kicker ? (
          <Text
            className={`text-sm font-semibold ${dark ? "text-white/70" : "text-muted"}`}
          >
            {kicker}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          className={`font-semibold tracking-tight ${titleSize === "xl" ? "text-4xl leading-tight md:text-5xl" : "text-3xl leading-tight md:text-4xl"} ${dark ? "text-white" : "text-ink"}`}
        >
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          <Text
            className={`text-base leading-6 ${dark ? "text-white/75" : "text-muted"}`}
          >
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
    </View>
  );
}

export { SegmentedControl, type SegmentOption } from "./design/SegmentedControl";

const chipTones = {
  light: {
    idle: "border-line bg-white",
    idleText: "text-ink",
    on: "border-ink bg-ink",
    onText: "text-white",
  },
  mint: {
    idle: "border-mintsoft bg-mintsoft",
    idleText: "text-ink",
    on: "border-ink bg-ink",
    onText: "text-white",
  },
  dark: {
    idle: "border-white/15 bg-white/10",
    idleText: "text-white",
    on: "border-mint bg-mint",
    onText: "text-ink",
  },
  outlineMint: {
    idle: "border-mint/40 bg-mint/10",
    idleText: "text-mint",
    on: "border-mint bg-mint",
    onText: "text-ink",
  },
} as const;

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  tone = "light",
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?(): void;
  icon?: IconName;
  tone?: keyof typeof chipTones;
  accessibilityLabel?: string;
}) {
  const styles = chipTones[tone];
  const textClass = selected ? styles.onText : styles.idleText;
  const iconColor =
    selected
      ? tone === "dark" || tone === "outlineMint"
        ? palette.ink
        : palette.white
      : tone === "dark"
        ? palette.white
        : tone === "outlineMint"
          ? palette.mint
          : palette.ink;
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} color={iconColor} /> : null}
      {selected && onPress && !icon ? (
        <Icon name="check" size={14} color={iconColor} />
      ) : null}
      <Text className={`text-sm font-medium ${textClass}`} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const box = `flex-row items-center gap-1.5 self-start rounded-lg border px-3 ${selected ? styles.on : styles.idle}`;
  if (!onPress)
    return <View className={`${box} min-h-7 py-1`}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={onPress}
      className={`${box} min-h-11 active:opacity-80`}
    >
      {content}
    </Pressable>
  );
}

export function DarkCard({
  children,
  className = "",
  ...props
}: PropsWithChildren<ViewProps>) {
  return (
    <View
      className={`overflow-hidden rounded-3xl bg-night p-5 shadow-float ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}

export function Timeline({
  start,
  end,
  startCaption,
  endCaption,
  middle,
  tone = "light",
}: {
  start: string;
  end: string;
  startCaption?: string;
  endCaption?: string;
  middle?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const strong = dark ? "text-white" : "text-ink";
  const soft = dark ? "text-white/65" : "text-muted";
  const solid = dark ? "bg-mint" : "bg-ink";
  return (
    <View className="gap-2">
      <View className="flex-row items-end justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className={`text-lg font-semibold ${strong}`}>{start}</Text>
          {startCaption ? (
            <Text className={`text-xs ${soft}`} numberOfLines={1}>
              {startCaption}
            </Text>
          ) : null}
        </View>
        {middle ? (
          <Text className={`pb-0.5 text-xs font-medium ${strong}`}>{middle}</Text>
        ) : null}
        <View className="min-w-0 flex-1 items-end">
          <Text className={`text-lg font-semibold ${strong}`}>{end}</Text>
          {endCaption ? (
            <Text className={`text-right text-xs ${soft}`} numberOfLines={1}>
              {endCaption}
            </Text>
          ) : null}
        </View>
      </View>
      <View
        className="flex-row items-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          className={`h-3 w-3 rounded-full border-2 ${dark ? "border-mint bg-night" : "border-ink bg-white"}`}
        />
        <View className={`h-0.5 flex-1 ${solid}`} />
        <View
          className={`h-2.5 w-5 rounded-full ${dark ? "bg-mint" : "bg-ink"}`}
        />
        <View
          className={`h-0 flex-1 border-t-2 border-dashed ${dark ? "border-white/35" : "border-muted/50"}`}
        />
        <View
          className={`h-3 w-3 rounded-full ${dark ? "bg-mint" : "bg-ink"}`}
        />
      </View>
    </View>
  );
}

export function LabeledValue({
  label,
  value,
  align = "left",
  size = "md",
  tone = "light",
  mono,
}: {
  label: string;
  value: ReactNode;
  align?: "left" | "center" | "right";
  size?: "md" | "lg" | "xl";
  tone?: "light" | "dark";
  mono?: boolean;
}) {
  const dark = tone === "dark";
  const alignClass =
    align === "center"
      ? "items-center"
      : align === "right"
        ? "items-end"
        : "items-start";
  const textAlign =
    align === "center"
      ? "text-center"
      : align === "right"
        ? "text-right"
        : "text-left";
  const sizeClass = { md: "text-base", lg: "text-xl", xl: "text-3xl" }[size];
  return (
    <View className={`min-w-0 gap-0.5 ${alignClass}`}>
      <Text className={`text-xs ${dark ? "text-white/60" : "text-muted"}`}>
        {label}
      </Text>
      <Text
        className={`${sizeClass} ${textAlign} font-semibold ${dark ? "text-white" : "text-ink"} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </Text>
    </View>
  );
}

export function TicketStub({
  children,
  footer,
  notchClassName = "bg-night",
  className = "",
}: PropsWithChildren<{
  footer?: ReactNode;
  notchClassName?: string;
  className?: string;
}>) {
  return (
    <View className={`rounded-3xl bg-white ${className}`}>
      <View className="gap-4 p-5">{children}</View>
      {footer ? (
        <>
          <View
            className="relative h-6 justify-center"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View className="mx-6 border-t-2 border-dashed border-line" />
            <View
              className={`absolute -left-3 top-0 h-6 w-6 rounded-full ${notchClassName}`}
            />
            <View
              className={`absolute -right-3 top-0 h-6 w-6 rounded-full ${notchClassName}`}
            />
          </View>
          <View className="flex-1 gap-4 p-5">{footer}</View>
        </>
      ) : null}
    </View>
  );
}

export function StickyActionBar({ children }: PropsWithChildren) {
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-t-3xl border border-b-0 border-line bg-white px-5 pb-5 pt-4 shadow-float md:rounded-3xl md:border-b">
      {children}
    </View>
  );
}

export function ClassCard({
  title,
  price,
  subtitle,
  meta,
  selected = false,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  title: string;
  price: string;
  subtitle?: string;
  meta?: ReactNode;
  selected?: boolean;
  onPress?(): void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            {selected ? (
              <Icon name="check" size={16} color={palette.mint} />
            ) : null}
            <Text
              className={`shrink text-base font-semibold ${selected ? "text-white" : "text-ink"}`}
            >
              {title}
            </Text>
          </View>
          {subtitle ? (
            <Text
              className={`text-sm ${selected ? "text-white/70" : "text-muted"}`}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Text
          className={`text-xl font-semibold ${selected ? "text-white" : "text-ink"}`}
        >
          {price}
        </Text>
      </View>
      {meta}
    </>
  );
  const box = `min-w-0 flex-1 basis-56 gap-2 rounded-3xl border p-4 ${selected ? "border-night bg-night" : "border-line bg-white"} ${disabled ? "opacity-60" : ""}`;
  if (!onPress) return <View className={box}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      className={`${box} active:opacity-90`}
    >
      {body}
    </Pressable>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-row flex-wrap items-end justify-between gap-3">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          accessibilityRole="header"
          className="text-xl font-semibold text-ink"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-sm text-muted">{subtitle}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const noticeTones = {
  info: { box: "bg-white border-line", text: "text-ink", icon: palette.ink },
  success: {
    box: "bg-mintsoft border-mintsoft",
    text: "text-success",
    icon: palette.brand,
  },
  warning: {
    box: "bg-amber-50 border-amber-200",
    text: "text-ink",
    icon: palette.warning,
  },
  danger: {
    box: "bg-red-50 border-red-100",
    text: "text-danger",
    icon: palette.danger,
  },
} as const;

export function Notice({
  children,
  tone = "info",
  icon,
  role,
  bold,
}: PropsWithChildren<{
  tone?: keyof typeof noticeTones;
  icon?: IconName;
  role?: "alert" | "status";
  bold?: boolean;
}>) {
  const styles = noticeTones[tone];
  const defaultIcon: IconName =
    tone === "success" ? "check" : tone === "info" ? "help" : "alert";
  return (
    <View
      className={`flex-row items-start gap-3 rounded-2xl border p-3 ${styles.box}`}
      role={role}
      accessibilityLiveRegion={
        role === "alert" ? "assertive" : role ? "polite" : undefined
      }
    >
      <Icon name={icon ?? defaultIcon} size={18} color={styles.icon} />
      <Text className={`flex-1 ${bold ? "font-medium" : ""} ${styles.text}`}>
        {children}
      </Text>
    </View>
  );
}

/** Style that only applies on web (outline and box-shadow are web-only). */
function webOnly(style: Record<string, string>) {
  return (Platform.OS === "web" ? style : {}) as object;
}
