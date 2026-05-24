# Dokploy API Reference

> **CRITICAL: Dokploy uses tRPC — ALL mutations use HTTP POST**
>
> Despite conventional REST naming, Dokploy's API is built on tRPC.
> ALL endpoints that modify data (create, update, delete, deploy, save*) use POST.
> Only read-only endpoints (*.one, *.all, *.version) use GET.
> There are NO PUT or DELETE HTTP methods in the Dokploy API.

Справочник основных Dokploy REST API endpoints, используемых в Dokpilot.

Полная документация: https://docs.dokploy.com/docs/api

> **Версия:** Актуально для Dokploy v0.27+. Более ранние версии могут иметь другие эндпоинты и форматы ответов.

---

## Аутентификация

Все запросы требуют HTTP-заголовок:
```
x-api-key: <your-api-key>
```

API-ключ генерируется в Dokploy UI: Settings → Profile → API/CLI → Generate API Key

> **Примечание:** В v0.27+ эндпоинт `auth.createUser` / `auth.createAdmin` удалён. Админ-аккаунт создаётся ТОЛЬКО через UI по адресу `http://IP:3000` при первом запуске.

---

## Base URL

```
http://<server-ip>:3000/api
```

Или с доменом:
```
https://panel.example.com/api
```

---

## Projects

### `POST project.create`

Создать новый проект (top-level контейнер для приложений и БД).

**Request:**
```json
{
  "name": "my-project",
  "description": "Project description"
}
```

**Response (v0.27+):**

> **Внимание:** Ответ вложенный — содержит `project` и `environment` объекты.

```json
{
  "project": {
    "projectId": "abc123",
    "name": "my-project",
    "description": "...",
    "createdAt": "2026-02-17T..."
  },
  "environment": {
    "environmentId": "env456",
    "name": "Production",
    "projectId": "abc123"
  }
}
```

**Извлечение данных:**
```bash
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')
```

> `environmentId` нужен для создания приложений, БД и Compose-проектов в рамках данного проекта.

### `GET project.all`

Получить все проекты (со вложенными приложениями, БД, доменами).

**Response:**
```json
[
  {
    "projectId": "abc123",
    "name": "my-project",
    "applications": [
      {
        "applicationId": "app1",
        "name": "frontend",
        "applicationStatus": "running",
        "domains": [...]
      }
    ],
    "postgres": [...],
    "mysql": [...],
    "mariadb": [...],
    "mongo": [...],
    "redis": [...]
  }
]
```

### `POST project.remove`

Удалить проект (вместе со всеми вложенными ресурсами).

**Request:**
```json
{
  "projectId": "abc123"
}
```

---

## Applications

### `POST application.create`

Создать приложение в проекте.

