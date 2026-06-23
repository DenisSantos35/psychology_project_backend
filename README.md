# Psycologi API

Backend REST em Node.js, Express, TypeScript, Prisma, PostgreSQL/Supabase e Supabase Auth.

## Preparação

1. Copie `.env.example` para `.env` e preencha as variáveis.
2. Execute `src/database/supabase-schema.sql` no SQL Editor do Supabase.
3. Execute `npm run prisma:generate`.
4. Inicie com `npm run dev`.

Base local padrão: `http://localhost:3000/api/v1`.

## Autenticação

Rotas privadas recebem `Authorization: Bearer <accessToken>`. O cadastro e login usam Supabase Auth; `public.users` armazena apenas o perfil e nunca a senha.

## Rotas

- `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`
- `GET /api/v1/auth/me`
- `GET|POST /api/v1/patients`; `GET|PATCH|DELETE /api/v1/patients/:id`
- `GET|POST /api/v1/appointments`; `GET|PATCH /api/v1/appointments/:id`
- `PATCH /api/v1/appointments/:id/confirm` e `/:id/cancel`
- As mesmas rotas de agenda estão disponíveis em `/api/v1/schedule`
- `GET|POST /api/v1/patients/:patientId/history`; `PATCH|DELETE /api/v1/history/:id`
- CRUD de `/api/v1/sessions`, `/api/v1/payments` e `/api/v1/consultations`
- Notas em `/api/v1/sessions/:sessionId/notes` e `/api/v1/notes/:id`
- `GET /api/v1/home/activity` e `/api/v1/home/summary`
- `GET /health/live` e `/health/ready`

Todas as consultas privadas filtram o proprietário pelo usuário autenticado. Notas clínicas são cifradas com AES-256-GCM antes de serem persistidas.

## Scripts

```bash
npm run dev
npm run build
npm start
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```
