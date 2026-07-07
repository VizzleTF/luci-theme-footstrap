# luci-theme-footstrap

Тема LuCI для OpenWrt **25.12+**. Форк `luci-theme-bootstrap` (ucode-шаблоны).
Дизайн — макет «OpenWrt Status Redesign» (см. `../docs/08-design-sistema.md`).

Внутреннее имя темы: `footstrap`. Media-путь: `/luci-static/footstrap`.
Варианты: `Footstrap` (auto по системной теме), `FootstrapDark`, `FootstrapLight`
(форс через symlink на тот же каталог).

## Раскладки (выбор в System → System → Language and Style)

- **Footstrap** — 1A Sidebar Console: вертикальная навигация слева (224px,
  иконки, сворачиваемые секции), topbar, переключатель темы. Спека:
  `../docs/09-realizatsiya-sidebar.md`.
- **Footstrap Top** — 1B Top-nav: горизонтальное меню сверху с дропдаунами (как
  сток bootstrap). Спека: `../docs/10-realizatsiya-topnav.md`.

Каждая — с вариантами Dark/Light (форс) + auto. Обе используют один
`cascade.css`, шрифты, логотип и дашборд-include; отличие только в раскладке
хрома (header/footer + menu-JS). Медиа-каталоги top-линейки — symlink на
`footstrap`.

Дизайн-токены (dark/light) — в `:root` блоке `cascade.css` (мост к легаси
bootstrap-переменным, поэтому стандартные cbi-виджеты перекрашены без правки
базовых правил). Шрифты Manrope + JetBrains Mono самохостятся в `fonts/`.

**Граница темы:** тема даёт хром + дизайн-язык. KPI-дэшборд с кольцом памяти,
спарклайном load и графической панелью портов из макета — это контент
Status-страницы (view-JS `luci-mod-status`), отдельная фаза-мод. Подробно —
`../docs/08-design-sistema.md`, раздел «Границы».

**Dashboard (мини-мод в теме):**
`htdocs/luci-static/resources/view/status/include/05_footstrap_dashboard.js` —
*аддитивный* status-overview include (новое имя файла → без конфликта с
luci-mod-status). LuCI сам подхватывает все `*.js` из каталога; префикс `05_`
ставит его первым. Рисует верх overview как в макете **1A**: KPI-ряд
(**Load / Memory / Storage / Uptime**) + карточки System (без Uptime/Load —
ушли в KPI) + Memory (бары Available/Used/Buffered/Cached) + Storage (диск/
temp/mounts). Данные — `system.board`, `system.info`, `luci.getVersion`,
`luci.getMountPoints`.

Штатные дубли (System/Memory/Storage) скрываются в рантайме по заголовку
(класс `.fs-dup-hidden`, `!important` — переживает per-poll `display=''`).
Секции Ports/Network/DHCP/Wifi остаются. Обёртка-карточка от `index.js`
снимается через CSS `:has(.fs-dashroot)`. Это рендер-логика, а не оформление —
осознанно пересекает границу тема/мод (docs/08 «Границы»); чужие файлы не
переопределяются.

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
