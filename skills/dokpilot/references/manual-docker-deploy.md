# Manual Docker Deploy — Деплой без GitHub интеграции

Этот гайд описывает путь деплоя (Path D) когда:
- GitHub App не установлен в Dokploy
- У пользователя нет GitHub Personal Access Token
- Или репозиторий локальный (не на GitHub)

Это полноценная стратегия деплоя, а не workaround.

---

## Когда использовать

- Приватный репозиторий без GitHub App / PAT
- Локально собранные проекты (не на GitHub)
- Одноразовый деплой (staging, demo, preview)
- Проекты, требующие специфической Docker-конфигурации
- Сервер не может клонировать репозиторий (firewall, прокси)

---

## Полный процесс

### 1. Клонирование и подготовка (локально)

```bash
TEMP_DIR="/tmp/dokpilot-$(date +%s)"
git clone --depth 1 --branch "$BRANCH" "$GITHUB_URL" "$TEMP_DIR"
```

Если ветка не указана:
```bash
git clone --depth 1 --branch main "$URL" "$TEMP_DIR" 2>/dev/null ||
git clone --depth 1 --branch master "$URL" "$TEMP_DIR"
```

### 2. Создание Dockerfile (если отсутствует)

Выбери шаблон по стеку, обнаруженному на фазе анализа.

#### Next.js (standalone)

> **КРИТИЧЕСКИ ВАЖНО:** Для Next.js standalone Dockerfile требуется `output: "standalone"` в `next.config.ts`/`next.config.js`. Если его нет — добавь перед билдом.

Проверка и добавление:
```bash
grep -q 'output.*standalone' "$TEMP_DIR/next.config."* 2>/dev/null || {
  sed -i 's/const nextConfig.*=.*{/const nextConfig = {\n  output: "standalone",/' "$TEMP_DIR/next.config.ts"
}
```

Dockerfile:
```dockerfile
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else npm i; \
  fi

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

#### Generic Node.js (Express, NestJS, Fastify)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
RUN npm run build 2>/dev/null || true
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
```

> Адаптируй `CMD` под стек: `node dist/main.js` (NestJS), `node server.js` (Express), `node index.js`.

#### Vite / Static SPA

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 3. Передача кода на сервер

```bash
# Создать tar-архив (без node_modules, .git)
cd "$TEMP_DIR"
tar czf /tmp/project-deploy.tar.gz --exclude=node_modules --exclude=.git --exclude=.next .

# Получить IP сервера и SSH-ключ
SERVER_IP=$(jq -r ".servers.\"$SERVER\".host" "$CONFIG")
SSH_KEY=$(jq -r ".servers.\"$SERVER\".ssh_key // empty" "$CONFIG")

# Загрузить на сервер
if [ -n "$SSH_KEY" ] && [ "$SSH_KEY" != "null" ]; then
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/project-deploy.tar.gz "root@${SERVER_IP}:/tmp/"
else
  scp -o StrictHostKeyChecking=no /tmp/project-deploy.tar.gz "root@${SERVER_IP}:/tmp/"
fi

# Распаковать на сервере
bash scripts/ssh-exec.sh "$SERVER" "mkdir -p /opt/builds/$PROJECT_NAME && \
  tar xzf /tmp/project-deploy.tar.gz -C /opt/builds/$PROJECT_NAME && \
  rm /tmp/project-deploy.tar.gz"
```

### 4. Сборка Docker-образа на сервере

> **ВАЖНО:** Docker-сборка может занять 2-10 минут. Обычный SSH таймаутит.
> Используй `--bg` режим `ssh-exec.sh` для запуска в фоне.

```bash
# Запуск сборки в фоне (не блокирует SSH)
bash scripts/ssh-exec.sh --bg "$SERVER" \
  "cd /opt/builds/$PROJECT_NAME && docker build -t ${PROJECT_NAME}:latest ." \
  "/tmp/${PROJECT_NAME}-build.log"
# Возвращает: {"status": "started", "pid": "12345", "log_file": "/tmp/..."}

# Опрос статуса
while true; do
  RESULT=$(bash scripts/ssh-exec.sh --poll "$SERVER" "docker build.*${PROJECT_NAME}" "/tmp/${PROJECT_NAME}-build.log")
  STATUS=$(echo "$RESULT" | jq -r '.status')

  if [ "$STATUS" = "done" ]; then
    # Проверить что образ создался
    IMAGE=$(bash scripts/ssh-exec.sh "$SERVER" "docker images -q ${PROJECT_NAME}:latest")
    if [ -n "$IMAGE" ]; then
      echo "Сборка успешна: $IMAGE"
      break
    else
      echo "Сборка провалилась. Логи:"
      bash scripts/ssh-exec.sh "$SERVER" "tail -50 /tmp/${PROJECT_NAME}-build.log"
      exit 1
    fi
  fi

  echo "Сборка в процессе..."
  sleep 15
done
```

### 5. Создание Dokploy compose-проекта

