import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { asDate, required } from "../../common/validation";
import { prisma } from "../../database/prisma";

export const historyRoutes = Router();

historyRoutes.get("/patients/:patientId/history", asyncHandler(async (request, response) => {
  const data = await prisma.patientHistory.findMany({ where: { patientId: request.params.patientId, ownerUserId: response.locals.user.id }, orderBy: { occurredAt: "desc" } });
  response.json({ data: data.map((item) => ({ ...item, professional: item.professionalName, date: item.occurredAt })) });
}));

historyRoutes.post("/patients/:patientId/history", asyncHandler(async (request, response) => {
  required(request.body, ["title", "description", "professional", "date", "status"]); const ownerUserId = response.locals.user.id;
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, ownerUserId, deletedAt: null } });
  if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado.");
  const data = await prisma.patientHistory.create({ data: { ownerUserId, patientId: patient.id, title: String(request.body.title), description: String(request.body.description), professionalName: String(request.body.professional), occurredAt: asDate(request.body.date, "date"), status: String(request.body.status) } });
  response.status(201).json({ data });
}));

historyRoutes.patch("/history/:id", asyncHandler(async (request, response) => {
  const current = await prisma.patientHistory.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!current) throw new HttpError(404, "HISTORY_NOT_FOUND", "Histórico não encontrado.");
  const data = await prisma.patientHistory.update({ where: { id: current.id }, data: { title: request.body.title, description: request.body.description, professionalName: request.body.professional, occurredAt: request.body.date ? asDate(request.body.date, "date") : undefined, status: request.body.status } }); response.json({ data });
}));

historyRoutes.delete("/history/:id", asyncHandler(async (request, response) => {
  const current = await prisma.patientHistory.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id } }); if (!current) throw new HttpError(404, "HISTORY_NOT_FOUND", "Histórico não encontrado.");
  await prisma.patientHistory.delete({ where: { id: current.id } }); response.status(204).send();
}));