**Request (v0.27+):**
```json
{
  "name": "my-app",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Обязательно:** `environmentId` — обязательное поле в v0.27+. Получается из ответа `project.create` (поле `environment.environmentId`) или из `project.all`.

**Response:**
```json
{
  "applicationId": "app1",
  "name": "my-app",
  "projectId": "abc123",
  "sourceType": null,
  "buildType": null
}
```

### `POST application.update`

Обновить настройки приложения (autoDeploy и другие флаги).

**Request:**
```json
{
  "applicationId": "app1",
  "autoDeploy": true
}
```

---

## Git Providers

### `GET gitProvider.getAll`

Get all configured git providers (GitHub App, GitLab, Bitbucket, Gitea).

**Response:**
```json
[
  {
    "gitProviderId": "gp1",
    "providerType": "github",
    "githubId": "gh123",
    "name": "Dokploy-2026-02-19-xxxxx",
    "createdAt": "2026-02-19T..."
  }
]
```

> Use `githubId` (NOT `gitProviderId`) when calling `application.saveGithubProvider`.
> If the array is empty or has no entry with `providerType: "github"`, the GitHub App is not installed.

### `POST application.saveGithubProvider`

Configure GitHub repository via the installed GitHub App. Requires `githubId` from `gitProvider.getAll`.

**Prerequisites:**
1. GitHub App must be installed in Dokploy (Settings > Server > GitHub)
2. Get `githubId`: `GET gitProvider.getAll` -> find entry with `providerType: "github"` -> use `.githubId`

**Request:**
```json
{
  "applicationId": "app1",
  "owner": "github-user-or-org",
  "repository": "repo-name",
  "branch": "main",
  "buildPath": "/",
  "githubId": "<from gitProvider.getAll>",
  "triggerType": "push",
  "enableSubmodules": false
}
```

> **Field notes:**
> - `repository` is the repo name only (not a URL, not `owner/repo`)
> - `githubId` is from `gitProvider.getAll`, NOT `gitProviderId`
> - `triggerType`: "push" for auto-deploy on push
> - `buildPath`: "/" for root, or "/packages/frontend" for monorepo

**Response:**
```json
{
  "message": "GitHub configuration saved successfully."
}
```

### Using `application.update` for Git source (no GitHub App)

When GitHub App is not installed, configure the git source via `application.update`:

**For public repos:**
```json
POST application.update
{
  "applicationId": "app1",
  "sourceType": "git",
  "customGitUrl": "https://github.com/user/repo.git",
  "customGitBranch": "main"
}
```

**For private repos with PAT:**
```json
POST application.update
{
  "applicationId": "app1",
  "sourceType": "git",
  "customGitUrl": "https://<PAT>@github.com/user/repo.git",
  "customGitBranch": "main"
}
```

> **WARNING:** Do NOT use `sourceType: "github"` without first calling
> `application.saveGithubProvider` with a valid `githubId`.
> Using `sourceType: "github"` alone triggers "Github Provider not found" on deploy.
>
> **WARNING:** `file://` URLs are NOT supported by Dokploy. Only `https://` and `ssh://` URLs work.

### `POST application.saveBuildType`

Установить тип билда.

**Request (v0.28+):**
```json
{
  "applicationId": "app1",
  "buildType": "nixpacks",
  "dockerfile": "Dockerfile",
  "dockerContextPath": "",
  "dockerBuildStage": "",
  "herokuVersion": "24",
  "railpackVersion": "0.15.4"
}
```

> **REQUIRED (v0.28+):** All seven fields are mandatory regardless of build type.
> Even for `nixpacks` builds, `dockerfile`, `herokuVersion`, and `railpackVersion`
> must be present with default values. The Zod schema rejects requests missing any of these.

Для `dockerfile` можно указать реальные значения:
```json
{
  "applicationId": "app1",
  "buildType": "dockerfile",
  "dockerfile": "Dockerfile",
  "dockerContextPath": ".",
  "dockerBuildStage": "",
  "herokuVersion": "24",
  "railpackVersion": "0.15.4"
}
```

Допустимые `buildType`: `nixpacks`, `dockerfile`, `railpack`, `heroku_buildpacks`, `paketo_buildpacks`, `static`.

### `POST application.saveEnvironment`

Установить env-переменные.

**Request (v0.28+):**
```json
{
  "applicationId": "app1",
  "env": "DATABASE_URL=postgresql://...\nNODE_ENV=production\nSECRET_KEY=abc123",
  "buildArgs": "",
  "buildSecrets": "",
  "createEnvFile": true
}
```

> **REQUIRED (v0.28+):** Fields `buildArgs`, `buildSecrets`, and `createEnvFile` are mandatory.
> Without them, the Zod schema returns HTTP 400 with fieldErrors.

Формат `env`: ключ=значение, разделитель — `\n` (перевод строки).

### `POST application.deploy`

Запустить деплой приложения.

**Request:**
```json
{
  "applicationId": "app1"
}
```

**Response:**
```json
{
  "deploymentId": "deploy1"
}
```

### `POST application.stop`

Остановить приложение.

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.start`

Запустить приложение (после остановки).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.redeploy`

Передеплоить приложение (rebuild + restart).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `GET application.one`

Получить информацию об одном приложении.

**Request (query params):**
```
?applicationId=app1
```

**Response:**
```json
{
  "applicationId": "app1",
  "name": "my-app",
  "applicationStatus": "running",
  "sourceType": "github",
  "repository": "https://github.com/user/repo",
  "branch": "main",
  "buildType": "nixpacks",
  "env": "DATABASE_URL=...",
  "domains": [...],
  "refreshToken": "abc123..."
}
```

