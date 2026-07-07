# Реализация варианта 1B — Top-nav (меню сверху)

Второй вариант раскладки `footstrap-top` — горизонтальное меню сверху (как сток
bootstrap / макет 1B). Выбирается в System → System → Language and Style наравне
с sidebar-вариантом. Общие с sidebar: `cascade.css`, шрифты, логотип, дашборд-
include, все токены и компоненты. Отличие — только раскладка хрома.

## Как устроен выбор

LuCI выбирает тему по `luci.main.mediaurlbase` → `basename` → каталог шаблонов
`themes/<basename>/header` (док 01). Регистрируем в `luci.themes` две линейки:

```
Footstrap          /luci-static/footstrap          (sidebar, auto)
FootstrapDark      /luci-static/footstrap-dark      (sidebar, форс тёмная)
FootstrapLight     /luci-static/footstrap-light     (sidebar, форс светлая)
FootstrapTop       /luci-static/footstrap-top       (top-nav, auto)
FootstrapTopDark   /luci-static/footstrap-top-dark  (top-nav, форс тёмная)
FootstrapTopLight  /luci-static/footstrap-top-light (top-nav, форс светлая)
```

Все шесть — в выпадающем списке тем. dark/light различаются суффиксом имени;
`header.ut` определяет режим единообразно:

```
const darkpref = (match(theme, /-dark$/) ? 'true' : (match(theme, /-light$/) ? 'false' : null));
```

## Файлы

```
ucode/template/themes/footstrap-top/{header.ut, footer.ut}   реальные (top layout)
ucode/template/themes/footstrap-top-dark  -> footstrap-top   (symlink)
ucode/template/themes/footstrap-top-light -> footstrap-top   (symlink)

htdocs/luci-static/footstrap-top       -> footstrap          (symlink: общий CSS/шрифты/лого)
htdocs/luci-static/footstrap-top-dark  -> footstrap          (symlink)
htdocs/luci-static/footstrap-top-light -> footstrap          (symlink)

htdocs/luci-static/resources/menu-footstrap-top.js           горизонтальный рендер меню
```

Медиа-каталоги top-линейки — symlink на `footstrap`, поэтому `{{ media }}/cascade.css`
отдаёт тот же файл (одна кодовая база стилей). Шаблонные каталоги `-top` реальные
(своя раскладка), а их dark/light — symlink на `footstrap-top`.

## Раскладка (header.ut top)

```
body.fs-top
 .fs-topwrap
   header.fs-topnav                 sticky бар: лого+hostname | #topmenu (гориз.) | right(indicators+toggle+logout)
   ul#modemenu.fs-modemenu-top      (скрыт, если один режим)
   main.fs-main-top #maincontent
     .fs-pagehead                   заголовок страницы (divider на всю ширину, контент центрирован)
     .fs-content (max 1180, центр)  предупреждения, #tabmenu, #view
     footer.fs-footer
```

Тумблер `body.fs-top` включает top-CSS; sidebar-правила (`.fs-shell/.fs-sidebar`)
не применяются (другие классы). Один `cascade.css` обслуживает обе раскладки.

## menu-footstrap-top.js

Горизонтальное меню с одним уровнем дропдаунов (паттерн стокового
`menu-bootstrap.js`): `#topmenu` — верхние разделы в ряд; у раздела с детьми —
`ul.dropdown-menu` (абсолютный поповер, показ по `:hover`/`:focus-within`).
`#tabmenu` — вкладки раздела; `#modemenu` — режимы. Плюс обработчик тумблера темы
(тот же клиентский `data-darkmode` + `localStorage`, что в sidebar).

## Проверка

- `ucode -c` header/footer top — OK
- Активация `footstrap-top` → overview 200, top-nav разметка, нет fallback
- `cascade.css` отдаётся через `/luci-static/footstrap-top` (symlink) — 200
- Переключение в списке тем меняет раскладку; dark/light форс и auto работают
- Дашборд-include и все фиксы стилей — общие, работают в обоих вариантах
