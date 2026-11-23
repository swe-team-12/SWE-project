import { useMutation } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Notice } from "@/components/ui";
import { localizedErrorMessage } from "@/lib/errorMessage";
import { downloadAuthenticatedFile } from "@/lib/files";
import type { CalendarLinks } from "@/types";

const PROVIDERS = ["google", "outlook", "office365", "yahoo"] as const;

/**
 * Add-to-calendar actions: an .ics download plus the provider links returned
 * by the API. When the API marks the calendar entry as unavailable (cancelled
 * event, refunded ticket, closed order) the reason is shown instead.
 */
export function CalendarActions({
  calendar,
  icsPath,
  filename,
}: {
  calendar: CalendarLinks | undefined;
  icsPath: string;
  filename: string;
}) {
  const { t } = useTranslation();
  const download = useMutation({
    mutationFn: () =>
      downloadAuthenticatedFile(icsPath, filename, "text/calendar"),
  });
  if (calendar && !calendar.available)
    return (
      <Notice tone="warning" icon="calendar">
        {t(`attendee.calendarUnavailable.${calendar.reason ?? "other"}`, {
          defaultValue: t("attendee.calendarUnavailable.other"),
        })}
      </Notice>
    );
  const links = PROVIDERS.flatMap((provider) => {
    const url = calendar?.[provider];
    return url ? [{ provider, url }] : [];
  });
  return (
    <View className="gap-3">
      <Button
        label={t("ui.downloadIcs")}
        variant="secondary"
        onPress={() => download.mutate()}
        loading={download.isPending}
        iconName="download"
        fullWidth
      />
      {download.error ? (
        <Notice tone="danger" role="alert">
          {localizedErrorMessage(download.error, t("ui.downloadFailed"))}
        </Notice>
      ) : null}
      {links.length ? (
        <View className="flex-row flex-wrap gap-2">
          {links.map(({ provider, url }) => (
            <View key={provider} className="min-w-0 grow basis-40">
              <Button
                label={t(`attendee.calendarProvider.${provider}`)}
                variant="secondary"
                size="sm"
                iconName="calendar"
                onPress={() => void Linking.openURL(url)}
                fullWidth
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
