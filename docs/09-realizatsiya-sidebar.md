# Реализация варианта 1A — Sidebar Console

Спека того, что и как меняется в `luci-theme-footstrap` для sidebar-раскладки.
Порядок работ и проверка — в конце.

## Целевая раскладка

```
┌──────────────────────────────────────────────┐
│ sidebar 224px │  main column (flex:1)          │
│               │ ┌────────────────────────────┐ │
│  [лого] OpenWrt│ │ topbar 66px: заголовок +   │ │
│               │ │  online-pill uptime         │ │
│  ПАНЕЛЬ       │ ├────────────────────────────┤ │
│  ▸ Status ●   │ │ #tabmenu (вкладки раздела)  │ │
│  ▸ System     │ │                            │ │
│  ▸ Network    │ │ #view (контент приложения) │ │
│  …            │ │                            │ │
│  [spacer]     │ │                            │ │
│  Тема [◐]     │ │                            │ │
│  ▸ Log out    │ │                            │ │
└──────────────────────────────────────────────┘
```

## Маппинг LuCI-контейнеров на sidebar

LuCI-меню рендерит клиентский JS в фиксированные контейнеры (док 01/04). Пере-
назначаем их:

| LuCI-контейнер | В bootstrap | В footstrap sidebar |
|---|---|---|
| `#topmenu` | горизонт. меню верхних разделов | **вертикальный список в сайдбаре** (Status/System/Network/…) |
| `#modemenu` | breadcrumb-переключатель admin/status | скрыт или как заголовок группы «Панель» (обычно один режим — admin) |
| `#tabmenu` | вкладки под шапкой | остаётся в main, над `#view` |
| `#indicators` | правый угол шапки | online-pill в topbar |
| `#view` | контент | контент (main column) |

Верхние разделы LuCI (Status, System, Services, Network, VPN, …) приходят из
дерева меню — их набор зависит от установленных пакетов, **не хардкодить**.

## Изменения по файлам

### 1. `htdocs/luci-static/footstrap/fonts/` (новое)

Самохостинг шрифтов (роутер офлайн, без Google Fonts):
- `Manrope-*.woff2` (веса 600/700/800 достаточно; 400/500 если нужен текст)
- `JetBrainsMono-*.woff2` (400/600)
- `@font-face` объявления в начале `cascade.css`.

Взять из google-webfonts-helper или репозиториев шрифтов (OFL/Apache — можно
класть в пакет). Fallback: `system-ui, sans-serif` / `ui-monospace, monospace`.

### 2. `cascade.css` — стратегия

Форк bootstrap `cascade.css` уже несёт все нужные cbi-классы (док 04). Меняем:

1. **Блок `:root` переменных** — заменить bootstrap HSL-схему на footstrap-токены
   (док 08): добавить `--bg/--panel/--panel2/--border/--text/--dim/--accent/
   --accent-soft/--track/--good/--warn/--danger/--shadow` + светлые в
   `:root[data-darkmode="false"]`, тёмные в `[data-darkmode="true"]`.
   Bootstrap-переменные (`--background-color-*` и т.д.) переопределить через
   новые, чтобы старые правила cbi продолжали работать без переписывания 2600
   строк:
   ```css
   :root {
     --background-color-high: var(--panel);
     --border-color-medium:   var(--border);
     --primary-color-medium:  var(--accent);
     /* … мост old→new … */
   }
   ```
2. **Раскладка** — новый блок: `body{display:flex}`, `#mainmenu`(sidebar)
   fixed-width 224px, `#maincontent` flex-column. Добавить classes для sidebar,
   topbar, online-pill.
3. **Компоненты** — доработать под макет: `.cbi-progressbar` (трек 8px, radius
   99px, заливка по значению), панели-карточки (radius 16, `--panel`, `--border`),
   строки-таблицы (flex space-between, mono-значения), шрифты.

Держать `data-darkmode` контракт (док 04): auto через `matchMedia`, форс через
symlink-темы footstrap-dark/light. Токены обеих схем — как в доке 08.

### 3. `ucode/template/themes/footstrap/header.ut`

- `<body>` → flex-контейнер (или обёртка `.fs-shell`).
- **Sidebar** (`<nav id="mainmenu">` или переиспользовать) с:
  - лого-блок (градиентный квадрат + wifi-SVG + wordmark hostname/OpenWrt);
  - заголовок группы «Панель»;
  - `<ul id="topmenu">` (пустой, наполнит menu-JS вертикально);
  - spacer `flex:1`;
  - строка «Тема» + переключатель (кнопка с `data-darkmode`-toggle);
  - Log out (`{{ dispatcher.build_url('admin/logout') }}` если есть).
- **Main**: `<div id="maincontent">` с topbar (заголовок `dispatched.title` +
  `#indicators` online-pill) и `#tabmenu`.
- Сохранить обязательное: `http.prepare_content`, cbi.js, переводы, `node.css`,
  `css`, `data-page`, `blank_page`, noscript, предупреждения (no-password,
  initramfs) — из дока 03/06.

### 4. `htdocs/luci-static/resources/menu-footstrap.js`

- `renderMainMenu` → вертикальный список в `#topmenu`: пункт =
  `<li><a><icon><span>title</span></a></li>`, активный класс по `dispatchpath`.
- Иконки: map по имени/пути раздела (`admin/status`→dashboard-иконка,
  `admin/system`→gear, `admin/network`→network, …), fallback — точка/generic
  SVG. Набор SVG — инлайн в JS (как в макете).
- `#tabmenu` — оставить горизонтальным в main (как bootstrap `renderTabMenu`).
- `#modemenu` — если >1 режима, показать; иначе скрыть.
- Переключатель темы: обработчик тогглит `data-darkmode` на `:root` +
  сохраняет выбор (localStorage или uci-nothing — только клиент). Учесть, что
  форс-варианты идут через выбор темы в настройках; клиентский тоггл — быстрый UX.

## Порядок работ

1. Шрифты в `fonts/` + `@font-face`.
2. `cascade.css`: переменные-мост (old→new) + токены обеих схем. Проверить, что
   стандартный overview не сломался (цвета применились).
3. `cascade.css`: sidebar-раскладка + компоненты.
4. `header.ut`: sidebar + main + topbar.
5. `menu-footstrap.js`: вертикальное меню + иконки + тема-тоггл.
6. Деплой `dev-sync.sh`, `ucode -c` шаблонов, live-render на `ssh router`
   (временная активация + curl + откат, см. док 05).

## Проверка (Definition of Done для 1A)

- [ ] `ucode -c` header/footer/sysauth — OK
- [ ] Активация footstrap → нет fallback/error500
- [ ] Sidebar рендерится, верхние разделы кликабельны, активный подсвечен
- [ ] Status→Overview: панели-карточки, прогресс-бары памяти/диска в стиле макета
- [ ] Вкладки раздела (#tabmenu) работают
- [ ] Переключатель темы меняет dark/light; auto по системной
- [ ] Мобильная ширина (<854px): sidebar сворачивается/скрывается
- [ ] Логин (sysauth) в стиле темы
- [ ] Откат на bootstrap чистый
