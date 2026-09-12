import { ed25519 } from "@noble/curves/ed25519.js";

import {
  type OfflineBundle,
  validateOfflineAdmission,
  verifyOfflineBundle,
} from "../offline";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedFixture(): OfflineBundle {
  const secret = new Uint8Array(32).fill(7);
  const publicKey = base64url(ed25519.getPublicKey(secret));
  const admissionPayload = {
    code: "TKT-OFFLINE-1",
    eid: "event-1",
    nonce: "opaque-nonce",
    tid: "ticket-1",
    typ: "admission",
    v: 1,
  };
  const admissionEncoded = base64url(
    new TextEncoder().encode(canonical(admissionPayload)),
  );
  const admissionSignature = base64url(
    ed25519.sign(new TextEncoder().encode(admissionEncoded), secret),
  );
  const qrToken = `bft:v1:${admissionEncoded}.${admissionSignature}`;
  const payload: OfflineBundle["payload"] = {
    version: 1,
    event_id: "event-1",
    generated_at: "2027-01-01T00:00:00Z",
    expires_at: "2027-01-02T00:00:00Z",
    public_key: publicKey,
    tickets: [
      {
        id: "ticket-1",
        code: "TKT-OFFLINE-1",
        status: "valid",
        attendee_name: "Demo Attendee",
        qr_token: qrToken,
        seat: { section: "A", row: "B", number: "7" },
      },
    ],
  };
  const encoded = base64url(new TextEncoder().encode(canonical(payload)));
  return {
    payload,
    encoded,
    signature: base64url(
      ed25519.sign(new TextEncoder().encode(encoded), secret),
    ),
  };
}

describe("offline scanner trust boundary", () => {
  it("accepts only a bundle signed by the separately trusted public key", () => {
    const bundle = signedFixture();
    expect(verifyOfflineBundle(bundle, bundle.payload.public_key)).toBe(true);
    expect(
      verifyOfflineBundle(bundle, base64url(new Uint8Array(32).fill(9))),
    ).toBe(false);
    expect(
      verifyOfflineBundle(
        { ...bundle, payload: { ...bundle.payload, event_id: "tampered" } },
        bundle.payload.public_key,
      ),
    ).toBe(false);
  });

  it("validates signed admission payloads and rejects campaign links", () => {
    const bundle = signedFixture();
    expect(
      validateOfflineAdmission(
        bundle,
        bundle.payload.tickets[0].qr_token,
        "event-1",
      )?.id,
    ).toBe("ticket-1");
    expect(
      validateOfflineAdmission(
        bundle,
        "https://example.com/c/campaign",
        "event-1",
      ),
    ).toBeNull();
    expect(
      validateOfflineAdmission(
        bundle,
        bundle.payload.tickets[0].qr_token,
        "another-event",
      ),
    ).toBeNull();
  });
});
