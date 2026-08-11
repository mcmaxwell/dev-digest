# L04: Blast Radius + pre-push CLI

## Context

DevDigest рев'ює diff, але рев'юер не бачить, **що ще** цей diff може зачепити.
Змінених рядків для цього недостатньо: потрібні зв'язки між символами й файлами.

Blast Radius будує карту впливу: які символи оголошені у змінених файлах, хто їх викликає, і які HTTP-ендпоінти та крони стоять за тими викликачами.

Головне: **модель для цього не потрібна**. Усі факти вже лежать в індексі `repo-intel`. Фіча лише читає індекс і подає його зрозуміло.

Друга частина - CLI `devdigest review --mode working`, що переносить той самий рев'ю-процес у локальну робочу копію, до `git push`.

### Рішення, ухвалені до планування

1. **UI - картка на вкладці Overview**, сусід `IntentCard`, за макетом. Не окрема вкладка.
2. **Серверний модуль `blast/` з `GET /pulls/:id/blast`** за текстом завдання. Застаріла інструкція всередині `mcp/src/tools/get-blast-radius.ts` пропонує інший роут і має бути оновлена.
3. **Опційний LLM-підсумок - окремий `POST /pulls/:id/blast/summary`** за явною кнопкою. GET ніколи не викликає модель.
4. **Усе в одному PR**: сервер, UI, MCP-інструмент, CLI.
5. **CLI живе в `mcp/`, але рев'ю виконується на сервері** за новим ендпоінтом, що приймає сирий diff. `mcp/` механічно не може імпортувати `reviewer-core` (правило `mcp-is-standalone` + zod 4 проти zod 3). Перевикористання досягається на межі процесів.
6. **Контракт бере словник з `contracts/brief.ts`** (`ChangedSymbol`, `BlastCaller`, `DownstreamImpact`, `BlastRadius`), але **новим файлом** `contracts/blast.ts` - правило барелю забороняє редагувати наявні. Обидві фізичні копії.

---

## Перевірені факти

**Двигун уже є і мертвий.** `RepoIntelService.getBlastRadius` (`repo-intel/service.ts:220`), інтерфейс `types.ts:147`, геттер `container.ts:120`. Нуль виробничих викликачів; єдиний тест б'є лише degraded-гілку.

**Персистентний шлях - чиста БД.** `tryPersistentBlast` (`service.ts:315-391`) робить п'ять запитів і жодного читання клону, AST чи ripgrep. Це і є вимога «сервер не перебудовує індекс під час запиту».

**Degraded-фолбек читає клон** і ганяє ripgrep. Входить у нього, коли `repo_index_state` відсутній або має статус не `full`/`partial`.

**mermaid `^11.15.0` вже в клієнті**, разом з `client/src/components/mermaid-diagram/MermaidDiagram.tsx`, який ліниво імпортує бібліотеку, ставить `securityLevel: "strict"` і валідує через `mermaid.parse` перед рендером. Нова залежність не потрібна.

**`getResolvedCallers` має рівно одного викликача** (`service.ts:342`) - замінювати безпечно.

**`risk_brief` уже є в `FEATURE_MODELS`** (`contracts/platform.ts:63`), опис «assesses merge risks for a pull request». Підсумок впливу - це рівно воно.

**`agent_runs.pr_id` nullable**, але `reviews.pr_id` - ні.

### П'ять реальних проблем

1. **Кап 20 викликачів - глобальний, не на символ.** `service.ts:386` робить `slice(0, 20)` над усім пласким списком. Один гарячий символ з'їдає всі слоти. Завдання вимагає «20 на символ».
2. **Зворотного обходу графа не існує.** Індекс `file_edges_repo_to_idx (repo_id, to_file)` є, але єдиний читач `getEdges(repoId)` тягне **всю** таблицю ребер без предиката.
3. **Пастка часткового індексу.** `partial` через soft budget пропускає весь блок rank/graph/facts (`pipeline/full.ts:214-248`), а `getResolvedCallers` робить **INNER JOIN** на `file_rank` (`repository.ts:527`). Результат: `callers: []` при `degraded: false`. Рівно те, що завдання забороняє.
4. **`getResolvedCallers` без `LIMIT` і без `ORDER BY`** - повертає всі рядки.
5. **Крони ніколи не потрапляють у `impactedEndpoints`** - лише у `factsByFile`, і лише на персистентному шляху.

### Дешевий шлях до змінених файлів

`container.reviewRepo.getPrFiles(prId)` - один індексований SELECT по `pr_files`. Саме це робить `SmartDiffService`.
**Не** `PullsService.detail` (ходить у GitHub на кожен виклик) і **не** `loadDiff` (запускає справжній `git diff`).

---

