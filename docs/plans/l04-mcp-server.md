# L04: локальний MCP-сервер `devdigest-mcp`

## Context

DevDigest сьогодні доступний лише через веб-студію на :3000 та HTTP API на :3001.
Щоб агент у редакторі (Claude Code) міг користуватися рев'юерами, findings і конвенціями репозиторію без переходу в браузер, потрібен локальний MCP-сервер.

Роадмап у `README.md` уже резервує під це рядок: `L04 | devdigest-mcp server · Blast Radius (reads repo-intel)`.

Ключове обмеження, яке визначає весь дизайн: **визначення інструментів MCP вантажаться в системний промт на старті КОЖНОГО нового чату**.
Сім типових MCP-серверів з'їдають ~67k токенів до першого повідомлення користувача.
Тому цільовий бюджет усього `tools/list` тут - **менше 2500 токенів**, і це вимірюється автоматично, а не на око.

П'ять інструментів (назви й семантика зафіксовані замовником):
`list_agents`, `run_agent_on_pr` (єдиний на запис, чекає результату), `get_findings`, `get_conventions`, `get_blast_radius` (свідома заглушка під домашку).

### Рішення, ухвалені до планування

1. **Доступ до домену - HTTP до локального API** `http://localhost:3001`. Ніякого Container, Postgres чи drizzle у процесі MCP.
2. **Новий п'ятий standalone-пакет `/mcp`** зі своїм `package.json` + lockfile, за конвенцією репо (без workspace).
3. **`run_agent_on_pr` чекає** з лімітом ~180с; на таймауті повертає не помилку, а `status: running` + `run_id` + інструкцію викликати `get_findings`.
4. **`get_blast_radius` - заглушка**: повна схема входу/виходу та анотації є, тіло повертає помилку з інструкцією, що саме дописати.

---

## Перевірені факти, на яких стоїть план

**MCP SDK перейшов на v2 і розпався на пакети.**
`@modelcontextprotocol/sdk` - це стара лінія v1 (`1.30.0`).
Нова лінія: `@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/core@2.0.0`, усі на `zod ^4.2.0`, node `>=20`.
Підтверджено з npm та з `dist/*.d.mts`:

- з `@modelcontextprotocol/server`: `McpServer`, `createMcpHandler`, `ToolAnnotations`, `ProtocolError`, `InMemoryTransport`
- з `@modelcontextprotocol/server/stdio`: `serveStdio(factory, options?): StdioServerHandle`, `StdioServerTransport`, `ServeStdioOptions { legacy?: 'serve'|'reject', transport?, onerror?, maxSubscriptions? }`

API: `registerTool(name, config, handler)`, де `config = { title?, description?, inputSchema?, outputSchema?, annotations?, icons?, _meta? }`, а `inputSchema` - справжній `z.object(...)`, не сирий shape.
Старий `server.tool(...)` + `new StdioServerTransport()` + `server.connect()` - це v1, у більшості туторіалів саме він.

**Помилки розділені самим SDK.**
Невідомий інструмент - це JSON-RPC `MethodNotFound`, якого модель не бачить.
Невалідні аргументи і будь-який виняток із хендлера SDK перетворює на `isError: true` результат, який модель бачить і може виправитися.
Тому наше завдання - **повертати** `isError: true` з навчальним текстом, а не кидати голий `Error`.

**stdout - це канал протоколу.** Будь-який `console.log` ламає `initialize`. Уся діагностика йде в `console.error`.

**zod 3 vs zod 4 - причина повного роз'єднання пакетів.**
У `server/`, `client/`, `reviewer-core/` стоїть `zod ^3.24.1`.
MCP SDK v2 вимагає zod 4.
Трюк reviewer-core (self-pin `"zod": ["./node_modules/zod"]` у `paths`) тут не спрацює: там обидві сторони на zod 3, а тут різні мажори, і вендорені контракти просто не скомпілюються під zod 4.
Отже `/mcp` **не аліасить `@devdigest/shared`** і має власні вузькі парсери відповіді.

**Стан сервера, який доведеться обходити:**

- `POST /pulls/:id/review` (`reviews/routes.ts:34`) завжди повертає `reviews: []`, бо `ReviewService.runReview` запускає екзек'ютор через `void this.executor.executeRuns(...)` (`reviews/service.ts:133`). Awaitable-ручки немає.
- Rate limit: глобально 120/хв (`app.ts:106`), але на `POST /pulls/:id/review` - **10/хв**.
- Усе адресується uuid-ами. Єдиний семантичний вхід - `GET /repos/:id/pulls/:number` (`pulls/routes.ts:35`). `GET /repos/:owner/:name` не існує, тож `owner/name` резолвиться через `GET /repos` на боці MCP.
- PR має бути **вже імпортований**; fallback "дістати з GitHub за номером" відсутній у всіх шляхах.
- Агенти не мають slug, а `(workspace_id, name)` не має unique-констрейнта.
- `GET /repos/:id/conventions` повертає **всі** кандидати, включно з `rejected`. Фільтрація - на боці MCP.
- Немає роута, що мапить `run_id` на його PR. `GET /runs/:id/trace` віддає `RunTrace.config` без `pr_id`.
- `ApiErrorBody = { error: { code, message, details? } }` (`contracts/platform.ts:287`).
- 429 від `@fastify/rate-limit` **не** є `AppError`, тому приходить як `code: "internal_error"`. Матчити треба за `status === 429`, не за кодом.
- `.mcp.json` у репо немає.

**Blast radius уже реалізований усередині:** `RepoIntelService.getBlastRadius(repoId, changedFiles)` (`repo-intel/service.ts:220`, персистентний шлях на `service.ts:317` поверх `file_edges`/`file_rank`/`file_facts`, плюс degraded ripgrep-фолбек).
Бракує лише HTTP-роута - `repo-intel/routes.ts` має тільки `GET /repos/:id/index-state` і `POST /repos/:id/resync`.
Це і є домашка.

---

## 1. Скелет пакета `/mcp`

