import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";

export const clientHealthHistoryRoutes = Router();

const allowedTypes = new Set(["all", "history", "appointment", "session", "consultation", "payment"]);

type HealthHistoryRow = {
  id: string;
  type: string;
  date: string;
  time: string;
  title: string;
  subtitle: string;
  professional_name: string;
  specialty: string | null;
  status: string;
  occurred_at: Date;
};

type HealthHistoryDetailRow = {
  id: string;
  status: string;
  title: string;
  date: string;
  time: string;
  description: string;
  professional_id: string;
  professional_name: string;
  specialty: string | null;
  license: string | null;
  workplace: string | null;
  avatar_url: string | null;
};

function pagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page ?? query.limit) || 20));
  return { page, perPage, offset: (page - 1) * perPage };
}

function typeFilter(value: unknown): string {
  const type = String(value ?? "all").trim().toLowerCase();
  if (!allowedTypes.has(type)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ field: "type", message: "Tipo invalido" }]);
  }
  return type;
}

function itemSelect(type: string) {
  return type === "all" ? Prisma.empty : Prisma.sql`where type = ${type}`;
}

function healthHistorySql(userId: string) {
  return Prisma.sql`
    with authenticated_patient as (
      select
        p.id as patient_id,
        p.owner_user_id,
        coalesce(nullif(u.name, ''), 'Profissional') as professional_name,
        pp.specialty
      from patients p
      join users u on u.id = p.owner_user_id
      left join professional_profiles pp on pp.user_id = p.owner_user_id
      where p.user_id = ${userId}::uuid
        and p.is_active = true
        and p.deleted_at is null
      limit 1
    ),
    items as (
      select
        h.id,
        'history'::text as type,
        h.occurred_at,
        h.title,
        h.professional_name,
        ap.specialty,
        h.status
      from patient_history h
      join authenticated_patient ap on ap.patient_id = h.patient_id and ap.owner_user_id = h.owner_user_id

      union all

      select
        a.id,
        'appointment'::text as type,
        a.starts_at as occurred_at,
        coalesce(nullif(a.description, ''), 'Consulta agendada') as title,
        ap.professional_name,
        ap.specialty,
        a.status
      from appointments a
      join authenticated_patient ap on ap.patient_id = a.patient_id and ap.owner_user_id = a.owner_user_id

      union all

      select
        s.id,
        'session'::text as type,
        s.starts_at as occurred_at,
        'Sessao'::text as title,
        ap.professional_name,
        ap.specialty,
        s.status
      from sessions s
      join authenticated_patient ap on ap.patient_id = s.patient_id and ap.owner_user_id = s.owner_user_id

      union all

      select
        c.id,
        'consultation'::text as type,
        c.scheduled_at as occurred_at,
        coalesce(nullif(c.title, ''), 'Consulta') as title,
        coalesce(nullif(c.doctor, ''), ap.professional_name) as professional_name,
        ap.specialty,
        c.status
      from consultations c
      join authenticated_patient ap on ap.patient_id = c.patient_id and ap.owner_user_id = c.owner_user_id

      union all

      select
        pay.id,
        'payment'::text as type,
        coalesce(pay.paid_at, pay.due_at, pay.created_at) as occurred_at,
        'Pagamento'::text as title,
        ap.professional_name,
        ap.specialty,
        pay.status
      from payments pay
      join sessions s on s.id = pay.session_id
      join authenticated_patient ap on ap.patient_id = s.patient_id and ap.owner_user_id = pay.owner_user_id
    )
    select
      id,
      type,
      to_char(occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
      to_char(occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI') as time,
      title,
      concat_ws(' - ', professional_name, specialty) as subtitle,
      professional_name,
      specialty,
      status,
      occurred_at
    from items
  `;
}


function splitDescription(value: string): string[] {
  return value
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

clientHealthHistoryRoutes.get("/:historyId", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const rows = await prisma.$queryRaw<HealthHistoryDetailRow[]>`
    select
      h.id,
      h.status,
      h.title,
      to_char(h.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
      to_char(h.occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI') as time,
      h.description,
      owner.id as professional_id,
      coalesce(nullif(h.professional_name, ''), owner.name) as professional_name,
      pp.specialty,
      pp.professional_license as license,
      null::text as workplace,
      pp.avatar_url
    from patient_history h
    join patients p on p.id = h.patient_id and p.owner_user_id = h.owner_user_id
    join users owner on owner.id = h.owner_user_id
    left join professional_profiles pp on pp.user_id = h.owner_user_id
    where h.id = ${request.params.historyId}::uuid
      and p.user_id = ${userId}::uuid
      and p.is_active = true
      and p.deleted_at is null
    limit 1
  `;

  const item = rows[0];
  if (!item) throw new HttpError(404, "HEALTH_HISTORY_NOT_FOUND", "Historico nao encontrado.");

  response.json({
    id: item.id,
    status: item.status,
    title: item.title,
    date: item.date,
    time: item.time,
    professional: {
      id: item.professional_id,
      name: item.professional_name,
      specialty: item.specialty,
      license: item.license,
      workplace: item.workplace,
      avatar_url: item.avatar_url,
    },
    diagnosis_notes: {
      description: splitDescription(item.description),
      important_note: null,
    },
    prescriptions: [],
    documents: [],
    guidelines: [],
  });
}));
clientHealthHistoryRoutes.get("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const type = typeFilter(request.query.type);
  const { page, perPage, offset } = pagination(request.query);
  const rows = await prisma.$queryRaw<HealthHistoryRow[]>(Prisma.sql`
    ${healthHistorySql(userId)}
    ${itemSelect(type)}
    order by occurred_at desc
    limit ${perPage + 1}
    offset ${offset}
  `);

  const items = rows.slice(0, perPage).map(({ occurred_at: _occurredAt, ...item }) => item);
  response.json({
    items,
    pagination: {
      page,
      per_page: perPage,
      has_more: rows.length > perPage,
    },
  });
}));