## 1. Контракт: `contracts/blast.ts`

Новий файл в **обох** копіях + рядок у обох барелях.

Механічне обмеження: барель робить `export *` і над `brief.ts`, і над `blast.ts`, тому `blast.ts` **не має ре-експортувати жодне ім'я, яке імпортує** з `brief.ts`.

```
RankedBlastCaller = BlastCaller.extend({ rank })
BlastDownstream   = DownstreamImpact.extend({
                      callers: RankedBlastCaller[],
                      caller_total, endpoints_total, crons_total })   // до капу
PrBlastRadius     = BlastRadius.extend({ downstream: BlastDownstream[] })
BlastIndexStatus  = 'ok' | 'partial' | 'degraded'
BlastIndexReason  = 'none' | 'not_indexed' | 'index_failed' | 'index_degraded'
                  | 'stale_indexer' | 'no_rank' | 'soft_budget' | 'graph_failed'
                  | 'parse_errors' | 'index_partial'
BlastIndexState   = { status, reason, ranked, facts, graph,
                      last_indexed_sha, indexed_at }
PrBlastResponse   = { blast, summary: BlastSummaryMeta | null,
                      index, changed_files, computed_at }
```

Два свідомі рішення:

- **`rank` лишається на дроті.** MCP-інструмент уже рекламує параметр `min_rank`; викидання rank змусило б прибирати залочений параметр із бюджетованої схеми.
- **Жодного англійського речення на дроті.** `reason` це enum, клієнт мапить через `next-intl`, як уже працює `intent.status.*`. Речення від сервера неперекладне.

---

## 2. Сервер: новий модуль `blast/`

```
server/src/modules/blast/
  routes.ts       транспорт, 2 роути
  service.ts      class BlastService { constructor(private container: Container) }
  build.ts        ЧИСТА: (BlastResult, ReverseLevel[], FileFactsRow[]) -> PrBlastRadius
  status.ts       ЧИСТА: IndexHealth -> BlastIndexState
  prompt.ts       ЧИСТА: prompt для підсумку
  schemas.ts      zod structured-output для підсумку
  repository.ts   pr_blast_summary
  constants.ts    капи
```

Реєстрація одним імпортом + одним записом у `modules/index.ts`, чий коментар уже називає `blast` як майбутній модуль.

```
GET  /pulls/:id/blast          -> PrBlastResponse   (без override rate limit)
POST /pulls/:id/blast/summary  -> PrBlastResponse   (10/хв)
```

POST повертає **увесь конверт**, а не лише підсумок, щоб `setQueryData` засіяв повний кеш - трюк з `useDetectIntent`.

### Порядок операцій у сервісі - сам по собі критерій приймання

```ts
async get(workspaceId, prId) {
  const pull = await this.pullOr404(workspaceId, prId);          // ТЕНАНСІ ПЕРШИМ
  const health = await this.container.repoIntel.getIndexHealth(pull.repoId);
  const index = deriveIndexState(health);

  // ЖОРСТКИЙ ГЕЙТ. Коли індекс непридатний, повертаємо чесний порожній конверт
  // БЕЗ виклику getBlastRadius, бо його фолбек читає клон і запускає ripgrep.
  // Вимога «не перебудовувати індекс під час запиту» забезпечена тим, що ми
  // не входимо в гілку, а не надією, що в неї не зайдуть.
  if (index.status === 'degraded') return emptyEnvelope(index, pull);

  const files = (await this.container.reviewRepo.getPrFiles(prId)).map(f => f.path);
  if (files.length === 0) return emptyEnvelope(index, pull);

  const [blastResult, reverse] = await Promise.all([
    this.container.repoIntel.getBlastRadius(pull.repoId, files),
    this.container.repoIntel.getReverseImporters(pull.repoId, files, BFS_DEPTH),
  ]);
  const facts = await this.container.repoIntel.getFileFactsFor(pull.repoId, factFiles);
  return { blast: buildBlast(blastResult, reverse, facts, summaryRow?.text ?? ''), ... };
}
```

### Нові методи фасаду repo-intel

```ts
getIndexHealth(repoId): Promise<IndexHealth>        // repo_index_state + його stats jsonb
getReverseImporters(repoId, files, depth): Promise<ReverseLevel[]>
getFileFactsFor(repoId, files): Promise<FileFactsRow[]>
```

`IndexHealth` - чесна проєкція: `{ present, status, indexerVersion, lastIndexedSha, updatedAt, softBudgetReached, graphFailed, parseDegradedCount, ranked, edgesWritten, factsWritten }`.
Усі поля `stats` коерсяться захисно (`typeof x === 'number' ? x : 0`), бо це нетипізований jsonb.

