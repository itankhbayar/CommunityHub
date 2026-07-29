# Dev-oriented image: source is bind-mounted by docker-compose and Nest watches it.
# glibc (bookworm) rather than alpine/musl so argon2 resolves a prebuilt binary
# instead of needing a node-gyp toolchain in the image.
FROM node:24-bookworm-slim

WORKDIR /app

# Dependencies are baked into the image; an anonymous volume in compose keeps
# this node_modules from being shadowed by the host bind mount.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4000

CMD ["npm", "run", "start:dev"]
