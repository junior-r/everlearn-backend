FROM node:24-alpine AS base
RUN npm install -g pnpm@11
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm prisma generate
EXPOSE 4000
CMD ["sh", "-c", "pnpm prisma generate && pnpm start:dev"]

FROM deps AS build
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm prisma generate
RUN pnpm build

FROM base AS prod
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/main"]
