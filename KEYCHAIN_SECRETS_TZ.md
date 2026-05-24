# ТЗ: Хранение секретов Dokpilot в macOS Keychain

## Контекст

Сейчас все секреты Dokpilot лежат в `~/.claude/skills/dokpilot/config/servers.json` в открытом виде:

- `servers.<name>.dokploy_api_key` — API-ключ Dokploy (полный root-доступ к VPS)
- `servers.<name>.ssh_key` — путь к приватному SSH-ключу
- `cloudflare.api_token` — CloudFlare API-токен (полный доступ к DNS-зонам)

Любой процесс или агент, имеющий доступ к `~/.claude/`, может прочитать все эти токены. Это нарушает принцип «секреты живут в системном secret store, а не в plain JSON». Цель доработки — дать пользователю возможность хранить секреты в **macOS Keychain**, при этом не ломая существующих установок.

## Цель и принципы

1. **Опциональность**: Keychain — рекомендация, но не принуждение. Старые конфиги с plaintext-секретами должны продолжать работать без изменений.
2. **Прозрачность для скриптов**: `dokploy-api.sh`, `cloudflare-dns.sh`, `ssh-exec.sh` не должны различать источник — они зовут единый `secret-store.sh`.
3. **Только macOS**: на Linux/Windows скилл и так работает — там Keychain недоступен, секреты остаются в файле (или ENV).
4. **UX по умолчанию — безопасный**: при `config server add` / `config cloudflare` скилл сначала предлагает Keychain, fallback в файл — явный выбор пользователя.

## Scope / Non-Goals

**В скоупе:**
- Новый скрипт `scripts/secret-store.sh` (обёртка над `security` CLI).
- Адаптация трёх существующих скриптов (`cloudflare-dns.sh`, `dokploy-api.sh`, `ssh-exec.sh`) — они теперь резолвят значение через `secret-store.sh`.
- Обновление команд раздела `/dokpilot config` в `SKILL.md` (диалог при вводе токена; новая команда `config migrate-to-keychain`).
- Новый `references/secrets-management.md` — гайд для пользователя.
- Обновление 1 eval-сценария + добавление 2 новых.

**Не в скоупе:**
- Поддержка Linux Secret Service (`secret-tool`), 1Password CLI, age, vault — это можно добавить позже как ещё один backend через тот же `secret-store.sh`.
- Ротация ключей (просто `config remove` + `config add` снова).
- Шифрование `servers.json` целиком (мы уносим только секреты, остальные поля и так публичные).

## Архитектура хранилища

### Формат `config/servers.json` после миграции

Секретные поля заменяются на «ссылку» вида `{"_secret": "<keychain-account>"}`:

```json
{
  "servers": {
    "main": {
      "host": "77.90.43.8",
      "ssh_user": "root",
      "ssh_key": "/Users/.../id_rsa",
      "dokploy_url": "http://77.90.43.8:3000",
      "dokploy_api_key": { "_secret": "main:dokploy_api_key" },
      "added_at": "2026-02-19T11:15:00Z"
    }
  },
  "cloudflare": {
    "api_token": { "_secret": "cloudflare:api_token" }
  },
  "defaults": { "server": "main" }
}
```

**Старая схема (plain string)** продолжает поддерживаться: если поле — строка, она используется как есть.

### Naming convention для Keychain items

- `service` (фиксировано): `dokpilot`
- `account` (динамически):
  - сервер: `<server-name>:<field>` — например `main:dokploy_api_key`
  - cloudflare: `cloudflare:api_token`
- `comment`: `Created by dokpilot skill on <ISO date>`

Команда чтения:

```bash
security find-generic-password -s dokpilot -a "main:dokploy_api_key" -w
```

Команда записи:

```bash
security add-generic-password -U -s dokpilot -a "main:dokploy_api_key" -w "<token>" \
  -j "Created by dokpilot skill on 2026-04-19"
# -U — обновить, если уже есть; -T опускаем, чтобы доступ требовал явного разрешения пользователя
```

> **Решение по `-T`**: НЕ добавляем `-T /usr/bin/security` или другие приложения. При первом доступе из терминала macOS покажет системный диалог — пользователь нажмёт «Always Allow» и больше его не увидит. Это лучше с точки зрения безопасности, чем «открыто всем».

## UX команд `/dokpilot config`

### `config server add <name> <ip> [--ssh-key <path>]`

Поведение меняется так:

1. Сохранить публичные поля (`host`, `ssh_user`, `ssh_key`, `dokploy_url`, `added_at`) в `servers.json` — как сейчас.
2. Спросить у пользователя API-ключ Dokploy:
   - `read -s -p "Dokploy API key for <name> (input hidden, leave empty to skip): "`