### Виведення статусу (`blast/status.ts`, чиста, табличний тест)

Читає `IndexHealth`, **ніколи** `BlastResult.degraded`, бо той фіксує лише яка гілка коду відпрацювала.

```
!present                         -> degraded / not_indexed
status === 'failed'              -> degraded / index_failed
status === 'degraded'            -> degraded / index_degraded
indexerVersion < INDEXER_VERSION -> partial  / stale_indexer
ranked === 0                     -> partial  / no_rank
softBudgetReached                -> partial  / soft_budget
graphFailed !== null             -> partial  / graph_failed
parseDegradedCount > 0           -> partial  / parse_errors
status === 'partial'             -> partial  / index_partial
інакше                           -> ok       / none
```

Порядок навмисний: `ranked === 0` перевіряється **до** загального `index_partial`, бо це рівно той випадок, коли INNER JOIN тихо повертає нуль.

---

## 3. Кап на символ і мапінг фактів

### Виправлення глобального капу

`MAX_CALLERS_PER_SYMBOL` названий «на символ» і документований як `ORDER BY rank DESC LIMIT N`. Це **дефект, не контракт**: нуль виробничих викликачів, єдиний тест б'є іншу гілку. Правимо в джерелі.

**Новий метод `getResolvedCallersTopN`** замість `getResolvedCallers` (єдиний викликач перевірено):

```sql
SELECT from_path, to_symbol, line, rank FROM (
  SELECT r.from_path, r.to_symbol, r.line,
         coalesce(fr.rank, 0) AS rank,
         row_number() OVER (PARTITION BY r.to_symbol
                            ORDER BY coalesce(fr.rank,0) DESC, r.from_path, r.line) AS rn
  FROM "references" r
  LEFT JOIN file_rank fr ON fr.repo_id = r.repo_id AND fr.file_path = r.from_path
  WHERE r.repo_id = $1 AND r.decl_file = ANY($2) AND r.to_symbol = ANY($3)
) t WHERE t.rn <= $4
```

Два виграші понад `slice()`:

- **`LEFT JOIN`, не `INNER JOIN`** - проблема 3 виправлена в джерелі. Частковий індекс без `file_rank` тепер повертає викликачів (без рангу, впорядкованих за шляхом) замість тиші. Разом зі статусом `partial / no_rank` користувач бачить і реальних викликачів, і застереження.
- **`row_number() PARTITION BY to_symbol`** дає справжній top-N на символ одним індексованим запитом. Глобальний `ORDER BY rank DESC LIMIT n` заморив би низькоранговий символ. Заразом це проблема 4.

Плюс: `tryPersistentBlast` прибирає свій `slice`, degraded-шлях отримує кап (зараз у нього немає жодного), а `build.ts` групує й капить **незалежно**, тож модуль лишається коректним навіть якщо фасад зрегресує.

### Мапінг фактів на символ

Крони йдуть **виключно** через `factsByFile`. Для символу `S`, оголошеного у файлі `D`:

```
reachable(S) = { файли-викликачі S }              // з references, глибина 0
             ∪ importersOf(D) на рівні 1          // з file_edges
             ∪ importersOf(importersOf(D)) рівень 2

endpoints_affected(S) = ∪ facts[f].endpoints, f ∈ reachable(S)
crons_affected(S)     = ∪ facts[f].crons
```

Дві чесності, що йдуть і в коментар контракту, і в UI:

- **Атрибуція файлова.** Два символи з одного зміненого файла дістануть однакові набори ендпоінтів, бо `file_edges` це граф файлів. Вдавати інше було б вигаданою точністю.
- **Відсутній рядок `file_facts` означає «немає ендпоінтів і кронів», а не «не проіндексовано»** - пайплайн пише рядок лише за наявності хоча б одного факту. Різницю несе `index.facts`.

Символи з нулем викликачів **не викидаються**: «у цього символу немає відомого downstream» - це теж результат.

---

## 4. Двохрівневий зворотний BFS

**Не надлишковий.** Розглянемо `routes.ts -> service.ts -> repository.ts`. Якщо PR змінює функцію в `repository.ts`, `references` фіксує одне ребро: `service.ts -> тaFunction`. Ендпоінт живе в `routes.ts`, який ніколи не називає змінений символ. Викликачі глибини 1 його не бачать.

BFS також відновлює вплив, коли резолв `decl_file` провалився (`resolveReferences` ставить його лише за єдиного кандидата), бо ребро імпорту існує незалежно від резолву символу.

Чого він **не** додає: викликачів. Він живить тільки `endpoints_affected`/`crons_affected`. Ребро імпорту не доводить виклик.

