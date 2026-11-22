interface ProblemCarrier extends Error {
  problem: { status?: number; code?: string };
}

// Duck-typed so it also works where the API module is mocked in tests.
function asApiError(value: unknown): ProblemCarrier | undefined {
  return value instanceof Error &&
    typeof (value as Partial<ProblemCarrier>).problem === "object" &&
    (value as Partial<ProblemCarrier>).problem !== null
    ? (value as ProblemCarrier)
    : undefined;
}

/**
 * Text for a failed request in the active language. ApiError already
 * localises known problem codes; download helpers wrap the ApiError as the
 * `cause`, so that is unwrapped too (except an expired session, which keeps
 * the wrapper's "sign in again" message).
 */
export function localizedErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const cause = asApiError(error instanceof Error ? error.cause : undefined);
  if (
    cause &&
    cause.problem.status !== 401 &&
    cause.problem.code !== "network_error"
  )
    return cause.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function errorCode(error: unknown): string | undefined {
  return (
    asApiError(error) ??
    asApiError(error instanceof Error ? error.cause : undefined)
  )?.problem.code;
}