```
mcp/
  .dependency-cruiser.cjs
  AGENTS.md  INSIGHTS.md  README.md
  package.json  pnpm-lock.yaml  tsconfig.json  vitest.config.ts
  bin/devdigest-mcp              виконуваний bash-лаунчер
  scripts/token-budget.ts        `pnpm budget`
  src/
    index.ts                     serveStdio(() => createServer({ api }))
    server.ts                    createServer(deps): McpServer з 5 інструментами
    config.ts                    env: base URL, таймаути, дефолт очікування
    api/index.ts                 інтерфейс ApiClient + createApiClient(baseUrl)
    api/http.ts                  fetch-обгортка, ApiError, мапінг ApiErrorBody
    api/schemas.ts               вузькі zod-парсери лише читаних полів
    api/resolve.ts               owner/name -> repoId, slug -> agentId, кеші
    rules/latest-reviews.ts      локальна копія правила "останнє рев'ю на агента"
    format/slug.ts               ім'я агента -> slug + виявлення неоднозначності
    format/render.ts             текстові рендерери
    format/truncate.ts           limit + підказка "showing X of Y"
    run-index.ts                 обмежений LRU run_id -> { prId, repo, prNumber }
    wait.ts                      цикл полінгу до термінального статусу
    tools/shared.ts              спільні фрагменти схем
    tools/{list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.ts
  test/
    helpers/{client.ts,fake-api.ts}   fixtures/*.json
    tools-list.test.ts               снапшот + бюджет + структурний гейт
    {list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.test.ts
    latest-reviews.test.ts  errors.test.ts
    mcp-stdio.it.test.ts             opt-in, потребує живого стека
```

`package.json`: **дві рантайм-залежності** - `@modelcontextprotocol/server ^2.0.0` і `zod ^4`.
devDeps: `@modelcontextprotocol/client`, `tsx`, `typescript`, `vitest`, `dependency-cruiser`, `js-tiktoken`, `@types/node`.
Скрипти: `dev`, `typecheck`, `arch:check`, `budget`, `test` (`vitest run --exclude '**/*.it.test.ts'`), `test:it` (`vitest run .it.test`), `inspect` (`npx @modelcontextprotocol/inspector ./bin/devdigest-mcp`).
Менеджер - **pnpm** з закомміченим `pnpm-lock.yaml` (npm у reviewer-core - вимушений виняток заради `npm ci`, тут такого обмеження немає).

`tsconfig.json` - копія reviewer-core мінус аліаси, **без блоку `paths`** (це навмисно, з коментарем чому), `lib: ["ES2022","DOM"]` заради глобального `fetch`.

`mcp/.dependency-cruiser.cjs` - чотири правила:

- `mcp-is-standalone`: `^src` не може імпортувати `^\.\./(server|client|reviewer-core|e2e)`
- `mcp-has-no-db-or-framework`: заборонені `drizzle-orm|postgres|pg|fastify|octokit|@octokit|simple-git`
- `tools-go-through-the-api-port`: `^src/tools` може імпортувати з `^src/api/` лише `index.ts`
- `no-circular`

`bin/devdigest-mcp` - bash-обгортка, що перевіряє наявність `node_modules/.bin/tsx` і падає з читабельним рядком замість `ENOENT`, потім `exec tsx src/index.ts`.
У `scripts/dev.sh` додається один рядок `install_if_needed mcp` поряд з наявними.

---

## 2. П'ять інструментів

Спільні правила для всіх: пласкі об'єкти, без вкладеності, **без `anyOf`/`oneOf`/`allOf`/`$ref`**, кожна властивість має однорядковий `.describe()`, кожен опційний параметр має дефолт прямо в схемі, максимум 6 параметрів.

### 2.0 Канонічні тексти - брати ДОСЛІВНО

Це затверджені фінальні формулювання. Імплементер копіює їх посимвольно і **не переписує від себе**.
Кожен рядок тут оподатковується в кожній сесії кожного користувача, тому будь-яка зміна цих текстів - окреме свідоме рішення з перезапуском `pnpm budget`, а не побічний ефект рефакторингу.

**Описи інструментів** (ліміт 350 символів):

```
list_agents
List the reviewer agents configured in this DevDigest workspace. Call this before
run_agent_on_pr: it returns the agent slug and id that tool needs, and agent ids are
UUIDs that cannot be guessed from a name.

run_agent_on_pr
Run one DevDigest reviewer agent on an already-imported pull request, wait for it to
finish, and return the verdict and findings. This spends real LLM tokens and usually
takes 30 to 180 seconds. If the wait limit is reached the tool returns status running
plus a run_id instead of an error; call get_findings with that run_id a minute later.

get_findings
Return the verdict and findings of a DevDigest review that has already run. Pass run_id
for one specific run, or repo plus pr_number for the latest review from every agent on
that PR. This does not start a review and costs nothing.

get_conventions
Return the coding conventions DevDigest extracted from a repository: house rules a human
has accepted, each with a measured adherence rate. Read these before writing or reviewing
code in that repo so the change matches the existing style.

get_blast_radius
Map the impact of a pull request: which symbols it changes, which files call them, and
which HTTP endpoints sit behind those callers. NOT IMPLEMENTED YET - this is the L04
exercise; calling it returns an error that spells out exactly what to build.
```

Переноси рядків вище - лише для читабельності плану. У коді кожен опис це **один рядок без переносів**.

**Описи параметрів** (ліміт 160 символів, ідуть у `.describe()`):

```
repo               Repository as "owner/name", exactly as listed in DevDigest.
pr_number          Pull request number.
agent              Agent slug or id from list_agents.
severity_min       Drop findings below this severity.
limit              Maximum findings returned; the response says how many were withheld.
wait_seconds       How long to wait before returning status running instead of results.
run_id             Run id from run_agent_on_pr. Takes precedence over repo and pr_number.
detail             concise lists severity, location and title; full adds rationale and suggested fix.
enabled_only       Only agents that can run. Set false to also see disabled ones.
category           Only rules in this category.
status             accepted means a human confirmed the rule; all adds unreviewed candidates.
evidence           Include one file:line pointer proving each rule.
max_callers        Maximum caller rows, highest-ranked first.
min_rank           Drop callers whose file rank is below this.
include_endpoints  Include the HTTP endpoints the callers sit behind.
```

