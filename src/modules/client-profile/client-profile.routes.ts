import { Router } from "express";
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

clientProfileRoutes.get("/", asyncHandler(async (_request, response) => {
  const profile = await getAuthenticatedPatientProfile(response.locals.user.id);
  const emergencyContacts = await listEmergencyContacts(profile.id);

  response.json({
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
