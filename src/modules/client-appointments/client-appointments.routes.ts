import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";
import {
  clientSlotDate,
  clientSlotEndDate,
  getAuthenticatedPatient,
  hasForbiddenClientIdentifier,
  listBlockedSlots,
  validateClientAppointmentDate,
  validateClientAppointmentTime,
} from "../client-doctors/client-doctors.routes";

export const clientAppointmentsRoutes = Router();
const ACTIVE_PATIENT_APPOINTMENT_STATUSES = ["pending", "confirmed"];

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ensureNotPastDate(date: string): void {
  if (date < todayInSaoPaulo()) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }
}

clientAppointmentsRoutes.get("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const patient = await getAuthenticatedPatient(userId);
  const statuses = ["pending", "confirmed", "completed", "cancelled"];
  const status = String(request.query.status ?? "").trim();
  const statusFilter = statuses.includes(status) ? Prisma.sql`and a.status = ${status}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    doctor_id: string;
    date: string;
    time: string;
    status: string;
    reason: string | null;
  }>>(Prisma.sql`
    select
      a.id,
      a.owner_user_id as doctor_id,
      to_char(a.starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
      to_char(a.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') as time,
      a.status,
      a.description as reason
    from appointments a
    where a.patient_id = ${patient.patient_id}::uuid
      ${statusFilter}
    order by a.starts_at asc
  `);

  response.json({ appointments: rows });
}));
clientAppointmentsRoutes.post("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};

  if (hasForbiddenClientIdentifier(body)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  const requestedDoctorId = String(body.doctor_id ?? body.doctorId ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  const date = validateClientAppointmentDate(body.date);
  const time = validateClientAppointmentTime(body.time);
  ensureNotPastDate(date);

  if (!reason) {
    throw new HttpError(422, "VALIDATION_ERROR", "Revise os dados informados e tente novamente.");
  }

  const startsAt = clientSlotDate(date, time);
  const endsAt = clientSlotEndDate(startsAt);

  const appointment = await prisma.$transaction(async (transaction) => {
    const patient = await getAuthenticatedPatient(userId, transaction);
    const doctorId = patient.owner_user_id;

    await transaction.$queryRaw<Array<{ lock_result: string }>>(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${`${doctorId}:${date}`}, 0))::text as lock_result
    `);

    await transaction.$queryRaw<Array<{ lock_result: string }>>(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${`${patient.patient_id}:${date}`}, 0))::text as lock_result
    `);

    const patientAppointments = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id
        from appointments
       where patient_id = ${patient.patient_id}::uuid
         and status in (${Prisma.join(ACTIVE_PATIENT_APPOINTMENT_STATUSES)})
         and (starts_at at time zone 'America/Sao_Paulo')::date = ${date}::date
       limit 1
    `);
    if (patientAppointments.length) {
      throw new HttpError(409, "PATIENT_APPOINTMENT_DATE_CONFLICT", "Paciente ja possui consulta marcada nesta data.");
    }

    const blockedSlots = await listBlockedSlots(doctorId, date, transaction);
    if (blockedSlots.includes(time)) {
      throw new HttpError(409, "APPOINTMENT_TIME_CONFLICT", "Este horario ja foi ocupado.");
    }

    const rows = await transaction.$queryRaw<Array<{ id: string; status: string; doctor_id: string }>>`
      insert into appointments (owner_user_id, patient_id, starts_at, ends_at, status, description)
      values (${doctorId}::uuid, ${patient.patient_id}::uuid, ${startsAt}, ${endsAt}, 'pending', ${reason})
      returning id, status, owner_user_id as doctor_id
    `;

    return rows[0];
  });
  response.status(201).json({
    message: "Agendamento criado",
    appointment: {
      id: appointment.id,
      doctor_id: appointment.doctor_id,
      date,
      time,
      status: appointment.status,
    },
  });
}));