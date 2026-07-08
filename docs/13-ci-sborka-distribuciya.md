# CI, сборка пакетов и распространение

Как footstrap собирается в пакеты и раздаётся. Тема **noarch** (`LUCI_PKGARCH:=all`)
и поддерживает **OpenWrt 24.10** (`.ipk`/opkg) и **25.12+** (`.apk`/apk).

## GitHub Actions (`.github/workflows/build.yml`)

Триггеры: тег `v*` или ручной `workflow_dispatch`. Матрица форматов:

| fmt | channel | SDK | CONFIG_USE_APK |
|---|---|---|---|
| apk | snapshot | `snapshots/targets/x86/64` (apk-тулчейн 25.12+) | `y` |
| ipk | 24.10 | последний `24.10.x` release SDK | `n` |

Шаги каждой сборки:
1. Резолв версии: из тега (`v0.3.6` → `0.3.6`) или fallback `0.<date>.<run>`.
2. Скачать SDK (URL резолвится **динамически** — grep по dir-листингу, не хардкод
   toolchain-версии; поддержаны `.tar.zst` и `.tar.xz`).
3. `rsync` каталог пакета `luci-theme-footstrap/` в `package/luci-theme-footstrap/`
   SDK (сохраняя симлинки темы), `feeds update -a && install -a`.
4. `.config`: `CONFIG_PACKAGE_luci-theme-footstrap=m` (+ `CONFIG_USE_APK=y` для apk),
   `make defconfig`, `make package/luci-theme-footstrap/compile V=s
   FOOTSTRAP_VERSION=<ver>`.
5. Собрать `.apk`/`.ipk` из `bin/`, залить артефакт.
6. Job `release` (только на тег): скачивает оба артефакта, `softprops/action-gh-release`
   цепляет **оба** пакета к релизу.

Новый релиз: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Решения в Makefile (почему так)

```makefile
PKG_NAME:=luci-theme-footstrap
FOOTSTRAP_VERSION?=            # CI инжектит из тега; локально версия git-derived
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif
LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all             # noarch: одна сборка на любой таргет
LUCI_MINIFY_CSS:=0            # !!! минификатор ломает :has()/color-mix()/calc()
LUCI_MINIFY_JS:=0             # и современный ES → верстка «съезжает»
...
include $(TOPDIR)/feeds/luci/luci.mk   # АБСОЛЮТНЫЙ путь (не ../../luci.mk):
                                       # работает и в package/, и в feeds/luci/themes/
```

- **`LUCI_MINIFY_CSS/JS:=0`** — критично. По умолчанию luci.mk минифицирует
  CSS/JS. Минификатор манглит `:has()`, `color-mix()`, вложенный `calc()`,
  современный ES → пакет ставится, но **верстка разваливается** (симптом:
  cascade.css в apk ~91 КБ вместо ~132 КБ). См. также docs/06.
- **`$(TOPDIR)/feeds/luci/luci.mk`** (абсолютный) — относительный `../../luci.mk`
  работает только когда пакет лежит в `feeds/luci/themes/`; в SDK-раскладке
  `package/<name>/` он ломается. Абсолютный путь работает везде.
- **`LUCI_PKGARCH:=all`** — LuCI-темы архитектурно-независимы; один пакет на все.

## Установка

Скрипт [`install.sh`](../install.sh) — определяет `apk`/`opkg` и ставит нужный
формат из последнего (или заданного) релиза:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/footstrap/main/install.sh | sh
# закрепить версию:  ... | sh -s v0.3.6
```

Вручную — **raw-файл из релиза** (НЕ zip-артефакт из Actions!):

```sh
apk add --allow-untrusted luci-theme-footstrap-*.apk   # 25.12+
opkg install luci-theme-footstrap_*.ipk                # 24.10
```

## Формат пакетов + типичная ошибка

- **apk** (25.12+) — формат Alpine apk-tools (OpenWrt перешёл на него в 25.12).
- **ipk** (24.10) — gzip-tar: `./debian-binary` (2.0) + `./control.tar.gz` +
  `./data.tar.gz`, ustar-заголовки. Идентичен формату родных OpenWrt-ipk.

**«Malformed package file» в opkg** почти всегда = ставят НЕ тот файл: zip-обёртку
GitHub-артефакта или `.apk` вместо `.ipk`. Наш `.ipk` валиден — проверяется
установкой реальным opkg:

```sh
docker run --rm -v /path/pkg.ipk:/tmp/p.ipk openwrt/rootfs:x86-64-24.10.4 \
  sh -c 'mkdir -p /var/lock; opkg install --nodeps /tmp/p.ipk'
```

## Локальная сборка (без CI)

`luci-theme-footstrap/build-apk.sh` — сборка `.apk` через SDK на ext4 (детали в
docs/05). Быстрый цикл разработки (без сборки) — `dev-sync.sh`, см. docs/05.
