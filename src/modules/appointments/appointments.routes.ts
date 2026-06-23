import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { asDate, listResponse, pagination, required } from "../../common/validation";
import { prisma } from "../../database/prisma";

export const appointmentsRoutes = Router();
const statuses = ["pending", "confirmed", "completed", "cancelled"];
const translated: Record<string, string> = { pending: "pendente", confirmed: "confirmado", completed: "concluido", cancelled: "cancelado" };

function mapAppointment(item: any) {
  return { id: item.id, patientId: item.patientId, patientName: item.patient.name,
    date: item.startsAt.toISOString().slice(0, 10), startHour: item.startsAt.toISOString().slice(11, 16), endHour: item.endsAt.toISOString().slice(11, 16),
    status: translated[item.status] ?? item.status, dateTime: item.startsAt, description: item.description,
    isConfirmed: item.status === "confirmed", avatarUrl: item.patient.avatarUrl };
}

async function ensureNoConflict(ownerUserId: string, startsAt: Date, endsAt: Date, ignoreId?: string) {
  if (endsAt <= startsAt) throw new HttpError(422, "INVALID_APPOINTMENT_RANGE", "O término deve ser posterior ao início.");
  const conflict = await prisma.appointment.findFirst({ where: { ownerUserId, id: ignoreId ? { not: ignoreId } : undefined, status: { not: "cancelled" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
  if (conflict) throw new HttpError(409, "APPOINTMENT_TIME_CONFLICT", "Já existe um atendimento nesse horário.");
}

appointmentsRoutes.get("/", asyncHandler(async (request, response) => {
  const ownerUserId = response.locals.user.id; const { page, limit, skip } = pagination(request.query);
  const where = { ownerUserId, ...(request.query.status ? { status: String(request.query.status) } : {}),
    ...(request.query.dateFrom || request.query.dateTo ? { startsAt: { ...(request.query.dateFrom ? { gte: asDate(request.query.dateFrom, "dateFrom") } : {}), ...(request.query.dateTo ? { lte: asDate(request.query.dateTo, "dateTo") } : {}) } } : {}) };
  const [items, total] = await prisma.$transaction([prisma.appointment.findMany({ where, include: { patient: true }, skip, take: limit, orderBy: { startsAt: "asc" } }), prisma.appointment.count({ where })]);
  response.json(listResponse(items.map(mapAppointment), page, limit, total));
}));

appointmentsRoutes.get("/:id", asyncHandler(async (request, response) => {
  const item = await prisma.appointment.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id }, include: { patient: true } });
  if (!item) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado."); response.json({ data: mapAppointment(item) });
}));

appointmentsRoutes.post("/", asyncHandler(async (request, response) => {
  required(request.body, ["patientId", "startsAt", "endsAt"]); const ownerUserId = response.locals.user.id;
  const startsAt = asDate(request.body.startsAt, "startsAt"), endsAt = asDate(request.body.endsAt, "endsAt");
  const patient = await prisma.patient.findFirst({ where: { id: String(request.body.patientId), ownerUserId, deletedAt: null } });
  if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado."); await ensureNoConflict(ownerUserId, startsAt, endsAt);
  const item = await prisma.appointment.create({ data: { ownerUserId, patientId: patient.id, startsAt, endsAt, description: String(request.body.description ?? "") }, include: { patient: true } });
  response.status(201).json({ data: mapAppointment(item) });
}));

appointmentsRoutes.patch("/:id", asyncHandler(async (request, response) => {
  const ownerUserId = response.locals.user.id; const current = await prisma.appointment.findFirst({ where: { id: request.params.id, ownerUserId } });
  if (!current) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado.");
  const startsAt = request.body.startsAt ? asDate(request.body.startsAt, "startsAt") : current.startsAt, endsAt = request.body.endsAt ? asDate(request.body.endsAt, "endsAt") : current.endsAt;
  await ensureNoConflict(ownerUserId, startsAt, endsAt, current.id);
  const item = await prisma.appointment.update({ where: { id: current.id }, data: { startsAt, endsAt, description: request.body.description, status: request.body.status }, include: { patient: true } }); response.json({ data: mapAppointment(item) });
}));

appointmentsRoutes.patch("/:id/confirm", asyncHandler(async (request, response) => {
  const current = await prisma.appointment.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!current) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado.");
  const data = await prisma.appointment.update({ where: { id: current.id }, data: { status: "confirmed", confirmedAt: new Date() }, include: { patient: true } }); response.json({ data: mapAppointment(data) });
}));

appointmentsRoutes.patch("/:id/cancel", asyncHandler(async (request, response) => {
  const current = await prisma.appointment.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!current) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado.");
  const data = await prisma.appointment.update({ where: { id: current.id }, data: { status: "cancelled", cancelledAt: new Date(), cancellationReason: String(request.body.reason ?? "") }, include: { patient: true } }); response.json({ data: mapAppointment(data) });
}));