`repo` і `pr_number` мають один і той самий текст у всіх інструментах, де зустрічаються - вони живуть у `src/tools/shared.ts` і перевикористовуються.
Виняток: у `get_findings` `repo` має власний текст `Repository as "owner/name". Use with pr_number when you have no run_id.`, бо там він опційний і треба пояснити зв'язок із `run_id`.

Разом: описи інструментів ~313 токенів, описи параметрів ~180. Решта бюджету - структура JSON Schema.

**Чому саме такі формулювання** (щоб при правці було зрозуміло, що зламається):

- `list_agents`: `Call this before run_agent_on_pr` орієнтує модель у графі інструментів; `UUIDs that cannot be guessed from a name` перехоплює найімовірнішу галюцинацію - вигаданий uuid.
- `run_agent_on_pr`: `already-imported` попереджає найчастішу помилку до виклику; речення про гроші й час - те, що змушує модель спитати користувача, і воно свідомо дублює `openWorldHint`, бо хости рідко показують анотації моделі; третє речення - контракт деградації, без якого модель прочитає таймаут як провал і повторить виклик, тобто заплатить двічі.
- `get_findings`: друге речення - це те місце, де обмеження `run_id` XOR `repo`+`pr_number` пояснюється прозою замість `anyOf`; третє протиставляє інструмент платному сусідові, щоб модель обирала безкоштовний для читання.
- `get_conventions`: `a human has accepted` і `measured adherence rate` кажуть моделі, що це заземлені факти, а не думка іншої моделі; друге речення - інструкція **коли** викликати, без якої read-only інструмент просто не викликається.
- `get_blast_radius`: спершу реальна здатність, щоб схема мала сенс, потім прапорець, щоб не витрачати виклик. Довга інструкція "як збудувати" живе в тілі помилки, не тут.

**Два свідомі відступи від букви правил**, щоб їх не "виправили" на рев'ю:

1. `repo` несе формат `"owner/name"` прямо в тексті, хоча правило радить не тримати прикладів у описах. Це специфікація формату, а не приклад, і вона економить провалений раунд.
2. `run_agent_on_pr` має найдовший опис, хоча AWS радить не роздувати їх. Він єдиний витрачає гроші й єдиний має бімодальний результат, а для жодного з цих фактів у JSON Schema немає конструкції.

Переліки валідних значень (які репо додані, які агенти існують) у описах **навмисно відсутні** - вони коштували б токенів у кожній сесії. Їхнє місце - тіло помилки, яка спрацьовує рідко.

### 2.1 `list_agents`

> List the reviewer agents configured in this DevDigest workspace. Call this before run_agent_on_pr: it returns the agent slug and id that tool needs, and agent ids are UUIDs that cannot be guessed from a name.

| параметр | тип | дефолт |
|---|---|---|
| `enabled_only` | boolean | `true` |
| `detail` | enum `concise`\|`full` | `concise` |

Анотації: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`. Без `outputSchema`.
Ендпоінт: `GET /agents`.

**Slug виводиться в шарі MCP** (`format/slug.ts`), бо в БД його немає: нижній регістр, не-алфанумерики в `-`, відкидання хвостового `reviewer`/`agent` ("Security Reviewer" -> `security`).
Повертаються **і slug, і uuid** - семантичний ідентифікатор для читання, uuid для наступного виклику.
Якщо два агенти дають однаковий slug - обидва друкуються з міткою неоднозначності, а `run_agent_on_pr` на такому slug повертає помилку замість вгадування.

`system_prompt` і `output_schema` **ніколи** не потрапляють у вивід: вони великі і це IP користувача. Це закріплюється тестом.

Порожні випадки - **не помилки**: нуль агентів або всі вимкнені повертають звичайний результат з підказкою, де їх створити чи ввімкнути.

### 2.2 `run_agent_on_pr`

> Run one DevDigest reviewer agent on an already-imported pull request, wait for it to finish, and return the verdict and findings. This spends real LLM tokens and usually takes 30 to 180 seconds. If the wait limit is reached the tool returns status running plus a run_id instead of an error; call get_findings with that run_id a minute later.

| параметр | тип | обов'язковий | дефолт |
|---|---|---|---|
| `repo` | string `"owner/name"` | так | |
| `pr_number` | integer >=1 | так | |
| `agent` | string (slug або id) | так | |
| `severity_min` | enum `SUGGESTION`\|`WARNING`\|`CRITICAL` | ні | `SUGGESTION` |
| `limit` | integer 1..50 | ні | `20` |
| `wait_seconds` | integer 10..300 | ні | `180` |

Анотації: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }`.
`destructiveHint` виставляється явно в `false`, бо дефолт MCP - `true`, коли `readOnlyHint` хибний, а рев'ю лише дописує рядки.
`openWorldHint: true` - бо витрачає реальні гроші на LLM. `idempotentHint: false` - два виклики це два прогони і два рахунки.

Без `outputSchema`: результат справді бімодальний (готовий вердикт vs `status: running`), а виразити це без `anyOf` означало б об'єкт із майже всіх опційних полів, що для моделі гірше за добре оформлений текст.

`all: true` (фан-аут на всіх агентів) **не виставляється назовні**: один виклик - один агент - один рахунок.

Послідовність:

1. `GET /repos` -> матч `full_name` без урахування регістру (кеш 60с, при промаху кеш обходиться і перезапитується один раз)
2. `GET /repos/:repoId/pulls/:pr_number` -> `PrDetail.id` це uuid PR
3. `GET /agents` -> резолв `agent` за uuid, потім slug, потім ім'ям
4. `POST /pulls/:prId/review` з `{ agentId }` -> `runs[0].run_id`
5. запис `run_id -> { prId, repo, prNumber, agent }` у `src/run-index.ts`
6. очікування (розділ 3)
7. на `done`: `GET /pulls/:prId/reviews` -> взяти `ReviewDto` з `run_id === runId` і `kind === 'review'`

П'ять полів на finding: severity, `file:start_line`, title, rationale (перші 200 символів), suggestion (перші 200, пропускається якщо null).
Шапка (`status`, `duration_ms`, `cost_usd`, `findings_count`, `severity_counts`, `score`) береться з `RunSummary`, який цикл полінгу вже має. `verdict` - з рев'ю.
Id findings не повертаються: жоден із п'яти інструментів їх не споживає, а це 36 символів на кожен.

