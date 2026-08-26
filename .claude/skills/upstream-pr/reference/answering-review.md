# Мониторинг и ответ на ревью

Правило `CLAUDE.md`: **сессия не пишет комментарии в апстрим-PR**. Замечание закрывается правкой
в диффе и пометкой треда resolved. Если что-то надо сказать человеку — текст готовится в чате,
отправляет его пользователь.

## Мониторинг

Один persistent-монитор на PR: комментарии, инлайны, новые ревью, смена состояния. Опрос раз в
минуту; id уже виденных ревью — в файле, иначе каждый цикл повторяет одно и то же.

```sh
gh api "repos/openwrt/luci/issues/<N>/comments?since=$last" --jq '.[] | "comment by \(.user.login): \(.body[0:400])"'
gh api "repos/openwrt/luci/pulls/<N>/comments?since=$last"  --jq '.[] | "inline by \(.user.login) on \(.path):\(.line): \(.body[0:400])"'
gh api "repos/openwrt/luci/pulls/<N>/reviews"               --jq '.[] | "\(.id)|review by \(.user.login) [\(.state)]: \(.body[0:300])"'
gh pr view <N> --repo openwrt/luci --json state --jq .state   # MERGED / CLOSED — можно снимать монитор
```

## Два вида ревью

### Бот (`openwrt-ai`) — разбираем сами

Не ждём пользователя. По каждому замечанию:

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
SHA=$(cd /tmp/luci-pr && git rev-parse HEAD)
until [ "$(gh api repos/openwrt/luci/commits/$SHA/check-runs --jq '[.check_runs[]|select(.status!="completed")]|length')" = "0" ]; do sleep 20; done
gh api repos/openwrt/luci/commits/$SHA/check-runs --jq '.check_runs[] | "\(.name): \(.conclusion)"'
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
