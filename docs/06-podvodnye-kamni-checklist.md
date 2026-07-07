# Подводные камни 25.12+ и чек-лист новой темы

## Камни совместимости

1. **Только ucode.** Темы со старыми `luasrc/view/themes/*.htm` (Lua-шаблоны) на
   25.12 без пакета `luci-lua-runtime` не работают. Многие темы с гитхаба
   (старые форки argon/material) до сих пор несут `.htm` — не копировать оттуда
   слепо. Ориентир — только официальные темы из openwrt/luci master.

2. **apk вместо opkg.** 25.12 перешёл на apk: пакеты `.apk`, версии пакетов должны
   соответствовать правилам apk (строже, чем opkg). `luci.mk` генерирует
   корректную версию сам — не задавать PKG_VERSION вручную с экзотикой.
   Постинсталл-хуки: uci-defaults срабатывают штатно, но `opkg list-installed`
   на роутере больше нет — `apk list --installed`.

3. **Меню рендерится клиентом.** Нельзя сгенерить меню сервером в header.ut —
   дерево приходит асинхронно (`ui.menu.load()`). Контейнеры до загрузки пустые:
   тема обязана нормально выглядеть в момент "меню ещё нет" (bootstrap прячет их
   `style="display:none"`).

4. **`data-page` на body обязателен.** CSS luci-base и приложений (statistics,
   firewall) таргетирует `[data-page="admin-..."]`. Убрали атрибут — сломали
   чужие стили.

5. **`node.css` и `css` в header.** Отдельные страницы (напр. статистика) просят
   дополнительный CSS. Не выводите — страницы виснут визуально. Аналогично
   `{{ resource }}/cbi.js` и скрипт переводов — обязательные включения.

6. **blank_page.** Забыли обработать — на странице логина появится меню/шапка
   с битыми ссылками (юзер не аутентифицирован).

7. **Не хардкодить пути.** Всегда `{{ media }}` и `{{ resource }}`, не
   `/luci-static/mytheme` строкой: тема может быть смонтирована с другим
   basename (symlink-варианты как bootstrap-dark).

8. **postrm обязателен.** Без него после `apk del` остаётся запись в
   `luci.themes`, и если тема была активной — у пользователя fallback-ошибка
   при каждом заходе, пока не переключит тему руками.

9. **Права юзера ≠ root.** LuCI поддерживает не-root логины (rpcd ACL). Меню
   приходит уже отфильтрованным — menu-JS не должен предполагать наличие узлов
   (`node?.children` с проверками, как в оригинале).

10. **`meta viewport` + мобильный CSS.** Забыть viewport — мобильная вёрстка
    мертва. Bootstrap выносит мобильное в отдельный `mobile.css` с media query
    на `<link>` — грузится всегда, применяется по ширине.

11. **initramfs/recovery и «нет пароля»** — предупреждения рисует header ТЕМЫ
    (не luci-base). Выкинете их — пользователь не узнает, что система в
    recovery-режиме. Скопировать блоки из bootstrap.

12. **darkreader-lock.** Без `<meta name="darkreader-lock">` расширение Dark
    Reader перекрасит вашу тёмную тему в кашу.

## Чек-лист файлов новой темы `luci-theme-mytheme`

```
[ ] Makefile                      LUCI_TITLE, +luci-base, postrm с uci delete
[ ] ucode/template/themes/mytheme/header.ut
      [ ] http.prepare_content
      [ ] title из boardinfo.hostname + dispatched.title
      [ ] link cascade.css через {{ media }}
      [ ] node.css + inline css
      [ ] script переводов + cbi.js
      [ ] body class lang_* + data-page
      [ ] blank_page: скрыть хром
      [ ] #topmenu, #indicators, #tabmenu (пустые, display:none)
      [ ] предупреждения: no password, initramfs
      [ ] noscript
[ ] ucode/template/themes/mytheme/footer.ut
      [ ] закрыть контейнер, footer с version.*
      [ ] #modemenu
      [ ] L.require('menu-mytheme')
      [ ] закрыть body/html
[ ] htdocs/luci-static/mytheme/cascade.css      (+ mobile.css)
[ ] htdocs/luci-static/mytheme/logo.svg, logo_48.png
[ ] htdocs/luci-static/resources/menu-mytheme.js
[ ] root/etc/uci-defaults/30_luci-theme-mytheme (set_opt паттерн, PKG_UPGRADE)
[ ] (опц.) sysauth.ut + resources/view/mytheme/sysauth.js
[ ] (опц.) symlink-варианты -dark/-light + uci-записи + postrm на все
```

## Стратегия: форк bootstrap

Рекомендованный путь (минимум поломок на апгрейдах LuCI):

1. Скопировать luci-theme-bootstrap → luci-theme-mytheme, переименовать каталоги
   `bootstrap` → `mytheme` внутри htdocs/ucode, `menu-bootstrap.js` → `menu-mytheme.js`,
   поправить `L.require(...)` в footer и `ui.instantiateView('mytheme.sysauth')`.
2. Перекрасить через `:root { --… }` переменные (док 04) — не трогая 2600 строк
   правил.
3. Менять раскладку (сайдбар и т.п.) — только после того, как п.1–2 работают.
4. Периодически диффать свой cascade.css с upstream bootstrap: новые версии LuCI
   добавляют классы для новых виджетов (за этим стоит следить между релизами).