Обрізання **ніколи не мовчазне**:
`Showing 20 of 143 findings (severity_min=SUGGESTION). Narrow with severity_min="WARNING" (37 findings) or raise limit (max 50).`
Числа в підказці рахуються з повного набору, тому вона дієва.

Відповідь на таймауті - **не помилка**: `status: running`, `run_id`, явне "Nothing was cancelled" і вказівка викликати `get_findings` через хвилину.

Помилки (усі як `isError: true`, кожна називає наступну дію):
невідомий репо (з переліком доданих), PR не імпортований (з поясненням, що fallback-у немає), невідомий агент (з переліком валідних), неоднозначний slug, 429 на рев'ю (з прямою згадкою ліміту 10/хв), прогін `failed` (з `RunSummary.error` дослівно + підказка про API-ключ), `cancelled`, зниклий рядок прогону, недоступний API.

### 2.3 `get_findings`

> Return the verdict and findings of a DevDigest review that has already run. Pass run_id for one specific run, or repo plus pr_number for the latest review from every agent on that PR. This does not start a review and costs nothing.

| параметр | тип | дефолт |
|---|---|---|
| `run_id` | string | |
| `repo` | string | |
| `pr_number` | integer >=1 | |
| `severity_min` | enum | `SUGGESTION` |
| `limit` | integer 1..50 | `20` |
| `detail` | enum `concise`\|`full` | `concise` |

Анотації: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`. Без `outputSchema`.

Обмеження "`run_id` XOR (`repo` + `pr_number`)" **свідомо не кодується в JSON Schema**: `.refine` чи discriminated union дали б `anyOf` і зламали правило пласких схем заради обмеження, яке пояснюється одним реченням у помилці.
Перевірка - у хендлері, з навчальним текстом. Це найімовірніша претензія на рев'ю, тож поряд буде коментар і тест.

Шлях `repo` + `pr_number`: `GET /repos` -> `GET /repos/:repoId/pulls/:number` -> `GET /pulls/:prId/reviews`, далі правило "останнє рев'ю на кожного агента", далі фільтр і групування за агентом.

Шлях `run_id`: HTTP-роута "прогін -> PR" не існує, тому працює обмежений in-process індекс, заповнений `run_agent_on_pr`.
При промаху - чесна помилка з поясненням і пропозицією передати `repo` + `pr_number`.
Це записується в домашку як необов'язковий бонус: додати `GET /runs/:id` -> `{ run_id, pr_id, status }` у `reviews/routes.ts`, і фолбек зникає.

**Правило "останнє рев'ю на агента" копіюється локально** в `rules/latest-reviews.ts`, стаючи третьою копією (канонічна - `server/src/modules/smart-diff/helpers.ts:32`, друга - у клієнті).
Причина: імпорт означав би аліас у `server/src/modules/`, а той файл тягне `FindingRow` з `db/rows.ts`, тобто типи рядків Drizzle - рівно те, чого цей пакет за визначенням не торкається.
Правило - 15 рядків. Пом'якшення: тест на фікстурі, скопійованій дослівно з `server/test/smart-diff.test.ts`, плюс запис в `INSIGHTS.md`, що називає всі три місця.

Порожні випадки - не помилки: нуль рев'ю, фільтр `severity_min` вичистив усе, є прогін у польоті (додається префікс з `GET /pulls/:prId/runs/active`).

### 2.4 `get_conventions`

> Return the coding conventions DevDigest extracted from a repository: house rules a human has accepted, each with a measured adherence rate. Read these before writing or reviewing code in that repo so the change matches the existing style.

| параметр | тип | обов'язковий | дефолт |
|---|---|---|---|
| `repo` | string | так | |
| `category` | enum з 10 значень `ConventionCategory` | ні | |
| `status` | enum `accepted`\|`pending`\|`all` | ні | `accepted` |
| `limit` | integer 1..100 | ні | `40` |
| `evidence` | boolean | ні | `false` |

Анотації: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`. Без `outputSchema`.
Ендпоінт: `GET /repos/:repoId/conventions`.

У `status` **навмисно немає значення `rejected`**, а `all` означає accepted + pending.
Відхилений кандидат - це людина, що сказала "ні"; підсовувати його моделі означало б змусити її застосувати правило, від якого команда відмовилась.
Сортування: accepted перед pending, далі adherence спадно, далі confidence - щоб під `limit` виживали найсильніші правила.
`adherence` рендериться відсотком або словом `unmeasured`, що чесно відрізняє "репо робить так у 96% випадків" від "модель так вважає".

Порожні випадки - не помилки: `scan === null` (з інструкцією запустити екстрактор), скан у процесі або з помилкою (префікс + віддати попередні правила), нуль accepted при N pending, категорія відфільтрувала все.

### 2.5 `get_blast_radius` (заглушка)

> Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints sit behind those callers. NOT IMPLEMENTED YET - this is the L04 exercise; calling it returns an error that spells out exactly what to build.

| параметр | тип | обов'язковий | дефолт |
|---|---|---|---|
| `repo` | string | так | |
| `pr_number` | integer >=1 | так | |
| `max_callers` | integer 1..100 | ні | `25` |
| `min_rank` | number 0..1 | ні | `0` |
| `include_endpoints` | boolean | ні | `true` |

**Єдиний з п'яти інструментів з `outputSchema`**, бо саме схема і є контрактом домашки:
`{ changed_symbols: string[], callers: { file, symbol, via, line, rank }[], impacted_endpoints: string[], degraded: boolean }`.
Мапінг один-до-одного на наявний `BlastResult` (`repo-intel/types.ts:57-87`): `changedSymbols`, `callers[].viaSymbol -> via`, `impactedEndpoints`. `factsByFile` і `reason` відкидаються як шум.

**Обережно: у репо вже є контракт з іменем `BlastRadius`** (`contracts/brief.ts:39`, експортований з барелю, з копією в клієнті), і це **інша форма**: `{ changed_symbols, downstream, summary }` - вища абстракція під PR Brief наступних уроків.
Наша схема дзеркалить `BlastResult` (двигун), а не `BlastRadius` (бриф).
Це записується коментарем, щоб домашка не породила четверту форму.