Новий метод `getImporters(repoId, toFiles, limit)`:
```sql
SELECT DISTINCT from_file, to_file FROM file_edges
WHERE repo_id = $1 AND to_file = ANY($2) LIMIT $3
```
Їде на `file_edges_repo_to_idx`. `getEdges` лишається для пайплайна рангів, якому справді потрібні всі ребра.

BFS у JS, рівно `depth` раундтрипів, `visited` засівається змінами (цикли термінуються). Капи: `REVERSE_FANOUT_PER_LEVEL = 200`, `REVERSE_MAX_EDGES = 2000`, `depth = BFS_DEPTH = 2` (уже в константах).
Гард: при `health.edgesWritten === 0` BFS пропускається, а `graph_failed`/`soft_budget` пояснюють відсутні ендпоінти.

---

## 5. Клієнт

`page.tsx:174` тепер передає `repoId`, `repoFullName`, `headSha` у `OverviewTab`, який рендерить `<BlastRadiusCard>` **під** `<IntentCard>` (Intent виводиться з опису і має перевірятися першим).

```
_components/BlastRadiusCard/
  BlastRadiusCard.tsx   машина станів, ранні повернення
  BlastStats.tsx        чотири чипи: symbols / callers / endpoints / crons
  IndexNotice.tsx       банер partial + порожній стан degraded + CTA Re-analyze
  BlastTree.tsx         секція на змінений символ
  CallerRow.tsx         file:line, володіє рішенням лінк/не-лінк
  BlastGraph.tsx        лінивий mermaid
  toMermaid.ts          ЧИСТА: PrBlastRadius -> рядок діаграми
  ViewToggle.tsx  SummaryBlock.tsx  constants.ts  styles.ts  index.ts
```

Хук `client/src/lib/hooks/blast.ts` дзеркалить `hooks/intent.ts`: `blastKeys`, `usePrBlast` (useQuery), `useBlastSummary` (useMutation з `setQueryData` на успіх). Плюс рядок у барелі хуків.

### file:line - тут пастка

`MonoLink` без `href` рендерить **інертну кнопку з `cursor: pointer`**, а `client/src/vendor/ui/**` у do-not-touch.

**Лінкуємо на `index.last_indexed_sha`, не на `pr.head_sha`.** Рядки викликачів беруться з **індексу**, зібраного з клону на дефолтній гілці; їхні номери рядків валідні саме там. Викликачі живуть у незмінених файлах, тож внутрішнього diff-в'ю для них не існує - GitHub blob на проіндексованому коміті єдина коректна ціль. Змінені символи лінкуються на `head_sha` без рядка.

**Коли `repoFullName` порожній або sha порожній - рендеримо `<span>` з `title`, ніколи `MonoLink`.** Ніяких інертних кнопок.

### Граф - вантажимо, на mermaid

`toMermaid.ts` чиста, і саме там живе безпека: **синтетичні id вузлів** (`n0`, `n1`), ніколи з даних; мітки екрануються (лапки, бектіки, переноси, контрольні символи), клампляться до 40 символів; капи `GRAPH_MAX_SYMBOLS = 12`, `GRAPH_MAX_CALLERS_PER_SYMBOL = 6`. Нуль ребер - рендеримо `graph.empty`, не порожню рамку.

### Повідомлення

`client/messages/en/blast.json` **уже існує і мертвий**, з ключами `stat.*`, `view.*`, `callerCount`, `noDownstream`, `graph.*` - точно під макет. Заголовок картки бере наявний `brief.block.blast`. Додаються: `loading`, `errorTitle`, `emptyTitle/Body`, `notIndexedTitle/Body`, `reindex`, `symbolsCaveat`, `truncated`, `linkUnavailable`, гілка `index.*` з перекладом кожного `reason`, і гілка `summary.*`.

П'ять станів: loading (скелетон, заголовок не стрибає), error (retry), degraded (не проіндексовано + робочий CTA `useResyncRepoIntel`), empty (нуль символів + `symbolsCaveat`), populated.

---

## 6. Ендпоінт підсумку

`POST /pulls/:id/blast/summary`, 10/хв, повертає весь `PrBlastResponse`.

Модель: `resolveFeatureModel(workspaceId, 'risk_brief')` - реєстр уже має цей запис, редагувати `contracts/platform.ts` і UI налаштувань не треба.

Промпт годується **лише дайджестом**: символи, кількості викликачів, топ-5 файлів, ендпоінти, крони, рядок статусу індексу. **Ніякого дифу і вмісту файлів.**

**`blast/schemas.ts` мусить лишитися пласким `z.object`.** З кореневого `INSIGHTS.md`: це схема structured-output, а `z.discriminatedUnion` емітить `oneOf`, який моделі обробляють значно гірше. Перехресні правила йдуть у `superRefine`, що коштує щонайбільше один репромпт, бо `completeStructured` віддає issues назад моделі.

