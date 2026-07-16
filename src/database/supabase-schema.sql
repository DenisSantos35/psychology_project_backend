-- Schema v2 baseado em docs/guia_backend.txt.
-- ATENÇÃO: para bancos que já possuem as tabelas da versão anterior,
-- faça backup e migração dos dados antes de substituir as tabelas.

begin;
create extension if not exists pgcrypto;

-- O banco foi verificado sem registros. Este bloco remove o schema v1 incompatível.
drop table if exists public.activity_patient cascade;
drop table if exists public.status_reference cascade;
drop table if exists public.gender_options cascade;
drop table if exists public.schedule_calendar cascade;
drop table if exists public.patient_details cascade;
drop table if exists public.clinical_notes cascade;
drop table if exists public.payments cascade;
drop table if exists public.sessions cascade;
drop table if exists public.patient_history cascade;
drop table if exists public.appointments cascade;
drop table if exists public.consultations cascade;
drop table if exists public.patient_emergency_contacts cascade;
drop table if exists public.patients cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.users cascade;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name varchar(150) not null check (btrim(name) <> ''),
  email varchar(254) not null,
  plan varchar(50), role varchar(30) not null default 'professional',
  is_active boolean not null default true, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint users_role_check check (role in ('admin','professional','patient'))
);
create unique index if not exists users_email_active_unique on public.users(lower(email)) where deleted_at is null;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in ('admin','professional','patient'));

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users(id,name,email)
  values(new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)), new.email)
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create table if not exists public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  cpf varchar(11) not null unique, date_of_birth date not null, gender varchar(30) not null,
  phone varchar(20) not null, cep varchar(8) not null, street varchar(150) not null,
  neighborhood varchar(100) not null, city varchar(100) not null, state_code char(2) not null,
  address_number varchar(20) not null, complement varchar(100), professional_type varchar(30) not null,
  professional_license varchar(50) not null unique, specialty varchar(100) not null,
  avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint professional_profiles_birth_check check (date_of_birth <= current_date),
  constraint professional_profiles_type_check check (professional_type in ('psychologist','doctor','nutritionist','physiotherapist'))
);
alter table public.professional_profiles add column if not exists avatar_url text;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  user_id uuid unique references public.users(id) on delete set null,
  name varchar(150) not null, phone varchar(30) not null, email varchar(254), status varchar(20) not null default 'active',
  cpf varchar(14), date_of_birth date, gender varchar(30), avatar_url text, cep varchar(9), city varchar(100),
  neighborhood varchar(100), state_code char(2), street varchar(150), address_number varchar(20), complement varchar(100),
  is_active boolean not null default true, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint patients_birth_check check (date_of_birth is null or date_of_birth <= current_date)
);
create index if not exists patients_owner_status_idx on public.patients(owner_user_id,status);
create index if not exists patients_owner_name_idx on public.patients(owner_user_id,name);
create unique index if not exists patients_owner_cpf_unique on public.patients(owner_user_id,cpf) where cpf is not null and deleted_at is null;
alter table public.patients add column if not exists user_id uuid unique references public.users(id) on delete set null;
create unique index if not exists patients_user_unique on public.patients(user_id) where user_id is not null;
create index if not exists patients_email_active_idx on public.patients(lower(email)) where email is not null and deleted_at is null;

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
create index if not exists patient_emergency_contacts_patient_idx on public.patient_emergency_contacts(patient_id);
create unique index if not exists patient_emergency_contacts_primary_unique on public.patient_emergency_contacts(patient_id) where is_primary = true;

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_expires_idx on public.password_resets(user_id, expires_at desc);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, status varchar(20) not null default 'pending',
  description text not null default '', cancellation_reason text, confirmed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint appointments_range_check check (ends_at > starts_at),
  constraint appointments_status_check check (status in ('pending','confirmed','completed','cancelled'))
);
create index if not exists appointments_owner_start_status_idx on public.appointments(owner_user_id,starts_at,status);

