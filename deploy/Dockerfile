FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY alerts ./alerts
COPY sync ./sync
COPY AGENTS.md ./AGENTS.md
COPY CLAUDE.md ./CLAUDE.md
COPY .codex ./.codex
COPY .claude ./.claude
COPY .github ./.github
USER node
