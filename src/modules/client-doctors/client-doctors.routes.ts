import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../common/async-handler";
import { HttpError } from "../../common/http-error";
import { prisma } from "../../database/prisma";

export const clientDoctorsRoutes = Router();

type ClientDoctorRow = {
  id: string;
  name: string;
  specialty: string | null;
  rating: string | number | null;
  location: string | null;
  avatar_url: string | null;
};

function searchFilter(search: string) {
  if (!search) return Prisma.empty;
  const term = `%${search}%`;
  return Prisma.sql`
    and (
      u.name ilike ${term}
      or pp.specialty ilike ${term}
      or pp.professional_type ilike ${term}
    )
  `;
}

function mapDoctor(row: ClientDoctorRow) {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    rating: row.rating === null ? null : Number(row.rating),
    location: row.location,
    avatar_url: row.avatar_url,
  };
}

clientDoctorsRoutes.get("/", asyncHandler(async (request, response) => {
  const userId = response.locals.user.id as string;
  const search = String(request.query.search ?? "").trim();

  if ("client_id" in request.query || "clientId" in request.query || "patient_id" in request.query || "patientId" in request.query) {
    throw new HttpError(400, "VALIDATION_ERROR", "Nao envie client_id ou patient_id. O paciente e identificado pelo token autenticado.");
  }

  const doctors = await prisma.$queryRaw<ClientDoctorRow[]>(Prisma.sql`
    with authenticated_patient as (
      select
        p.id as patient_id,
        p.owner_user_id
      from patients p
      join users patient_user on patient_user.id = p.user_id
      where p.user_id = ${userId}::uuid
        and p.is_active = true
        and p.deleted_at is null
        and patient_user.role = 'patient'
        and patient_user.is_active = true
        and patient_user.deleted_at is null
      limit 1
    ),
    linked_doctors as (
      select distinct ap.owner_user_id, ap.patient_id
      from authenticated_patient ap
    )
    select
      u.id,
      coalesce(nullif(u.name, ''), 'Profissional') as name,
      pp.specialty,
      null::numeric as rating,
      coalesce(latest_consultation.location, nullif(pp.city, '')) as location,
      pp.avatar_url
    from linked_doctors linked
    join users u on u.id = linked.owner_user_id
    left join professional_profiles pp on pp.user_id = u.id
    left join lateral (
      select c.location
      from consultations c
      where c.patient_id = linked.patient_id
        and c.owner_user_id = linked.owner_user_id
        and nullif(c.location, '') is not null
      order by c.scheduled_at desc
      limit 1
    ) latest_consultation on true
    where u.role = 'professional'
      and u.is_active = true
      and u.deleted_at is null
      ${searchFilter(search)}
    order by u.name asc
  `);

  response.json({ doctors: doctors.map(mapDoctor) });
}));
