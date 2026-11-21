/**
 * Outcome of an operation whose failure is part of normal operation. The
 * caller branches on `ok` and, for a failure, on the error's `kind`.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