Суміжна пастка звідти ж, актуальна для `contracts/review-diff.ts`: `Finding` це `FindingShape.superRefine(...)`, тобто `ZodEffects` **без `.extend`**. Якщо відповіді дифу знадобиться розширити finding, будувати треба від `FindingShape` і повторно накладати refinement.

**Безпека:** `wrapUntrusted` експортований з reviewer-core, але `INJECTION_GUARD` додається лише всередині `assemblePrompt`, якого цей шлях не викликає - **гард треба додати явно тут**. Тест: символ з іменем `</untrusted>` не може закрити блок.

Вивід клампиться до 400 символів на сервері. Зберігається в новій таблиці `pr_blast_summary` (`pr_id` PK, `text`, `head_sha`, `indexed_sha`, `provider`, `model`, `generated_at`). **`stale` виводиться на читанні**, не колонка: `row.head_sha !== pull.headSha || row.indexed_sha !== health.lastIndexedSha` - ловить обидва способи зіпсуватися. Патерн `pr_intent`.

Рядка в `agent_runs` немає - з тієї ж причини, що документує `IntentService`.

**Лінія відрізу, якщо PR треба стиснути:** прибрати таблицю і віддавати підсумок лише в кеш React Query. Втрачається на перезавантаженні, решта без змін.

---

## 7. MCP-інструмент

Схема переформовується під згруповану відповідь, чотири властивості верхнього рівня:

```
changed_symbols: [{ name, file, kind }]
downstream:      [{ symbol, callers: [{ name, file, line, rank }],
                    endpoints_affected, crons_affected }]
summary:         string
index_status:    'ok' | 'partial' | 'degraded'      // замість degraded: boolean
```

`index_status` коштує стільки ж, а несе більше: `partial` - це рівно той випадок, який булеан не виражав, і в якому модель інакше прочитала б порожній `callers` як «ніхто не викликає».

Лічильники обрізання (`caller_total`) свідомо **не** в схемі, а в тілі тексту: схема оподатковується щосесії, текст результату - ні.

**Кожне числове поле отримує явний `.max()`.** З `mcp/INSIGHTS.md`: `z.number().int()` без верхньої межі емітить у рекламовану схему `"maximum": 9007199254740991`. Це видимий шум у промпті моделі і зайві токени на кожному полі. Тут таких полів чотири (`line`, `rank`, і два в параметрах), тож межі ставимо реальні: `line` до 1_000_000, `rank` 0..1.

Новий опис (272 символи, транскрибується в `tools-list.test.ts` тим самим комітом):
> Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints and cron jobs sit behind those callers. Reads a prebuilt index, costs nothing, and reports when that index is partial so missing callers are never mistaken for none.

`BLAST_RADIUS_HOMEWORK` видаляється, що повертає токени. Зараз 524 з 1571 при бюджеті 2500 і смузі 2200; вкладена `downstream` додасть 150-250. **Крок 8 міряє бюджет до написання хендлера.** Якщо перетне 2200, ріжемо в порядку: `kind`, опис `rank`, друге речення опису.

Три пастки в параметрах:
- `max_callers` ріже **на символ**, і текст каже скільки приховано;
- `min_rank` при `index.ranked === false` дав би порожнечу - хендлер **ігнорує його і каже про це**;
- `include_endpoints: false` **обнуляє масив, а не прибирає ключ**, інакше валідація `structuredContent` проти `outputSchema` впаде.

Кожен рядок з чужого репо (імена символів, шляхи) йде через `clip()` - критерій 13 з `routing.md`.

---

## 8. CLI і ендпоінт дифу

### Експозиція

`mcp/package.json` отримує `bin`: `devdigest-mcp` і новий `devdigest`. `mcp/bin/devdigest` - bash-лаунчер за зразком наявного, але execs `src/cli/main.ts`.

**Окремий файл входу, не гілка в `src/index.ts`.** Той модуль викликає `serveStdio` на верхньому рівні, і весь його контракт - «stdout це канал JSON-RPC». CLI, що друкує в stdout, не має ділити з ним модуль: один рефакторинг з `console.log` зламає `initialize` кожної MCP-сесії. Два файли, два контракти stdout, нуль умов.

Після приземлення CLI прогнати дешеву перевірку з `mcp/INSIGHTS.md`, яка доводить, що stdio-сервер не зачепило:
```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
  | ./bin/devdigest-mcp 2>/dev/null | wc -l     # має бути рівно 1
```

```
mcp/src/cli/
  main.ts   argv -> dispatch -> exit. ЄДИНИЙ файл, що друкує або виходить
  args.ts   ЧИСТА  help.ts  git.ts (execFile)  modes.ts  render.ts  exit.ts
```

