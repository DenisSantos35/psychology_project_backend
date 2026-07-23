import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { required } from "../../common/validation";
import { prisma } from "../../database/prisma";

export const clientProfileRoutes = Router();

type ClientProfileRow = {
  id: string;
  patient_user_id: string | null;
  name: string;
  email: string | null;
  cpf: string | null;
  date_of_birth: Date | string | null;
  gender: string | null;
  cep: string | null;
  street: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state_code: string | null;
  complement: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  user_role: string | null;
  user_is_active: boolean | null;
  user_deleted_at: Date | null;
  plan_name: string | null;
};

type EmergencyContactRow = {
  id: string;
  name: string;
  relationship: string | null;
  phone: string;
};

type ClientProfileResponse = {
  id: string;
  patient_code: string;
  plan_name: string | null;
  full_name: string;
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  cpf_masked: string | null;
  address: {
    zip_code: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    complement: string | null;
  };
  emergency_contacts: EmergencyContactRow[];
};

function formatDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function maskCpf(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 2)}*.***.***-${digits.slice(9)}`;
}

function patientCode(patientId: string): string {
  const compact = patientId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `#${compact.slice(0, 4)} ${compact.slice(4, 6)}`;
}

function validateEmergencyContact(body: Record<string, unknown>) {
  required(body, ["name", "relationship", "phone"]);
  return {
    name: String(body.name).trim(),
    relationship: String(body.relationship).trim(),
    phone: String(body.phone).trim(),
  };
}

function optionalText(body: Record<string, unknown>, field: string): string | undefined {
  if (!(field in body)) return undefined;
  return typeof body[field] === "string" ? body[field].trim() : "";
}

function validateClientProfileUpdate(body: Record<string, unknown>) {
  const allowed = new Set(["full_name", "email", "birth_date", "gender", "address"]);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));
  if (unknown.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", unknown.map((field) => ({ field, message: "Campo desconhecido" })));
  }

  const address = body.address && typeof body.address === "object" && !Array.isArray(body.address) ? body.address as Record<string, unknown> : undefined;
  if ("address" in body && !address) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field: "address", message: "Endereco invalido" }]);
  }

  const allowedAddress = new Set(["zip_code", "street", "number", "district", "city", "state", "complement"]);
  const invalidAddress = address ? Object.keys(address).filter((field) => !allowedAddress.has(field)) : [];
  if (invalidAddress.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", invalidAddress.map((field) => ({ field: `address.${field}`, message: "Campo desconhecido" })));
  }

  const fullName = optionalText(body, "full_name");
  const email = optionalText(body, "email")?.toLowerCase();
  const birthDateText = optionalText(body, "birth_date");
  const gender = optionalText(body, "gender");
  const zipCode = address && "zip_code" in address ? String(address.zip_code ?? "").trim() : undefined;
  const street = address ? optionalText(address, "street") : undefined;
  const number = address ? optionalText(address, "number") : undefined;
  const district = address ? optionalText(address, "district") : undefined;
  const city = address ? optionalText(address, "city") : undefined;
  const state = address && "state" in address ? String(address.state ?? "").trim().toUpperCase() : undefined;
  const complement = address && "complement" in address ? String(address.complement ?? "").trim() || null : undefined;

  const errors: Array<{ field: string; message: string }> = [];
  for (const [field, current] of Object.entries({ full_name: fullName, email, birth_date: birthDateText, gender })) {
    if (current === "") errors.push({ field, message: "Nao pode ser vazio" });
  }
  for (const [field, current] of Object.entries({ zip_code: zipCode, street, number, district, city, state })) {
    if (current === "") errors.push({ field: `address.${field}`, message: "Nao pode ser vazio" });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: "email", message: "E-mail invalido" });
  if (state && !/^[A-Z]{2}$/.test(state)) errors.push({ field: "address.state", message: "UF invalida" });

  let birthDate: Date | undefined;
  if (birthDateText) {
    birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateText) ? new Date(`${birthDateText}T00:00:00.000Z`) : undefined;
    if (!birthDate || Number.isNaN(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== birthDateText || birthDate > new Date()) {
      errors.push({ field: "birth_date", message: "Data invalida ou futura" });
    }
  }
  if (errors.length) throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", errors);

  return { fullName, email, birthDate, gender, zipCode, street, number, district, city, state, complement };
}

async function getAuthenticatedPatientProfile(userId: string): Promise<ClientProfileRow> {
  const rows = await prisma.$queryRaw<ClientProfileRow[]>`
    select
      p.id,
      p.user_id as patient_user_id,
      p.name,
      p.email,
      p.cpf,
      p.date_of_birth,
      p.gender,
      p.cep,
      p.street,
      p.address_number,
      p.neighborhood,
      p.city,
      p.state_code,
      p.complement,
      p.is_active,
      p.deleted_at,
      u.role as user_role,
      u.is_active as user_is_active,
      u.deleted_at as user_deleted_at,
      owner.plan as plan_name
    from patients p
    join users u on u.id = p.user_id
    left join users owner on owner.id = p.owner_user_id
    where p.user_id = ${userId}::uuid
    limit 1
  `;

  const profile = rows[0];
  if (
    !profile ||
    !profile.is_active ||
    profile.deleted_at ||
    profile.user_role !== "patient" ||
    !profile.user_is_active ||
    profile.user_deleted_at
  ) {
    throw new HttpError(403, "CLIENT_ACCESS_FORBIDDEN", "Usuario nao e paciente ou sem acesso ao app cliente.");
  }

  return profile;
}

