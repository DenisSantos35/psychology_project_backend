import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../common/http-error";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

export function registerRateLimit(request: Request, _response: Response, next: NextFunction): void {
  const key = request.ip ?? "unknown";
  const now = Date.now();
  const current = attempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  entry.count += 1;
  attempts.set(key, entry);
  if (entry.count > LIMIT) return next(new HttpError(429, "RATE_LIMIT_EXCEEDED", "Muitas tentativas. Tente novamente mais tarde."));
  next();
}
