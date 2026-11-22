import { gcm } from "@noble/ciphers/aes.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

import { apiFetch } from "./api";

const KEY_NAME = "biletflow_offline_bundle_key";
let database: Promise<SQLite.SQLiteDatabase> | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = globalThis.atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function encryptionKey(): Promise<Uint8Array> {
  let stored: string | null = null;
  if (Platform.OS === "web")
    stored = globalThis.localStorage?.getItem(KEY_NAME) ?? null;
  else stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored) return fromBase64(stored);
  const key = Crypto.getRandomBytes(32);
  const encoded = toBase64(key);
  if (Platform.OS === "web")
    globalThis.localStorage?.setItem(KEY_NAME, encoded);
  else await SecureStore.setItemAsync(KEY_NAME, encoded);
  return key;
}

/**
 * Raised when the device or browser cannot provide persistent offline storage,
 * e.g. Firefox Private Browsing, which disables the origin private file system
 * that expo-sqlite relies on for the web.
 */
export class OfflineStorageUnavailableError extends Error {
  // Screens show a translated notice; the message is only a log identifier.
  readonly code = "offline_storage_unavailable";
  constructor(cause?: unknown) {
    super("offline_storage_unavailable");
    this.name = "OfflineStorageUnavailableError";
    this.cause = cause;
  }
}

/**
 * Raised when a downloaded bundle is not signed by the trusted admission key.
 * Screens translate it by type; nothing is stored in that case.
 */
export class OfflineBundleInvalidError extends Error {
  readonly code = "offline_bundle_invalid";
  constructor() {
    super("offline_bundle_invalid");
    this.name = "OfflineBundleInvalidError";
  }
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  try {
    const instance = await SQLite.openDatabaseAsync("biletflow-offline.db");
    await instance.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS offline_bundles (
          event_id TEXT PRIMARY KEY NOT NULL,
          nonce TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scan_queue (
          operation_id TEXT PRIMARY KEY NOT NULL,
          event_id TEXT NOT NULL,
          qr_token TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'queued'
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
    return instance;
  } catch (error) {
    throw new OfflineStorageUnavailableError(error);
  }
}

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!database) database = openDatabase();
  return database;
}

/** Resolves to the database, or null when offline storage cannot be opened. */
async function optionalDb(): Promise<SQLite.SQLiteDatabase | null> {
  try {
    return await db();
  } catch (error) {
    if (error instanceof OfflineStorageUnavailableError) return null;
    throw error;
  }
}

/** Whether offline bundles and the offline scan queue can be used here. */
export async function isOfflineStorageAvailable(): Promise<boolean> {
  return (await optionalDb()) !== null;
}

export interface OfflineBundle {
  payload: {
    version: number;
    event_id: string;
    generated_at: string;
    expires_at: string;
    public_key: string;
    tickets: {
      id: string;
      code: string;
      status: string;
      attendee_name: string;
      qr_token: string;
      seat: { section?: string; row?: string; number?: string };
    }[];
  };
  encoded: string;
  signature: string;
}

function verifySignature(
  encoded: string,
  signature: string,
  publicKey: string,
): boolean {
  return ed25519.verify(
    fromBase64(signature),
    new TextEncoder().encode(encoded),
    fromBase64(publicKey),
  );
}

function decodedPayload(encoded: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromBase64(encoded))) as Record<
    string,
    unknown
  >;
}

export function verifyOfflineBundle(
  bundle: OfflineBundle,
  trustedPublicKey: string,
): boolean {
  if (bundle.payload.public_key !== trustedPublicKey) return false;
  if (!verifySignature(bundle.encoded, bundle.signature, trustedPublicKey))
    return false;
  const signedPayload = decodedPayload(bundle.encoded);
  return canonicalJson(signedPayload) === canonicalJson(bundle.payload);
}

export function validateOfflineAdmission(
  bundle: OfflineBundle,
  qrToken: string,
  eventId: string,
): OfflineBundle["payload"]["tickets"][number] | null {
  if (!qrToken.startsWith("bft:v1:")) return null;
  const [encoded, signature] = qrToken.slice("bft:v1:".length).split(".", 2);
  if (
    !encoded ||
    !signature ||
    !verifySignature(encoded, signature, bundle.payload.public_key)
  ) {
    return null;
  }
  const payload = decodedPayload(encoded);
  if (payload.typ !== "admission" || payload.v !== 1 || payload.eid !== eventId)
    return null;
  return (
    bundle.payload.tickets.find(
      (ticket) =>
        ticket.id === payload.tid &&
        ticket.code === payload.code &&
        ticket.qr_token === qrToken,
    ) ?? null
  );
}

