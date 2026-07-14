import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../common/http-error";
import { createMockRequest, createMockResponse } from "./test-helpers";

process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost";
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "test-key";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/db";

const { authRoutes } = require("../modules/auth/auth.routes");
const { validateRegister } = require("../modules/auth/register.validation");
const { authenticate } = require("../middlewares/auth.middleware");
const { registerRateLimit } = require("../middlewares/register-rate-limit.middleware");
const { errorHandler } = require("../middlewares/error.middleware");
const { prisma } = require("../database/prisma");
const { supabase } = require("../config/supabase");

const baseRegisterBody = {
  name: "Ana Souza",
  cpf: "529.982.247-25",
  dateOfBirth: "1990-01-15",
  gender: "female",
  phone: "(11) 98888-7777",
  email: "ana@example.com",
  address: {
    cep: "01001-000",
    street: "Rua Exemplo",
    neighborhood: "Centro",
    city: "São Paulo",
    stateCode: "sp",
    number: "123",
    complement: "apto 12",
  },
  professionalType: "psychologist",
  professionalLicense: "CRP 12345",
  specialty: "Terapia cognitiva",
  password: "Senha@123",
  confirmPassword: "Senha@123",
};

test("validateRegister aceita um payload válido", () => {
  const input = validateRegister(baseRegisterBody);
  assert.equal(input.email, "ana@example.com");
  assert.equal(input.phone, "11988887777");
  assert.equal(input.stateCode, "SP");
  assert.equal(input.complement, "apto 12");
});

test("validateRegister rejeita senha divergente", () => {
  assert.throws(() => validateRegister({ ...baseRegisterBody, confirmPassword: "Outra@123" }), {
    name: "Error",
  });
});

test("registerRateLimit bloqueia após o limite", () => {
  const request = createMockRequest({ method: "POST", url: "/api/v1/auth/register" });
  Object.defineProperty(request, "ip", { value: "10.0.0.1" });
  const response = createMockResponse();
  const nextErrors: unknown[] = [];

  for (let index = 0; index < 10; index += 1) {
    registerRateLimit(request, response as never, (error?: unknown) => {
      if (error) nextErrors.push(error);
    });
  }

  registerRateLimit(request, response as never, (error?: unknown) => {
    if (error) nextErrors.push(error);
  });

  assert.equal(nextErrors.length, 1);
  assert.ok(nextErrors[0] instanceof HttpError);
  assert.equal((nextErrors[0] as HttpError).status, 429);
});

test("authenticate rejeita token ausente", async () => {
  const request = createMockRequest({ method: "GET", url: "/api/v1/auth/me" });
  const response = createMockResponse();

  await authenticate(request as never, response as never, () => undefined);

  assert.equal(response.statusCode, 401);
  assert.match(String((response.body as { message: string }).message), /Token de autenticação não informado/);
});

test("authenticate aceita usuário ativo", async () => {
  const originalGetUser = supabase.auth.getUser;
  const originalFindUnique = prisma.user.findUnique;

  (supabase.auth as any).getUser = async () => ({ data: { user: { id: "user-1", email: "ana@example.com" } }, error: null });
  prisma.user.findUnique = (async () => ({ isActive: true, deletedAt: null })) as never;

  const request = createMockRequest({ method: "GET", url: "/api/v1/auth/me" });
  request.headers.authorization = "Bearer token";
  const response = createMockResponse();
  let nextCalled = false;

  await authenticate(request as never, response as never, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal((response.locals.user as { id: string }).id, "user-1");

  (supabase.auth as any).getUser = originalGetUser;
  prisma.user.findUnique = originalFindUnique;
});

test("errorHandler converte HttpError em payload padronizado", () => {
  const response = createMockResponse();
  errorHandler(new HttpError(422, "RULE", "Falhou"), {} as never, response as never, () => undefined);
  assert.equal(response.statusCode, 422);
  assert.equal((response.body as { error: { code: string } }).error.code, "RULE");
});
