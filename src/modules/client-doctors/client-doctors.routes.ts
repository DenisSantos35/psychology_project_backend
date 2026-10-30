import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";

export const clientDoctorsRoutes = Router();

type QueryClient = Pick<typeof prisma, "$queryRaw">;

type ClientDoctorRow = {
  id: string;
  name: string;
  specialty: string | null;
  rating: string | number | null;
  location: string | null;
  avatar_url: string | null;
};

type AuthenticatedPatientRow = {
  patient_id: string;
  owner_user_id: string;
};

type AppointmentSlotRow = {
  starts_at: Date | string;
  ends_at: Date | string;
};

const SLOT_START_HOUR = 7;
const SLOT_END_HOUR = 20;
const SLOT_MINUTES = 30;
const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed", "scheduled"];

function searchFilter(search: string) {
  if (!search) return Prisma.empty;
  const term = `%${search}%`;
  return Prisma.sql`
    and (
      u.name ilike ${term}
      or pp.specialty ilike ${term}
      or pp.professional_type ilike ${term}
    )
  `;
}

function mapDoctor(row: ClientDoctorRow) {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    rating: row.rating === null ? null : Number(row.rating),
    location: row.location,
    avatar_url: row.avatar_url,
  };
}

function hasClientIdentifier(input: Record<string, unknown>): boolean {
  return "client_id" in input || "clientId" in input || "patient_id" in input || "patientId" in input;
}

function validateDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  return date;
}

function allSlots(): string[] {
  const slots: string[] = [];
  for (let total = SLOT_START_HOUR * 60; total <= SLOT_END_HOUR * 60; total += SLOT_MINUTES) {
    const hour = Math.floor(total / 60).toString().padStart(2, "0");
    const minute = (total % 60).toString().padStart(2, "0");
    slots.push(`${hour}:${minute}`);
  }
  return slots;
}

function slotDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-03:00`);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isSlotBlocked(date: string, time: string, appointments: AppointmentSlotRow[]): boolean {
  const startsAt = slotDate(date, time);
  const endsAt = addMinutes(startsAt, SLOT_MINUTES);
  return appointments.some((appointment) => {
    const appointmentStartsAt = new Date(appointment.starts_at);
    const appointmentEndsAt = new Date(appointment.ends_at);
    return appointmentStartsAt < endsAt && appointmentEndsAt > startsAt;
  });
}

export async function getAuthenticatedPatient(userId: string, client: QueryClient = prisma): Promise<AuthenticatedPatientRow> {
  const rows = await client.$queryRaw<AuthenticatedPatientRow[]>`
    select
      p.id as patient_id,
      p.owner_user_id
    from patients p
    join users patient_user on patient_user.id = p.user_id
    where p.user_id = ${userId}::uuid
      and p.is_active = true
      and p.deleted_at is null
      and patient_user.role = 'patient'
      and patient_user.is_active = true
      and patient_user.deleted_at is null
    limit 1
  `;

  if (!rows[0]) {
    throw new HttpError(403, "CLIENT_ACCESS_FORBIDDEN", "Usuario nao e paciente ou sem acesso ao app cliente.");
  }

  return rows[0];
}

export async function ensureLinkedDoctor(userId: string, doctorId: string, client: QueryClient = prisma): Promise<AuthenticatedPatientRow> {
  const doctors = await client.$queryRaw<Array<{ id: string }>>`
    select u.id
    from users u
    where u.id = ${doctorId}::uuid
      and u.role = 'professional'
      and u.is_active = true
      and u.deleted_at is null
    limit 1
  `;

  if (!doctors[0]) {
    throw new HttpError(404, "DOCTOR_NOT_FOUND", "Medico nao encontrado.");
  }

  const patient = await getAuthenticatedPatient(userId, client);
  if (patient.owner_user_id !== doctorId) {
    throw new HttpError(403, "DOCTOR_NOT_LINKED", "Medico nao vinculado ao paciente.");
  }

  return patient;
}

export async function listBlockedSlots(doctorId: string, date: string, client: QueryClient = prisma): Promise<string[]> {
  const appointments = await client.$queryRaw<AppointmentSlotRow[]>(Prisma.sql`
    select starts_at, ends_at
    from appointments
    where owner_user_id = ${doctorId}::uuid
      and status in (${Prisma.join(ACTIVE_APPOINTMENT_STATUSES)})
      and starts_at < ((${date}::date + interval '1 day') at time zone 'America/Sao_Paulo')
      and ends_at > (${date}::date at time zone 'America/Sao_Paulo')
  `);

  return allSlots().filter((slot) => isSlotBlocked(date, slot, appointments));
}

export function validateClientAppointmentDate(value: unknown): string {
  return validateDate(value);
}

export function validateClientAppointmentTime(value: unknown): string {
  const time = String(value ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < SLOT_START_HOUR || hour > SLOT_END_HOUR || ![0, 30].includes(minute)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  return time;
}

export function clientSlotDate(date: string, time: string): Date {
  return slotDate(date, time);
}

export function clientSlotEndDate(startsAt: Date): Date {
  return addMinutes(startsAt, SLOT_MINUTES);
}

export function hasForbiddenClientIdentifier(input: Record<string, unknown>): boolean {
  return hasClientIdentifier(input);
}

clientDoctorsRoutes.get("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const search = String(request.query.search ?? "").trim();

  if (hasClientIdentifier(request.query)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Nao envie client_id ou patient_id. O paciente e identificado pelo token autenticado.");
  }

  const doctors = await prisma.$queryRaw<ClientDoctorRow[]>(Prisma.sql`
    with authenticated_patient as (
      select
        p.id as patient_id,
        p.owner_user_id
      from patients p
      join users patient_user on patient_user.id = p.user_id
      where p.user_id = ${userId}::uuid
        and p.is_active = true
        and p.deleted_at is null
        and patient_user.role = 'patient'
        and patient_user.is_active = true
        and patient_user.deleted_at is null
      limit 1
    ),
    linked_doctors as (
      select distinct ap.owner_user_id, ap.patient_id
      from authenticated_patient ap
    )
    select
      u.id,
      coalesce(nullif(u.name, ''), 'Profissional') as name,
      pp.specialty,
      null::numeric as rating,
      coalesce(latest_consultation.location, nullif(pp.city, '')) as location,
      pp.avatar_url
    from linked_doctors linked
    join users u on u.id = linked.owner_user_id
    left join professional_profiles pp on pp.user_id = u.id
    left join lateral (
      select c.location
      from consultations c
      where c.patient_id = linked.patient_id
        and c.owner_user_id = linked.owner_user_id
        and nullif(c.location, '') is not null
      order by c.scheduled_at desc
      limit 1
    ) latest_consultation on true
    where u.role = 'professional'
      and u.is_active = true
      and u.deleted_at is null
      ${searchFilter(search)}
    order by u.name asc
  `);

  response.json({ doctors: doctors.map(mapDoctor) });
}));

clientDoctorsRoutes.get("/:doctorId/availability", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const doctorId = request.params.doctorId;
  const date = validateDate(request.query.date);

  if (hasClientIdentifier(request.query)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Nao envie client_id ou patient_id. O paciente e identificado pelo token autenticado.");
  }

  await ensureLinkedDoctor(userId, doctorId);
  const blockedSlots = await listBlockedSlots(doctorId, date);
  const blockedSet = new Set(blockedSlots);

  response.json({
    doctor_id: doctorId,
    date,
    available_slots: allSlots().filter((slot) => !blockedSet.has(slot)),
    blocked_slots: blockedSlots,
  });
}));