import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../common/http-error";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function createRateLimit(limit: number, windowMs: number, keyPrefix: string) {
  return function rateLimit(request: Request, _response: Response, next: NextFunction): void {
    const routeKey = request.originalUrl ?? request.path ?? request.url ?? "unknown";
    const key = `${keyPrefix}:${routeKey}:${request.ip ?? "unknown"}`;
    const now = Date.now();
    const current = attempts.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    entry.count += 1;
    attempts.set(key, entry);
    if (entry.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      request.res?.setHeader?.("Retry-After", String(retryAfterSeconds));
      return next(new HttpError(429, "RATE_LIMIT_EXCEEDED", "Muitas tentativas. Tente novamente mais tarde."));
    }
    next();
  };
}

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

export const registerRateLimit = createRateLimit(LIMIT, WINDOW_MS, "register");
export const loginRateLimit = createRateLimit(30, WINDOW_MS, "login");
export const forgotPasswordRateLimit = createRateLimit(15, WINDOW_MS, "forgot-password");

export function resetRateLimits(): void {
  attempts.clear();
}