export async function saveOfflineBundle(
  bundle: OfflineBundle,
  trustedPublicKey: string,
): Promise<void> {
  if (!verifyOfflineBundle(bundle, trustedPublicKey)) {
    throw new OfflineBundleInvalidError();
  }
  const key = await encryptionKey();
  const nonce = Crypto.getRandomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = gcm(key, nonce).encrypt(plaintext);
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO offline_bundles(event_id, nonce, ciphertext, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET nonce=excluded.nonce, ciphertext=excluded.ciphertext, updated_at=excluded.updated_at`,
    bundle.payload.event_id,
    toBase64(nonce),
    toBase64(encrypted),
    new Date().toISOString(),
  );
}

export async function getOfflineBundle(
  eventId: string,
): Promise<OfflineBundle | null> {
  const instance = await optionalDb();
  if (!instance) return null;
  const row = await instance.getFirstAsync<{
    nonce: string;
    ciphertext: string;
  }>(
    "SELECT nonce, ciphertext FROM offline_bundles WHERE event_id = ?",
    eventId,
  );
  if (!row) return null;
  const key = await encryptionKey();
  const decrypted = gcm(key, fromBase64(row.nonce)).decrypt(
    fromBase64(row.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as OfflineBundle;
}

export async function queueOfflineScan(
  eventId: string,
  qrToken: string,
): Promise<string | null> {
  const operationId = Crypto.randomUUID();
  const instance = await db();
  const existing = await instance.getFirstAsync<{ operation_id: string }>(
    "SELECT operation_id FROM scan_queue WHERE event_id=? AND qr_token=? AND sync_status='queued'",
    eventId,
    qrToken,
  );
  if (existing) return null;
  await instance.runAsync(
    "INSERT INTO scan_queue(operation_id, event_id, qr_token, captured_at) VALUES (?, ?, ?, ?)",
    operationId,
    eventId,
    qrToken,
    new Date().toISOString(),
  );
  return operationId;
}

export async function queuedScanCount(eventId?: string): Promise<number> {
  const instance = await optionalDb();
  if (!instance) return 0;
  const row = eventId
    ? await instance.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM scan_queue WHERE sync_status='queued' AND event_id=?",
        eventId,
      )
    : await instance.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM scan_queue WHERE sync_status='queued'",
      );
  return row?.count ?? 0;
}

export type OfflineScanOutcome =
  | "valid"
  | "invalid"
  | "cancelled"
  | "refunded"
  | "already_used"
  | "wrong_event"
  | "conflict";

/** One queued scan as the server resolved it during synchronization. */
export interface OfflineSyncItem {
  operation_id: string;
  outcome: OfflineScanOutcome;
  ticket_id?: string | null;
  ticket_code?: string | null;
  attendee_name?: string | null;
  ticket_status?: string | null;
  ticket_type_name?: string | null;
  seat_label?: string | null;
  checked_in_at?: string | null;
  code?: string | null;
}

export interface OfflineSyncResult {
  accepted: number;
  conflicts: number;
  rejected: number;
  results: OfflineSyncItem[];
}

export interface OfflineSyncSummary {
  at: string;
  accepted: number;
  conflicts: number;
  rejected: number;
}

const EMPTY_SYNC: OfflineSyncResult = {
  accepted: 0,
  conflicts: 0,
  rejected: 0,
  results: [],
};
const CONFLICT_OUTCOMES = new Set(["conflict", "already_used"]);

/**
 * Counts results by outcome the way the server does: `valid` is accepted,
 * `conflict` / `already_used` are conflicts, everything else was rejected.
 */
export function countSyncOutcomes(results: { outcome: string }[]): {
  accepted: number;
  conflicts: number;
  rejected: number;
} {
  let accepted = 0;
  let conflicts = 0;
  let rejected = 0;
  for (const item of results) {
    if (item.outcome === "valid") accepted += 1;
    else if (CONFLICT_OUTCOMES.has(item.outcome)) conflicts += 1;
    else rejected += 1;
  }
  return { accepted, conflicts, rejected };
}

/** Results that need the scanner's attention after a synchronization. */
export function unresolvedSyncItems(
  results: OfflineSyncItem[],
): OfflineSyncItem[] {
  return results.filter((item) => item.outcome !== "valid");
}

function lastSyncKey(eventId?: string): string {
  return eventId ? `last_sync:${eventId}` : "last_sync";
}

/** When this device last synchronized queued scans, and how that went. */
export async function lastOfflineSync(): Promise<OfflineSyncSummary | null> {
  const instance = await optionalDb();
  if (!instance) return null;
  const row = await instance.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    lastSyncKey(),
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<OfflineSyncSummary>;
    if (typeof parsed.at !== "string") return null;
    return {
      at: parsed.at,
      accepted: Number(parsed.accepted) || 0,
      conflicts: Number(parsed.conflicts) || 0,
      rejected: Number(parsed.rejected) || 0,
    };
  } catch {
    return null;
  }
}

export async function syncOfflineScans(): Promise<OfflineSyncResult> {
  const instance = await optionalDb();
  if (!instance) return EMPTY_SYNC;
  const rows = await instance.getAllAsync<{
    operation_id: string;
    event_id: string;
    qr_token: string;
    captured_at: string;
  }>(
    "SELECT operation_id, event_id, qr_token, captured_at FROM scan_queue WHERE sync_status='queued' ORDER BY captured_at",
  );
  if (!rows.length) return EMPTY_SYNC;
  const response = await apiFetch<Partial<OfflineSyncResult>>(
    "/scanner/sync",
    {
      method: "POST",
      body: JSON.stringify({
        operations: rows.map((row) => ({
          operation_id: row.operation_id,
          event_id: row.event_id,
          qr_token: row.qr_token,
          captured_at: row.captured_at,
          was_offline: true,
        })),
      }),
    },
  );
  const results = response.results ?? [];
  const counted = countSyncOutcomes(results);
  const result: OfflineSyncResult = {
    accepted: response.accepted ?? counted.accepted,
    conflicts: response.conflicts ?? counted.conflicts,
    rejected: response.rejected ?? counted.rejected,
    results,
  };
  const summary: OfflineSyncSummary = {
    at: new Date().toISOString(),
    accepted: result.accepted,
    conflicts: result.conflicts,
    rejected: result.rejected,
  };
  // Only operations the server answered leave the queue; anything it did not
  // report stays queued for the next attempt (operation ids are idempotent).
  await instance.withTransactionAsync(async () => {
    for (const item of results) {
      await instance.runAsync(
        "DELETE FROM scan_queue WHERE operation_id=?",
        item.operation_id,
      );
    }
    await instance.runAsync(
      `INSERT INTO sync_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      lastSyncKey(),
      JSON.stringify(summary),
    );
  });
  return result;
}
