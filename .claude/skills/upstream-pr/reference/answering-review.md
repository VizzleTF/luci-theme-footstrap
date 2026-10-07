# Мониторинг и ответ на ревью

Правило `CLAUDE.md`: **сессия не пишет комментарии в апстрим-PR**. Замечание закрывается правкой
в диффе и пометкой треда resolved. Если что-то надо сказать человеку — текст готовится в чате
и отдаётся мейнтейнеру, отправляет его он.

## Мониторинг

Один наблюдатель на PR — `tools/pr-watch.sh`, в фоне (`run_in_background` или `tools/bg.sh`):

```sh
tools/bg.sh tools/pr-watch.sh <N> --seen ../tmp/pr-<N>.seen
```

Он опрашивает `gh api` раз в минуту, дедуплицирует события по id в seen-файле, ключует CI по SHA
головы (force-push обнуляет), собирает пачку и завершается, когда пришло ревью (человека или бота),
комментарий или сменилось состояние PR (`MERGED`/`CLOSED`). Падение отдельной проверки CI его не
будит: результат CI приходит строкой в следующей пачке. После завершения прочитать пачку и запустить
наблюдателя снова. `git push` в рецептах идёт в фоне — один раз он занял больше 120 с.

## Два вида ревью

### Бот (`openwrt-ai`) — разбираем сами

Не ждём пользователя. **Замечания только к комментариям применяются дословно**: текст предложения
бота идёт в диф как есть. Любое отклонение от него показывается мейнтейнеру в форме «бот
предлагает X / я предлагаю Y» с цитатой предложения. По каждому замечанию:

1. **Проверить измерением, право ли оно.** Бот ошибается заметно чаще человека: он жаловался, что
   `text-overflow: ellipsis` ничего не делает, хотя `white-space: nowrap` приходит из base; он же
   нашёл настоящую регрессию в селекторе подписей графиков.
2. Настоящую ошибку — починить сразу, в том же заходе.
3. Ложную — не чинить, зафиксировать в ответе пользователю одной строкой, почему.
4. Треды закрыть — **только те, что действительно исправлены или доказательно опровергнуты**.

### Человек — уведомление и вердикт

1. Отправить пользователю уведомление, что пришло ревью от живого мейнтейнера.
2. Прочитать целиком, не по обрезанному уведомлению.
3. Разобрать по пунктам и дать вердикт по каждому: делаем / это ошибка ревьюера, вот почему /
   требует решения пользователя.
4. Правки — после его слова, если пункт спорный; очевидные — сразу.

## Команды

```sh
gh api repos/openwrt/luci/pulls/<N>/comments --jq '.[] | "=== \(.path):\(.line // .original_line)\n\(.body)"'
gh api repos/openwrt/luci/pulls/<N>/reviews  --jq '.[] | "=== \(.user.login) [\(.state)]\n\(.body)"'
```

Открытые треды и закрытие:

```sh
gh api graphql -f query='query { repository(owner:"openwrt", name:"luci") {
  pullRequest(number:<N>) { reviewThreads(first:30) { nodes { id isResolved path line
    comments(first:1){nodes{body}} } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | "\(.id)|\(.path):\(.line)"'

gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input:{threadId:$id}) { thread { isResolved } } }' -f id="<THREAD_ID>"
```

CI после пуша:

```sh
gh api repos/openwrt/luci/commits/$(git -C ../tmp/luci-pr rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'
```

## Заготовки ответов

Отдаются пользователю в чат, отправляет он.

**Про `'prefs' is not defined`**

> That is an `eslint.config.mjs` defect: it does not read the `'require X as Y'` pragma, so every
> aliased require reports as undefined — 24 of the 30 aliases in the tree, 59 files across 18
> packages. The fix belongs there; I can send it as a separate PR.

**Про security review**

> Yes — the branch diff was reviewed: the installer's signature chain, the new shell script, the
> login template, the browser JS and the build pipeline. No findings.

**Про совместимость со старьём**

> Dropped — the theme targets 24.10 and newer now. A 23.05 router gets the pinned last release that
> runs on it, verified by the same signature and digest as any other artifact.

## Чего не делать

- Не резолвить тред, который не исправлен, — даже «объяснив» его.
- Не спорить с позицией «мы апстрим»: просят убрать совместимость или вынести правку в отдельный
  PR — дешевле сделать. Оба раза это заняло часы и было принято.
- Не переоткрывать PR ради переделки формы: `push --force-with-lease` в ту же ветку — норма.
  Закрывать стоит, только если меняется сам предмет PR.
