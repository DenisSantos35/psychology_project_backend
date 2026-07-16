begin;

create table if not exists public.patient_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name varchar(150) not null check (btrim(name) <> ''),
  relationship varchar(80),
  phone varchar(30) not null,
  email varchar(254),
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_emergency_contacts_patient_idx
  on public.patient_emergency_contacts(patient_id);

create unique index if not exists patient_emergency_contacts_primary_unique
  on public.patient_emergency_contacts(patient_id)
  where is_primary = true;

drop trigger if exists set_patient_emergency_contacts_updated_at on public.patient_emergency_contacts;
create trigger set_patient_emergency_contacts_updated_at
  before update on public.patient_emergency_contacts
  for each row execute function public.set_updated_at();

alter table public.patient_emergency_contacts enable row level security;

drop policy if exists patient_emergency_contacts_owner_all on public.patient_emergency_contacts;
create policy patient_emergency_contacts_owner_all on public.patient_emergency_contacts
  for all
  using (exists(select 1 from public.patients p where p.id = patient_id and p.owner_user_id = auth.uid()))
  with check (exists(select 1 from public.patients p where p.id = patient_id and p.owner_user_id = auth.uid()));

drop policy if exists patient_emergency_contacts_patient_select on public.patient_emergency_contacts;
create policy patient_emergency_contacts_patient_select on public.patient_emergency_contacts
  for select
  using (exists(select 1 from public.patients p where p.id = patient_id and p.user_id = auth.uid()));

commit;