Анотації: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`. Інструмент **лишається в `tools/list`**.

Тіло повертає `isError: true` з інструкцією. Її серверна частина сформульована **за скілом `onion-architecture`**, а не як "зроби все в роуті":

1. Новий метод `RepoIntelService.blastRadiusForPull(workspaceId, repoId, prNumber)`: резолвить змінені файли через `PullsService.detailByNumber(...).files` (`PrDetail.files: PrFile[]`, `contracts/platform.ts:223`) і делегує в наявний `getBlastRadius(repoId, changedFiles)`.
   Конструювання чужого сервісу дозволено правилом `no-cross-module-imports` як документований шов композиції (той самий, що `polling -> pulls`). `PullsRepository` для цього не годиться: його немає в контейнері.
2. Роут `GET /repos/:id/blast?pr=<number>` у `repo-intel/routes.ts` лишається транспортом: zod-схеми параметрів і відповіді, **один** виклик сервісу, мапінг статусу. Реєструвати нічого не треба, `repo-intel` уже в `modules/index.ts`.
3. Zod-схема відповіді - це контракт, тож вона йде у `vendor/shared/contracts/` і **в обидві фізичні копії** (`server/` і `client/`), за правилом репо.
4. Замінити тіло цього інструмента на виклик роута з мапінгом на вже оголошений `outputSchema`, з урахуванням `max_callers`, `min_rank`, `include_endpoints`; повертати і `content`, і `structuredContent`.
5. Замінити `mcp/test/get-blast-radius.test.ts` на справжній тест по фікстурі.
6. `cd server && pnpm arch:check` має пройти.

Цей текст довгий, але живе **в результаті, а не в `tools/list`**, тому коштує нуль токенів на старті сесії.
Ця асиметрія (описи оподатковуються кожною сесією, тіла помилок - лише коли спрацьовують) фіксується в `mcp/AGENTS.md`.

---

## 3. Механізм очікування в `run_agent_on_pr`

**Полінг, не SSE.** Три причини:

1. Коректність. `GET /runs/:id/events` мостить `container.runBus` - in-memory шину. Якщо прогін завершиться між поверненням `POST` і нашою підпискою, або якщо API перезапуститься, потік завершиться без події `done` і клієнт зависне. Рядок `agent_runs` у Postgres - довговічне джерело правди, і `GET /pulls/:id/runs` читає саме його.
2. Корисне навантаження. Один `GET /pulls/:id/runs` повертає `RunSummary[]` зі `status`, `error`, `duration_ms`, `cost_usd`, `findings_count`, `severity_counts`, `score` - тобто всю шапку відповіді й весь payload таймауту з того самого запиту, що детектує завершення. SSE потребував би другого запиту все одно.
3. Залежності. Жодного EventSource-клієнта і логіки перепідключення в пакеті з двома рантайм-залежностями.

```
POST /pulls/:prId/review {"agentId": uuid}   -> runId = body.runs[0].run_id
цикл, поки elapsed < wait_seconds:
  sleep(delay)
  GET /pulls/:prId/runs   -> знайти рядок з run_id === runId
    рядок відсутній -> tool error "no longer in the run history"
    done            -> GET /pulls/:prId/reviews, рендер, вихід
    failed          -> tool error з row.error дослівно
    cancelled       -> tool error
    running         -> далі
повернути payload "status: running" (НЕ помилку)
```

Бекоф `1s, 1s, 2s, 2s, 3s, 5s`, далі стабільні `5s`, з підрізанням останнього сну, щоб не перескочити `wait_seconds`.
Швидкі перші проби ловлять дешевий прогін на 20с; плато 5с тримає кількість запитів низькою. Гірший випадок на 180с - 38 запитів, при глобальному ліміті 120/хв.

`waitForRun(api, prId, runId, { waitMs, sleep })` бере `sleep` параметром із дефолтом на реальний таймер, тож тест проганяє весь розклад синхронно без боротьби `vi.useFakeTimers()` з асинхронною машинерією SDK.

Оскільки очікування може перевищити внутрішні таймери хоста, `.mcp.json` виставляє `"timeout": 300000` - вище за максимальні 300с `wait_seconds` плюс супутні HTTP-виклики.

---

## 4. HTTP-шар

Конфіг (`src/config.ts`, парситься один раз на старті через zod):

| env | дефолт | сенс |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | базовий URL API |
| `DEVDIGEST_MCP_TIMEOUT_MS` | `15000` | таймаут запиту |
| `DEVDIGEST_MCP_WAIT_SECONDS` | `180` | дефолт для `wait_seconds` |

Невалідний `DEVDIGEST_API_URL` - `console.error` + `process.exit(1)` на старті.
Більше з середовища не читається нічого: **у цьому процесі немає жодного секрету**, і це окремо зазначається в README.

**Без health-проби на старті**: stdio-сервер має швидко відповісти на `initialize`, а API цілком легально може ще не піднятися. Доступність з'ясовується ліниво на першому виклику інструмента.

Таймаути через `AbortSignal.timeout(ms)`, 15с за замовчуванням, 30с окремо для `GET /repos/:id/pulls/:number`, бо `PullsService.detailByNumber` може ходити в GitHub за дифом на холодному імпорті.

`api/http.ts` експортує `ApiError { status, code, message, details? }` і `ApiUnreachableError`.
Не-2xx парситься проти `{ error: { code, message, details? } }`; якщо тіло не парситься, код стає `http_<status>`.
Коди, які варто мапити поіменно: `not_found`, `validation_error`, `invalid_run_request`, `scan_in_progress`, `github_unavailable`, `repo_not_cloned`.

**Пастка, яку треба обробити за статусом, а не за кодом:** 429 від `@fastify/rate-limit` не є `AppError`, тому проходить через загальну гілку обробника помилок і повертається як `code: "internal_error"`.
Матч на код класифікував би ліміт як падіння сервера. Гілка rate-limit ключується на `status === 429`, і на це є тест.

API не запущений (`fetch` кидає `TypeError` з `cause.code === 'ECONNREFUSED'`) - одне повідомлення, визначене в одному місці:
`Cannot reach the DevDigest API at http://localhost:3001. Start the stack with ./scripts/dev.sh from the repo root, then retry.`
Таймаут має власне формулювання, бо "ще піднімається" і "не запущений" вимагають різних дій.