### `POST application.delete`

Удалить приложение.

**Request:**
```json
{
  "applicationId": "app1"
}
```

---

## Docker Compose

### `POST compose.create`

Создать compose-проект.

**Request (v0.27+):**
```json
{
  "name": "my-compose",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Обязательно:** `environmentId` — обязательное поле в v0.27+.

**Response:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.saveGithubProvider`

Настроить GitHub-репозиторий для compose-проекта через GitHub App. Аналогично `application.saveGithubProvider`.

**Request:**
```json
{
  "composeId": "comp1",
  "owner": "user",
  "repository": "repo-name",
  "branch": "main",
  "composePath": "docker-compose.yml",
  "githubId": "<from gitProvider.getAll>"
}
```

### `POST compose.update`

Обновить настройки compose-проекта (composePath, raw YAML и другие флаги).

> **ВАЖНО:** Для настройки GitHub-репозитория используй `compose.saveGithubProvider` (требует `githubId` из `gitProvider.getAll`).

**Для raw-режима (inline YAML):**
```json
{
  "composeId": "comp1",
  "sourceType": "raw",
  "composePath": "docker-compose.yml",
  "composeFile": "services:\n  app:\n    image: my-app:latest\n    ports:\n      - '3000:3000'\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}
```

> **CRITICAL:** Поле для YAML — `composeFile`, НЕ `customCompose`.
> Использование `customCompose` молча игнорируется — создаётся пустой docker-compose.yml, деплой падает с ошибкой "Compose file not found".

> **Raw-режим** используется когда нет Git-репозитория: локально собранные образы, приватные репо без токена, или кастомные multi-container конфигурации.

### `POST compose.deploy`

Задеплоить compose-проект.

**Request:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.remove`

Удалить compose-проект.

**Request:**
```json
{
  "composeId": "comp1"
}
```

---

## Auto-deploy (GitHub App)

Dokploy uses a built-in GitHub App for auto-deploy. When installed (Dokploy UI > Settings > Server > GitHub), pushes to the configured branch trigger automatic deployment. **No manual webhooks needed.**

### Enable/disable auto-deploy

```json
POST application.update
{
  "applicationId": "app1",
  "autoDeploy": true
}
```

### How it works

1. GitHub App is installed once in Dokploy UI
2. App receives push events from GitHub automatically
3. If `autoDeploy: true` and the push is to the configured branch, deployment triggers

### For non-GitHub providers only (GitLab, Gitea, Bitbucket)

If NOT using GitHub App, manual webhook setup is needed:

```bash
# Get refresh token
REFRESH_TOKEN=$(bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq -r '.refreshToken')

# Webhook URL for applications
echo "https://<dokploy-url>/api/deploy/$REFRESH_TOKEN"

