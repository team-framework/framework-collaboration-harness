FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY alerts ./alerts
COPY sync ./sync
COPY .codex ./.codex
COPY .claude ./.claude
COPY .github ./.github
USER node
