# Built from the repo root so the npm workspace links resolve.
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
# Only the two backend workspaces are installed; the Expo app is not part of
# the server image and pulling it in would balloon the build for nothing.
RUN npm ci --workspace @atlantica/shared --workspace @atlantica/server --include-workspace-root

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
RUN npm run build --workspace @atlantica/shared \
 && npm run build --workspace @atlantica/server

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
RUN npm ci --omit=dev --workspace @atlantica/shared --workspace @atlantica/server --include-workspace-root \
 && npm cache clean --force

COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/server/dist ./packages/server/dist
COPY packages/server/public ./packages/server/public
# The transcribed weekly grid ships with the image; DATA_DIR (the mutable state
# file) is mounted separately so a redeploy never wipes the `sent` bookkeeping.
COPY packages/server/data/daytime-schedule.json ./packages/server/data/daytime-schedule.json

# The server resolves SCHEDULE_FILE / PUBLIC_DIR relative to the working
# directory, so it must run from the server package, not the repo root.
WORKDIR /repo/packages/server

ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/src/index.js"]
