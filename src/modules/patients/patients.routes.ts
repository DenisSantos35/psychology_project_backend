import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { cleanDigits, listResponse, pagination, required } from "../../common/validation";
import { prisma } from "../../database/prisma";

export const patientsRoutes = Router();

function patientData(body: Record<string, unknown>) {
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "VALIDATION_ERROR", "isActive deve ser um valor booleano.", [{ field: "isActive", message: "Deve ser booleano" }]);
  }

  return {
    name: body.nome === undefined ? body.name as string | undefined : String(body.nome).trim(),
    phone: body.telefone === undefined ? cleanDigits(body.phone) : cleanDigits(body.telefone),
    email: body.email === undefined ? undefined : String(body.email).trim().toLowerCase() || null,
    status: body.status as string | undefined,
    cpf: cleanDigits(body.cpf),
    dateOfBirth: body.dateOfBirth ? new Date(String(body.dateOfBirth)) : body.dateOfBirth === null ? null : undefined,
    gender: body.gender as string | undefined,
    avatarUrl: body.avatarUrl as string | undefined,
    cep: cleanDigits(body.cep), city: body.city as string | undefined,
    neighborhood: body.neighborhood as string | undefined,
    stateCode: (body.stateCode ?? body.stateOfCountry) as string | undefined,
    street: (body.street ?? body.address) as string | undefined,
    addressNumber: (body.addressNumber ?? body.number) as string | undefined,
    complement: body.complement as string | undefined,
    isActive: body.isActive as boolean | undefined,
  };
}

async function listPatients(request: any, response: any) {
  const ownerUserId = response.locals.user.id;
  const { page, limit, skip } = pagination(request.query);
  const q = String(request.query.q ?? "").trim();
  const where = {
    ownerUserId, deletedAt: null,
    ...(request.query.status ? { status: String(request.query.status) } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.patient.findMany({ where, skip, take: limit, orderBy: { name: "asc" } }),
    prisma.patient.count({ where }),
  ]);
  response.json(listResponse(data.map((p) => ({ ...p, userId: p.ownerUserId, nome: p.name, telefone: p.phone })), page, limit, total));
}

patientsRoutes.get("/search", asyncHandler(listPatients));

patientsRoutes.get("/", asyncHandler(listPatients));

patientsRoutes.get("/:id", asyncHandler(async (request, response) => {
  const data = await prisma.patient.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id, deletedAt: null } });
  if (!data) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado.");
  response.json({ data: { ...data, userId: data.ownerUserId, nome: data.name, telefone: data.phone, stateOfCountry: data.stateCode, address: data.street, number: data.addressNumber } });
}));

patientsRoutes.post("/", asyncHandler(async (request, response) => {
  required(request.body, [request.body.nome !== undefined ? "nome" : "name", request.body.telefone !== undefined ? "telefone" : "phone"]);
  const data = patientData(request.body);
  if (data.dateOfBirth && data.dateOfBirth > new Date()) throw new HttpError(422, "INVALID_DATE_OF_BIRTH", "Nascimento não pode estar no futuro.");
  const patient = await prisma.patient.create({ data: { ...data, name: data.name!, phone: data.phone!, ownerUserId: response.locals.user.id } });
  response.status(201).json({ data: patient });
}));

patientsRoutes.patch("/:id", asyncHandler(async (request, response) => {
  const ownerUserId = response.locals.user.id;
  const current = await prisma.patient.findFirst({ where: { id: request.params.id, deletedAt: null }, select: { id: true, ownerUserId: true } });
  if (!current) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado.");
  if (current.ownerUserId !== ownerUserId) throw new HttpError(403, "FORBIDDEN", "Acesso negado.");
  const data = await prisma.patient.update({ where: { id: current.id, ownerUserId }, data: patientData(request.body) });
  response.json({ data });
}));

patientsRoutes.delete("/:id", asyncHandler(async (request, response) => {
  const current = await prisma.patient.findFirst({ where: { id: request.params.id, ownerUserId: response.locals.user.id, deletedAt: null } });
  if (!current) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado.");
  await prisma.patient.update({ where: { id: current.id }, data: { deletedAt: new Date(), isActive: false } });
  response.status(204).send();
}));
