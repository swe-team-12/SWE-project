import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  ConfirmPanel,
  errorText,
  ListState,
  Meta,
  Notice,
} from "@/components/admin/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { Icon, palette } from "@/components/icons";
import {
  Button,
  Chip,
  DarkCard,
  ErrorBlock,
  Field,
  LoadingBlock,
  Metric,
  Notice as InfoNotice,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import {
  getOfflineBundle,
  isOfflineStorageAvailable,
  lastOfflineSync,
  type OfflineBundle,
  OfflineBundleInvalidError,
  OfflineStorageUnavailableError,
  type OfflineSyncResult,
  type OfflineSyncSummary,
  queueOfflineScan,
  queuedScanCount,
  saveOfflineBundle,
  syncOfflineScans,
  unresolvedSyncItems,
  validateOfflineAdmission,
} from "@/lib/offline";
import {
  duplicateOfflineView,
  isBundleExpired,
  offlineScanView,
  scanStyle,
  type ScanView,
} from "@/lib/scanResult";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";

interface ScannerEvent {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string;
  registered: number;
  checked_in: number;
}

interface Totals {
  registered: number;
  checked_in: number;
  remaining: number;
  cancelled: number;
  refunded: number;
}

interface ServerScanResult extends Omit<ScanView, "kind" | "note" | "detail"> {
  outcome: Exclude<ScanView["kind"], "reversed" | "error">;
}

interface AttendeeRow {
  ticket_id: string;
  ticket_code: string;
  name: string;
  email: string;
  status: string;
  seat: string;
  checked_in?: boolean;
  checked_in_at?: string | null;
  can_check_in?: boolean;
  seat_label?: string | null;
  ticket_type_name?: string | null;
  order_number?: string | null;
}

const operationId = (prefix: string) => `${prefix}-${Crypto.randomUUID()}`;

/** A response from the API (as opposed to a request that never got through). */
function isServerProblem(error: unknown): boolean {
  return !!(error as { problem?: unknown })?.problem;
}

function ResultCard({
  view,
  onUndo,
}: {
  view: ScanView;
  onUndo?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const style = scanStyle(view.kind);
  const title = t(`scannerX.outcome.${view.kind}.title`);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${title}. ${view.attendee_name ?? view.ticket_code ?? ""}`}
      className={`gap-4 rounded-[28px] border-2 p-5 ${style.card}`}
    >
      <View className="flex-row items-center gap-4">
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-panel"
        >
          <Text className="text-4xl font-extrabold text-ink">{style.icon}</Text>
        </View>
        <Text className="flex-1 text-3xl font-extrabold leading-tight tracking-tight text-ink">
          {title}
        </Text>
      </View>
      <Text className="text-base leading-6 text-ink">
        {view.detail ?? t(`scannerX.outcome.${view.kind}.help`)}
      </Text>
      {view.note ? (
        <Text className="font-bold text-ink">
          {t(`scannerX.note.${view.note}`)}
        </Text>
      ) : null}
      {view.attendee_name || view.ticket_code ? (
        <View className="gap-1 rounded-2xl bg-white/80 p-4">
          {view.attendee_name ? (
            <Text className="text-2xl font-extrabold tracking-tight text-ink">
              {view.attendee_name}
            </Text>
          ) : null}
          {view.ticket_code ? (
            <Text className="font-mono text-sm text-ink">
              {[view.ticket_code, view.ticket_type_name, view.seat_label]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          {view.checked_in_at ? (
            <Text className="text-sm text-ink">
              {t("scannerX.checkedInAt", {
                date: formatDateTime(
                  view.checked_in_at,
                  i18n.language,
                  "medium",
                ),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {onUndo ? (
        <View className="self-start">
          <Button
            label={t("scannerX.undo")}
            variant="secondary"
            onPress={onUndo}
          />
        </View>
      ) : null}
    </View>
  );
}

function ScannerContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [eventId, setEventId] = useState<string>();
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [lastResult, setLastResult] = useState<ScanView>();
  const [manual, setManual] = useState("");
  const [queued, setQueued] = useState(0);
  const [offlineAvailable, setOfflineAvailable] = useState(true);
  const [storedBundle, setStoredBundle] = useState<{
    eventId: string;
    bundle: OfflineBundle | null;
  }>();
  const [lastSync, setLastSync] = useState<OfflineSyncSummary | null>(null);
  const [syncResult, setSyncResult] = useState<OfflineSyncResult>();
  const [undo, setUndo] = useState<{ id: string; label: string }>();
  const lastScan = useRef<{ value: string; at: number } | undefined>(undefined);
  const search = manual.trim();
  const events = useQuery({
    queryKey: ["scanner-events"],
    queryFn: () => apiFetch<ScannerEvent[]>("/scanner/events"),
    enabled: !!user,
  });
  const selectedEventId = eventId ?? events.data?.[0]?.id;
  // The stored bundle is only shown for the event it was loaded for.
  const bundle =
    storedBundle && storedBundle.eventId === selectedEventId
      ? storedBundle.bundle
      : null;
  const totals = useQuery({
    queryKey: ["scanner-totals", selectedEventId],
    queryFn: () =>
      apiFetch<Totals>(`/scanner/events/${selectedEventId}/totals`),
    enabled: !!selectedEventId,
    refetchInterval: 20_000,
  });
  const attendees = useQuery({
    queryKey: ["scanner-attendees", selectedEventId, search],
    queryFn: () =>
      apiFetch<AttendeeRow[]>(
        `/scanner/events/${selectedEventId}/attendees?q=${encodeURIComponent(search)}`,
      ),
    enabled: !!selectedEventId && search.length >= 2,
  });
  const refreshOffline = useCallback(async () => {
    const [count, sync] = await Promise.all([
      queuedScanCount().catch(() => 0),
      lastOfflineSync().catch(() => null),
    ]);
    setQueued(count);
    setLastSync(sync);
  }, []);
  /** Totals, the attendee list and the event counters after any admission change. */
  const refreshAdmission = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["scanner-totals"] }),
      client.invalidateQueries({ queryKey: ["scanner-attendees"] }),
      client.invalidateQueries({ queryKey: ["scanner-events"] }),
    ]);
  }, [client]);
  useEffect(() => {
    let active = true;
    // Private browsing modes (e.g. Firefox) block the storage expo-sqlite needs;
    // the scanner then works online only instead of surfacing an uncaught error.
    void isOfflineStorageAvailable()
      .catch(() => false)
      .then((available) => {
        if (active) setOfflineAvailable(available);
      });
    void Promise.all([
      queuedScanCount().catch(() => 0),
      lastOfflineSync().catch(() => null),
    ]).then(([count, sync]) => {
      if (!active) return;
      setQueued(count);
      setLastSync(sync);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!selectedEventId) return;
    void getOfflineBundle(selectedEventId)
      .catch(() => null)
      .then((stored) => {
        if (active)
          setStoredBundle({ eventId: selectedEventId, bundle: stored });
      });
    return () => {
      active = false;
    };
  }, [selectedEventId]);

  const scan = useMutation({
    mutationFn: async (qrToken: string): Promise<ScanView> => {
      const event = selectedEventId;
      if (!event) return { kind: "error", detail: t("ui.noAssignedEvents") };
      try {
        const result = await apiFetch<ServerScanResult>("/scanner/scan", {
          method: "POST",
          body: JSON.stringify({
            qr_token: qrToken,
            event_id: event,
            operation_id: Crypto.randomUUID(),
            captured_at: new Date().toISOString(),
            was_offline: false,
          }),
        });
        return { ...result, kind: result.outcome };
      } catch (error) {
        // A server rejection is authoritative. Offline validation is only a
        // fallback for a request that never reached the server.
        if (isServerProblem(error)) throw error;
        const stored = await getOfflineBundle(event).catch(() => null);
        const entry = stored
          ? validateOfflineAdmission(stored, qrToken, event)
          : null;
        const offline = offlineScanView(stored, entry, new Date());
        if (!offline.queue) return offline.view;
        const queuedOperation = await queueOfflineScan(event, qrToken);
        return queuedOperation
          ? offline.view
          : duplicateOfflineView(offline.view);
      }
    },
    onSuccess: async (result) => {
      setLastResult(result);
      setCameraEnabled(false);
      await Promise.all([refreshOffline(), refreshAdmission()]);
    },
    onError: (error) => {
      setLastResult({ kind: "error", detail: errorText(error) });
      setCameraEnabled(false);
    },
  });
  const checkIn = useMutation({
    mutationFn: (ticketId: string) =>
      apiFetch<ServerScanResult>(
        `/scanner/tickets/${ticketId}/check-in?event_id=${selectedEventId}&operation_id=${encodeURIComponent(operationId("manual"))}`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setLastResult({ ...result, kind: result.outcome });
      await refreshAdmission();
    },
    onError: async (error) => {
      setLastResult({ kind: "error", detail: errorText(error) });
      await refreshAdmission();
    },
  });
  const reverse = useMutation({
    mutationFn: (ticketId: string) =>
      apiFetch<ServerScanResult>(
        `/scanner/tickets/${ticketId}/reverse?operation_id=${encodeURIComponent(operationId("reverse"))}&event_id=${selectedEventId}`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setUndo(undefined);
      setLastResult({
        ...result,
        kind: result.outcome === "valid" ? "reversed" : result.outcome,
        checked_in_at: null,
      });
      await refreshAdmission();
    },
    onError: () => void refreshAdmission(),
  });
  const download = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) throw new Error("no_event");
      const trust = await apiFetch<{ public_key: string }>(
        "/scanner/public-key",
      );
      const fresh = await apiFetch<OfflineBundle>(
        `/scanner/events/${selectedEventId}/bundle`,
      );
      await saveOfflineBundle(fresh, trust.public_key);
      return fresh;
    },
    onSuccess: (fresh) =>
      setStoredBundle({ eventId: fresh.payload.event_id, bundle: fresh }),
  });
  const synchronize = useMutation({
    mutationFn: syncOfflineScans,
    onSuccess: async (result) => {
      setSyncResult(result);
      await Promise.all([refreshOffline(), refreshAdmission()]);
    },
  });
  const onBarcode = ({ data }: { data: string }) => {
    const now = Date.now();
    if (lastScan.current?.value === data && now - lastScan.current.at < 3000)
      return;
    lastScan.current = { value: data, at: now };
    scan.mutate(data);
  };
  const askUndo = (id: string, label: string) => {
    reverse.reset();
    setUndo({ id, label });
  };
  const offlineError = (error: unknown) =>
    error instanceof OfflineBundleInvalidError
      ? t("scannerX.offline.bundleInvalid")
      : error instanceof OfflineStorageUnavailableError
        ? t("ui.offlineUnavailable")
        : errorText(error);
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  const date = (value: string) =>
    formatDateTime(value, i18n.language, "medium");
  const bundleExpired = bundle ? isBundleExpired(bundle, new Date()) : false;
  const unresolved = syncResult ? unresolvedSyncItems(syncResult.results) : [];
  const canUndoLatest =
    lastResult?.kind === "valid" &&
    !!lastResult.ticket_id &&
    lastResult.note === undefined;
  const totalsData = totals.data;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-16"
    >
      <ScreenHeader
        kicker={t("ui.eventAdmin")}
        title={t("ui.admissionScanner")}
        right={
          <Chip
            label={t("ui.queuedOffline", { count: queued })}
            icon="clock"
            tone={queued ? "light" : "mint"}
          />
        }
      />
      {!offlineAvailable ? (
        <Notice tone="warning">{t("ui.offlineUnavailable")}</Notice>
      ) : null}
      {events.isLoading ? <LoadingBlock /> : null}
      {events.error ? (
        <ErrorBlock
          message={errorText(events.error)}
          retry={() => void events.refetch()}
        />
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 py-1"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("scannerX.eventPicker")}
      >
        {events.data?.map((event) => {
          const selected = selectedEventId === event.id;
          return (
            <Pressable
              key={event.id}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={event.title}
              onPress={() => {
                setEventId(event.id);
                setUndo(undefined);
              }}
              className={`w-64 gap-1 rounded-3xl border p-4 active:opacity-90 ${selected ? "border-night bg-night" : "border-line bg-white"}`}
            >
              <View className="flex-row items-start gap-2">
                <View
                  className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-mint bg-mint" : "border-muted"}`}
                >
                  {selected ? (
                    <Icon name="check" size={12} color={palette.ink} />
                  ) : null}
                </View>
                <Text
                  className={`flex-1 font-extrabold ${selected ? "text-white" : "text-ink"}`}
                  numberOfLines={2}
                >
                  {event.title}
                </Text>
              </View>
              <Text
                className={`text-sm font-semibold ${selected ? "text-mint" : "text-brand"}`}
              >
                {t("ui.checkedInCount", {
                  checked: event.checked_in,
                  registered: event.registered,
                })}
              </Text>
              <Text
                className={`text-xs ${selected ? "text-white/65" : "text-muted"}`}
                numberOfLines={1}
              >
                {[event.venue_name, date(event.starts_at)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {events.data?.length === 0 ? (
        <InfoNotice>{t("ui.noAssignedEvents")}</InfoNotice>
      ) : null}
      {selectedEventId ? (
        <View className="flex-row flex-wrap items-start gap-5">
          <View className="min-w-72 flex-[3] basis-80 gap-5">
            <DarkCard className="gap-4">
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View className="min-w-48 flex-1 gap-1">
                  <Text
                    accessibilityRole="header"
                    className="text-2xl font-extrabold tracking-tight text-white"
                  >
                    {t("ui.scanAdmission")}
                  </Text>
                  <Text className="text-sm leading-5 text-white/70">
                    {t("ui.campaignRejected")}
                  </Text>
                </View>
                <Button
                  label={
                    cameraEnabled ? t("ui.closeCamera") : t("ui.openCamera")
                  }
                  iconName={cameraEnabled ? "close" : "qr"}
                  onPress={async () => {
                    if (!permission?.granted) await requestPermission();
                    setCameraEnabled((value) => !value);
                  }}
                />
              </View>
              {cameraEnabled && permission?.granted ? (
                <View className="h-96 overflow-hidden rounded-3xl border-2 border-mint/60">
                  <CameraView
                    style={{ flex: 1 }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={onBarcode}
                  />
                </View>
              ) : (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="h-40 items-center justify-center rounded-3xl border-2 border-dashed border-mint/40 bg-white/5"
                >
                  <Icon name="qr" size={56} color={palette.mint} strokeWidth={1.5} />
                </View>
              )}
              {permission && !permission.granted ? (
                <View className="flex-row items-start gap-2 rounded-2xl border border-amber-200/40 bg-amber-400/10 p-3">
                  <Icon name="alert" size={18} color="#FDE68A" />
                  <Text className="flex-1 text-amber-100">
                    {t("ui.cameraRequired")}
                  </Text>
                </View>
              ) : null}
              {scan.isPending ? (
                <View
                  accessibilityLiveRegion="polite"
                  className="flex-row items-center gap-3 rounded-2xl bg-white/10 p-3"
                >
                  <ActivityIndicator color={palette.mint} />
                  <Text className="font-bold text-white">
                    {t("ui.validatingTicket")}
                  </Text>
                </View>
              ) : null}
            </DarkCard>
            <View className="gap-3">
              <SectionTitle title={t("ui.latestResult")} />
              {lastResult ? (
                <ResultCard
                  view={lastResult}
                  onUndo={
                    canUndoLatest && undo?.id !== lastResult.ticket_id
                      ? () =>
                          askUndo(
                            lastResult.ticket_id!,
                            lastResult.attendee_name ??
                              lastResult.ticket_code ??
                              "",
                          )
                      : undefined
                  }
                />
              ) : (
                <View className="items-center gap-2 rounded-[28px] border border-dashed border-line bg-white/60 px-4 py-8">
                  <Icon name="qr" size={24} color={palette.muted} />
                  <Text className="text-center text-muted">
                    {t("ui.noScan")}
                  </Text>
                </View>
              )}
              {undo ? (
                <ConfirmPanel
                  title={t("scannerX.undoConfirmTitle")}
                  message={t("scannerX.undoConfirmBody", { name: undo.label })}
                  confirmLabel={t("scannerX.undo")}
                  danger
                  loading={reverse.isPending}
                  error={reverse.error ? errorText(reverse.error) : undefined}
                  onConfirm={() => reverse.mutate(undo.id)}
                  onCancel={() => {
                    setUndo(undefined);
                    reverse.reset();
                  }}
                />
              ) : null}
            </View>
          </View>
          <View className="min-w-72 flex-[2] basis-80 gap-5">
            <View className="gap-3">
              <SectionTitle
                title={t("scannerX.totals.title")}
                subtitle={
                  totalsData
                    ? t("scannerX.totalsExtra", {
                        cancelled: totalsData.cancelled,
                        refunded: totalsData.refunded,
                      })
                    : undefined
                }
              />
              {totals.error ? (
                <Notice tone="danger">{errorText(totals.error)}</Notice>
              ) : null}
              {totals.isLoading ? <LoadingBlock /> : null}
              {totalsData ? (
                <View className="flex-row flex-wrap gap-3">
                  {(
                    [
                      ["checked_in", "check", "night"],
                      ["remaining", "clock", "light"],
                      ["registered", "ticket", "light"],
                    ] as const
                  ).map(([key, icon, tone]) => (
                    <View key={key} className="min-w-40 flex-1 basis-40">
                      <Metric
                        label={t(`scannerX.totals.${key}`)}
                        value={totalsData[key]}
                        icon={icon}
                        tone={tone}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <Surface className="gap-4">
              <SectionTitle title={t("ui.manualAttendee")} />
              <Field
                label={t("ui.attendeeSearch")}
                value={manual}
                onChangeText={setManual}
                autoCapitalize="none"
                icon="search"
              />
              {search.length < 2 ? (
                <Meta>{t("scannerX.searchHint")}</Meta>
              ) : (
                <ListState
                  loading={attendees.isLoading}
                  error={attendees.error}
                  retry={() => void attendees.refetch()}
                  empty={attendees.data?.length === 0}
                  emptyText={t("scannerX.searchEmpty")}
                />
              )}
              {search.length >= 2
                ? attendees.data?.map((item) => {
                    const checkedIn =
                      item.checked_in ?? item.status === "checked_in";
                    const canCheckIn =
                      item.can_check_in ?? item.status === "valid";
                    const label = `${item.name} (${item.ticket_code})`;
                    return (
                      <View
                        key={item.ticket_id}
                        className="gap-3 rounded-3xl border border-line bg-canvas/60 p-4"
                      >
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="min-w-0 flex-1 gap-0.5">
                            <Text className="text-base font-extrabold text-ink">
                              {item.name}
                            </Text>
                            <Text className="text-sm text-muted">
                              {[
                                item.ticket_code,
                                item.ticket_type_name,
                                item.seat_label ?? item.seat,
                                item.order_number,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                            <Text className="text-sm text-muted">
                              {item.email}
                            </Text>
                            {checkedIn && item.checked_in_at ? (
                              <Text className="text-sm font-bold text-ink">
                                {t("scannerX.checkedInAt", {
                                  date: date(item.checked_in_at),
                                })}
                              </Text>
                            ) : null}
                          </View>
                          <StatusBadge status={item.status} />
                        </View>
                        {canCheckIn ||
                        (checkedIn && undo?.id !== item.ticket_id) ? (
                          <View className="flex-row flex-wrap gap-2">
                            {canCheckIn ? (
                              <Button
                                label={t("scannerX.checkIn")}
                                accessibilityLabel={t("scannerX.checkInFor", {
                                  name: label,
                                })}
                                iconName="check"
                                size="sm"
                                onPress={() => checkIn.mutate(item.ticket_id)}
                                loading={
                                  checkIn.isPending &&
                                  checkIn.variables === item.ticket_id
                                }
                                disabled={checkIn.isPending}
                              />
                            ) : null}
                            {checkedIn && undo?.id !== item.ticket_id ? (
                              <Button
                                label={t("scannerX.undo")}
                                accessibilityLabel={t("scannerX.undoFor", {
                                  name: label,
                                })}
                                variant="secondary"
                                size="sm"
                                onPress={() => askUndo(item.ticket_id, label)}
                              />
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                : null}
            </Surface>
            <Surface className="gap-3">
              <SectionTitle
                title={t("ui.offlineReadiness")}
                subtitle={t("scannerX.offline.help")}
              />
              <InfoNotice
                tone={queued ? "warning" : "info"}
                icon="clock"
                role="status"
                bold
              >
                {t("scannerX.offline.pending", { count: queued })}
              </InfoNotice>
              {bundle ? (
                <Notice tone={bundleExpired ? "warning" : "success"}>
                  {t(
                    bundleExpired
                      ? "scannerX.offline.bundleExpired"
                      : "scannerX.offline.bundleReady",
                    {
                      count: bundle.payload.tickets.length,
                      date: date(bundle.payload.generated_at),
                      expires: date(bundle.payload.expires_at),
                    },
                  )}
                </Notice>
              ) : (
                <Meta>{t("scannerX.offline.noBundle")}</Meta>
              )}
              <Button
                label={t("ui.downloadBundle")}
                variant="secondary"
                iconName="download"
                onPress={() => download.mutate()}
                loading={download.isPending}
                disabled={!offlineAvailable}
              />
              {download.isSuccess ? (
                <InfoNotice tone="success" role="status">
                  {t("ui.bundleSaved")}
                </InfoNotice>
              ) : null}
              {download.error ? (
                <Notice tone="danger">{offlineError(download.error)}</Notice>
              ) : null}
              <Meta>
                {lastSync
                  ? t("scannerX.offline.lastSync", {
                      date: date(lastSync.at),
                      accepted: lastSync.accepted,
                      conflicts: lastSync.conflicts,
                      rejected: lastSync.rejected,
                    })
                  : t("scannerX.offline.neverSynced")}
              </Meta>
              <Button
                label={t("ui.syncQueued", { count: queued })}
                variant="dark"
                onPress={() => {
                  setSyncResult(undefined);
                  synchronize.mutate();
                }}
                loading={synchronize.isPending}
                disabled={!offlineAvailable || !queued}
              />
              {synchronize.error ? (
                <Notice tone="danger">
                  {t("scannerX.offline.syncFailed", {
                    reason: offlineError(synchronize.error),
                  })}
                </Notice>
              ) : null}
              {syncResult ? (
                <View accessibilityLiveRegion="polite" className="gap-2">
                  <Notice tone={unresolved.length ? "warning" : "success"}>
                    {t("scannerX.offline.syncSummary", {
                      accepted: syncResult.accepted,
                      conflicts: syncResult.conflicts,
                      rejected: syncResult.rejected,
                    })}
                  </Notice>
                  {unresolved.map((item) => (
                    <Text key={item.operation_id} className="text-sm text-ink">
                      {scanStyle(item.outcome).icon}{" "}
                      {[
                        item.attendee_name,
                        item.ticket_code,
                        t(`scannerX.outcome.${item.outcome}.title`, {
                          defaultValue: item.outcome,
                        }),
                        item.code
                          ? t(`apiErrors.${item.code}`, { defaultValue: "" })
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Surface>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function ScannerPage() {
  return (
    <RequireAuth>
      <ScannerContent />
    </RequireAuth>
  );
}