# Webhook URL for compose
echo "https://<dokploy-url>/api/deploy/compose/$REFRESH_TOKEN"
```

> **For GitHub repositories with GitHub App installed, do NOT use webhooks.** The App handles everything.

---

## Domains

### `POST domain.create`

Добавить домен к приложению.

**Request:**
```json
{
  "applicationId": "app1",
  "host": "app.example.com",
  "port": 3000,
  "https": true,
  "path": "/",
  "certificateType": "letsencrypt"
}
```

> **Важно:** DNS A-запись должна быть создана и propagated ДО вызова `domain.create` с `certificateType: "letsencrypt"`. Иначе ACME challenge провалится и сертификат не будет выпущен. См. порядок: DNS → Domain → Deploy.

**Response:**
```json
{
  "domainId": "dom1",
  "host": "app.example.com",
  "port": 3000,
  "https": true
}
```

### `POST domain.delete`

Удалить домен.

**Request:**
```json
{
  "domainId": "dom1"
}
```

---

## Databases — PostgreSQL

### `POST postgres.create`

Создать PostgreSQL базу данных.

**Request (v0.27+):**
```json
{
  "name": "my-db",
  "projectId": "abc123",
  "environmentId": "env456",
  "databaseName": "myapp",
  "databaseUser": "myapp",
  "databasePassword": "secure-password"
}
```

> **Обязательно:** `environmentId` и `databasePassword` — обязательные поля в v0.27+.

**Response:**
```json
{
  "postgresId": "pg1",
  "name": "my-db"
}
```

### `POST postgres.deploy`

Запустить PostgreSQL (после создания или остановки).

**Request:**
```json
{
  "postgresId": "pg1"
}
```

### `GET postgres.one`

Получить информацию о PostgreSQL, включая connection strings.

**Request (query params):**
```
?postgresId=pg1
```

**Response:**
```json
{
  "postgresId": "pg1",
  "name": "my-db",
  "databaseName": "myapp",
  "databaseUser": "myapp",
  "internalDatabaseUrl": "postgresql://myapp:password@my-db:5432/myapp",
  "externalDatabaseUrl": "postgresql://myapp:password@45.55.67.89:5432/myapp"
}
```

### `POST postgres.remove`

Удалить PostgreSQL.

**Request:**
```json
{
  "postgresId": "pg1"
}
```

---

## Databases — MySQL

Аналогично PostgreSQL, но endpoints:
- `POST mysql.create` (требует `environmentId`, `databasePassword`)
- `POST mysql.deploy`
- `GET mysql.one`
- `POST mysql.remove`

---

## Databases — MariaDB

- `POST mariadb.create` (требует `environmentId`, `databasePassword`)
- `POST mariadb.deploy`
- `GET mariadb.one`
- `POST mariadb.remove`

---

## Databases — MongoDB

- `POST mongo.create` (требует `environmentId`, `databasePassword`)
- `POST mongo.deploy`
- `GET mongo.one`
- `POST mongo.remove`

---

## Databases — Redis

### `POST redis.create`

**Request (v0.27+):**
```json
{
  "name": "my-redis",
  "projectId": "abc123",
  "environmentId": "env456",
  "databasePassword": "secure-password"
}
```

> **Обязательно:** `environmentId` и `databasePassword` — обязательные поля в v0.27+.

**Response:**
```json
{
  "redisId": "redis1",
  "name": "my-redis"
}
```

### `POST redis.deploy`

**Request:**
```json
{
  "redisId": "redis1"
}
```

### `GET redis.one`

**Request (query params):**
```
?redisId=redis1
```

### `POST redis.remove`

**Request:**
```json
{
  "redisId": "redis1"
}
```

---

## Deployments

### `GET deployment.all`

Получить все деплойменты для приложения.

**Request (query params):**
```
?applicationId=app1
```

**Response:**
```json
[
  {
    "deploymentId": "deploy1",
    "status": "done",
    "createdAt": "2026-02-17T...",
    "finishedAt": "2026-02-17T..."
  }
]
```

### `GET deployment.logsByDeployment`

Получить логи деплоя.

> **NOTE:** Этот endpoint может не работать в некоторых версиях Dokploy.
> **Основной метод:** Читать логи через SSH по пути из `logPath` в ответе `deployment.all`:
> ```bash
> LOG_PATH=$(echo "$RESPONSE" | jq -r '.[0].logPath')
> bash scripts/ssh-exec.sh "$SERVER" "cat $LOG_PATH"
> ```
> Используй API endpoint только как fallback.

**Request (query params):**
```
?deploymentId=deploy1
```

**Response:**
```
Build logs as plain text...
```

---

## Settings

### `GET settings.version`

Получить версию Dokploy.

**Response:**
```json
{
  "version": "v0.27.0"
}
```

---

## Примеры использования

### Создать проект и задеплоить Next.js приложение (v0.27+)

```bash
# 1. Создать проект (ответ вложенный!)
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-saas"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Создать PostgreSQL (требует environmentId и databasePassword)
PG=$(bash scripts/dokploy-api.sh main POST postgres.create '{
  "name":"my-saas-db",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'",
  "databasePassword":"'"$(openssl rand -base64 16)"'",
  "databaseUser":"mysaas",
  "databaseName":"mysaas"
}')
PG_ID=$(echo "$PG" | jq -r '.postgresId')