Логування - лише `console.error`, максимум один рядок на виклик, **ніколи не тіла відповідей**: `GET /agents` несе `system_prompt`, `GET /repos` несе `clone_path`.

---

## 5. Реєстрація

Новий `.mcp.json` у корені (project scope - кожен, хто клонує репо, отримує сервер автоматично):

```json
{
  "mcpServers": {
    "devdigest": {
      "type": "stdio",
      "command": "${CLAUDE_PROJECT_DIR:-.}/mcp/bin/devdigest-mcp",
      "args": [],
      "env": { "DEVDIGEST_API_URL": "${DEVDIGEST_API_URL:-http://localhost:3001}" },
      "timeout": 300000
    }
  }
}
```

Ключ сервера `devdigest` визначає імена інструментів у хості: `mcp__devdigest__list_agents` і далі.
**Це і є причина, чому серверні префікси в назвах інструментів не потрібні** - хост неймспейсить сам, а `devdigest_list_agents` дав би `mcp__devdigest__devdigest_list_agents`.
Перейменування ключа перейменовує всі інструменти, тож він фіксується і документується.

CLI-еквівалент для тих, хто не хоче правити файл:

```sh
claude mcp add --scope project --env DEVDIGEST_API_URL=http://localhost:3001 \
  --transport stdio devdigest -- ./mcp/bin/devdigest-mcp
```

Перевірка: `claude mcp list` показує `devdigest: connected`, `/mcp` у свіжій сесії показує п'ять інструментів.

---

## 6. Тести

Прецеденту тестування не-HTTP точки входу в репо немає, тож лінії визначаються тут.
Іменування слідує серверній конвенції: `*.it.test.ts` означає "потрібен живий стек".

**Ключове дизайнерське рішення, що робить герметичну лінію можливою:** `createServer(deps: { api: ApiClient })` приймає HTTP-клієнт аргументом.
Реальний клієнт конструюється лише в `src/index.ts`.
Кожен тест хендлера передає фейковий `ApiClient` із фікстур - нічого не мокається через шлях модуля, а правило dependency-cruiser `tools-go-through-the-api-port` механічно це утримує.

Кожен тест ганяє сервер через справжній `Client` поверх `createMcpHandler`, тож перевіряється реальний дротовий результат, включно з помилками валідації, які генерує сам SDK.

Герметична лінія (`pnpm test`, вона ж CI): без мережі, Postgres, ключів і спавну процесу.
Покриття: виведення slug і неоднозначність; те, що `system_prompt` не з'являється в жодному виводі; повний розклад полінгу з інжектованим `sleep` (done / failed / cancelled / зниклий / таймаут); те, що результат таймауту **не** `isError`; повідомлення на 429; XOR-валідація `get_findings`; шлях `run_id` з індексом і без; групування по агентах; дефолт accepted-only і те, що `rejected` не повертається ніколи; `scan: null`; те, що заглушка blast radius називає `repo-intel/routes.ts` і `service.ts:220`; табличний тест, що кожен `ApiError` мапиться на точний рядок і кожне повідомлення містить наступну дію.

Фікстури знімаються один раз із живого засіданого стека (`curl localhost:3001/agents | jq`) і комітяться - це реальний вивід сервера, а не вигадані форми.

**Структурний гейт** у `tools-list.test.ts` - те, що окупається далеко за межами L04. Він обходить кожну оголошену схему і стверджує:

- сумарний токен-кост `tools/list` менший за 2500
- у кожного інструмента не більше 8 властивостей
- **ніде немає `anyOf`, `oneOf`, `allOf`, `$ref`** (рекурсивний обхід)
- кожна властивість має непорожній `description`
- **два різні ліміти довжини**: опис інструмента <= 350 символів, опис властивості <= 160
- тексти інструментів і властивостей збігаються з розділом 2.0 посимвольно (порівняння з константами в тесті, щоб дрейф формулювань падав як помилка, а не проходив тихо)
- кожен інструмент явно оголошує `annotations.readOnlyHint`
- рівно один інструмент має `readOnlyHint: false`, і в нього ж `openWorldHint: true`
- не більше одного інструмента з `outputSchema`

Це перетворює домовлені практики на механічну перевірку: наступний урок, що додасть шостий інструмент, не зможе тихо їх порушити.

Інтеграційна лінія (`pnpm test:it`, opt-in, не в CI): `mcp-stdio.it.test.ts` спавнить **реальний процес** через `StdioClientTransport` (для stdio in-process-скорочення не існує) і перевіряє `tools/list` з п'яти інструментів, живі `list_agents` і `get_conventions` на засіданому репо, і - найцінніше - що з `DEVDIGEST_API_URL` на мертвому порту `list_agents` повертає повідомлення про `./scripts/dev.sh`.

**Свідомо не автоматизується:** `run_agent_on_pr` наскрізь. Він витрачає реальні гроші й потребує ключа. Це задокументована ручна перевірка, за тією ж логікою, що тримає `e2e/` без LLM-викликів.
**У `e2e/` не йде нічого**: та лінія - детерміновані браузерні флоу.

Новий `.github/workflows/mcp.yml` за зразком `reviewer-core.yml`, з фільтром шляхів лише на `mcp/**`: `pnpm typecheck && pnpm arch:check && pnpm test`.
Він **не** має залежати від `server/src/vendor/shared/**` - у цьому й суть роз'єднання.

---

## 7. Перевірка токен-бюджету

`scripts/token-budget.ts` міряє реальний payload, а не наближення до нього:

1. підняти сервер in-process через `createMcpHandler`
2. підключити `Client` поверх `handler.fetch` і викликати `client.listTools()`
3. `JSON.stringify(result.tools)` - це рівно те, що хост вставляє в системний промт
4. порахувати через `js-tiktoken`, `getEncoding('cl100k_base')`
5. надрукувати таблицю по інструментах + разом, і `process.exit(1)` при перевищенні

`cl100k_base` - не токенайзер Claude, але на JSON-подібному ASCII розходиться на 5-10%, працює офлайн і вже є усталеним вибором у репо (`server/src/adapters/tokenizer/index.ts`).
Точність тут не потрібна - потрібне стабільне число, що рухається, коли схема росте.

