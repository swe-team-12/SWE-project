// Live updates for one support case, with keep-alive pings and reconnection.

export type CaseSocketStatus = "connecting" | "live" | "reconnecting" | "off";

interface CaseSocketOptions {
  /** Builds the socket URL for a fresh access token. */
  url(token: string): string;
  /** Current access token; read again on every (re)connect so a refreshed token is used. */
  getToken(): string | null;
  /** Called for every server event except keep-alive replies, and after a reconnect. */
  onEvent(): void;
  onStatus?(status: CaseSocketStatus): void;
  createSocket?(url: string): WebSocket;
}

const PING_INTERVAL_MS = 20_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
// The server closes with 4403 when the token or case access is rejected.
const ACCESS_DENIED_CODE = 4403;
const MAX_DENIED_ATTEMPTS = 3;
const OPEN = 1;

export function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
}

/**
 * Opens the case socket and keeps it open until the returned function is
 * called. A dropped connection is retried with exponential backoff; after a
 * successful reconnect `onEvent` fires once so messages missed in between are
 * fetched. Repeated access rejections stop the retries (polling remains).
 */
export function connectCaseSocket(options: CaseSocketOptions): () => void {
  const create =
    options.createSocket ?? ((url: string) => new WebSocket(url));
  let socket: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let denied = 0;
  let opened = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const stopPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = undefined;
  };

  const scheduleRetry = () => {
    if (disposed) return;
    options.onStatus?.("reconnecting");
    retryTimer = setTimeout(connect, retryDelay(attempt));
    attempt += 1;
  };

  function connect() {
    if (disposed) return;
    const token = options.getToken();
    if (!token) {
      scheduleRetry();
      return;
    }
    let current: WebSocket;
    try {
      current = create(options.url(token));
    } catch {
      scheduleRetry();
      return;
    }
    socket = current;
    current.onopen = () => {
      if (disposed) return;
      const reconnected = opened;
      opened = true;
      attempt = 0;
      denied = 0;
      options.onStatus?.("live");
      stopPing();
      pingTimer = setInterval(() => {
        if (current.readyState === OPEN) current.send("ping");
      }, PING_INTERVAL_MS);
      if (reconnected) options.onEvent();
    };
    current.onmessage = (event) => {
      if (disposed) return;
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string };
        if (payload.type === "pong") return;
      } catch {
        // Not JSON: treat it as a change notification.
      }
      options.onEvent();
    };
    current.onerror = () => {
      // The close event that follows drives the reconnect.
    };
    current.onclose = (event) => {
      if (disposed || socket !== current) return;
      stopPing();
      socket = null;
      if (event?.code === ACCESS_DENIED_CODE) {
        denied += 1;
        if (denied >= MAX_DENIED_ATTEMPTS) {
          options.onStatus?.("off");
          return;
        }
      }
      scheduleRetry();
    };
  }

  options.onStatus?.("connecting");
  connect();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    stopPing();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      socket = null;
    }
  };
}
