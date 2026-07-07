# Сборка, деплой и цикл разработки

## Два режима работы

1. **Быстрый цикл (без сборки)** — правим файлы прямо на роутере / scp с хоста.
   Тема — это только шаблоны + статика, компилировать нечего. Основной режим
   при разработке.
2. **Пакет .apk через SDK** — для распространения и чистой установки.

## Быстрый цикл разработки на живом роутере

Целевые пути (см. док 01):

```
/usr/share/ucode/luci/template/themes/mytheme/{header.ut,footer.ut}
/www/luci-static/mytheme/cascade.css ...
/www/luci-static/resources/menu-mytheme.js
```

### Первичная заливка (роутер `ssh router`)

```sh
# 1. БЕКАП затрагиваемого (одноразово, до любых изменений)
ssh router 'mkdir -p /root/theme-backup && \
  cp -a /etc/config/luci /root/theme-backup/luci.config && \
  tar -C / -czf /root/theme-backup/luci-theme-orig.tar.gz \
    usr/share/ucode/luci/template/themes www/luci-static'

# 2. Каталоги + файлы
ssh router 'mkdir -p /usr/share/ucode/luci/template/themes/mytheme /www/luci-static/mytheme'
scp ucode/template/themes/mytheme/*.ut router:/usr/share/ucode/luci/template/themes/mytheme/
scp htdocs/luci-static/mytheme/*       router:/www/luci-static/mytheme/
scp htdocs/luci-static/resources/menu-mytheme.js router:/www/luci-static/resources/

# 3. Регистрация (НЕ переключая активную тему — безопасно)
ssh router 'uci set luci.themes.MyTheme=/luci-static/mytheme && uci commit luci'
```

Дальше тема выбирается в LuCI: System → System → Language and Style, или:

```sh
ssh router 'uci set luci.main.mediaurlbase=/luci-static/mytheme && uci commit luci'
```

### Страховка от поломки

- Механизм fallback (док 01): если header.ut темы не компилируется, LuCI сам
  откатится на первую рабочую тему из `luci.themes` (bootstrap) и покажет
  индикатор "Theme fallback" с текстом ошибки. Т.е. кривой шаблон **не окирпичит
  веб-интерфейс**.
- Ручной откат в любой момент:
  `ssh router 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'`
- Совсем всё сломалось: `uci` доступен по ssh, LuCI для восстановления не нужен.

### Кэши при итерации

- Меню/диспетчер кэшируются: `/tmp/luci-indexcache.<hash>.json`. Хэш считается от
  mtime файлов меню — при добавлении/удалении файлов обновляется сам, но при
  странностях: `ssh router 'rm -f /tmp/luci-indexcache*'`.
- Шаблоны `.ut` НЕ кэшируются между запросами (ucode компилирует на лету) —
  правка header.ut видна по F5.
- CSS/JS кэширует браузер: жёсткий reload (Ctrl+Shift+R). `luci.js` грузится с
  `?v=<версия>-<mtime базы пакетов>`, но CSS темы — без версии: при правках CSS
  на живую держать DevTools с Disable cache.

### Синхронизация одним скриптом

```sh
#!/bin/sh
# dev-sync.sh — залить тему на роутер
set -e
R=router
N=mytheme
rsync -av --no-perms ucode/template/themes/$N/ $R:/usr/share/ucode/luci/template/themes/$N/
rsync -av --no-perms htdocs/luci-static/$N/    $R:/www/luci-static/$N/
scp -q htdocs/luci-static/resources/menu-$N.js $R:/www/luci-static/resources/
echo synced
```

(rsync на роутере может отсутствовать — тогда `apk add rsync` или чистый scp.)

## Сборка пакета .apk (OpenWrt 25.12 использует apk, не opkg)

### Через SDK

```sh
# SDK под таргет роутера (пример: mediatek/filogic 25.12.2)
wget https://downloads.openwrt.org/releases/25.12.2/targets/mediatek/filogic/\
openwrt-sdk-25.12.2-mediatek-filogic_gcc-*_musl.Linux-x86_64.tar.zst
tar --zstd -xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*/

# feeds (нужен luci ради luci.mk и luci-base)
./scripts/feeds update base luci
./scripts/feeds install -a -p luci

# положить тему внутрь feed'а luci (там работает include ../../luci.mk)
ln -s /path/to/repo/luci-theme-mytheme feeds/luci/themes/luci-theme-mytheme
./scripts/feeds update -i luci && ./scripts/feeds install luci-theme-mytheme

make defconfig
make package/luci-theme-mytheme/compile V=s

# результат
ls bin/packages/*/luci/luci-theme-mytheme*.apk
```

### Установка на роутер

```sh
scp bin/packages/*/luci/luci-theme-mytheme*.apk router:/tmp/
ssh router 'apk add --allow-untrusted /tmp/luci-theme-mytheme*.apk'
# удаление
ssh router 'apk del luci-theme-mytheme'
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
`include $(TOPDIR)/feeds/luci/luci.mk`.

## Тестовая матрица

- Страницы: Status/Overview (таблицы, ifacebox), Network/Interfaces (zonebadge,
  модалки), Network/Firewall (section-table, dropdown), System/Software (прогресс),
  Realtime graphs (SVG), логин/логаут, Reboot.
- Режимы: светлая/тёмная/auto, мобильная ширина (<854px), длинные hostname/SSID.
- Отдельно: страница `apply/rollback` (шторка подтверждения изменений) — рисуется
  ui.js поверх темы, часто ломается кастомными z-index.