Бюджет **2500 із попереджувальною смугою на 2200**. Описаний дизайн має вимірятися десь на 1300-1600, тобто гейт - це запас на зростання описів у наступних уроках, а не ціль, яку треба заповнити.

Два артефакти навмисно: скрипт як людський звіт під час розробки (`pnpm budget`), і та сама функція підрахунку всередині `tools-list.test.ts`, щоб CI це форсив.
Інлайн-снапшот payload-у в тому ж тесті означає, що будь-яка зміна схеми з'являється як читабельний дифф у код-рев'ю - саме це реально зупиняє повзучий бюджет.

---

## 8. Порядок кроків

**Крок 0. Підтвердити контракт SDK на цій машині.**
```sh
mkdir -p mcp && cd mcp && pnpm init && pnpm add @modelcontextprotocol/server zod
node -e "import('@modelcontextprotocol/server').then(m=>console.log(Object.keys(m)))"
node -e "import('@modelcontextprotocol/server/stdio').then(m=>console.log(Object.keys(m)))"
```
Очікується `McpServer` і `createMcpHandler` у першому, `serveStdio` у другому.
Окремо перевірити точну сигнатуру `createMcpHandler` - у типах вона приймає об'єкт опцій, а не голу фабрику.
Якщо щось не збігається, SDK знову зрушив і розділ "перевірені факти" треба переперевірити до написання інструментів.

**Крок 1. Скелет + один інструмент без HTTP.**
`package.json`, `tsconfig.json`, `.dependency-cruiser.cjs`, `bin/devdigest-mcp`, `src/index.ts`, `src/server.ts`, `list_agents` на захардкодженій фікстурі.
```sh
cd mcp && pnpm typecheck && pnpm arch:check
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | ./bin/devdigest-mcp
```
Очікується рівно один рядок JSON на stdout, без банера перед ним. Далі `pnpm inspect` і Connect.

**Крок 2. HTTP-шар, резолвери, мапінг помилок; `list_agents` по-справжньому.**
```sh
./scripts/dev.sh --no-client        # окремий термінал
cd mcp && pnpm test
DEVDIGEST_API_URL=http://localhost:9 pnpm test:it
```

**Крок 3. `get_conventions` і `get_findings` + `domain/latest-reviews.ts`.**
```sh
cd mcp && pnpm test && pnpm arch:check
```
`latest-reviews.test.ts` має проходити на фікстурі, скопійованій із `server/test/smart-diff.test.ts` без змін.

**Крок 4. `run_agent_on_pr` і `src/wait.ts`.**
```sh
cd mcp && pnpm test
```
Плюс єдина ручна перевірка, що коштує грошей: засіданий `acme/payments-api` PR #482 з реальним ключем, обидва шляхи - завершений і `wait_seconds: 10` -> `status: running`.

**Крок 5. Заглушка `get_blast_radius`.** `pnpm test`.

**Крок 6. Бюджет і структурний гейт.** `pnpm budget && pnpm test`.

**Крок 7. Реєстрація, доки, CI.**
`.mcp.json`, `mcp/README.md`, `mcp/AGENTS.md`, `mcp/INSIGHTS.md`, `.github/workflows/mcp.yml`, рядок `install_if_needed mcp` у `scripts/dev.sh`, рядок `mcp/` у таблиці пакетів кореневого `README.md`, і перемикання L04 у таблиці уроків.
```sh
claude mcp list      # devdigest: connected
```

---

## 9. Ризики

1. **SDK v2 щойно вийшов, а більшість туторіалів досі про v1.** Студент, що піде за блогпостом, напише `server.tool(...)` і `new StdioServerTransport()`. Пом'якшення: пін `^2.0.0`, закомічений lockfile, дельта v1-vs-v2 на початку `mcp/AGENTS.md`. У зворотний бік сумісність уже є: `serveStdio` дефолтиться на `legacy: 'serve'`.
2. **zod 4 у `/mcp` проти zod 3 усюди інде.** Це причина відсутності `paths`. Якщо хтось згодом додасть аліас, отримає стіну помилок типів у вендорених контрактах. Захист - правило dependency-cruiser і запис в `INSIGHTS.md`.
3. **`POST /pulls/:id/review` завжди повертає `reviews: []`.** Коментар у `contracts/review-api.ts` стверджує протилежне ("returned once the synchronous run completes") і застарів. У `run-agent-on-pr.ts` буде коментар з посиланням на `reviews/service.ts:133`; сам коментар у контракті варто виправити тим самим PR.
4. **PR не імпортований - найімовірніша перша помилка студента**, бо fallback-у "дістати з GitHub за номером" немає ніде. Повідомлення про помилку і є всім пом'якшенням, тож у нього окремий тест.
5. **`get_findings` за `run_id` працює лише в межах сесії, що запустила прогін.** Задокументовано в помилці; виправлення - невелика необов'язкова частина домашки.
6. **Розмір виводу на великому PR.** 143 findings при `detail: "full"` наблизяться до порогу попередження. Дефолтний `limit` 20 плюс обрізання rationale на 200 символів тримають типову відповідь на 1-2k токенів.
7. **Три копії правила "останнє рев'ю на агента".** Прийнято свідомо. Пом'якшення - спільна фікстура і запис в `INSIGHTS.md`, що називає всі три файли.

---

## 10. Критерії приймання

