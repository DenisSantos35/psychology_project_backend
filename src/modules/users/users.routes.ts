import { Router } from "express";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";
import { supabaseAdmin } from "../../config/supabase";
export const usersRoutes = Router();
usersRoutes.get("/:id", asyncHandler(async (request, response) => { const actor = await prisma.user.findUnique({ where: { id: response.locals.user.id } }); if (request.params.id !== actor?.id && actor?.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Acesso negado."); const data = await prisma.user.findFirst({ where: { id: request.params.id, deletedAt: null } }); if (!data) throw new HttpError(404, "USER_NOT_FOUND", "Usuário não encontrado."); response.json({ data }); }));
usersRoutes.patch("/:id", asyncHandler(async (request, response) => {
  const actor = await prisma.user.findUnique({ where: { id: response.locals.user.id } });
  if (request.params.id !== actor?.id && actor?.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Acesso negado.");
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !["name", "email"].includes(field))) throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.");
  const name = "name" in body && typeof body.name === "string" ? body.name.trim() : undefined;
  const email = "email" in body && typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  if ((name !== undefined && !name) || (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.");
  const current = await prisma.user.findUnique({ where: { id: request.params.id } });
  if (!current) throw new HttpError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
  if (email) {
    const conflict = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, deletedAt: null, NOT: { id: request.params.id } } });
    if (conflict) throw new HttpError(409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta com este e-mail.");
  }
  if (!supabaseAdmin) throw new HttpError(500, "INTERNAL_ERROR", "Atualização de usuário não configurada.");
  const { error } = await supabaseAdmin.auth.admin.updateUserById(request.params.id, {
    ...(email !== undefined ? { email, email_confirm: true } : {}), ...(name !== undefined ? { user_metadata: { name } } : {}),
  });
  if (error) throw new HttpError(422, "BUSINESS_RULE_ERROR", "Não foi possível atualizar o usuário.");
  try {
    const data = await prisma.user.update({ where: { id: request.params.id }, data: { name, email } });
    response.json({ data });
  } catch (updateError) {
    await supabaseAdmin.auth.admin.updateUserById(request.params.id, { email: current.email, email_confirm: true, user_metadata: { name: current.name } }).catch(() => undefined);
    throw updateError;
  }
}));
usersRoutes.delete("/:id", asyncHandler(async (request, response) => { const actor = await prisma.user.findUnique({ where: { id: response.locals.user.id } }); if (request.params.id !== actor?.id && actor?.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Acesso negado."); await prisma.user.update({ where: { id: request.params.id }, data: { deletedAt: new Date(), isActive: false } }); response.status(204).send(); }));
usersRoutes.get("/", asyncHandler(async (_request, response) => { const actor = await prisma.user.findUnique({ where: { id: response.locals.user.id } }); if (actor?.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Acesso negado."); const data = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }); response.json({ data }); }));
