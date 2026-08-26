# Как собрать ветку

Апстрим держит только собранный `cascade.css`, а не `styles/`. Значит каждый коммит PR должен
нести свой кусок готового листа — то есть ветка собирается **переигрыванием** состояний нашего
дерева, а не переносом коммитов `main` как есть.

## Рабочие копии

| Путь | Что это |
|---|---|
| `.` | наш репозиторий, ветка `main` |
| `../tmp/fs-hist` | worktree нашего репозитория для переигрывания |
| `/tmp/luci-pr` | клон openwrt/luci; `origin` — апстрим, `fork` — наш форк |

```sh
git worktree add --detach ../tmp/fs-hist <точка>       # если worktree ещё нет
cd /tmp/luci-pr && git config user.name "Ivan Kvashonkin"   # иначе формальности завернут
```

## Шаг 1. Найти точку, где апстрим совпадал с нами

```sh
cd /tmp/luci-pr && git show origin/master:themes/luci-theme-footstrap/htdocs/luci-static/footstrap/cascade.css | md5sum
# затем в ../tmp/fs-hist перебрать кандидатов:
for c in $(git log --format=%h -25 -- luci-theme-footstrap/styles); do
  git checkout --quiet --detach $c && bash luci-theme-footstrap/build-css.sh >/dev/null 2>&1
  m=$(md5sum luci-theme-footstrap/htdocs/luci-static/footstrap/cascade.css | cut -d' ' -f1)
  [ "$m" = "<их md5>" ] && echo "MATCH $c"
done
```

## Шаг 2. Переиграть, пропуская ненужное

Ветка строится группами: `cherry-pick -n` нескольких коммитов, затем один `commit`. Так несколько
наших коммитов становятся одним апстримным — группируем по логике изменения, а не по тому, как
работа шла в нашем репозитории.

```sh
cd ../tmp/fs-hist && git checkout --quiet -B upstream-N <точка>
pick() { for c in "$@"; do git cherry-pick -n -x $c >/dev/null 2>&1 || {
  git diff --name-only --diff-filter=U | while read -r f; do git checkout --theirs "$f"; git add "$f"; done; }; done; }

pick <коммит> <коммит> && git commit --quiet -m g1
```

Приёмы, которые понадобились на практике:

- **выкинуть часть коммита** — после `pick` вернуть файл на место:
  `git checkout HEAD -- luci-theme-footstrap/styles/theme/45-misc.css`;
- **перенести часть в другую группу** — взять файл из нужного коммита:
  `git checkout <коммит> -- <файл>`;
- **пропустить коммит целиком** — просто не включать в `pick` (так выпали 23.05-коммиты);
- **правка комментария должна ехать с кодом, который она описывает** — иначе в серии видно, как
  один коммит вводит текст, а следующий его исправляет.

## Шаг 3. Сверить вершину с `main`

Перед нарезкой коммитов PR — обязательно, иначе в апстрим уедет не то, что проверено.

```sh
for f in htdocs/luci-static/resources/fs-fit.js htdocs/luci-static/resources/fs-appearance.js \
         htdocs/luci-static/resources/fs-overview.js htdocs/luci-static/resources/fs-router.js \
         ucode/template/themes/footstrap/sysauth.ut; do
  echo "$f: $(diff <(git show HEAD:luci-theme-footstrap/$f) \
    <(cd <репо> && git show HEAD:luci-theme-footstrap/$f) | wc -l)"
done
bash luci-theme-footstrap/build-css.sh >/dev/null 2>&1 && md5sum luci-theme-footstrap/htdocs/luci-static/footstrap/cascade.css
```

Все нули и совпадающий md5 — можно резать коммиты.

## Шаг 4. Нарезать коммиты PR

Для каждой точки: синк в клон luci, затем коммит с готовым сообщением.

```sh
cd /tmp/luci-pr && git checkout --quiet -B <ветка> origin/master && git reset --hard --quiet origin/master
i=1
for p in $(cd ../tmp/fs-hist && git log --format=%h --reverse <точка>..upstream-N); do
  (cd ../tmp/fs-hist && git checkout --quiet --detach $p && ./tools/sync-luci-fork.sh /tmp/luci-pr >/dev/null 2>&1)
  cd /tmp/luci-pr
  git checkout --quiet origin/master -- themes/luci-theme-footstrap/po   # Weblate владеет каталогами
  git add -A themes/luci-theme-footstrap
  git diff --cached --quiet || git commit --quiet -F <файл сообщения $i>
  i=$((i+1))
done
```

`po/` возвращается на каждом шаге не случайно: наши каталоги отличаются путями в комментариях,
и без этого они попадут в дифф.

## Шаг 5. Проверить дифф ветки

```sh
cd /tmp/luci-pr
git log --format="%h %s" --stat origin/master..HEAD | grep -E "^[0-9a-f]{7} |files? changed"
git diff --name-only origin/master..HEAD          # только шиппящиеся файлы, без po/ и Makefile
git log --format="%an <%ae>" origin/master..HEAD | sort -u
```

## Шаг 6. Публикация

```sh
git push --force-with-lease --quiet fork <ветка>
gh pr create --repo openwrt/luci --base master --head VizzleTF:<ветка> \
  --title "..." --body-file <файл>
```

Обновление существующего PR — тот же `push --force-with-lease` плюс, если состав изменился,
`gh pr edit <N> --body-file`.

## Грабли

- `luci.mk:` как префикс subject бот отвергает — нужен `treewide:`.
- Автор коммита обязан быть «Имя Фамилия»; `git config user.name` в `/tmp/luci-pr` по умолчанию
  берётся глобальный (`VizzleTF`) и заворачивается.
- `sync-luci-fork.sh` сам вырезает `/* fs:probe */`-экспорты — но только если рабочая копия,
  из которой идёт синк, содержит свежие `tools/sync-luci-fork.sh` и `strip-probes.sh`.
- `cascade.css` в апстриме лежит **неминифицированным** и **без манглинга токенов** — это
  осознанно: там дерево исходников, которое кто-то должен читать при ревью.
