import cors from "cors";
import express from "express";
import { authenticate } from "./middlewares/auth.middleware";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.get("/auth/me", authenticate, (_request, response) => {
  const { id, email, user_metadata } = response.locals.user;

  response.status(200).json({
    user: { id, email, user_metadata },
  });
});

export { app };
