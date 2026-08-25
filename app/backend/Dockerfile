# Backend container — Node.js + Express + TypeScript (technology-stack.md).
# Simple single-stage build; team size/timeline don't justify a multi-stage
# production-optimized image yet (see deployment-architecture.md — single dev-PC target).

FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generates the Prisma client against schema.prisma (needs no live DB connection).
RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
