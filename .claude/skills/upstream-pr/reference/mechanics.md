# Как собрать ветку

Апстрим держит только собранный `cascade.css`, а не `styles/`. Значит каждый коммит PR должен
нести свой кусок готового листа — то есть ветка собирается **переигрыванием** состояний нашего
дерева, а не переносом коммитов `main` как есть.

## Рабочие копии

| Путь | Что это |
|---|---|
| `.` | наш репозиторий |
| `../tmp/fs-hist` | worktree нашего репозитория для переигрывания |
| `../tmp/luci-pr` | клон openwrt/luci, один на все PR; `origin` — апстрим, `fork` — наш форк |

**Источник — последний релизный тег темы** (`git describe --tags --abbrev=0`), не `main`: в апстрим
едет то, что выпущено.

```sh
git worktree add --detach ../tmp/fs-hist $(git describe --tags --abbrev=0)   # если worktree ещё нет
LUCI=$(cd ../tmp/luci-pr && pwd)                  # дальше путь к клону — только через $LUCI
git -C $LUCI config user.name "Ivan Kvashonkin"   # иначе формальности завернут
git -C $LUCI checkout --quiet -B <ветка> origin/master   # переиспользование клона: -B, не новый clone
```

## Шаг 1. Найти точку, где апстрим совпадал с нами

Сравниваются **все шиппящиеся файлы**, а не один `cascade.css`: он совпадает и при разошедшихся
JS и шаблонах. Кандидаты — релизные теги, от новых к старым. Для каждого: синк в чистый
`origin/master`-checkout и `git status` по теме. Git сравнивает blob-SHA, поэтому пустой вывод
значит «каждый файл совпал»; `Makefile` и `po/` ведутся там отдельно и из сверки исключены.

```sh
for t in $(git tag --sort=-creatordate | head -10); do
  git -C $LUCI reset --quiet --hard origin/master
  git -C ../tmp/fs-hist checkout --quiet --detach $t
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null 2>&1)
  n=$(git -C $LUCI status --porcelain -- themes/luci-theme-footstrap ':!themes/luci-theme-footstrap/Makefile' ':!themes/luci-theme-footstrap/po' | wc -l)
  echo "$t: $n файлов расходятся"
done
```

Первый тег с нулём — точка. Если нуля нет, берётся тег с минимумом: его список
(`git status --porcelain`) показывает, что апстрим поправил сам, и это переносится в нашу сторону
до переигрывания.

## Шаг 2. Переиграть, пропуская ненужное

Ветка строится группами: `cherry-pick -n` нескольких коммитов, затем один `commit`. Так несколько
наших коммитов становятся одним апстримным — группируем по логике изменения, а не по тому, как
работа шла в нашем репозитории.

```sh
cd ../tmp/fs-hist && git checkout --quiet -B upstream-N <точка>   # точка из шага 1
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

## Шаг 3. Сверить вершину с тегом

Перед нарезкой коммитов PR — обязательно, иначе в апстрим уедет не то, что проверено. Сверяется
**всё дерево темы** через `diff -r`, а не список файлов: новый файл не должен выпасть из проверки.
Эталон — синк тега в отдельную worktree клона.

```sh
git -C $LUCI worktree add --detach ../tmp/luci-ref origin/master      # если ещё нет
git -C ../tmp/fs-hist checkout --quiet --detach $(git describe --tags --abbrev=0)
(cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $(cd ../tmp/luci-ref && pwd))
diff -r -x Makefile -x po ../tmp/luci-ref/themes/luci-theme-footstrap $LUCI/themes/luci-theme-footstrap && echo "вершина == тег"
```

`$LUCI` стоит на вершине ветки PR. Пустой вывод — можно резать коммиты. `sync-luci-fork.sh` сам
падает (exit 1), если режим файла не совпал с индексом нашего репо, если вырезание проб оставило
двойную пустую строку и если в шиппящемся файле осталась ссылка за пределы дерева (`../tmp/`,
`tools/`, `tests/`, стенды, `issue #N`, хеш коммита) — его вывод читается целиком.

## Шаг 4. Нарезать коммиты PR

Для каждой точки: синк в клон luci, затем коммит с готовым сообщением.

```sh
git -C $LUCI checkout --quiet -B <ветка> origin/master      # -B пересоздаёт ветку с нуля
i=1
for p in $(git -C ../tmp/fs-hist log --format=%h --reverse <точка>..upstream-N); do
  git -C ../tmp/fs-hist checkout --quiet --detach $p
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null) || break   # ошибки гарда — в stderr
  git -C $LUCI checkout --quiet origin/master -- themes/luci-theme-footstrap/po   # Weblate владеет каталогами
  git -C $LUCI add -A themes/luci-theme-footstrap
  git -C $LUCI diff --cached --quiet || git -C $LUCI commit --quiet -F <файл сообщения $i>
  i=$((i+1))
done
```

`po/` возвращается на каждом шаге не случайно: наши каталоги отличаются путями в комментариях,
и без этого они попадут в дифф.

## Шаг 5. Проверить дифф ветки

```sh
cd $LUCI
git log --format="%h %s" --stat origin/master..HEAD | grep -E "^[0-9a-f]{7} |files? changed"
git diff --name-only origin/master..HEAD          # только шиппящиеся файлы, без po/ и Makefile
git diff --check origin/master..HEAD
git log --format="%an <%ae>" origin/master..HEAD | sort -u
```

## Шаг 6. Публикация

Только по слову мейнтейнера: PR создаёт и пушит сессия, но не раньше его «пушь» и «создавай».

```sh
git push --force-with-lease --quiet fork <ветка>   # run_in_background: один раз занял больше 120 с
gh pr create --repo openwrt/luci --base master --head VizzleTF:<ветка> \
  --title "..." --body-file <файл>
```

Обновление существующего PR — тот же `push --force-with-lease` плюс, если состав изменился,
`gh pr edit <N> --body-file`.

## Грабли

- `luci.mk:` как префикс subject бот отвергает — нужен `treewide:`.
- Автор коммита обязан быть «Имя Фамилия»; `git config user.name` в клоне по умолчанию
  берётся глобальный (`VizzleTF`) и заворачивается.
- `sync-luci-fork.sh` сам вырезает `/* fs:probe */`-экспорты — но только если рабочая копия,
  из которой идёт синк, содержит свежие `tools/sync-luci-fork.sh` и `strip-probes.sh`.
- `cascade.css` в апстриме лежит **неминифицированным** и **без манглинга токенов** — это
  осознанно: там дерево исходников, которое кто-то должен читать при ревью.