```bash
# Создать проект в Dokploy
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST project.create '{"name":"'"$PROJECT_NAME"'"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# Создать compose-проект
COMPOSE=$(bash scripts/dokploy-api.sh "$SERVER" POST compose.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'"
}')
COMPOSE_ID=$(echo "$COMPOSE" | jq -r '.composeId')
```

### 6. Настройка raw YAML с Traefik-лейблами

> **КРИТИЧЕСКИ ВАЖНО:** Поле для YAML — `composeFile`, НЕ `customCompose`.
> Использование `customCompose` приведёт к пустому docker-compose.yml и ошибке "Compose file not found".

```bash
# Сгенерировать YAML
COMPOSE_YAML=$(cat <<YAML
services:
  app:
    image: ${PROJECT_NAME}:latest
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOSTNAME=0.0.0.0
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${PROJECT_NAME}.rule=Host(\`${DOMAIN}\`)"
      - "traefik.http.routers.${PROJECT_NAME}.entrypoints=websecure"
      - "traefik.http.routers.${PROJECT_NAME}.tls.certResolver=letsencrypt"
      - "traefik.http.services.${PROJECT_NAME}.loadbalancer.server.port=${PORT}"
    networks:
      - dokploy-network
networks:
  dokploy-network:
    external: true
YAML
)

# Экранировать для JSON
COMPOSE_YAML_ESCAPED=$(echo "$COMPOSE_YAML" | jq -Rs .)

# Загрузить в Dokploy
bash scripts/dokploy-api.sh "$SERVER" POST compose.update '{
  "composeId": "'"$COMPOSE_ID"'",
  "sourceType": "raw",
  "composePath": "docker-compose.yml",
  "composeFile": '"$COMPOSE_YAML_ESCAPED"'
}'
```

### 7. Настройка DNS (если указан домен)

```bash
SERVER_IP=$(jq -r ".servers.\"$SERVER\".host" "$CONFIG")

# DNS без CloudFlare proxy (для Let's Encrypt)
bash scripts/cloudflare-dns.sh create "$DOMAIN" "$SERVER_IP" --no-proxy

# Ожидание DNS propagation
sleep 30
dig +short "$DOMAIN" @1.1.1.1
```

> Traefik-лейблы в compose YAML уже настраивают роутинг.
> Dokploy domain API для compose-проектов не нужен.

### 8. Деплой

```bash
bash scripts/dokploy-api.sh "$SERVER" POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

Мониторинг:
```bash
sleep 10
APP_NAME=$(echo "$COMPOSE" | jq -r '.appName')
bash scripts/ssh-exec.sh "$SERVER" "ls -t /etc/dokploy/logs/$APP_NAME/ | head -1 | xargs -I{} cat '/etc/dokploy/logs/$APP_NAME/{}' | tail -30"
```

### 9. Проверка доступности

```bash
bash scripts/wait-ready.sh "https://$DOMAIN" 120 10
```

### 10. Smoke test (опционально)

```bash
# Проверить что приложение отвечает корректно (не просто 200)
BODY=$(curl -s "https://$DOMAIN" 2>/dev/null | head -100)
if echo "$BODY" | grep -qiE '<html|<!doctype|"status":"ok"|"ok":true'; then
  echo "Smoke test passed"
else
  echo "WARNING: App responds but content may be incorrect. Check manually."
fi
```

---

## Повторный деплой (обновление)

```bash
# 1. Загрузить новый код
tar czf /tmp/project-deploy.tar.gz --exclude=node_modules --exclude=.git --exclude=.next -C "$TEMP_DIR" .
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/project-deploy.tar.gz "root@${SERVER_IP}:/tmp/"
bash scripts/ssh-exec.sh "$SERVER" "tar xzf /tmp/project-deploy.tar.gz -C /opt/builds/$PROJECT_NAME && rm /tmp/project-deploy.tar.gz"

# 2. Пересобрать образ
bash scripts/ssh-exec.sh --bg "$SERVER" \
  "cd /opt/builds/$PROJECT_NAME && docker build -t ${PROJECT_NAME}:latest ." \
  "/tmp/${PROJECT_NAME}-rebuild.log"
# ... (poll as in step 4) ...

# 3. Передеплоить compose
bash scripts/dokploy-api.sh "$SERVER" POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

---

## Важные ограничения

| Ограничение | Причина |
|:------------|:--------|
| `file://` URL нельзя использовать в Dokploy | Dokploy интерпретирует их как SSH URL |
| Сервисы ОБЯЗАТЕЛЬНО должны быть в `dokploy-network` | Traefik маршрутизирует только через эту сеть |
| Traefik labels обязательны для compose-проектов | Dokploy domain API не работает для compose с raw YAML |
| Поле для YAML — `composeFile`, НЕ `customCompose` | `customCompose` молча игнорируется |
| Docker build может таймаутить SSH | Используй `ssh-exec.sh --bg` для фоновых билдов |
| Next.js standalone требует `output: "standalone"` | Без этого `.next/standalone` не создаётся |