3. Если введён — спросить **где хранить**:
   - macOS + `security` доступен → дефолт **Keychain**, опция «п» — plain в файл.
   - другая ОС → только plain файл, без вопроса.
4. Сохранить через `secret-store.sh set "<name>:dokploy_api_key" "<token>"`.
5. В `servers.json` записать `{"_secret": "<name>:dokploy_api_key"}`.

### `config cloudflare <api-token>`

- Если токен передан в аргументе — сохранить **сразу в Keychain** (наиболее безопасный default), записать ссылку.
- Если без аргумента — спросить через `read -s` и потом тот же flow.
- Аргументная форма оставлена для совместимости, но в выводе предупредить: «токен мог попасть в shell history; рекомендуется удалить или использовать форму без аргумента».

### `config server remove <name>`

Дополнительно: удалить связанные Keychain-items (`<name>:*`) после подтверждения. Подтверждение явное: `Y/n`.

### `config migrate-to-keychain` (новая команда)

Прогоняет существующий `servers.json`:

1. Находит все поля, чьё значение — строка (а не объект `{_secret}`) среди известных секретных ключей.
2. Для каждого: записывает в Keychain → заменяет в JSON на ссылку.
3. Делает бэкап `servers.json.pre-keychain-<timestamp>` рядом.
4. Печатает отчёт: что мигрировано, что пропущено.

### `config` (без аргументов)

Сейчас:

```bash
cat config/servers.json | jq 'del(.servers[].dokploy_api_key, .servers[].ssh_key, .cloudflare.api_token)'
```

Меняем на отчёт со статусом источника каждого секрета:

```
servers.main.dokploy_api_key  → keychain (dokpilot / main:dokploy_api_key)
servers.main.ssh_key           → file (path)
cloudflare.api_token           → keychain (dokpilot / cloudflare:api_token)
defaults.server                → main
```

Реальные значения никогда не печатаются.

## Реализация — конкретные правки

### Новый `scripts/secret-store.sh`

```text
Usage:
  secret-store.sh get <account>            → выводит секрет в stdout, exit 0
                                              (exit 1 если не найдено)
  secret-store.sh set <account> <value>    → записать; -U обновляет
  secret-store.sh delete <account>         → удалить
  secret-store.sh list                     → перечислить аккаунты для service=dokpilot
  secret-store.sh available                → exit 0 если security CLI доступен; иначе 1

Внутри:
  - Проверяет `command -v security` и uname=Darwin
  - Service constant = "dokpilot"
  - Все ошибки security маппит на читаемые сообщения
  - При записи: -U (update), без -T (force prompt at first access)
```

### `scripts/cloudflare-dns.sh:37`

Сейчас:

```bash
TOKEN=$(jq -r ".cloudflare.api_token // empty" "$CONFIG")
```

Становится:

```bash
TOKEN=$(resolve_secret '.cloudflare.api_token')
```

Где `resolve_secret()` — общая bash-функция (вынести в новый `scripts/_lib.sh` и source-ить из всех трёх скриптов):

```bash
resolve_secret() {
  local jq_path="$1"
  local raw=$(jq -c "$jq_path // empty" "$CONFIG")
  [ -z "$raw" ] && return 1
  # Object form: {"_secret": "<account>"}
  local account=$(echo "$raw" | jq -r '._secret // empty')
  if [ -n "$account" ]; then
    bash "$SCRIPT_DIR/secret-store.sh" get "$account"
  else
    echo "$raw" | jq -r '.'
  fi
}
```

### `scripts/dokploy-api.sh:47-48`

Те же два jq-вызова заменяются на:

```bash
URL=$(jq -r ".servers.\"$SERVER\".dokploy_url // empty" "$CONFIG")  # публичное — читаем как есть
KEY=$(resolve_secret ".servers.\"$SERVER\".dokploy_api_key")
```

`dokploy-api.sh:68` (передача в header) — без изменений, переменная та же.

### `scripts/ssh-exec.sh:39-41`

`host` и `ssh_user` — публичные. `ssh_key` пока НЕ переносим в Keychain (это путь, а не сам ключ):

```bash
HOST=$(jq -r ".servers.\"$server_name\".host // empty" "$config")
USER=$(jq -r ".servers.\"$server_name\".ssh_user // \"root\"" "$config")
SSH_KEY=$(jq -r ".servers.\"$server_name\".ssh_key // empty" "$config")
```

> **Решение по SSH-ключу**: путь оставляем в файле, сам ключ остаётся на диске под `chmod 600`. Это стандартная практика; перенос приватного ключа в Keychain потребовал бы временного восстановления файла на каждый ssh-вызов и сильно усложнил скрипт без явной выгоды (хорошие практики macOS — пользоваться `ssh-agent` + `ssh-add --apple-use-keychain`, что уже системно).

