import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { asDate, listResponse, pagination, required } from "../../common/validation";
import { prisma } from "../../database/prisma";

export const sessionsRoutes = Router();

sessionsRoutes.get("/sessions", asyncHandler(async (request, response) => {
  const { page, limit, skip } = pagination(request.query); const where = { ownerUserId: response.locals.user.id, ...(request.query.status ? { status: String(request.query.status) } : {}) };
  const [data, total] = await prisma.$transaction([prisma.session.findMany({ where, skip, take: limit, orderBy: { startsAt: "desc" } }), prisma.session.count({ where })]); response.json(listResponse(data, page, limit, total));
}));
sessionsRoutes.get("/patients/:patientId/sessions", asyncHandler(async (request, response) => { const data = await prisma.session.findMany({ where: { patientId: request.params.patientId, ownerUserId: response.locals.user.id }, orderBy: { startsAt: "desc" } }); response.json({ data }); }));
sessionsRoutes.get("/sessions/:id", asyncHandler(async (request, response) => { const data = await prisma.session.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!data) throw new HttpError(404, "SESSION_NOT_FOUND", "Sessão não encontrada."); response.json({ data }); }));
sessionsRoutes.post("/sessions", asyncHandler(async (request, response) => {
  required(request.body, ["patientId", "startsAt"]); const ownerUserId = response.locals.user.id;
  const patient = await prisma.patient.findFirst({ where: { id: String(request.body.patientId), ownerUserId, deletedAt: null } }); if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado.");
  if (request.body.appointmentId) { const appointment = await prisma.appointment.findFirst({ where: { id: String(request.body.appointmentId), ownerUserId, patientId: patient.id } }); if (!appointment) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado."); }
  const data = await prisma.session.create({ data: { ownerUserId, patientId: patient.id, appointmentId: request.body.appointmentId, startsAt: asDate(request.body.startsAt, "startsAt"), endsAt: request.body.endsAt ? asDate(request.body.endsAt, "endsAt") : undefined, status: String(request.body.status ?? "scheduled") } }); response.status(201).json({ data });
}));
sessionsRoutes.patch("/sessions/:id", asyncHandler(async (request, response) => { const current = await prisma.session.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!current) throw new HttpError(404, "SESSION_NOT_FOUND", "Sessão não encontrada."); const data = await prisma.session.update({ where: { id: current.id }, data: { startsAt: request.body.startsAt ? asDate(request.body.startsAt, "startsAt") : undefined, endsAt: request.body.endsAt ? asDate(request.body.endsAt, "endsAt") : request.body.endsAt, status: request.body.status } }); response.json({ data }); }));
