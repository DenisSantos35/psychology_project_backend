import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL deve estar configurada");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
