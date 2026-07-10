# luci-theme-footstrap

Тема LuCI для OpenWrt **25.12+** (ucode-шаблоны). Дизайн — макет «OpenWrt Status
Redesign» (см. `../docs/08-design-sistema.md`).

Внутреннее имя темы: `footstrap`. Media-путь: `/luci-static/footstrap`.

## Раскладки (выбор в System → System → Language and Style)

Зарегистрированы **две** записи — они отличаются только положением меню:

- **FootstrapSidebar** — 1A Sidebar Console: вертикальная навигация слева (224px,
  иконки, сворачиваемые секции), topbar. Спека:
  `../docs/09-realizatsiya-sidebar.md`.
- **FootstrapOnTop** — 1B Top-nav: горизонтальное меню сверху с дропдаунами.
  Спека: `../docs/10-realizatsiya-topnav.md`.

Режим (auto/светлая/тёмная) и палитра — **клиентские** переключатели в поповере
Appearance, а не отдельные темы. Обе раскладки используют один `cascade.css`,
шрифты, логотип и overview-layout include; отличие только в раскладке хрома
(header/footer + menu-JS). `/luci-static/footstrap-top` — symlink на единственный
реальный media-каталог `footstrap`.

Дизайн-токены (dark/light) живут в `styles/02-tokens.css` и содержат мост на
общепринятые в темах LuCI имена (`--primary-color-high`, `--background-color-*`,
…). Поэтому смена палитры перекрашивает и штатные cbi-виджеты, и CSS любого
стороннего `luci-app-*`, не трогая ни одного правила. Шрифты Manrope +
JetBrains Mono самохостятся в `fonts/`.

**Граница темы:** тема даёт хром + дизайн-язык, контент Status-страницы рисует
view-JS `luci-mod-status`. Тема сам контент не рендерит — только переставляет
штатные секции overview. Подробно — `../docs/08-design-sistema.md`, раздел
«Границы».

**Overview-layout (мини-мод в теме):**
`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js` —
*аддитивный* status-overview include (уникальное имя → без конфликта с
luci-mod-status). LuCI сам подхватывает все `*.js` из каталога; префикс `05_`
ставит его первым. Своего контента **не рисует** — `MutationObserver` на `#view`
находит штатные секции System/Memory/Storage по заголовку и оборачивает их в
`.fs-ovl`, а CSS-grid раскладывает: System — левая колонка на оба ряда, Memory
(сверху) + Storage (снизу) — правая. Остальные секции остаются штатными ниже.
Штатный poll обновляет нутро каждой секции **на месте** (`dom.content`), обёртку
`.cbi-section` не пересоздаёт, поэтому перемещённые секции не мигают. Свою
пустую обёртку скрывает CSS `#view > .cbi-section:has(.fs-ovl-marker)`. Это
рендер-логика, а не оформление — осознанно пересекает границу тема/мод (docs/08
«Границы»); чужие файлы не переопределяются.

Прежний вариант (`05_footstrap_dashboard.js`) рисовал весь overview кастомно
(KPI-ряд, карточки, свои таблицы) — но пересборка страницы-в-высоту на каждый
poll мигала и сбрасывала скролл на мобильном, поэтому заменён на layout-only.

## Структура

```
Makefile                                  LUCI_TITLE, +luci-base, postrm
htdocs/luci-static/footstrap/             cascade.css, mobile.css, logo.svg, logo_48.png
htdocs/luci-static/footstrap-dark  -> footstrap   (symlink)
htdocs/luci-static/footstrap-light -> footstrap   (symlink)
htdocs/luci-static/resources/menu-footstrap.js    клиентский рендер меню
htdocs/luci-static/resources/view/footstrap/sysauth.js
ucode/template/themes/footstrap/          header.ut, footer.ut, sysauth.ut
ucode/template/themes/footstrap-dark  -> footstrap   (symlink)
ucode/template/themes/footstrap-light -> footstrap   (symlink)
root/etc/uci-defaults/30_luci-theme-footstrap     регистрация в uci
```

## Разработка на роутере

```sh
./dev-sync.sh          # залить на ssh router (регистрация без активации)
# включить вручную:
ssh router 'uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*'
# откат:
ssh router 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci'
```

Кастомизация — через CSS-переменные `:root { --… }` в `cascade.css` (см.
`../docs/04-css-menu-js-dark-mode.md`), раскладка правится в header.ut +
menu-footstrap.js.

## Сборка пакета .apk

См. `../docs/05-sborka-deploy-razrabotka.md`. Кратко: положить каталог в
`feeds/luci/themes/`, `make package/luci-theme-footstrap/compile V=s`,
`apk add --allow-untrusted luci-theme-footstrap_*.apk`.