create table if not exists public.patient_history (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  title varchar(180) not null, description text not null, professional_name varchar(150) not null,
  occurred_at timestamptz not null, status varchar(20) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint patient_history_status_check check (status in ('completed','pending','cancelled'))
);
create index if not exists patient_history_owner_patient_date_idx on public.patient_history(owner_user_id,patient_id,occurred_at desc);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  starts_at timestamptz not null, ends_at timestamptz, status varchar(20) not null default 'scheduled',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint sessions_range_check check (ends_at is null or ends_at > starts_at),
  constraint sessions_status_check check (status in ('scheduled','in_progress','completed','cancelled'))
);
create index if not exists sessions_owner_start_status_idx on public.sessions(owner_user_id,starts_at,status);

create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  encrypted_content text not null, encryption_version smallint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists clinical_notes_owner_session_idx on public.clinical_notes(owner_user_id,session_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  amount numeric(12,2) not null check(amount >= 0), status varchar(20) not null default 'pending',
  due_at timestamptz, paid_at timestamptz, payment_method varchar(30),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint payments_status_check check (status in ('pending','paid','overdue','cancelled','refunded'))
);
create index if not exists payments_owner_status_due_idx on public.payments(owner_user_id,status,due_at);

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  title varchar(180), doctor varchar(150), location varchar(180) not null,
  scheduled_at timestamptz not null, status varchar(20) not null, diagnosis text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists consultations_owner_date_status_idx on public.consultations(owner_user_id,scheduled_at,status);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid, actor_user_id uuid,
  entity_type varchar(50), action varchar(30) not null, entity_id uuid,
  metadata jsonb not null default '{}', ip_address inet, created_at timestamptz not null default now(),
  foreign key(owner_user_id) references public.users(id) on delete set null,
  foreign key(actor_user_id) references public.users(id) on delete set null
);
create index if not exists audit_logs_owner_date_idx on public.audit_logs(owner_user_id,created_at desc);

do $$ declare t text; begin
  foreach t in array array['users','professional_profiles','patients','patient_emergency_contacts','appointments','patient_history','sessions','clinical_notes','payments','consultations'] loop
    execute format('drop trigger if exists %I on public.%I','set_'||t||'_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()','set_'||t||'_updated_at',t);
  end loop;
end $$;

alter table public.users enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_emergency_contacts enable row level security;
alter table public.appointments enable row level security;
alter table public.patient_history enable row level security;
alter table public.sessions enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.payments enable row level security;
alter table public.consultations enable row level security;
alter table public.audit_logs enable row level security;

-- Políticas para acesso pelo Supabase client. O backend também filtra owner_user_id.
do $$ declare t text; begin
  foreach t in array array['patients','appointments','patient_history','sessions','clinical_notes','payments','consultations'] loop
    execute format('drop policy if exists owner_all on public.%I',t);
    execute format('create policy owner_all on public.%I for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid())',t);
  end loop;
end $$;
drop policy if exists patient_emergency_contacts_owner_all on public.patient_emergency_contacts;
create policy patient_emergency_contacts_owner_all on public.patient_emergency_contacts
  for all
  using (exists(select 1 from public.patients p where p.id = patient_id and p.owner_user_id = auth.uid()))
  with check (exists(select 1 from public.patients p where p.id = patient_id and p.owner_user_id = auth.uid()));
drop policy if exists patient_emergency_contacts_patient_select on public.patient_emergency_contacts;
create policy patient_emergency_contacts_patient_select on public.patient_emergency_contacts
  for select
  using (exists(select 1 from public.patients p where p.id = patient_id and p.user_id = auth.uid()));
drop policy if exists users_own_profile on public.users;
create policy users_own_profile on public.users for select using(id = auth.uid());
drop policy if exists professional_profiles_own_profile on public.professional_profiles;
create policy professional_profiles_own_profile on public.professional_profiles for select using(user_id = auth.uid());

commit;