Два нові правила depcruise: `cli-goes-through-the-api-port` і `cli-does-not-import-the-mcp-server`.
`node:child_process` дозволений (його немає в забороненому списку), `simple-git` - ні, звідси `execFile`.

**Обидва правила перевіряються на непорожність до того, як їм довіряти** - за записом у `mcp/INSIGHTS.md`: кинути тимчасовий `src/cli/_probe.ts`, що імпортує `../api/http.js`, прогнати `pnpm arch:check`, переконатися, що помилка називає правило, видалити пробу. Правило, яке не спрацьовує, гірше за відсутнє: воно дає хибне відчуття покриття.

### git

Тільки `execFile`, ніколи `exec`, ніколи шел. `maxBuffer: 64MB` (дефолтний 1MB тихо ріже справжній diff, що дало б рев'ю неповного дифу і впевнений pass), `timeout: 30s`.
Корінь: `git rev-parse --show-toplevel`. Diff: `git diff HEAD --no-color --no-ext-diff -U3 --`; **`--no-ext-diff` критичний**, бо локальний `diff.external` у клонованому репо інакше виконає довільну програму.

### Невідстежувані файли: виключаємо, голосно

`.env.local`, `credentials.json` і чернетки не відстежуються **за задумом**, а ця команда шле вміст у хостовану модель. Включити їх означає перетворити «перевір мою роботу» на «залий мої невідстежувані секрети».

Тихе виключення було б справжнім провалом, тому: сказано в `--help`, названо на **stderr** при кожному запуску («3 untracked file(s) were NOT reviewed... run `git add <file>` to include it»), і винесено в `untracked_excluded` при `--format json`.

### Коди виходу - контракт

```
0  рев'ю пройшло, нічого на рівні --fail-on або вище
1  рев'ю пройшло, є блокувальні знахідки
2  рев'ю НЕ вдалося виконати: API недоступний, таймаут, агент не знайдений, помилка LLM
3  помилка вжитку: невідомий прапорець, нереалізований режим, не всередині git-репо
4  нічого рев'ювати: немає змін у відстежуваних файлах
```

`2` окремо від `1`, бо хук має падати закрито на інфраструктурній помилці, а людині треба відрізняти «рев'юер каже ні» від «рев'юер не запускався». `4` окремо від `0`, бо хук на чистому дереві не має рапортувати успішне рев'ю. Усі п'ять у `exit.ts` як enum, друкуються в `--help`, і тест це стверджує.

`--mode` дефолтиться на `working`; `staged` і `branch` парсяться чисто і виходять з кодом 3 «not implemented». Реєстр `MODES` робить додавання режиму одним записом без змін у `main.ts`.

### `POST /reviews/diff`

Живе в `server/src/modules/reviews/` (перевикористовує `resolveTargets`, двигун і гейт заземлення), виконавець у новому `reviews/diff-review.ts`. Контракт - новий `contracts/review-diff.ts`, обидві копії.

Запит: `{ diff (1..400_000 симв.), agent?, severity_min?, fail_on?, source }`.
Відповідь: `{ verdict, summary, score, findings, blockers, grounding, dropped, agent, usage, files_reviewed }`.

Викликає `reviewPullRequest` з `@devdigest/reviewer-core`. **Безпеку додавати не треба**: `assemblePrompt` уже додає `INJECTION_GUARD` і загортає diff у `wrapUntrusted`, а `groundFindings` працює всередині двигуна - кожна знахідка мусить цитувати реальний хунк саме цього дифу. `--repo` і slug агента у промпт **не потрапляють узагалі**.

**Не персистить нічого.** `reviews.pr_id` це `notNull`, тож рядок рев'ю без PR неможливий. `agent_runs.pr_id` nullable, але індекс `(pr_id, ran_at)` і всі читачі фільтрують по `pr_id`: рядок із null був би невидимий в UI, але роздував би майбутні підрахунки вартості. SSE-споживача немає (CLI блокується на відповіді), тож уся машинерія прогонів нічого не купує. Відповідаємо синхронно, спостережуваність через `usage` і один структурований лог.

**Що промпт втрачає:** без рядка `repos` немає `callersDigest`, `repoMap`, `rankNote`, `intent`, `prDescription`. Лишається: системний промпт агента, його скіли, diff, injection guard, фільтр скоупу і гейт цитування. Прийнятно: збагачення підвищують точність на PR-масштабі, а робоче дерево - маленька локальна зміна, і те, що робить знахідки довіреними, недоторкане. Сказано в `--help`.

Rate limit `4/хв` (жорсткіше за 10/хв у PR-роуті, бо цей досяжний з git-хука, що спрацьовує на кожен push), `bodyLimit: 2MB`, zod-межа 400k символів, кап 200 файлів. Це вся історія стримування, і вона має приїхати тим самим комітом, що й роут.

---

## 9. Тести

**server герметичні:** `blast-status.test.ts` (уся таблиця виведення - це і є критерій «порожній масив не маскує брак даних»), `blast-build.test.ts` (кап на символ: 21 на A + 5 на B дає 20+5, ніколи 20 разом; крон доходить до `crons_affected`; файл без `file_facts` дає порожні масиви, не помилку), `blast-reverse-bfs.test.ts` (зупинка на глибині 2, термінація циклу, кап), `blast-prompt.test.ts`, `diff-review.test.ts`.

**server інтеграційні:** `blast.it.test.ts` засіває `repo_index_state`, `symbols`, `references`, `file_rank`, `file_facts`, `file_edges` для PR #482 і перевіряє: `PrBlastResponse.parse` **клієнтською копією контракту** (дрейф падає тут); ендпоінт, досяжний **лише через ребро глибини 2**; PR чужого воркспейсу дає 404 (доводить, що `pullOr404` перший); відсутній `repo_index_state` дає 200 з `not_indexed`, **не 500**, зі шпигуном, що `codeIndex` не чіпали; `partial` без `file_rank` усе одно повертає викликачів.

**client RTL:** усі п'ять станів; **`repoFullName: null` -> текст `file:line` є, а `queryByRole('button')` порожній** (немає інертної кнопки); `href` містить `last_indexed_sha`, а не `headSha`; `toMermaid` тестується **як чиста функція**, символ з іменем `A"];click B` не з'являється дослівно.

**mcp герметичні:** переписаний `get-blast-radius.test.ts` на фікстурі; `include_endpoints: false` **обнуляє, а не прибирає** ключ; `structuredContent` валідується проти `outputSchema`; `render.test.ts` отримує кейс підробки рядків для імені символу; `cli-args/render/help.test.ts`, де `cli-help` стверджує наявність усіх п'яти кодів і речення про невідстежувані файли.

**Ручне, в тілі PR:** демо-PR, клік по кожному `file:line`, видалення `repo_index_state` (має бути стан «не проіндексовано», не спінер і не чотири нулі), `pnpm budget`, CLI на брудному дереві з невідстежуваним файлом і на чистому (код 4). Плюс демо-відео за критерієм приймання.

---

## 10. Порядок кроків

| # | Крок | Перевірка |
|---|---|---|
| 1 | обидва контракти, обидві копії, обидва барелі | `pnpm typecheck` у server і client; `scripts/pr-self-review-checks.sh` (він діфає копії) |
| 2 | repo-intel: `IndexHealth`, `getImporters`, `getResolvedCallersTopN`, фікс капу | `pnpm test -- repo-intel && pnpm arch:check` |
| 3 | `blast/status.ts` + `build.ts` + їхні чисті тести | `pnpm test -- blast` |
| 4 | `pr_blast_summary` у схемі, далі `pnpm db:generate` (ніколи не правити руками) | `pnpm db:migrate` |
| 5 | решта `blast/` + запис у реєстрі | `pnpm arch:check && pnpm test` |
| 6 | `blast.it.test.ts` | `pnpm test:it -- blast` |
| 7 | `POST /reviews/diff` з усім стримуванням в одному коміті | `pnpm test && pnpm test:it -- diff-review` |
| 8 | MCP: схема + опис, **бюджет міряється тут** | `cd mcp && pnpm budget && pnpm test -- tools-list` |
| 9 | MCP: хендлер, парсери, рендер, видалення homework | `cd mcp && pnpm typecheck && pnpm arch:check && pnpm test && pnpm budget` |
| 10 | CLI: bin, `src/cli/*`, два правила depcruise | `cd mcp && pnpm arch:check && pnpm test`; вручну `./bin/devdigest review --help` |
| 11 | клієнт: хук, повідомлення, картка, проброс пропсів | `cd client && pnpm typecheck && pnpm lint && pnpm test` |
| 12 | доки + INSIGHTS (нижче), `scripts/repo-facts.sh` | `bash scripts/repo-facts.sh` |

Крок 12 конкретно: `mcp/AGENTS.md` містить речення, що довгий навчальний текст живе «в тілі заглушки `get_blast_radius`» - після цієї роботи воно стає неправдою і має бути переписане на `src/format/errors.ts`. Той самий запис є в `mcp/INSIGHTS.md`; за правилами скіла до нього дописується датована підправка, а не переписується старий. Плюс рядок про п'яту таблицю в `repo-intel/README.md`, де `getBlastRadius` досі позначений як «used by L04», хоча стане справді вжитим.

Кроки 1-6 - критичний шлях. Кроки 7+10 (CLI) і 11 (клієнт) незалежні між собою після кроку 1 і паралеляться.

---

## 11. Ризики

- **Двигун blast має нуль виробничих викликачів.** Будь-який латентний баг у `tryPersistentBlast` спливе вперше саме тут. Пом'якшення - крок 6 засіває справжні рядки, а не довіряє гілці коду.
- **Індекс будується на SHA дефолтної гілки, не на голові PR.** Символи, які PR **додає**, невидимі; символи, які **видаляє**, ще показують викликачів. Не лікується без індексації гілки PR, це поза обсягом. Виноситься в копію `symbolsCaveat` і коментар контракту, не ховається.
- **`row_number() OVER` - перша віконна функція в цьому репо.** Перевірити, що Drizzle правильно біндить `= ANY($n)` для масивів тексту; шаблон сирого `sql` уже вживається в `resolveReferences`. Запасний варіант: два запити з документованим застереженням про заморювання.
- **Токен-бюджет - жорсткий гейт на переформування MCP-схеми.** Крок 8 міряє до роботи над хендлером, поки різати дешево.
- **`POST /reviews/diff` - єдиний ендпоінт, що витрачає гроші без рядка PR.** Ліміт 4/хв, кап тіла 2MB, межа 400k і кап 200 файлів - це вся історія стримування.
- **Мітки mermaid беруться з чужого репо.** Синтетичні id + екранування + клампи, тестовані на чистому білдері, а не через рендерер.

---

## 12. Що взято з наявних INSIGHTS і попереднього плану

`CLAUDE.md` вимагає читати `AGENTS.md` і `INSIGHTS.md` торкнутого модуля на старті задачі. Ось що звідти реально змінило цей план, щоб при виконанні це не переоткривали:

| Джерело | Що застосовано |
|---|---|
| `mcp/INSIGHTS.md` | явний `.max()` на числових полях схеми (інакше `9007199254740991` у промпті); перевірка непорожності нових правил depcruise пробним файлом; однорядкова перевірка stdio після додавання CLI; `InMemoryTransport.createLinkedPair()` як харнес; транскрипція описів окремо від коду |
| кореневий `INSIGHTS.md` | LLM-схеми лишаються пласким `z.object` (discriminatedUnion дає `oneOf`, гірший для моделей); `FindingShape.superRefine` не має `.extend`; `PATH` з nvm v22 у кожному виклику; L02-урок «гард стану має жити в сервісі, а не в роуті» - тут це жорсткий гейт `degraded` у `BlastService`, не в `routes.ts` |
| попередній план L04 | токен-бюджет міряється **до** написання хендлера; асиметрія «опис оподатковується щосесії, тіло помилки - ні»; структурний гейт (без `anyOf`/`oneOf`/`$ref`, ≤8 параметрів, ліміти довжин); правило двох копій контрактів; звірка з `onion-architecture` |
| `pr-self-review` критерій 13 | кожен рядок з чужого репо (імена символів, шляхи, ендпоінти) йде через `clip()` перед потраплянням у результат MCP-інструмента |
| проба SDK | `include_endpoints: false` **обнуляє** масив, а не прибирає ключ, інакше валідація `structuredContent` проти `outputSchema` падає |
| L02-ретроспектива | shell-ін'єкція була справжнім critical у тому уроці, тому CLI ходить лише через `execFile`, ніколи `exec`, ніколи через шел |

Одна річ із `mcp/INSIGHTS.md` навмисно **не** застосовується: відкрите питання про `GET /runs/:id`, яке зняло б обмеження `run-index.ts`. Це бонус попереднього уроку, він не стосується blast radius, і тягнути його сюди означало б розмити обсяг.

---

## 13. Верифікація наскрізь

```sh
# сервер
cd server && pnpm typecheck && pnpm arch:check && pnpm test
cd server && pnpm exec vitest run .it.test --no-file-parallelism

# клієнт
cd client && pnpm typecheck && pnpm lint && pnpm test

# mcp + CLI
cd mcp && pnpm typecheck && pnpm arch:check && pnpm test && pnpm budget

# живий стек
./scripts/dev.sh
# імпортувати acme/payments-api, Re-analyze, відкрити PR #482:
#   картка поруч з Intent, ненульові чипи, клік по file:line відкриває
#   GitHub на проіндексованому коміті, «Summarize impact» дає одне речення
./scripts/mcp.sh enable   # і в новій сесії викликати get_blast_radius

# CLI
./mcp/bin/devdigest review --mode working   # брудне дерево: знахідки + нота про untracked
echo $?
./mcp/bin/devdigest review --mode working   # чисте дерево: код 4
```
