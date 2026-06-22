# Psycologi App Backend

## Configuração

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`.
2. Instale as dependências com `npm install`.
3. Após criar o banco e adicionar os models em `prisma/schema.prisma`, execute `npm run prisma:migrate`.
4. Inicie em desenvolvimento com `npm run dev`.

A API usa a porta `3333` por padrão. Verifique-a em `GET /health`.

## Scripts

- `npm run dev`: inicia com recarga automática.
- `npm run build`: compila para `dist`.
- `npm start`: executa a versão compilada.
- `npm run prisma:generate`: gera o Prisma Client.
- `npm run prisma:migrate`: cria/aplica uma migration de desenvolvimento.
- `npm run prisma:studio`: abre o Prisma Studio.
