import * as Sharing from "expo-sharing";

import i18n from "@/i18n";

import { ApiError, setAccessToken } from "../api";
import { downloadAuthenticatedFile, saveBlobOnWeb } from "../files";

jest.mock("expo-file-system", () => ({
  File: jest.fn(() => ({ uri: "file://cache/download", write: jest.fn() })),
  Paths: {},
}));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn() }));
jest.mock("../session-storage", () => ({
  getRefreshToken: jest.fn(async () => "refresh"),
  setRefreshToken: jest.fn(async () => undefined),
}));
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));

describe("saveBlobOnWeb", () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let anchor: {
    href: string;
    download: string;
    style: { display: string };
    click: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: jest.fn(),
      remove: jest.fn(),
    };
    globalThis.document = {
      createElement: jest.fn(() => anchor),
      body: { appendChild: jest.fn() },
    } as unknown as Document;
    URL.createObjectURL = jest.fn(() => "blob:ticket");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("keeps the object URL alive until after the download starts", () => {
    saveBlobOnWeb(new Blob(["%PDF"]), "TICKET-1.pdf");

    expect(anchor.download).toBe("TICKET-1.pdf");
    expect(anchor.href).toBe("blob:ticket");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ticket");
  });
});

describe("downloadAuthenticatedFile", () => {
  const originalFetch = globalThis.fetch;

  function response(status: number, body: BodyInit, type: string) {
    return new Response(body, { status, headers: { "content-type": type } });
  }

  beforeEach(() => {
    jest.mocked(Sharing.shareAsync).mockClear();
    setAccessToken("expired-token");
    void i18n.changeLanguage("en");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAccessToken(null);
  });

  it("refreshes an expired access token and retries the download once", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response(
          401,
          JSON.stringify({
            status: 401,
            code: "token_expired",
            title: "Unauthorized",
            detail: "Token has expired",
          }),
          "application/problem+json",
        ),
      )
      .mockResolvedValueOnce(
        response(
          200,
          JSON.stringify({ access_token: "fresh", refresh_token: "r2" }),
          "application/json",
        ),
      )
      .mockResolvedValueOnce(response(200, "%PDF", "application/pdf"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await downloadAuthenticatedFile(
      "/tickets/1/pdf",
      "T-1.pdf",
      "application/pdf",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/refresh");
    const retryHeaders = fetchMock.mock.calls[2][1].headers as Headers;
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh");
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file://cache/download", {
      mimeType: "application/pdf",
      dialogTitle: "T-1.pdf",
    });
  });

  it("asks the user to sign in again when the session cannot be refreshed", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response(
          401,
          JSON.stringify({
            status: 401,
            code: "token_expired",
            title: "Unauthorized",
            detail: "Token has expired",
          }),
          "application/problem+json",
        ),
      )
      .mockResolvedValueOnce(
        response(401, "{}", "application/json"),
      ) as unknown as typeof fetch;

    await expect(
      downloadAuthenticatedFile("/tickets/1/pdf", "T-1.pdf", "application/pdf"),
    ).rejects.toThrow(i18n.t("ui.sessionExpired"));
  });

  it("surfaces the server problem detail for other errors", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response(
          409,
          JSON.stringify({
            status: 409,
            code: "ticket_void",
            title: "Conflict",
            detail: "Ticket was refunded.",
          }),
          "application/problem+json",
        ),
      ) as unknown as typeof fetch;

    const error = await downloadAuthenticatedFile(
      "/tickets/1/pdf",
      "T-1.pdf",
      "application/pdf",
    ).catch((caught: Error) => caught);
    expect((error as Error).message).toBe("Ticket was refunded.");
    expect((error as Error).cause).toBeInstanceOf(ApiError);
  });

  it("falls back to a translated message when the error has no problem body", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response(502, "Bad gateway", "text/plain"),
      ) as unknown as typeof fetch;

    await expect(
      downloadAuthenticatedFile("/tickets/1/pdf", "T-1.pdf", "application/pdf"),
    ).rejects.toThrow(i18n.t("ui.downloadFailed"));
  });
});
