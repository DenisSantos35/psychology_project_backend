import type { NextFunction, Request, Response } from "express";
import { supabase } from "../config/supabase";

export async function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.headers.authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    response.status(401).json({ message: "Token de autenticação não informado" });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    response.status(401).json({ message: "Token inválido ou expirado" });
    return;
  }

  response.locals.user = data.user;
  next();
}
