# Сборка, деплой и цикл разработки

## Два режима работы

1. **Быстрый цикл (без сборки)** — правим файлы прямо на роутере / scp с хоста.
   Тема — это шаблоны + статика; единственный шаг сборки — `build-css.sh`,
   который склеивает дерево `styles/` в `cascade.css` (только `cat`/`awk`,
   docs/17). Основной режим при разработке.
2. **Пакет .apk через SDK** — для распространения и чистой установки.

## Дев-роутеры: четыре контейнера, по одному на комбинацию

Стенд поднимает [owlab](https://github.com/VizzleTF/owlab) из `owlab.yaml` в корне
репозитория. Роутеров **четыре**, потому что различия, которые кусаются, —
рантаймовые, и одна коробка их не покажет. Осей три: пакетник (apk с 25.12, opkg
на 24.10), LuCI-фид (апстрим против форка) и релиз; четыре ящика покрывают все пары.

| id | дистрибутив | релиз | пакетник | LuCI |
|---|---|---|---|---|
| `owrt2512` | OpenWrt | 25.12.4 | apk | http://localhost:8025 |
| `owrt2410` | OpenWrt | 24.10.8 | opkg | http://localhost:8024 |
| `imm2512` | ImmortalWrt | 25.12.1 | apk | http://localhost:8026 |
| `imm2410` | ImmortalWrt | 24.10.6 | opkg | http://localhost:8027 |

```sh
owlab up                 # собрать и поднять все четыре
owlab sync --watch       # пересобирать CSS и заливать на каждую правку
owlab open owrt2512      # открыть LuCI в браузере
owlab doctor             # что умеет эта машина
```

Логин `root`, пароль пустой. Внутри — настоящий userland релиза (procd как PID 1,
netifd, ubus, rpcd, uhttpd) из его же rootfs-тарбола, а не самосборная имитация.

- **Обращение только через `localhost:<порт>`.** Адрес docker-моста маршрутизируется
  с хоста на нативном Linux и внутри WSL2, но не на Docker Desktop для macOS и
  Windows — поэтому ни одна команда не ходит по адресу моста, и стенд работает
  одинаково на любой ОС. Это же снимает старое требование «ssh и http на одном адресе».
- **Пересборка образа = сброс к заводским**: томов нет, `owlab up --rebuild`
  сносит залитую тему — гоняем `owlab sync` заново. Это и нужно: путь установки
  проверяется по-настоящему, на обоих пакетниках.
- **`curl` на них нет** — как и на стоковом роутере (см. `+luci-base` в CLAUDE.md),
  поэтому сниппет с curl запускаем с хоста по `localhost:<порт>`, а не
  `owlab exec owrt2512 -- 'curl …'`.
- **mwan3 и watchcat owlab гасит сам.** mwan3 считает dummy-WAN мёртвым и ставит
  `ip rule … blackhole`: LuCI отвечает, а весь исходящий трафик висит без ошибки.
  Страницы остаются, сервисы — нет.
- Железный роутер остался как `ssh router` — когда вопрос именно в железе.

## Быстрый цикл разработки на живом роутере

Целевые пути (см. док 01):

```
/usr/share/ucode/luci/template/themes/mytheme/{header.ut,footer.ut}
/www/luci-static/mytheme/cascade.css ...
/www/luci-static/resources/menu-mytheme.js
```

### Заливка

```sh
owlab sync                    # во все роутеры
owlab sync owrt2512           # в один
owlab sync --watch            # и дальше на каждую правку
```

`sync` кладёт файлы ровно туда, куда их положил бы `luci.mk`, и сбрасывает те же
кэши, что и его postinst. Что именно делается — в `owlab.yaml`:

- `build:` — пересобирает `cascade.css` из `styles/` (`build-css.sh --dev`,
  с комментариями) перед каждой заливкой. Без этого шага в дерево копируется всё,
  **кроме** файла, который LuCI и запрашивает, и роутер отдаёт 404 на собственный стиль;
- `install:` — маппинг каталогов пакета в пути роутера;
- `post_sync:` — регистрация темы (`luci.themes.Footstrap`) и снос легаси-каталогов.
  Это делается тут, а не через `root/etc/uci-defaults/30_luci-theme-footstrap`,
  потому что `sync` намеренно не перезаписывает `/etc/config` и `/etc/uci-defaults` —
  это состояние роутера, а не содержимое пакета;
- `theme: footstrap` — owlab выставляет `luci.main.mediaurlbase` после заливки.
  Установка пакета темы её только **регистрирует**; активную тему пакет не меняет,
  и на дев-стенде это ровно наоборот тому, что нужно.

Resource-JS копируется **глобом** (`htdocs/` целиком), а не списком имён: список был
багом — новый файл попадал в пакет (`luci.mk` копирует `htdocs/` целиком), но на
дев-роутер молча не доезжал и впервые проверялся уже после релиза.

Чего `sync` не делает в отличие от старого `dev-sync.sh`: не штампует `FS_VERSION`
(поповер покажет `dev`) и не компилирует `i18n/*.po` → `.lmo` — строки остаются
английскими. И то и другое делает настоящая сборка пакета (`owlab build`), где это
и надо проверять.

### Страховка от поломки

- Механизм fallback (док 01): если header.ut темы не компилируется, LuCI сам
  откатится на первую рабочую тему из `luci.themes` (bootstrap) и покажет
  индикатор "Theme fallback" с текстом ошибки. Т.е. кривой шаблон **не окирпичит
  веб-интерфейс**.
- Ручной откат в любой момент:
  `owlab exec owrt2512 -- 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'`
- Совсем всё сломалось: `uci` доступен по ssh, LuCI для восстановления не нужен.

### Кэши при итерации

- Меню/диспетчер кэшируются: `/tmp/luci-indexcache.<hash>.json`. Хэш считается от
  mtime файлов меню — при добавлении/удалении файлов обновляется сам, но при
  странностях: `owlab exec owrt2512 -- 'rm -f /tmp/luci-indexcache*'`.
- Шаблоны `.ut` НЕ кэшируются между запросами (ucode компилирует на лету) —
  правка header.ut видна по F5.
- CSS/JS кэширует браузер: жёсткий reload (Ctrl+Shift+R). `luci.js` грузится с
  `?v=<версия>-<mtime базы пакетов>`; в footstrap с тем же ключом грузится и
  `cascade.css` (`?v={{ pkgs_update_time }}` в `partials/head.ut`), поэтому после
  заливки CSS достаточно тронуть базу пакетов — ключ меняется, и файл подхватывается
  обычным F5, без Disable cache. **Какой это файл — зависит от релиза**, и фоллбэк ниже
  повторяет тот, что делает сам `pkgs_update_time` в luci-base: указать только apk-путь =
  на 24.10 ключ не меняется, файл доезжает, а браузер отдаёт старый из кэша — выглядит
  ровно как правка, которая ничего не сделала.
  ```sh
  owlab exec owrt2512 -- 'for db in /lib/apk/db/installed /usr/lib/opkg/status; do [ -f "$db" ] && touch "$db"; done'
  ```

### Проверка изменения

- **Шаблон** — тем же `trycompile`, что делает LuCI:
  `owlab exec owrt2512 -- 'ucode -T -c -o /dev/null /usr/share/ucode/luci/template/themes/footstrap/header.ut'`.
  То же гоняет CI.
- **CSS** — скриншотами проверять нельзя: живые счётчики (uptime, DHCP-лизы, сигнал wifi)
  двигают 0.5–1.3% пикселей между двумя прогонами ОДНОГО И ТОГО ЖЕ стиля, а реальная
  регрессия — 0.19%; сигнал под шумом. Дифф считается по computed-стилям: страница грузится
  один раз, `<link>` подменяется на второй файл, снимок `getComputedStyle` по всем элементам —
  DOM и данные те же, значит любая разница вызвана CSS.
  ```sh
  docker cp old.css owlab-luci-theme-footstrap-owrt2512:/www/luci-static/footstrap/cascade-a.css
  docker cp new.css owlab-luci-theme-footstrap-owrt2512:/www/luci-static/footstrap/cascade-b.css
  LUCI_PW=<pw> python3 .claude/skills/footstrap-audit/cssdiff.py \
    admin/network/firewall admin/system/system admin/status/overview admin/system/opkg
  ```

## Правка JS: комментарии бесплатны, regex-литералы — нет

JS минифицируется на **двух путях**. Релизная CI-сборка пре-минифицирует **terser**
(`tools/minify-js.mjs`, ~41 КБ — манглит идентификаторы) и выставляет `FOOTSTRAP_PREMIN=1`, что
переводит `LUCI_MINIFY_JS:=0`. Сборка **без** node (SDK-пользователь, buildbot) держит дефолтный
`1`, и `luci.mk` гонит **нетронутый исходник** через **jsmin** (`luci-base/src/jsmin.c`, он и так
на билдботе, ~57 КБ). Комментарии — ~60 % исходника JS, а uhttpd раздаёт `/www` **без сжатия**,
т.е. это байты и на проводе, и во флеше на обоих путях. Комментировать можно сколько угодно: в
пакет они не попадают. **jsmin-правило ниже остаётся обязательным для исходника** — фолбэк-путь
всё ещё гоняет jsmin.

Плата — одно правило, и оно про корректность, а не про стиль. jsmin решает, `/` это regex или
деление, по ОДНОМУ предыдущему символу из фиксированного списка (`( , = : [ ! & | ? + - ~ * / { } ;`).
Ни `n` (последняя буква `return`), ни `>` (из `=>`) в него не входят:

```js
return /^https?:\/\//i.test(a);     // jsmin принимает // за начало комментария, СЪЕДАЕТ
                                    // остаток файла и выходит с кодом 0
return (/^https?:\/\//i.test(a));   // `(` в списке — безопасно
```

Это не теория: openwrt/luci#8299, #8020, #8021, #8256. **Нулевой код возврата jsmin ничего не
доказывает** — порча молчаливая. Отсюда два гейта, оба в CI:

- eslint `wrap-regex` — запрещает саму форму (`npx eslint --fix` расставит скобки);
- `tools/jsmin-verify.mjs` — собирает тот же jsmin из коммита, закреплённого в
  `luci-upstream.pin`, минифицирует каждый уходящий в пакет файл и падает, если поток токенов
  (acorn) не совпал с исходником. Только он ловит порчу с exit 0.

Regex как **аргумент** (`s.replace(/x/g, y)`) уже стоит за `(` или `,` — безопасен. Бэктик
внутри `${…}` в шаблонной строке — тоже нельзя (jsmin теряет строку; падает громко).

## Сборка пакета .apk (OpenWrt 25.12 использует apk, не opkg)

> Автоматическая сборка (**GitHub Actions**, apk + ipk, релизы, `install.sh`,
> поддержка 24.10) вынесена в **docs/13**. Ниже — ручная сборка через SDK.

### Через owlab

```sh
owlab build                       # таргет берётся у первого роутера из owlab.yaml
owlab build --arch x86_64 --release 25.12.4
owlab install owrt2512 dist/luci-theme-footstrap-*.apk
```

Поднимает `openwrt/sdk` нужного релиза, подкладывает репозиторий как `src-link`-feed
**выше** официальных (иначе одноимённый пакет из апстрим-фида выиграет) и собирает.
Результат — в `dist/`.

Это не то же самое, что `sync`, и разница измерима: `luci.mk` держит
`LUCI_MINIFY_JS`/`LUCI_MINIFY_CSS` включёнными, поэтому настоящая сборка гонит
исходники через jsmin и csstidy. Замерено на этой теме — 120 358 байт из пакета
против 418 930 из `sync`. Код, который работает несжатым и ломается минифицированным,
не виден до сборки пакета; без этого шага его первым увидит пользователь.

На Apple Silicon это идёт под эмуляцией: все теги `openwrt/sdk` — `linux/amd64`,
апстрим публикует SDK только под Linux-x86_64. owlab предупреждает об этом до старта.

### Через SDK руками

Эти же шаги (скачать SDK, положить тему в feed, собрать) автоматизирует
`luci-theme-footstrap/build-apk.sh` — руками они выглядят так:

```sh
# SDK под таргет роутера (пример: mediatek/filogic 25.12.2)
wget https://downloads.openwrt.org/releases/25.12.2/targets/mediatek/filogic/\
openwrt-sdk-25.12.2-mediatek-filogic_gcc-*_musl.Linux-x86_64.tar.zst
tar --zstd -xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*/

# feeds (нужен luci ради luci.mk и luci-base)
./scripts/feeds update base luci
./scripts/feeds install -a -p luci

# положить тему внутрь feed'а luci
ln -s /path/to/repo/luci-theme-footstrap feeds/luci/themes/luci-theme-footstrap
./scripts/feeds update -i luci && ./scripts/feeds install luci-theme-footstrap

make defconfig
make package/luci-theme-footstrap/compile V=s

# результат
ls bin/packages/*/luci/luci-theme-footstrap*.apk
```

`cascade.css` в git не лежит: его генерирует хук `Build/Prepare` в Makefile
темы — он вызывает `build-css.sh` уже по копии дерева в `PKG_BUILD_DIR` (нужны
только `cat`/`awk`, поэтому это работает и на билдботе OpenWrt). Там же в
`fs-version.js` штампуется версия.

### Установка на роутер

```sh
owlab install owrt2512 bin/packages/*/luci/luci-theme-footstrap*.apk
# удаление
owlab exec owrt2512 -- 'apk del luci-theme-footstrap'
```

`--allow-untrusted` нужен, т.к. локальная сборка не подписана ключом фида.

### Свой feed (для install через menuconfig / собственный репозиторий)

feeds.conf.default в SDK/buildroot:

```
src-git mytheme https://github.com/<you>/<repo>.git
```

Структура репо тогда: `themes/luci-theme-mytheme/…` — feed-скрипты найдут пакет
по Makefile. `include ../../luci.mk` резолвится, если в корне репо лежит копия
`luci.mk` — либо проще указывать полный путь к luci.mk из feed'а luci:
`include $(TOPDIR)/feeds/luci/luci.mk` (footstrap использует именно эту форму —
поэтому его Makefile собирается и из `feeds/luci/themes/`, и просто из
`package/`, как это делает CI).

## Тестовая матрица

- Страницы: Status/Overview (таблицы, ifacebox), Network/Interfaces (zonebadge,
  модалки), Network/Firewall (section-table, dropdown), System/Software (прогресс),
  Realtime graphs (SVG), логин/логаут, Reboot.
- Режимы: светлая/тёмная/auto, обе раскладки (sidebar / top — это **клиентский**
  переключатель в поповере Appearance, а не запись темы), палитры (footstrap /
  hicontrast), узкое окно, длинные hostname/SSID.
- **Брейкпойнтов для «влезает или нет» нет — это ИЗМЕРЕНИЕ.** Сайдбар уступает место
  бару, когда ширина контентной колонки (`innerWidth − сайдбар/рельс − паддинги`) падает
  ниже `--fs-content-min`: считает `fitShell()` (`fs-chrome.js`), читая токены
  `--fs-sidebar-w` / `--fs-rail-w` / `--fs-content-min` из CSS (`fs-fit.js` владеет
  наблюдателем и коалесингом), и ставит `data-narrow` на `:root` — на него и смотрят CSS, и
  `flyoutMode()`. Меню верхнего бара так же по измерению сначала ужимается (`.fs-dense1/2`)
  и только потом переезжает на вторую строку (`.fs-bar-stack`): влезет оно или нет, зависит
  от числа разделов на конкретном роутере, а не от экрана. Единственный литерал —
  `@media (min-width: 521px)` в `20-shell.css`: пол, ниже которого никакой срез не оставит
  читаемой колонки, и он же держит хром корректным при выключенном JS. Возвращать вьюпортный
  брейкпойнт для этого вопроса нельзя: было `matchMedia('(max-width: 767px)')`, и в окне
  768–779px хром рисовался баром, пока меню считало себя аккордеоном. Тест — тянуть окно
  мышью, а не проверять точки.
- Отдельно: страница `apply/rollback` (шторка подтверждения изменений) — рисуется
  ui.js поверх темы, часто ломается кастомными z-index.
- Статические гейты (их же гоняет CI, docs/13). `build-css.sh` сам проверяет баланс скобок и
  broken-build FLOOR (верхнего бюджета размера нет — снят); остальное — двумя командами:
  ```sh
  npm run check                                          # перед пушем
  python3 .claude/skills/footstrap-audit/audit.py --strict
  ```
  `npm run check` = `lint` (eslint по `htdocs/`, stylelint по `styles/`) → `css-metrics`
  (ratchet: `!important` ≤ 33, максимальная специфичность, пустые правила) → `css-orphans`
  (мёртвые `fs-*`-селекторы; безопасно только внутри своего неймспейса) → `css-dup`
  (одинаковые тела правил под разными гардами: дубль обязан быть либо слит, либо закреплён
  `@mirror`) → `mirror` (закреплённые копии, CSS и shell, побайтно совпадают) → `axes`
  (пре-пейнт в `head.ut` согласован с живыми аппликаторами Appearance) → `export-tier`
  (контракт `--*-color-*` со сторонними `luci-app-*`) → `i18n` (`.pot` актуален, пустых
  msgstr нет) → `a11y` (axe-core по `docs/gallery.html`, матрица light/dark ×
  footstrap/hicontrast × {untinted,60°,260°} — 12 комбинаций) → `chrome-fence` (метка
  `[data-fs-chrome]`, fence и pin совпадают с хромом) → `changelog` (контракт docs/21).
  `audit.py --strict` — неопределённые `var()`, затенённые правила, мёртвые декларации `base`,
  лишние `!important`, хардкод-цвета. CI сверх этого гоняет `tools/jsmin-verify.mjs` (см. выше) и
  `ucode -T -c` по шаблонам. Бюджетов размера (CSS/шрифты/JS) больше нет — сняты.
  Ничего из `package.json` в пакет не попадает — на билдботе OpenWrt node нет.
