import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "../generated/prisma/client";
import { HttpError } from "../common/http-error";

export function notFound(request: Request, _response: Response, next: NextFunction): void {
  next(new HttpError(404, "ROUTE_NOT_FOUND", `Rota ${request.method} ${request.path} não encontrada.`));
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  const requestId = randomUUID();
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details, requestId } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    response.status(409).json({ error: { code: "RESOURCE_CONFLICT", message: "Registro já existente.", details: [], requestId } });
    return;
  }
  console.error({ requestId, message: error instanceof Error ? error.message : "Unknown error" });
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor.", details: [], requestId } });
}