# 3. Деплой PostgreSQL
bash scripts/dokploy-api.sh main POST postgres.deploy '{"postgresId":"'"$PG_ID"'"}'

# 4. Получить connection string
PG_INFO=$(bash scripts/dokploy-api.sh main GET "postgres.one?postgresId=$PG_ID")
DB_URL=$(echo "$PG_INFO" | jq -r '.internalDatabaseUrl')

# 5. Создать приложение (требует environmentId)
APP=$(bash scripts/dokploy-api.sh main POST application.create '{
  "name":"my-saas",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
APP_ID=$(echo "$APP" | jq -r '.applicationId')

# 6. Настроить GitHub (через GitHub App — если установлен)
GITHUB_ID=$(bash scripts/dokploy-api.sh main GET "gitProvider.getAll" | \
  jq -r '[.[] | select(.providerType == "github")][0].githubId // empty')

if [ -n "$GITHUB_ID" ]; then
  bash scripts/dokploy-api.sh main POST application.saveGithubProvider '{
    "applicationId":"'"$APP_ID"'",
    "owner":"user",
    "repository":"my-saas",
    "branch":"main",
    "buildPath":"/",
    "githubId":"'"$GITHUB_ID"'",
    "triggerType":"push",
    "enableSubmodules":false
  }'
else
  # Fallback: customGitUrl для публичных репо
  bash scripts/dokploy-api.sh main POST application.update '{
    "applicationId":"'"$APP_ID"'",
    "sourceType":"git",
    "customGitUrl":"https://github.com/user/my-saas.git",
    "customGitBranch":"main"
  }'
fi

# 7. Установить buildType (все 7 полей обязательны в v0.28+)
bash scripts/dokploy-api.sh main POST application.saveBuildType '{
  "applicationId":"'"$APP_ID"'",
  "buildType":"nixpacks",
  "dockerfile":"Dockerfile",
  "dockerContextPath":"",
  "dockerBuildStage":"",
  "herokuVersion":"24",
  "railpackVersion":"0.15.4"
}'

# 8. Установить env (все 5 полей обязательны в v0.28+)
bash scripts/dokploy-api.sh main POST application.saveEnvironment '{
  "applicationId":"'"$APP_ID"'",
  "env":"DATABASE_URL='"$DB_URL"'\nNODE_ENV=production",
  "buildArgs":"",
  "buildSecrets":"",
  "createEnvFile":true
}'

# 9. Создать DNS-запись (БЕЗ proxy для Let's Encrypt!)
bash scripts/cloudflare-dns.sh create app.example.com "$SERVER_IP" false

# 10. Подождать DNS propagation
sleep 30

# 11. Добавить домен с SSL
bash scripts/dokploy-api.sh main POST domain.create '{
  "applicationId":"'"$APP_ID"'",
  "host":"app.example.com",
  "port":3000,
  "https":true,
  "path":"/",
  "certificateType":"letsencrypt"
}'

# 12. Деплой
bash scripts/dokploy-api.sh main POST application.deploy '{"applicationId":"'"$APP_ID"'"}'
```

### Создать Compose-проект с raw YAML

```bash
# 1. Создать проект
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-compose-app"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Создать compose-проект
COMPOSE=$(bash scripts/dokploy-api.sh main POST compose.create '{
  "name":"my-compose-app",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
COMPOSE_ID=$(echo "$COMPOSE" | jq -r '.composeId')

# 3. Загрузить raw YAML
bash scripts/dokploy-api.sh main POST compose.update '{
  "composeId":"'"$COMPOSE_ID"'",
  "sourceType":"raw",
  "composePath":"docker-compose.yml",
  "composeFile":"services:\n  app:\n    image: my-app:latest\n    ports:\n      - '\''3000:3000'\''\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}'

# 4. Деплой
bash scripts/dokploy-api.sh main POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

### Enable auto-deploy (GitHub App)

```bash
# Just enable the flag — GitHub App handles the rest automatically
bash scripts/dokploy-api.sh main POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "autoDeploy":true
}'
# No webhook setup needed when using GitHub App
```
