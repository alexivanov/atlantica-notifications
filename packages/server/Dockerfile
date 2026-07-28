FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
# The transcribed weekly grid ships with the image; DATA_DIR (the mutable state
# file) is mounted separately so a redeploy never wipes the `sent` bookkeeping.
COPY data/daytime-schedule.json ./data/daytime-schedule.json

ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/src/index.js"]
