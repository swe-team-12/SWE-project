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

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!database) {
    database = SQLite.openDatabaseAsync("biletflow-offline.db").then(
      async (instance) => {
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
      `);
        return instance;
      },
    );
  }
  return database;
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
    throw new Error("The offline validation bundle signature is invalid.");
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
  const instance = await db();
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
  const instance = await db();
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

export async function syncOfflineScans(): Promise<{
  accepted: number;
  conflicts: number;
}> {
  const instance = await db();
  const rows = await instance.getAllAsync<{
    operation_id: string;
    event_id: string;
    qr_token: string;
    captured_at: string;
  }>(
    "SELECT operation_id, event_id, qr_token, captured_at FROM scan_queue WHERE sync_status='queued' ORDER BY captured_at",
  );
  if (!rows.length) return { accepted: 0, conflicts: 0 };
  const result = await apiFetch<{
    accepted: number;
    conflicts: number;
    results: { operation_id: string; outcome: string }[];
  }>("/scanner/sync", {
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
  });
  await instance.withTransactionAsync(async () => {
    for (const item of result.results) {
      await instance.runAsync(
        "DELETE FROM scan_queue WHERE operation_id=?",
        item.operation_id,
      );
    }
  });
  return result;
}
