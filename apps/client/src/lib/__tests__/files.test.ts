jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn() }));
jest.mock("../api", () => ({ API_URL: "", currentAccessToken: () => null }));

import { saveBlobOnWeb } from "../files";

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