### `SKILL.md`

- Раздел `/dokpilot config` (строки 219–250) переписать под новые UX-флоу.
- Добавить подраздел про команду `config migrate-to-keychain`.
- В заголовке секции `### 3. Security` (около строки ~180) добавить пункт: «Tokens in Keychain by default on macOS».

### `references/secrets-management.md` (новый)

- Что хранится, где и почему.
- Как отозвать доступ (Keychain Access.app → удалить запись).
- Как мигрировать вручную и обратно.
- Как ротировать токены.
- Что делать если Keychain заблокирован.

## Совместимость и миграция

- **Существующие установки**: `servers.json` со строковыми токенами читается как раньше, без warning'ов (тихая совместимость, чтобы не пугать).
- **При следующем `config server add` / `config cloudflare`** — пользователь увидит новый вопрос про Keychain. Это естественный момент для миграции.
- **Явная миграция**: команда `config migrate-to-keychain` — для тех, кто хочет всё перевести разом.
- **Откат**: пользователь может вручную сделать `security find-generic-password -s dokpilot -a "main:dokploy_api_key" -w` и положить значение обратно строкой в JSON. Документировать в `references/secrets-management.md`.

## Тесты / evals

В `evals/evals.json`:

- **Обновить eval #3 (Setup VPS)**: после ввода API-key проверить, что Claude предлагает Keychain как дефолт и сохраняет туда (а не в plain JSON).
- **Новый eval**: «config migrate-to-keychain» — на стартовом конфиге со строковыми токенами после команды все секреты должны быть `{_secret: ...}` в файле, а в Keychain — присутствовать.
- **Новый eval**: «работа со старым конфигом» — со строковыми токенами все три скрипта продолжают работать (deploy, cloudflare-dns create, ssh-exec).

Ручной smoke-test (в `references/secrets-management.md` как чек-лист):

```bash
# 1. Запись
bash scripts/secret-store.sh set "test:token" "hello"
# 2. Чтение
[ "$(bash scripts/secret-store.sh get 'test:token')" = "hello" ] && echo OK
# 3. Удаление
bash scripts/secret-store.sh delete "test:token"
# 4. End-to-end: после миграции CF API всё ещё работает
bash scripts/cloudflare-dns.sh list moone.dev | head
# 5. End-to-end: Dokploy API
bash scripts/dokploy-api.sh main GET project.all | jq 'length'
```

## Файлы, которые нужно создать или изменить

| Файл | Действие |
|------|----------|
| `scripts/secret-store.sh` | **NEW** — обёртка над `security` CLI |
| `scripts/_lib.sh` | **NEW** — общая `resolve_secret()` |
| `scripts/cloudflare-dns.sh` | EDIT — строка ~37 |
| `scripts/dokploy-api.sh` | EDIT — строки ~47–48 |
| `scripts/ssh-exec.sh` | EDIT — строки ~39–41 (только обёртка над секретами; ssh_key path не трогаем) |
| `SKILL.md` | EDIT — строки 219–250 + ~180 (security note) |
| `references/secrets-management.md` | **NEW** — гайд для пользователя |
| `evals/evals.json` | EDIT — обновить eval #3, добавить 2 новых |
| `CHANGELOG.md` | EDIT — описать новую версию (например v3.2) |

## Verification (как убедиться что готово)

1. На чистом конфиге выполнить `/dokpilot config server add test 1.2.3.4`, ввести фиктивный токен — убедиться, что в `servers.json` записан `{_secret}`, а `security find-generic-password -s dokpilot -a 'test:dokploy_api_key' -w` возвращает токен.
2. Выполнить `/dokpilot config migrate-to-keychain` на конфиге со строковыми токенами — проверить, что бэкап создан, JSON обновлён, в Keychain появились items.
3. Запустить любую команду со старого README (`/dokpilot status`, `/dokpilot logs ...`) — должна работать без изменений.
4. `/dokpilot config` без аргументов — печатает источники, не значения.
5. Прогнать обновлённые evals — все зелёные.

## Открытые решения (зафиксированы)

- **Только macOS** для Keychain. Linux/Windows — без изменений (plaintext в файле).
- **`ssh_key`** — оставляем путь в файле, сам ключ не трогаем (рекомендация в доке: `ssh-add --apple-use-keychain`).
- **Запись через `security` без `-T`** — пользователь увидит системный диалог при первом доступе, дальше «Always Allow».
- **Обратная совместимость со строковыми значениями** — без warning'ов при чтении.