1. `cd mcp && pnpm typecheck && pnpm arch:check && pnpm test` проходить **без мережі, Docker і ключів**.
2. `pnpm budget` показує суму `tools/list` менше 2500 токенів і друкує розбивку по інструментах.
3. Структурний гейт проходить: жодного `anyOf`/`oneOf`/`allOf`/`$ref`, <= 8 параметрів на інструмент, кожна властивість описана, опис інструмента <= 350 символів і властивості <= 160, рівно один не-read-only інструмент і це `run_agent_on_pr` з `openWorldHint: true`, не більше одного `outputSchema`.
3a. Усі описи посимвольно збігаються з розділом 2.0 плану - це перевіряється тестом, а не оком.
4. З піднятим `./scripts/dev.sh` свіжа сесія Claude Code показує `devdigest` як connected із п'ятьма інструментами, без ручного `claude mcp add`.
5. З зупиненим API кожен read-інструмент повертає `isError: true` з повідомленням, що називає `./scripts/dev.sh`. Ніщо не зависає і ніщо не спливає як протокольна помилка JSON-RPC.
6. `run_agent_on_pr` на засіданому PR повертає відрендерений вердикт; з `wait_seconds: 10` повертає `status: running` + `run_id` і **не** помилку, після чого `get_findings` із цим `run_id` віддає завершений вердикт.
7. `get_blast_radius` присутній у `tools/list` з повними схемами входу й виходу і повертає `isError`-тіло, що називає `server/src/modules/repo-intel/routes.ts` і `service.ts:220`.
8. `/mcp` не імпортує нічого з `server/`, `client/`, `reviewer-core/`, `e2e/` і не імпортує drizzle, postgres, fastify, octokit - це форсить `pnpm arch:check` у CI.
9. Жоден вивід інструмента не містить `system_prompt` агента, і процес не читає з середовища жодного секрету.

---

## 11. Звірка з `onion-architecture`

Скіл покриває `server/` і `reviewer-core/`. Висновки для цієї роботи:

**`/mcp` формально поза цибулиною.** У словнику скіла `routes.ts`, SSE і `polling` - це край (driving adapters). MCP-сервер це четвертий driving adapter, але в окремому процесі, тому він не всередині цибулини, а **клієнт її краю**. Порушити шари він не може за конструкцією: єдиний спосіб дістатися домену - HTTP. Це фіксується в `mcp/AGENTS.md`.

**Правило 4 ("новий зовнішній інструмент = повний порт атомарно") тут не спрацьовує.** Воно про driven-порти, тобто про те, що ми викликаємо. MCP-хост викликає нас. Тому в `server/` не додається ані порт, ані адаптер, ані поле в `ContainerOverrides`, ані геттер у `Container`. Це підтверджує рішення №1.

**Правило 3 у духові застосовується всередині `/mcp`.** `ApiClient` - це порт, `createApiClient` - адаптер, `createServer({ api })` - інжекція. Правило depcruise `tools-go-through-the-api-port` робить це механічним.

**Виправлено після звірки:** папка `mcp/src/domain/` перейменована. У цьому репо "domain" означає `reviewer-core/` + `vendor/shared`, тобто чисту бізнес-суть; те, що там лежало, - це форматування (`format/`), скопійоване правило (`rules/`) і стан процесу (`run-index.ts`). Назва `domain/` вводила б в оману кожного, хто читав скіл.

**Виправлено після звірки:** інструкція домашки в тілі `get_blast_radius` порушувала Правило 1 (роут - лише транспорт), бо вимагала резолвити файли PR і викликати двигун прямо в `routes.ts`. Переписано на сервісний метод + один виклик з роута (розділ 2.5).

---

## Файли, яких торкнемось поза `/mcp`

**Обов'язково, у складі L04:**

| Файл | Зміна |
|---|---|
| `.mcp.json` | новий, корінь; project scope, щоб студенти отримали сервер без ручних дій |
| `scripts/dev.sh` | один рядок `install_if_needed mcp` після рядка 76 |
| `.github/workflows/mcp.yml` | новий, за зразком `reviewer-core.yml`, фільтр шляхів лише на `mcp/**` |
| `scripts/repo-facts.sh` | **жорстко перелічує пакети** (`for p in server client reviewer-core e2e`, рядок 44), файли depcruise (рядки 86-87) і таблицю тестових лейнів (59-63). Треба додати `mcp` у всі три місця, інакше `.claude/repo-facts.md` мовчки пропустить новий пакет |
| `.claude/repo-facts.md` | перегенерувати після правки скрипта (`CLAUDE.md` цього вимагає при появі пакета, скрипта, модуля, контракту чи правила depcruise) |
| `CLAUDE.md` | "4 standalone packages" -> 5; додати `mcp/` у блок Map; додати рядок у "Read when…" |
| `AGENTS.md` (корінь) | те саме про кількість пакетів і менеджери |
| `README.md` | рядок `mcp/` у таблиці пакетів, перемикання L04 у таблиці уроків |
| `TESTING.md` | нова лінія: герметична `mcp` у CI + ручна `mcp/*.it.test.ts` |
| `server/src/vendor/shared/contracts/review-api.ts` **і** `client/src/vendor/shared/contracts/review-api.ts` | застарілий коментар стверджує, що рев'ю повертаються "once the (synchronous) run completes"; насправді `reviews` завжди порожній (`reviews/service.ts:133`). Обидві копії в одному кроці |

`.gitignore` чіпати не треба: `node_modules/` там глобальний.

**Домашка (L04 exercise), поза цим PR:**

| Файл | Зміна |
|---|---|
| `server/src/modules/repo-intel/service.ts` | новий метод `blastRadiusForPull(workspaceId, repoId, prNumber)` |
| `server/src/modules/repo-intel/routes.ts` | `GET /repos/:id/blast?pr=<number>` - zod + один виклик сервісу |
| `server/src/vendor/shared/contracts/*` + копія в `client/` | zod-схема відповіді роута; **не** плутати з наявним `BlastRadius` у `contracts/brief.ts:39` |
| `server/src/modules/reviews/routes.ts` | необов'язково: `GET /runs/:id` -> `{run_id, pr_id, status}`, після чого зникає обмеження `get_findings` за `run_id` |

---

## Верифікація наскрізь

```sh
# 1. герметично, без мережі й Docker
cd mcp && pnpm typecheck && pnpm arch:check && pnpm test && pnpm budget

# 2. сервер не зламано
cd server && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'

# 3. живий стек
./scripts/dev.sh --no-client
cd mcp && pnpm test:it
DEVDIGEST_API_URL=http://localhost:9 pnpm test:it   # повідомлення про dev.sh

# 4. реальний хост
claude mcp list        # devdigest: connected
# у свіжій сесії: /mcp показує 5 інструментів; викликати list_agents і get_conventions
```

Ручна перевірка, що коштує грошей і тому не автоматизується: `run_agent_on_pr` на засіданому `acme/payments-api` PR #482 - завершений шлях і шлях `wait_seconds: 10` -> `status: running`.
