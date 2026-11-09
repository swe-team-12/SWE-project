import {
  OfflineStorageUnavailableError,
  getOfflineBundle,
  isOfflineStorageAvailable,
  queueOfflineScan,
  queuedScanCount,
  syncOfflineScans,
} from "../offline";

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => {
    throw new Error("SecurityError: Security error when calling GetDirectory");
  }),
}));

describe("offline storage unavailable (e.g. Firefox private browsing)", () => {
  it("reports unavailability instead of throwing", async () => {
    await expect(isOfflineStorageAvailable()).resolves.toBe(false);
  });

  it("falls back to empty offline state for read paths", async () => {
    await expect(queuedScanCount("event-1")).resolves.toBe(0);
    await expect(queuedScanCount()).resolves.toBe(0);
    await expect(getOfflineBundle("event-1")).resolves.toBeNull();
    await expect(syncOfflineScans()).resolves.toEqual({
      accepted: 0,
      conflicts: 0,
    });
  });

  it("rejects writes with a typed error", async () => {
    await expect(queueOfflineScan("event-1", "token")).rejects.toBeInstanceOf(
      OfflineStorageUnavailableError,
    );
  });
});
