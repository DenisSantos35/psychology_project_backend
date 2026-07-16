import crypto from "node:crypto";
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { required } from "../../common/validation";
import { supabase, supabaseAdmin } from "../../config/supabase";
import { prisma } from "../../database/prisma";
import { authenticate } from "../../middlewares/auth.middleware";
import { forgotPasswordRateLimit, loginRateLimit } from "../../middlewares/register-rate-limit.middleware";

export const clientAuthRoutes = Router();
const clientResetPasswordRedirectTo = process.env.CLIENT_RESET_PASSWORD_URL ?? "psycologi://auth/reset-password";
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

type PatientLoginProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
  patient_id: string | null;
  patient_active: boolean | null;
  patient_deleted_at: Date | null;
};

type PatientByEmail = {
  id: string;
  name: string;
  email: string;
  user_id: string | null;
};

type ExistingPatientUser = {
  id: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
};

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function validateEmail(email: string, field = "email"): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field, message: "E-mail invalido" }]);
  }
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field: "password", message: "Senha deve ter pelo menos 8 caracteres" }]);
  }
}

function getRedirectTo(body: Record<string, unknown>): string {
  const value = body.redirect_to ?? body.redirect_url ?? body.redirectTo;
  if (value === undefined || value === null || value === "") return clientResetPasswordRedirectTo;
  const redirectTo = String(value).trim();

  try {
    const url = new URL(redirectTo);
    if (!url.protocol) throw new Error("Missing protocol");
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field: "redirect_to", message: "URL de redirecionamento invalida" }]);
  }

  return redirectTo;
}

function getBearerToken(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function createPasswordRecoveryClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new HttpError(500, "INTERNAL_ERROR", "Supabase nao configurado.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getPatientProfileByUserId(userId: string): Promise<PatientLoginProfile | null> {
  const rows = await prisma.$queryRaw<PatientLoginProfile[]>`
    select
      u.id,
      u.name,
      u.email,
      u.role,
      u.is_active,
      u.deleted_at,
      p.id as patient_id,
      p.is_active as patient_active,
      p.deleted_at as patient_deleted_at
    from users u
    left join patients p on p.user_id = u.id
    where u.id = ${userId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

async function findPatientByEmail(email: string): Promise<PatientByEmail | null> {
  const rows = await prisma.$queryRaw<PatientByEmail[]>`
    select id, name, email, user_id
    from patients
    where lower(email) = ${email}
      and is_active = true
      and deleted_at is null
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function ensurePatientUser(patient: PatientByEmail): Promise<string | null> {
  if (patient.user_id) return patient.user_id;

  const existingUsers = await prisma.$queryRaw<ExistingPatientUser[]>`
    select id, role, is_active, deleted_at
    from users
    where lower(email) = ${patient.email}
      and deleted_at is null
    limit 1
  `;
  const existingUser = existingUsers[0];
  if (existingUser) {
    if (existingUser.role !== "patient" || !existingUser.is_active || existingUser.deleted_at) return null;
    await prisma.$executeRaw`
      update patients
      set user_id = ${existingUser.id}::uuid
      where id = ${patient.id}::uuid
    `;
    return existingUser.id;
  }

  if (!supabaseAdmin) return null;

  const temporaryPassword = crypto.randomBytes(32).toString("base64url");
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: patient.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { name: patient.name, role: "patient", patient_id: patient.id },
  });

  if (error || !data.user) {
    if (!error?.message.toLowerCase().includes("already")) return null;
    return null;
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      update users
      set name = ${patient.name},
          email = ${patient.email},
          role = 'patient',
          is_active = true,
          deleted_at = null
      where id = ${data.user!.id}::uuid
    `;
    await transaction.$executeRaw`
      update patients
      set user_id = ${data.user!.id}::uuid
      where id = ${patient.id}::uuid
    `;
  });

  return data.user.id;
}

clientAuthRoutes.post("/login", loginRateLimit, asyncHandler(async (request, response) => {
  required(request.body, ["email", "password"]);
  const email = normalizeEmail(request.body.email);
  validateEmail(email);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(request.body.password),
  });

  if (error || !data.session) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Credenciais invalidas.");
  }

  const profile = await getPatientProfileByUserId(data.user.id);
  if (!profile?.is_active || profile.deleted_at) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Credenciais invalidas.");
  }
  if (profile.role !== "patient" || !profile.patient_id || !profile.patient_active || profile.patient_deleted_at) {
    throw new HttpError(403, "CLIENT_ACCESS_FORBIDDEN", "Usuario nao e paciente ou sem acesso ao app cliente.");
  }

  response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: {
      id: profile.id,
      patient_id: profile.patient_id,
      name: profile.name,
      email: profile.email,
      role: "patient",
    },
  });
}));

clientAuthRoutes.post("/forgot-password", forgotPasswordRateLimit, asyncHandler(async (request, response) => {
  required(request.body, ["email"]);
  const email = normalizeEmail(request.body.email);
  const redirectTo = getRedirectTo(request.body);
  validateEmail(email);

  const patient = await findPatientByEmail(email);
  if (patient) {
    const userId = await ensurePatientUser(patient);
    if (userId) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error({ message: "Client password recovery e-mail failed", email, redirectTo, supabaseError: error.message });
        throw new HttpError(502, "PASSWORD_RECOVERY_EMAIL_FAILED", "Nao foi possivel enviar o e-mail de recuperacao.");
      }
    }
  }

  response.json({ message: "Se o e-mail existir, enviaremos instrucoes de recuperacao." });
}));

clientAuthRoutes.post("/reset-password", forgotPasswordRateLimit, asyncHandler(async (request, response) => {
  required(request.body, ["refresh_token", "password"]);
  const accessToken = getBearerToken(request.headers.authorization) ?? String(request.body.access_token ?? "").trim();
  const refreshToken = String(request.body.refresh_token).trim();
  const password = String(request.body.password);
  validatePassword(password);

  if (!accessToken) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field: "access_token", message: "Obrigatorio" }]);
  }

  const recoveryClient = createPasswordRecoveryClient();
  const { data: sessionData, error: sessionError } = await recoveryClient.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (sessionError || !sessionData.user) {
    throw new HttpError(400, "INVALID_RECOVERY_SESSION", "Sessao de recuperacao invalida ou expirada.");
  }

  const profile = await getPatientProfileByUserId(sessionData.user.id);
  if (!profile?.is_active || profile.deleted_at || profile.role !== "patient" || !profile.patient_id || !profile.patient_active || profile.patient_deleted_at) {
    throw new HttpError(403, "CLIENT_ACCESS_FORBIDDEN", "Usuario nao e paciente ou sem acesso ao app cliente.");
  }

  const { error: updateError } = await recoveryClient.auth.updateUser({ password });
  if (updateError) {
    throw new HttpError(400, "RESET_PASSWORD_FAILED", "Nao foi possivel redefinir a senha.");
  }

  response.json({ message: "Senha redefinida com sucesso." });
}));

clientAuthRoutes.post("/logout", authenticate, asyncHandler(async (request, response) => {
  if (supabaseAdmin) {
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (token) await supabaseAdmin.auth.admin.signOut(token, "global");
  }
  response.json({ message: "Logout realizado" });
}));
