import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";
import { supabaseAdmin } from "../../config/supabase";
import { registerRateLimit } from "../../middlewares/register-rate-limit.middleware";

export const professionalProfilesRoutes = Router();
const TYPES = new Set(["psychologist", "doctor", "nutritionist", "physiotherapist"]);
const ALLOWED = new Set(["name", "email", "phone", "specialty", "professionalLicense", "professionalType", "dateOfBirth", "gender", "address"]);
const FORBIDDEN = new Set(["role", "plan", "isActive", "userId", "cpf", "createdAt", "avatarUrl"]);

type ProfileRow = {
  id: string; userId: string; name: string; email: string; role: string; plan: string | null; isActive: boolean;
  cpf: string; dateOfBirth: Date | string; gender: string; phone: string; cep: string; street: string; neighborhood: string;
  city: string; stateCode: string; number: string; complement: string | null; professionalType: string;
  professionalLicense: string; specialty: string; avatarUrl: string | null; createdAt: Date; updatedAt: Date;
};

async function getProfile(userId: string, client = prisma): Promise<Record<string, unknown>> {
  const rows = await client.$queryRaw<ProfileRow[]>`
    select p.id, u.id as "userId", u.name, u.email, u.role, u.plan, u.is_active as "isActive",
      p.cpf, p.date_of_birth as "dateOfBirth", p.gender, p.phone, p.cep, p.street, p.neighborhood,
      p.city, p.state_code as "stateCode", p.address_number as number, p.complement,
      p.professional_type as "professionalType", p.professional_license as "professionalLicense",
      p.specialty, p.avatar_url as "avatarUrl", p.created_at as "createdAt", p.updated_at as "updatedAt"
    from professional_profiles p join users u on u.id = p.user_id
    where p.user_id = ${userId}::uuid and u.deleted_at is null
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, "PROFESSIONAL_PROFILE_NOT_FOUND", "Perfil profissional não encontrado.");
  const { cep, street, neighborhood, city, stateCode, number, complement, ...profile } = row;
  const dateOfBirth = row.dateOfBirth instanceof Date ? row.dateOfBirth.toISOString().slice(0, 10) : String(row.dateOfBirth);
  return { ...profile, dateOfBirth, address: { cep, street, neighborhood, city, stateCode, number, complement } };
}

function value(body: Record<string, unknown>, field: string): string | undefined {
  if (!(field in body)) return undefined;
  return typeof body[field] === "string" ? body[field].trim() : "";
}

professionalProfilesRoutes.get("/me", asyncHandler(async (_request, response) => {
  response.json({ data: await getProfile(response.locals.user.id) });
}));

professionalProfilesRoutes.patch("/me", registerRateLimit, asyncHandler(async (request, response) => {
  if (!supabaseAdmin) throw new HttpError(500, "INTERNAL_ERROR", "Atualização profissional não configurada.");
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const fields = Object.keys(body);
  const forbidden = fields.filter((field) => FORBIDDEN.has(field));
  const unknown = fields.filter((field) => !ALLOWED.has(field) && !FORBIDDEN.has(field));
  if (!fields.length || forbidden.length || unknown.length) {
    const invalid = forbidden.length ? forbidden : unknown;
    throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", invalid.map((field) => ({ field, message: forbidden.length ? "Campo não pode ser alterado" : "Campo desconhecido" })));
  }
  const address = body.address && typeof body.address === "object" && !Array.isArray(body.address) ? body.address as Record<string, unknown> : undefined;
  if ("address" in body && !address) throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", [{ field: "address", message: "Endereço inválido" }]);
  const allowedAddress = new Set(["cep", "street", "neighborhood", "city", "stateCode", "number", "complement"]);
  const invalidAddress = address ? Object.keys(address).filter((field) => !allowedAddress.has(field)) : [];
  if (address && (!Object.keys(address).length || invalidAddress.length)) throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", invalidAddress.map((field) => ({ field: `address.${field}`, message: "Campo desconhecido" })));

  const name = value(body, "name");
  const email = value(body, "email")?.toLowerCase();
  const phone = value(body, "phone")?.replace(/\D/g, "");
  const specialty = value(body, "specialty");
  const professionalLicense = value(body, "professionalLicense");
  const professionalType = value(body, "professionalType");
  const dateText = value(body, "dateOfBirth");
  const gender = value(body, "gender");
  const cep = address && "cep" in address ? String(address.cep ?? "").replace(/\D/g, "") : undefined;
  const stateCode = address && "stateCode" in address ? String(address.stateCode ?? "").trim().toUpperCase() : undefined;
  const addressValues = address ? {
    street: value(address, "street"), neighborhood: value(address, "neighborhood"), city: value(address, "city"),
    number: value(address, "number"), complement: "complement" in address ? (value(address, "complement") || null) : undefined,
  } : {};
  const errors: Array<{ field: string; message: string }> = [];
  for (const [field, current] of Object.entries({ name, email, phone, specialty, professionalLicense, professionalType, dateOfBirth: dateText, gender })) if (current === "") errors.push({ field, message: "Não pode ser vazio" });
  for (const [field, current] of Object.entries({ cep, stateCode, ...addressValues })) if (current === "") errors.push({ field: `address.${field}`, message: "Não pode ser vazio" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: "email", message: "E-mail inválido" });
  if (phone && !/^\d{10,11}$/.test(phone)) errors.push({ field: "phone", message: "Use 10 ou 11 dígitos" });
  if (cep && !/^\d{8}$/.test(cep)) errors.push({ field: "address.cep", message: "Use 8 dígitos" });
  if (stateCode && !/^[A-Z]{2}$/.test(stateCode)) errors.push({ field: "address.stateCode", message: "UF inválida" });
  if (professionalType && !TYPES.has(professionalType)) errors.push({ field: "professionalType", message: "Tipo profissional inválido" });
  let dateOfBirth: Date | undefined;
  if (dateText) {
    dateOfBirth = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : undefined;
    if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime()) || dateOfBirth.toISOString().slice(0, 10) !== dateText || dateOfBirth > new Date()) errors.push({ field: "dateOfBirth", message: "Data inválida ou futura" });
  }
  if (errors.length) throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", errors);

  const userId = response.locals.user.id as string;
  const current = await getProfile(userId) as { id: string; email: string; name: string };
  const conflicts = await prisma.$queryRaw<Array<{ email: boolean; license: boolean }>>`
    select exists(select 1 from users where lower(email) = ${email ?? ""} and id <> ${userId}::uuid and deleted_at is null) as email,
      exists(select 1 from professional_profiles where professional_license = ${professionalLicense ?? ""} and user_id <> ${userId}::uuid) as license
  `;
  if (email && conflicts[0]?.email) throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta com este e-mail.");
  if (professionalLicense && conflicts[0]?.license) throw new HttpError(409, "LICENSE_ALREADY_EXISTS", "Já existe uma conta com esta licença profissional.");

  const userUpdates: Prisma.Sql[] = [];
  const profileUpdates: Prisma.Sql[] = [];
  if (name !== undefined) userUpdates.push(Prisma.sql`name = ${name}`);
  if (email !== undefined) userUpdates.push(Prisma.sql`email = ${email}`);
  if (phone !== undefined) profileUpdates.push(Prisma.sql`phone = ${phone}`);
  if (specialty !== undefined) profileUpdates.push(Prisma.sql`specialty = ${specialty}`);
  if (professionalLicense !== undefined) profileUpdates.push(Prisma.sql`professional_license = ${professionalLicense}`);
  if (professionalType !== undefined) profileUpdates.push(Prisma.sql`professional_type = ${professionalType}`);
  if (dateOfBirth !== undefined) profileUpdates.push(Prisma.sql`date_of_birth = ${dateOfBirth}`);
  if (gender !== undefined) profileUpdates.push(Prisma.sql`gender = ${gender}`);
  if (cep !== undefined) profileUpdates.push(Prisma.sql`cep = ${cep}`);
  if (stateCode !== undefined) profileUpdates.push(Prisma.sql`state_code = ${stateCode}`);
  if (addressValues.street !== undefined) profileUpdates.push(Prisma.sql`street = ${addressValues.street}`);
  if (addressValues.neighborhood !== undefined) profileUpdates.push(Prisma.sql`neighborhood = ${addressValues.neighborhood}`);
  if (addressValues.city !== undefined) profileUpdates.push(Prisma.sql`city = ${addressValues.city}`);
  if (addressValues.number !== undefined) profileUpdates.push(Prisma.sql`address_number = ${addressValues.number}`);
  if (addressValues.complement !== undefined) profileUpdates.push(Prisma.sql`complement = ${addressValues.complement}`);

  const authChanged = email !== undefined || name !== undefined;
  if (authChanged) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ...(email !== undefined ? { email, email_confirm: true } : {}),
      ...(name !== undefined ? { user_metadata: { name } } : {}),
    });
    if (error) throw new HttpError(400, "BUSINESS_RULE_ERROR", "Não foi possível atualizar os dados de autenticação.");
  }
  try {
    await prisma.$transaction(async (transaction) => {
      if (userUpdates.length) await transaction.$executeRaw(Prisma.sql`update users set ${Prisma.join(userUpdates)}, updated_at = now() where id = ${userId}::uuid`);
      if (profileUpdates.length) await transaction.$executeRaw(Prisma.sql`update professional_profiles set ${Prisma.join(profileUpdates)}, updated_at = now() where user_id = ${userId}::uuid`);
      await transaction.$executeRaw`insert into audit_logs(actor_user_id, owner_user_id, entity_type, action, entity_id, metadata) values (${userId}::uuid, ${userId}::uuid, 'professional_profile', 'update', ${current.id}::uuid, ${JSON.stringify({ fields: fields.flatMap((field) => field === "address" ? Object.keys(address!).map((item) => `address.${item}`) : field) })}::jsonb)`;
    });
  } catch (error) {
    if (authChanged) await supabaseAdmin.auth.admin.updateUserById(userId, { email: current.email, email_confirm: true, user_metadata: { name: current.name } }).catch(() => undefined);
    throw error;
  }
  response.json({ data: await getProfile(userId) });
}));
