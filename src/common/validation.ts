import { HttpError } from "./http-error";

export function required(body: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");
  if (missing.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", missing.map((field) => ({ field, message: "Obrigatório" })));
  }
}

export function asDate(value: unknown, field: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "VALIDATION_ERROR", `${field} deve ser uma data ISO 8601 válida.`);
  return date;
}

export function pagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function cleanDigits(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value).replace(/\D/g, "");
}

export function listResponse(data: unknown[], page: number, limit: number, total: number) {
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
