import cors from "cors";
import express from "express";
import { prisma } from "./database/prisma";
import { authRoutes } from "./modules/auth/auth.routes";
import { clientAuthRoutes } from "./modules/client-auth/client-auth.routes";
import { authenticate } from "./middlewares/auth.middleware";
import { errorHandler, notFound } from "./middlewares/error.middleware";
import { appointmentsRoutes } from "./modules/appointments/appointments.routes";
import { clinicalNotesRoutes } from "./modules/clinical-notes/clinical-notes.routes";
import { consultationsRoutes } from "./modules/consultations/consultations.routes";
import { historyRoutes } from "./modules/patient-history/history.routes";
import { homeRoutes } from "./modules/home/home.routes";
import { patientsRoutes } from "./modules/patients/patients.routes";
import { paymentsRoutes } from "./modules/payments/payments.routes";
import { sessionsRoutes } from "./modules/sessions/sessions.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { professionalProfilesRoutes } from "./modules/professional-profiles/professional-profiles.routes";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:8080").split(",").map((item) => item.trim());
const apiPrefix = process.env.API_PREFIX ?? "/api/v1";

app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health/live", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.get("/health/ready", async (_request, response) => {
  try {
    await prisma.$queryRaw`select 1`;
    response.status(200).json({ status: "ready", database: "ok" });
  } catch {
    response.status(503).json({ status: "unavailable", database: "error" });
  }
});

app.use(`${apiPrefix}/auth`, authRoutes);
app.use("/api/client/auth", clientAuthRoutes);
app.use(`${apiPrefix}/users`, authenticate, usersRoutes);
app.use(`${apiPrefix}/professional-profiles`, authenticate, professionalProfilesRoutes);
app.use(`${apiPrefix}/patients`, authenticate, patientsRoutes);
app.use(`${apiPrefix}/appointments`, authenticate, appointmentsRoutes);
app.use(`${apiPrefix}/schedule`, authenticate, appointmentsRoutes);
app.use(apiPrefix, authenticate, historyRoutes);
app.use(apiPrefix, authenticate, sessionsRoutes);
app.use(apiPrefix, authenticate, clinicalNotesRoutes);
app.use(apiPrefix, authenticate, paymentsRoutes);
app.use(`${apiPrefix}/consultations`, authenticate, consultationsRoutes);
app.use(`${apiPrefix}/home`, authenticate, homeRoutes);

app.use(notFound);
app.use(errorHandler);

export { app };
