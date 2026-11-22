import { connectCaseSocket, retryDelay } from "../supportSocket";

class FakeSocket {
  static created: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.created.push(this);
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function start(onEvent = jest.fn(), onStatus = jest.fn()) {
  const stop = connectCaseSocket({
    url: (token) => `ws://test/case?token=${token}`,
    getToken: () => "token",
    onEvent,
    onStatus,
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
  return { stop, onEvent, onStatus };
}

describe("support case socket", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.created = [];
  });
  afterEach(() => jest.useRealTimers());

  it("backs off exponentially up to a ceiling", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(3)).toBe(8000);
    expect(retryDelay(20)).toBe(30000);
  });

  it("reports live, ignores pongs and refreshes on new messages", () => {
    const { onEvent, onStatus, stop } = start();
    const socket = FakeSocket.created[0];
    socket.open();
    expect(onStatus).toHaveBeenLastCalledWith("live");
    socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) });
    expect(onEvent).not.toHaveBeenCalled();
    socket.onmessage?.({ data: JSON.stringify({ type: "message" }) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(20_000);
    expect(socket.sent).toContain("ping");
    stop();
  });

  it("reconnects after a drop and refetches what was missed", () => {
    const { onEvent, onStatus, stop } = start();
    FakeSocket.created[0].open();
    FakeSocket.created[0].onclose?.({ code: 1006 });
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting");
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.created).toHaveLength(2);
    FakeSocket.created[1].open();
    expect(onEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops retrying after repeated access denials", () => {
    const { onStatus, stop } = start();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeSocket.created[attempt].onclose?.({ code: 4403 });
      jest.advanceTimersByTime(60_000);
    }
    expect(onStatus).toHaveBeenLastCalledWith("off");
    expect(FakeSocket.created).toHaveLength(3);
    stop();
  });

  it("closes the socket and cancels retries on cleanup", () => {
    const { stop } = start();
    const socket = FakeSocket.created[0];
    socket.onclose?.({ code: 1006 });
    stop();
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.created).toHaveLength(1);
    const second = start();
    second.stop();
    expect(FakeSocket.created[1].closed).toBe(true);
  });
});
