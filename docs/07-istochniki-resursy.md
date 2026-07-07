# Источники и внешние ресурсы

Итог ресерча (веб-ресерч с адверсариальной верификацией + прямой анализ
исходников openwrt/luci master + живой роутер 25.12.2). Все пункты ниже
подтверждены минимум 2–3 независимыми проверками против первоисточников.

## Первоисточники (доверять)

| Ресурс | Что там |
|---|---|
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap | Эталонная тема. header.ut/footer.ut/sysauth.ut, uci-defaults, Makefile, symlink-механика dark/light |
| https://github.com/openwrt/luci/wiki/ThemesHowTo | **Актуальный** официальный гайд по темам (ucode-based). Минимальный Makefile: `rules.mk` + `LUCI_TITLE` + `include ../../luci.mk` |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/ucode/runtime.uc | Выбор темы, fallback, env-переменные (media/theme/resource) |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/ucode/dispatcher.uc | sysauth-рендер, indexcache, меню |
| https://github.com/openwrt/luci/blob/master/luci.mk | Автоустановка htdocs/ → /www, ucode/ → /usr/share/ucode/luci, root/ → / |
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-material | Пример альтернативной раскладки (сайдбар) на том же контракте |
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-openwrt-2020 | Минимальная тема без sysauth (2 шаблона + шрифт + spinner) |

## Устаревшее (НЕ использовать как référence)

- https://github.com/openwrt/luci/wiki/HowTo:-Create-Themes — **legacy Lua-гайд**
  (`luasrc/view`, `<%...%>`-шаблоны, `require("luci.http")`). Для 25.12+ не
  годится: подтверждено верификацией, это старый пайплайн. Не путать с
  актуальным `ThemesHowTo` (без двоеточия).
- Старые форки тем с `luasrc/view/themes/*.htm` — работают только с
  `luci-lua-runtime`, копировать код из них нельзя.

## Современные сторонние примеры

- https://github.com/LazuliKao/luci-theme-fluent — тема на ucode-шаблонах со
  сборкой через Rsbuild (TypeScript/SCSS → cascade.css). Подтверждено: структура
  пакета идентична bootstrap (htdocs/luci-static/fluent, ucode/template/themes/fluent,
  root/etc/uci-defaults, Makefile); дистрибуция двойная — `.ipk` (opkg, 24.10.x)
  и `.apk --allow-untrusted` (25.12.x). Хороший пример, если захочется
  препроцессор для CSS.
- luci-theme-argon (jerrykuku) — самая популярная сторонняя тема; утверждения о
  её ветках/тёмном режиме верифицировать не успели (лимит сессии). Перед
  заимствованием кода проверить, что берёте ветку с ucode-шаблонами, а не
  legacy `.htm`.

## Подтверждённые ключевые факты (кросс-чек с доками 01–06)

1. Тема 25.12+ = ucode-шаблоны `.ut` в `ucode/template/themes/<имя>/`
   (header, footer, опц. sysauth). Lua не участвует.
2. Пакет: `htdocs/luci-static/<имя>/` (статика, доступ через `{{ media }}`),
   `root/etc/uci-defaults/` (регистрация), Makefile с `LUCI_TITLE` +
   `LUCI_DEPENDS:=+luci-base` + `include ../../luci.mk`; postrm чистит uci.
3. Регистрация: `uci set luci.themes.<Имя>=/luci-static/<имя>; uci commit luci`;
   активная тема — `luci.main.mediaurlbase`, bootstrap ставит её только при
   свежей установке (`PKG_UPGRADE != 1`).
4. header.ut начинается с ucode-блока: import из `luci.core`,
   `ubus.call('system','board')`, `http.prepare_content('text/html; charset=UTF-8')`.
5. Меню — пустые скрытые контейнеры в header, наполняются клиентским JS
   (client-side рендеринг LuCI).
6. Dark mode: `matchMedia('(prefers-color-scheme: dark)')` → атрибут
   `data-darkmode` на `:root`; форс-варианты через symlink-темы -dark/-light.
7. 24.10 = ipk/opkg, 25.12 = apk (`apk add --allow-untrusted`).
