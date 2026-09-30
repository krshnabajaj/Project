/** Errors that are safe to show to the user. Anything else is logged and replaced by a generic message. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "VALIDATION"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_TRANSITION"
      | "LIMIT"
      | "UNAUTHENTICATED"
      | "INTEGRATION" = "VALIDATION",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "You are not allowed to perform this action.") => new AppError(msg, "FORBIDDEN");
export const notFound = (what = "Record") => new AppError(`${what} not found.`, "NOT_FOUND");

export function httpStatusFor(err: unknown): number {
  if (!(err instanceof AppError)) return 500;
  switch (err.code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "INVALID_TRANSITION":
      return 409;
    case "LIMIT":
      return 413;
    case "INTEGRATION":
      return 502;
    default:
      return 400;
  }
}
