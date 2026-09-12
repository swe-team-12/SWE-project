import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api";
import {
  getOfflineBundle,
  type OfflineBundle,
  queueOfflineScan,
  queuedScanCount,
  saveOfflineBundle,
  syncOfflineScans,
  validateOfflineAdmission,
} from "@/lib/offline";
import { useAuth } from "@/providers/AuthProvider";

interface ScannerEvent {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string;
  registered: number;
  checked_in: number;
}

interface ScanResult {
  outcome:
    | "valid"
    | "invalid"
    | "cancelled"
    | "refunded"
    | "already_used"
    | "wrong_event"
    | "conflict";
  ticket_id?: string;
  ticket_code?: string;
  attendee_name?: string;
  message: string;
}

export default function ScannerPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [eventId, setEventId] = useState<string>();
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult>();
  const [manual, setManual] = useState("");
  const [queued, setQueued] = useState(0);
  const lastScan = useRef<{ value: string; at: number } | undefined>(undefined);
  const events = useQuery({
    queryKey: ["scanner-events"],
    queryFn: () => apiFetch<ScannerEvent[]>("/scanner/events"),
    enabled: !!user,
  });
  const selectedEventId = eventId ?? events.data?.[0]?.id;
  const attendees = useQuery({
    queryKey: ["scanner-attendees", selectedEventId, manual],
    queryFn: () =>
      apiFetch<
        {
          ticket_id: string;
          ticket_code: string;
          name: string;
          email: string;
          status: string;
          seat: string;
        }[]
      >(
        `/scanner/events/${selectedEventId}/attendees?q=${encodeURIComponent(manual)}`,
      ),
    enabled: !!selectedEventId && manual.length >= 2,
  });
  useEffect(() => {
    void queuedScanCount(selectedEventId).then(setQueued);
  }, [selectedEventId, lastResult]);

  const scan = useMutation({
    mutationFn: async (qrToken: string) => {
      if (!selectedEventId) throw new Error(t("ui.noAssignedEvents"));
      const operationId = Crypto.randomUUID();
      try {
        return await apiFetch<ScanResult>("/scanner/scan", {
          method: "POST",
          body: JSON.stringify({
            qr_token: qrToken,
            event_id: selectedEventId,
            operation_id: operationId,
            captured_at: new Date().toISOString(),
            was_offline: false,
          }),
        });
      } catch (error) {
        // A server rejection is authoritative. Offline validation is only a network fallback.
        if (error instanceof ApiError) throw error;
        const bundle = await getOfflineBundle(selectedEventId);
        const entry = bundle
          ? validateOfflineAdmission(bundle, qrToken, selectedEventId)
          : null;
        if (!entry) throw error;
        if (new Date(bundle!.payload.expires_at) < new Date())
          throw new Error(t("ui.downloadBundle"));
        if (entry.status === "cancelled" || entry.status === "refunded")
          return {
            outcome: entry.status,
            ticket_id: entry.id,
            ticket_code: entry.code,
            attendee_name: entry.attendee_name,
            message: `Offline snapshot: ticket is ${entry.status}.`,
          } as ScanResult;
        if (entry.status === "checked_in")
          return {
            outcome: "already_used",
            ticket_id: entry.id,
            ticket_code: entry.code,
            attendee_name: entry.attendee_name,
            message: "Offline snapshot: this ticket was already checked in.",
          } as ScanResult;
        const operation = await queueOfflineScan(selectedEventId, qrToken);
        if (!operation)
          return {
            outcome: "already_used",
            ticket_id: entry.id,
            ticket_code: entry.code,
            attendee_name: entry.attendee_name,
            message:
              "This ticket is already queued for offline synchronization.",
          } as ScanResult;
        return {
          outcome: "valid",
          ticket_id: entry.id,
          ticket_code: entry.code,
          attendee_name: entry.attendee_name,
          message: "Validated offline and queued for synchronization.",
        } as ScanResult;
      }
    },
    onSuccess: async (result) => {
      setLastResult(result);
      setCameraEnabled(false);
      await client.invalidateQueries({ queryKey: ["scanner-events"] });
    },
    onError: (error) => {
      setLastResult({
        outcome: "invalid",
        message:
          error instanceof Error ? error.message : t("ui.somethingWrong"),
      });
      setCameraEnabled(false);
    },
  });
  const download = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) throw new Error(t("ui.noAssignedEvents"));
      const trust = await apiFetch<{ public_key: string }>(
        "/scanner/public-key",
      );
      const bundle = await apiFetch<OfflineBundle>(
        `/scanner/events/${selectedEventId}/bundle`,
      );
      await saveOfflineBundle(bundle, trust.public_key);
      return bundle;
    },
  });
  const synchronize = useMutation({
    mutationFn: syncOfflineScans,
    onSuccess: async (result) => {
      setQueued(await queuedScanCount(selectedEventId));
      setLastResult({
        outcome: result.conflicts ? "conflict" : "valid",
        message: `Synchronized ${result.accepted} accepted scan(s); ${result.conflicts} conflict(s).`,
      });
      await client.invalidateQueries({ queryKey: ["scanner-events"] });
    },
  });
  const reverse = useMutation({
    mutationFn: (ticketId: string) =>
      apiFetch<ScanResult>(
        `/scanner/tickets/${ticketId}/reverse?operation_id=${encodeURIComponent(`reverse-${Crypto.randomUUID()}`)}`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setLastResult(result);
      await client.invalidateQueries({ queryKey: ["scanner-events"] });
    },
  });
  const onBarcode = ({ data }: { data: string }) => {
    const now = Date.now();
    if (lastScan.current?.value === data && now - lastScan.current.at < 3000)
      return;
    lastScan.current = { value: data, at: now };
    scan.mutate(data);
  };
  if (!user) return <ErrorBlock message={t("ui.noAssignedEvents")} />;
  return (
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <View className="flex-row flex-wrap items-end justify-between gap-4">
        <View>
          <Text className="text-sm font-black uppercase tracking-wider text-brand">
            {t("ui.eventAdmin")}
          </Text>
          <Text className="mt-1 text-4xl font-black text-ink">
            {t("ui.admissionScanner")}
          </Text>
        </View>
        <View className="rounded-full bg-amber-100 px-4 py-2">
          <Text className="font-bold text-warning">
            {t("ui.queuedOffline", { count: queued })}
          </Text>
        </View>
      </View>
      {events.isLoading ? <LoadingBlock /> : null}
      {events.error ? (
        <ErrorBlock message={(events.error as Error).message} />
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 py-1"
      >
        {events.data?.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => setEventId(event.id)}
            className={`min-w-64 rounded-2xl border p-4 ${selectedEventId === event.id ? "border-brand bg-teal-50" : "border-line bg-white"}`}
          >
            <Text className="font-black text-ink">{event.title}</Text>
            <Text className="mt-1 text-sm text-muted">
              {t("ui.checkedInCount", {
                checked: event.checked_in,
                registered: event.registered,
              })}
            </Text>
            <Text className="text-xs text-muted">{event.venue_name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {events.data?.length === 0 ? (
        <Surface>
          <Text className="text-muted">{t("ui.noAssignedEvents")}</Text>
        </Surface>
      ) : null}
      {selectedEventId ? (
        <View className="flex-row flex-wrap items-start gap-5">
          <View className="min-w-72 flex-[2] gap-5">
            <Surface className="gap-4 overflow-hidden">
              <View className="flex-row flex-wrap justify-between gap-3">
                <View>
                  <Text className="text-xl font-black text-ink">
                    {t("ui.scanAdmission")}
                  </Text>
                  <Text className="text-muted">{t("ui.campaignRejected")}</Text>
                </View>
                <Button
                  label={
                    cameraEnabled ? t("ui.closeCamera") : t("ui.openCamera")
                  }
                  onPress={async () => {
                    if (!permission?.granted) await requestPermission();
                    setCameraEnabled((value) => !value);
                  }}
                />
              </View>
              {cameraEnabled && permission?.granted ? (
                <View className="h-96 overflow-hidden rounded-2xl">
                  <CameraView
                    style={{ flex: 1 }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={onBarcode}
                  />
                </View>
              ) : null}
              {permission && !permission.granted ? (
                <Text className="rounded-xl bg-amber-50 p-3 text-warning">
                  {t("ui.cameraRequired")}
                </Text>
              ) : null}
              {scan.isPending ? (
                <LoadingBlock label={t("ui.validatingTicket")} />
              ) : null}
            </Surface>
            <Surface className="gap-4">
              <Text className="text-xl font-black text-ink">
                {t("ui.manualAttendee")}
              </Text>
              <Field
                label={t("ui.attendeeSearch")}
                value={manual}
                onChangeText={setManual}
              />
              {attendees.data?.map((item) => (
                <View
                  key={item.ticket_id}
                  className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
                >
                  <View>
                    <Text className="font-bold text-ink">{item.name}</Text>
                    <Text className="text-sm text-muted">
                      {item.ticket_code} · {item.seat}
                    </Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
              ))}
            </Surface>
          </View>
          <View className="min-w-72 flex-1 gap-5">
            <Surface
              className={`gap-4 ${lastResult?.outcome === "valid" ? "border-emerald-300 bg-emerald-50" : lastResult ? "border-red-200 bg-red-50" : ""}`}
            >
              <Text className="text-sm font-black uppercase text-muted">
                {t("ui.latestResult")}
              </Text>
              {lastResult ? (
                <>
                  <StatusBadge status={lastResult.outcome} />
                  <Text className="text-2xl font-black text-ink">
                    {lastResult.attendee_name ??
                      lastResult.ticket_code ??
                      t("ui.scanResult")}
                  </Text>
                  <Text className="text-ink">
                    {t(`status.${lastResult.outcome}`)}
                  </Text>
                  {lastResult.outcome === "valid" && lastResult.ticket_id ? (
                    <Button
                      label={t("ui.reverseCheckIn")}
                      variant="secondary"
                      onPress={() => reverse.mutate(lastResult.ticket_id!)}
                      loading={reverse.isPending}
                    />
                  ) : null}
                </>
              ) : (
                <Text className="text-muted">{t("ui.noScan")}</Text>
              )}
            </Surface>
            <Surface className="gap-3">
              <Text className="text-lg font-black text-ink">
                {t("ui.offlineReadiness")}
              </Text>
              <Button
                label={t("ui.downloadBundle")}
                variant="secondary"
                onPress={() => download.mutate()}
                loading={download.isPending}
              />
              <Button
                label={t("ui.syncQueued", { count: queued })}
                variant="secondary"
                onPress={() => synchronize.mutate()}
                loading={synchronize.isPending}
                disabled={!queued}
              />
              {download.isSuccess ? (
                <Text className="text-sm font-bold text-success">
                  {t("ui.bundleSaved")}
                </Text>
              ) : null}
              {download.error ? (
                <Text className="text-sm text-danger">
                  {(download.error as Error).message}
                </Text>
              ) : null}
            </Surface>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