async function listEmergencyContacts(patientId: string): Promise<EmergencyContactRow[]> {
  return prisma.$queryRaw<EmergencyContactRow[]>`
    select id, name, relationship, phone
    from patient_emergency_contacts
    where patient_id = ${patientId}::uuid
    order by is_primary desc, created_at desc
  `;
}

async function buildClientProfileResponse(profile: ClientProfileRow): Promise<ClientProfileResponse> {
  const emergencyContacts = await listEmergencyContacts(profile.id);

  return {
    id: profile.id,
    patient_code: patientCode(profile.id),
    plan_name: profile.plan_name,
    full_name: profile.name,
    email: profile.email,
    birth_date: formatDate(profile.date_of_birth),
    gender: profile.gender,
    cpf_masked: maskCpf(profile.cpf),
    address: {
      zip_code: profile.cep,
      street: profile.street,
      number: profile.address_number,
      district: profile.neighborhood,
      city: profile.city,
      state: profile.state_code,
      complement: profile.complement,
    },
    emergency_contacts: emergencyContacts,
  };
}

clientProfileRoutes.get("/", asyncHandler(async (_request, response) => {
  const profile = await getAuthenticatedPatientProfile(response.locals.user.id);
  response.json(await buildClientProfileResponse(profile));
}));

clientProfileRoutes.patch("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const currentProfile = await getAuthenticatedPatientProfile(userId);
  const input = validateClientProfileUpdate(request.body);
  const userUpdates: Prisma.Sql[] = [];
  const patientUpdates: Prisma.Sql[] = [];

  if (input.fullName !== undefined) {
    userUpdates.push(Prisma.sql`name = ${input.fullName}`);
    patientUpdates.push(Prisma.sql`name = ${input.fullName}`);
  }
  if (input.email !== undefined) {
    userUpdates.push(Prisma.sql`email = ${input.email}`);
    patientUpdates.push(Prisma.sql`email = ${input.email}`);
  }
  if (input.birthDate !== undefined) patientUpdates.push(Prisma.sql`date_of_birth = ${input.birthDate}`);
  if (input.gender !== undefined) patientUpdates.push(Prisma.sql`gender = ${input.gender}`);
  if (input.zipCode !== undefined) patientUpdates.push(Prisma.sql`cep = ${input.zipCode}`);
  if (input.street !== undefined) patientUpdates.push(Prisma.sql`street = ${input.street}`);
  if (input.number !== undefined) patientUpdates.push(Prisma.sql`address_number = ${input.number}`);
  if (input.district !== undefined) patientUpdates.push(Prisma.sql`neighborhood = ${input.district}`);
  if (input.city !== undefined) patientUpdates.push(Prisma.sql`city = ${input.city}`);
  if (input.state !== undefined) patientUpdates.push(Prisma.sql`state_code = ${input.state}`);
  if (input.complement !== undefined) patientUpdates.push(Prisma.sql`complement = ${input.complement}`);

  if (input.email) {
    const conflicts = await prisma.$queryRaw<Array<{ email: boolean }>>`
      select exists(select 1 from users where lower(email) = ${input.email} and id <> ${userId}::uuid and deleted_at is null) as email
    `;
    if (conflicts[0]?.email) throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Ja existe uma conta com este e-mail.");
  }

  if (userUpdates.length || patientUpdates.length) {
    await prisma.$transaction(async (transaction) => {
      if (userUpdates.length) {
        await transaction.$executeRaw(Prisma.sql`update users set ${Prisma.join(userUpdates)}, updated_at = now() where id = ${userId}::uuid`);
      }
      if (patientUpdates.length) {
        await transaction.$executeRaw(Prisma.sql`update patients set ${Prisma.join(patientUpdates)}, updated_at = now() where id = ${currentProfile.id}::uuid and user_id = ${userId}::uuid`);
      }
    });
  }

  const updatedProfile = await getAuthenticatedPatientProfile(userId);
  response.json({
    message: "Perfil atualizado",
    profile: await buildClientProfileResponse(updatedProfile),
  });
}));

clientProfileRoutes.post("/emergency-contacts", asyncHandler(async (request, response) => {
  const profile = await getAuthenticatedPatientProfile(response.locals.user.id);
  const input = validateEmergencyContact(request.body);
  const contacts = await prisma.$queryRaw<EmergencyContactRow[]>`
    insert into patient_emergency_contacts (patient_id, name, relationship, phone, is_primary)
    values (
      ${profile.id}::uuid,
      ${input.name},
      ${input.relationship},
      ${input.phone},
      not exists(select 1 from patient_emergency_contacts where patient_id = ${profile.id}::uuid)
    )
    returning id, name, relationship, phone
  `;

  response.status(201).json(contacts[0]);
}));

clientProfileRoutes.patch("/emergency-contacts/:id", asyncHandler(async (request, response) => {
  const profile = await getAuthenticatedPatientProfile(response.locals.user.id);
  const input = validateEmergencyContact(request.body);
  const contacts = await prisma.$queryRaw<EmergencyContactRow[]>`
    update patient_emergency_contacts
    set name = ${input.name},
        relationship = ${input.relationship},
        phone = ${input.phone},
        updated_at = now()
    where id = ${request.params.id}::uuid
      and patient_id = ${profile.id}::uuid
    returning id, name, relationship, phone
  `;

  if (!contacts[0]) {
    throw new HttpError(404, "EMERGENCY_CONTACT_NOT_FOUND", "Contato de emergencia nao encontrado.");
  }

  response.json(contacts[0]);
}));
