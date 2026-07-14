import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { required } from "../../common/validation";
import { supabase, supabaseAdmin } from "../../config/supabase";
import { authenticate } from "../../middlewares/auth.middleware";
import { prisma } from "../../database/prisma";
import { forgotPasswordRateLimit, loginRateLimit, registerRateLimit } from "../../middlewares/register-rate-limit.middleware";
import { validateRegister } from "./register.validation";

export const authRoutes = Router();

authRoutes.post("/register", registerRateLimit, asyncHandler(async (request, response) => {
  if (!supabaseAdmin) throw new HttpError(500, "INTERNAL_ERROR", "Cadastro profissional não configurado.");
  const input = validateRegister(request.body);
  const conflicts = await prisma.$queryRaw<Array<{ email: boolean; cpf: boolean; license: boolean }>>`
    select
      exists(select 1 from users where lower(email) = ${input.email} and deleted_at is null) as email,
      exists(select 1 from professional_profiles where cpf = ${input.cpf}) as cpf,
      exists(select 1 from professional_profiles where professional_license = ${input.professionalLicense}) as license
  `;
  if (conflicts[0]?.email) throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta com este e-mail.");
  if (conflicts[0]?.cpf) throw new HttpError(409, "CPF_ALREADY_EXISTS", "Já existe uma conta com este CPF.");
  if (conflicts[0]?.license) throw new HttpError(409, "LICENSE_ALREADY_EXISTS", "Já existe uma conta com esta licença profissional.");
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (error || !data.user) {
    if (error?.message.toLowerCase().includes("already")) throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta com este e-mail.");
    throw new HttpError(400, "AUTH_REGISTER_FAILED", "Não foi possível criar a conta.");
  }
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`update users set name = ${input.name}, email = ${input.email}, role = 'professional' where id = ${data.user!.id}::uuid`;
      await transaction.$executeRaw`
        insert into professional_profiles
          (user_id, cpf, date_of_birth, gender, phone, cep, street, neighborhood, city, state_code, address_number, complement, professional_type, professional_license, specialty)
        values
          (${data.user!.id}::uuid, ${input.cpf}, ${input.dateOfBirth}, ${input.gender}, ${input.phone}, ${input.cep}, ${input.street}, ${input.neighborhood}, ${input.city}, ${input.stateCode}, ${input.addressNumber}, ${input.complement}, ${input.professionalType}, ${input.professionalLicense}, ${input.specialty})
      `;
    });
  } catch (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw profileError;
  }
  response.status(201).json({ data: {
    id: data.user.id, name: input.name, email: input.email, role: "professional", isActive: true,
    professionalProfile: { professionalType: input.professionalType, professionalLicense: input.professionalLicense, specialty: input.specialty },
  } });
}));

authRoutes.post("/login", loginRateLimit, asyncHandler(async (request, response) => {
  required(request.body, ["email", "password"]);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(request.body.email).trim().toLowerCase(), password: String(request.body.password),
  });
  if (error || !data.session) throw new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos.");
  const profile = await prisma.user.findUnique({ where: { id: data.user.id } });
  if (!profile?.isActive || profile.deletedAt) throw new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos.");
  const expiresAt = new Date(Date.now() + data.session.expires_in * 1000).toISOString();
  response.json({ data: {
    accessToken: data.session.access_token, refreshToken: data.session.refresh_token,
    expiresIn: data.session.expires_in,
    expiresAt,
    user: { id: data.user.id, name: profile?.name ?? data.user.user_metadata.name, email: data.user.email, role: profile?.role ?? "professional" },
  } });
}));

authRoutes.post("/refresh", asyncHandler(async (request, response) => {
  required(request.body, ["refreshToken"]);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: String(request.body.refreshToken) });
  if (error || !data.session) throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token inválido.");
  const expiresAt = new Date(Date.now() + data.session.expires_in * 1000).toISOString();
  response.json({ data: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in, expiresAt } });
}));

authRoutes.post("/logout", authenticate, asyncHandler(async (request, response) => {
  if (supabaseAdmin) {
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (token) await supabaseAdmin.auth.admin.signOut(token, "global");
  }
  response.status(204).send();
}));

authRoutes.get("/me", authenticate, asyncHandler(async (_request, response) => {
  const authUser = response.locals.user;
  const profile = await prisma.user.findUnique({ where: { id: authUser.id } });
  response.json({ data: { ...profile, email: authUser.email } });
}));

authRoutes.post("/forgot-password", forgotPasswordRateLimit, asyncHandler(async (request, response) => {
  if (request.body.email) await supabase.auth.resetPasswordForEmail(String(request.body.email).trim().toLowerCase());
  response.json({ data: { message: "Se o email existir, as instruções de recuperação serão enviadas." } });
}));
