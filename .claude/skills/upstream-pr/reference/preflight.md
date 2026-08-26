# Предполёт

Каждая проверка здесь стоит одного замечания, которое иначе прилетит в ревью и будет стоить
переигрывания ветки.

## 1. Наши гейты

```sh
npm run check          # должен выйти 0; включает lint, audit, size, changelog, a11y и остальные
```

Не входят в `check` и запускаются отдельно, когда правка их касается:
`npm run live` (нужен поднятый стенд), `npm run fork-drift`, `npm run upstream`.

## 2. Их eslint по нашим файлам

Апстримный конфиг перечисляет глобалы вручную и **не читает** прагму `'require X as Y'`, поэтому
он ругается на алиасы, которых нет в его списке. Это ловится локально:

```sh
cd /tmp/lintcheck && cp <изменённые .js> .
# конфиг с их набором глобалов, без плагинов
<репо>/node_modules/.bin/eslint --no-config-lookup -c ./eslint.config.mjs *.js | grep "is not defined"
```

Если предупреждение относится к алиасу — это дефект их конфига (24 из 30 алиасов дерева ему
неизвестны, задето 59 файлов в 18 пакетах), и ответ такой же. Если к настоящей опечатке — чинить.

## 3. Их правила формальностей

`.github/formalities.json` в клоне luci — машинный гейт, он висит перед сборкой:

| Правило | Значение |
|---|---|
| subject | ≤60 мягко, ≤80 жёстко |
| строка тела | ≤100 символов |
| тело | обязательно, и не должно повторять subject |
| `Signed-off-by` | обязателен, совпадает с автором |
| автор | имя и фамилия, не `@users.noreply.github.com` |
| ветка | не `master`/`main` |
| merge-коммиты, CRLF | запрещены |

Проверка своими руками перед пушем:

```sh
awk 'length > 75 {print FILENAME": "FNR": "length}' <файлы сообщений>
head -1 <файл> | wc -c      # ≤61 с учётом перевода строки
```

## 4. Шаблоны компилируются

Только на стенде — локально `ucode` нет.

```sh
owlab exec owrt2512 -- 'for f in $(find /usr/share/ucode/luci/template/themes/footstrap -name "*.ut"); do
  ucode -T -c -o /dev/null "$f" || echo "FAILS: $f"; done; echo done'
```

## 5. Живая проверка

Поведенческая правка не готова, пока не прогнана на **обоих** пакетных менеджерах:

```sh
owlab sync owrt2512 owrt2410
node tools/scroll-anchor.mjs --engines chromium,firefox,webkit   # если трогали fs-fit
npm run live -- --all                                            # общий обход
```

CSS доказывается computed-style или пиксельным диффом против прогона того же листа, не скриншотом:
живые счётчики дают 0.5–1.3% различий сами по себе.

## 6. Дрейф

```sh
./tools/sync-luci-fork.sh ../luci-fork && npm run fork-drift
```

Легитимно отличаются только `Makefile` (правится на той стороне вручную), `po/` (Weblate) и
`cascade.css` (собирается здесь, коммитится там). Всё остальное в списке DRIFT — это либо
неотправленная правка, либо забытый синк.

## 7. Размер

Понадобится, если спросят про вес пакета — спрашивали уже дважды.

```sh
node tools/size-budget.mjs --show      # разбивка JS по файлам, CSS, холодная страница
du -sb luci-theme-footstrap/ucode luci-theme-footstrap/htdocs/luci-static/resources
```

Доля комментариев в файле:

```sh
python3 -c "
import re,glob
tot=com=0
for f in glob.glob('luci-theme-footstrap/ucode/**/*.ut', recursive=True):
    s=open(f).read(); tot+=len(s); com+=sum(len(m) for m in re.findall(r'\{#.*?#\}', s, re.S))
print(f'{tot/1024:.1f} KB, comments {com/1024:.1f} KB ({100*com/tot:.0f}%)')"
```

## 8. Security review

Обязателен перед PR и перед релизом (`CLAUDE.md`), прогоняется по финальной ветке — `/security-review`.
Мейнтейнер спрашивал прямо; в последний раз находок не было.
Что проверять в первую очередь: цепочку подписи в `install.sh`, новые shell-скрипты, шаблон логина
(страница неаутентифицированная), sink-и в браузерном JS, изменения конвейера сборки.
