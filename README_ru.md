# LUCI-THEME-FOOTSTRAP

[English](README.md) · **Русский** ·
**[Песочница — всё можно потрогать без роутера](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap.json)](https://owfeed.org/install/ru/)
[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap-releases.json)](https://owfeed.org/install/ru/)

<picture>
  <source media="(max-width: 767px)" srcset="assets/readme/phone-menu-dark.png">
  <img src="assets/readme/overview-top-dark.png" width="100%" alt="Тот же обзор в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">
</picture>

[Ещё скриншоты →](docs/screenshots/)

## Что умеет

<img src="assets/readme/appearance-dark.png" width="100%" alt="Вкладка Footstrap в «Система → Система»: раскладка, тема, палитра, плотность и скругление; поля цвета для акцента, статусов и поверхностей — каждое со словесной оценкой контраста; выбор обоев с котами на фоне страницы; и «Сохранить как умолчание» рядом с двумя сбросами.">

- **Стилизует приложения**, а не только стоковые страницы
- **Работает на телефоне**
- **Лёгкая** — без фреймворка, единственная зависимость `luci-base`
- **Быстрее bootstrap** — цифры ниже
- **Обновляется вместе с роутером** — ставится из фида, поэтому `apk upgrade` тянет её дальше
- **Внешний вид ваш** — восемнадцать осей, применяются сразу, всё в одной вкладке

На роутере вы один раз выбираете **Footstrap** в **System → System → Language and Style**, а всё
перечисленное ниже живёт во вкладке **Footstrap** на той же странице. Каждая ось
в нём — настройка *браузера*: применяется сразу, без перезагрузки страницы.

- **Layout** — верхняя панель (по умолчанию) или боковое меню
- **Theme** — auto (следит за системой), светлая или тёмная
- **Palette** — Footstrap (цвета GitHub Primer) или Hi-Contrast
- **Density** — компактная, обычная или крупная
- **Wallpaper** — выключены, коты, динозавры (качаются по требованию, в пакет не входят) или своя
  картинка
- **Tint** — подмешивает оттенок в фон, чтобы понимать, какому роутеру принадлежит вкладка (или
  скриншот в тикете)
- **Colours** — акцент и три статусных цвета, каждый задаётся hex-кодом; краска поверх выводится из
  светлоты цвета, а получившийся контраст называется словами
- **Surfaces** — карточки, элементы форм, боковая панель и границы, тем же полем
- **Rounding** — радиус скругления, 0–20px
- **Submenus** — держать несколько разделов меню открытыми или сворачивать до одного

Понравившийся набор можно сохранить умолчанием для роутера — новый браузер начнёт с него.


## Замерено, а не заявлено

Время до первой отрисовки, тот же роутер, те же страницы.

| Страница | bootstrap | footstrap |
|---|---:|---:|
| Wireless | 288 мс | **16 мс** |
| Interfaces | 367 мс | **63 мс** |
| DNS | 328 мс | **84 мс** |
| Firewall | 300 мс | **88 мс** |
| Прогон 36 страниц | 7458 мс | **3196 мс** |
| Запросов/стр. | 15–48 | **0–8** |

Медианная страница — **в 3.04 раза быстрее**, весь прогон — **в 2.33 раза**.

<details>
<summary>Те же цифры графиком</summary>

<img src="assets/readme/speed.svg" width="720" alt="Замер: Wireless status 288 мс → 16 мс, Interfaces 367 → 63, DNS 328 → 84, Firewall zones 300 → 88. Весь прогон из 36 страниц 7458 → 3196 мс, в 2.33 раза; медианная страница в 3.04 раза; запросов на страницу 15–48 → 0–8.">

</details>

## Установка

### Одна строка — установщик сам добавит фид

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Он определяет релизную линию и архитектуру, добавляет репозиторий
[owfeed-packages](https://github.com/owfeed/owfeed-packages) вместе с ключом подписи, защищает и
ключ, и репозиторий от стирания при обновлении прошивки, а дальше ставит тему через `apk` / `opkg`.
Последнее и есть смысл: менеджер пакетов знает, откуда тема взялась, поэтому **`apk upgrade` тянет
её дальше** наравне со всем остальным. Скачанный файл так и остался бы на своей версии, пока кто-то
не придёт со следующим файлом.

Один раз спросит, ставить ли необязательную проверку обновлений (`FOOTSTRAP_UPDATER=1` / `=0`
отвечают за вас без вопроса).

Если фид недоступен — или если вы закрепили версию, `... | sh -s v0.9.0`, чего фид отдать не может,
потому что держит по одной версии на ветку, — установщик уходит на релизный ассет и проверяет его по
подписанному манифесту. Оба пути описаны ниже.

Добавить любой фид — значит доверять ему **любое** имя пакета, которое он способен отдать; размен
разобран в [разделе установки самого фида](https://github.com/owfeed/owfeed-packages#install), и эти
две минуты стоят того.

### Руками, если хочется видеть каждый шаг

```sh
# OpenWrt 25.12 и новее. Для HTTPS на стоковом образе сперва нужны эти два пакета.
apk add ca-bundle libustream-mbedtls

wget https://repo.owfeed.org/owfeed-packages.pem -O /etc/apk/keys/owfeed-packages.pem
echo "https://repo.owfeed.org/releases/25.12/$(cat /etc/apk/arch)/packages.adb" > /etc/apk/repositories.d/owfeed-packages.list

# Сохранить ключ и репозиторий при обновлении прошивки.
mkdir -p /lib/upgrade/keep.d
printf '%s\n' /etc/apk/keys/owfeed-packages.pem /etc/apk/repositories.d/owfeed-packages.list > /lib/upgrade/keep.d/owfeed-packages

apk update && apk add luci-theme-footstrap
```

На 24.10 и старше фид отдаёт ту же тему как ipk, через opkg:

```sh
# ИМЯ файла ключа — это его id, opkg ищет ключ именно по нему.
wget https://repo.owfeed.org/9040356b214084da -O /etc/opkg/keys/9040356b214084da

echo "src/gz owfeed-packages https://repo.owfeed.org/releases/24.10/$(. /etc/openwrt_release; echo $DISTRIB_ARCH)" >> /etc/opkg/customfeeds.conf

opkg update && opkg install luci-theme-footstrap
```

Каким бы способом фид ни добавился, не ставьте на том же роутере **ещё и** скачанный пакет:
`apk add ./file.apk` пишет в `/etc/apk/world` пин на хеш содержимого, пин переживает sysupgrade, и
пакет больше никогда не обновится из фида.

### Запасной путь установщика — закреплённая версия или недоступный фид

Та же одна строка уходит сюда сама, когда фид недоступен или закреплён тег:

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh -s v0.9.0
```

Он достаёт релиз из подписанного манифеста, проверяет подпись ключом, зашитым в установщик, и
sha256 пакета — по манифесту, после чего ставит файл. Ничего, кроме ассетов релиза, не нужно —
ради этого случая путь и существует.

### Дальше

Выберите **Footstrap** в **System → System → Language and Style**, поле «Design». Это единственное,
что задаётся на роутере, — всё остальное лежит на соседней вкладке **Footstrap** той же страницы и
принадлежит вашему браузеру, а не роутеру.

<details>
<summary>Почему эта ссылка, а не <code>raw.githubusercontent.com</code></summary>

Ссылка ведёт на **ассет релиза**. GitHub ограничивает raw для неаутентифицированных запросов — 60 в
час на IP-адрес источника, — и за CGNAT или общим выходом этот лимит часто уже израсходован кем-то
другим, так что по raw-ссылке может не скачаться сам установщик. У ассетов релиза такого лимита нет.
Raw по-прежнему работает, если он вам привычнее:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

Ни установка, ни обновление больше не обращаются к `api.github.com`. Оба читают **подписанный
манифест**, публикуемый вместе с релизом, поэтому лимит 60/час не может сломать ни установку, ни
проверку версии (issue #17).

</details>

<details>
<summary>Если не скачивается</summary>

Если роутеру `github.com` недоступен вовсе, установщик есть и на **зеркале** — на том же хосте,
откуда он потом возьмёт пакеты, и это наш хост:

```sh
wget -qO- https://vizzletf.github.io/luci-theme-footstrap/install.sh | sh
```

Если и этот хост недоступен — повторите через GitHub-прокси:

```sh
GITHUB_PROXY=https://gh-proxy.com/ sh -c "$(wget -qO- https://gh-proxy.com/https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh)"
```

Публичные прокси, работавшие на момент написания, — ни один из них не наш, и любой может исчезнуть:
`https://gh-proxy.com/`, `https://ghproxy.net/`, `https://ghfast.top/`, `https://gh.llkk.cc/`.

`GITHUB_PROXY` подставляется только к github-адресам, пробуется первым и откатывается на прямой
путь, так что мёртвый прокси не утащит установку за собой. **Пакеты, которые он отдаёт, безопасны
что бы прокси ни делал** — каждый сверяется с sha256 из подписанного манифеста, так что прокси может
отдать настоящий релиз либо не отдать ничего, но не что-то другое.

Есть и автоматический запасной путь, не требующий ни прокси, ни решения: если `github.com` не
отвечает, установщик пробует **зеркало на GitHub Pages** с тем же подписанным манифестом и теми же
пакетами. Прокси нужен тогда, когда недоступен и этот хост.

</details>

<details>
<summary>Проверить установщик перед запуском</summary>

**Исключение — сам установщик, и оно стоит десяти секунд внимания.** Однострочник выше отдаёт под
root скрипт, скачанный через третью сторону, и никакой подписи на этом этапе ещё не проверено:
цепочка доверия начинается только когда скрипт уже запущен. Если не хочется принимать это на веру —
проверьте заранее (`usign` есть в каждом образе OpenWrt):

```sh
P=https://gh-proxy.com/https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download
wget -qO /tmp/install.sh "$P/install.sh" && wget -qO /tmp/install.sh.sig "$P/install.sh.sig"
cat > /tmp/release.pub <<'EOF'
untrusted comment: luci-theme-footstrap release key
RWQYxjhl4rz41tNZc3dXmnRplRO1ydN1q8as++iPUjZc6SRUCb952L/T
EOF
usign -V -m /tmp/install.sh -x /tmp/install.sh.sig -p /tmp/release.pub && GITHUB_PROXY=https://gh-proxy.com/ sh /tmp/install.sh
```

Ключ выписан выше намеренно: сверьте эти символы с [`release.pub`](release.pub) в репозитории — и
прокси перестаёт участвовать в решении вообще.

</details>

## Дев-роутеры

Четыре штуки — OpenWrt и ImmortalWrt, 25.12 и 24.10 — из одного файла, на любой ОС. Нужны
[owlab](https://github.com/owfeed/owlab) и Docker:

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab up                 # собрать и поднять все четыре
owlab sync --watch       # пересобирать CSS и заливать на каждую правку
owlab open owrt2512      # открыть LuCI в браузере
```

Логин `root`, пароль пустой. Подробности и обоснование — в
[docs/development.md](docs/development.md).

owlab собирает и настоящий пакет: `owlab build` запускает OpenWrt SDK и пишет `dist/<arch>/`,
который [owfeed](https://github.com/owfeed/owfeed) подписывает и публикует, причём ни один
инструмент не зависит от другого. Эта тема — рабочий пример всего пути целиком;
[ECOSYSTEM.md](https://github.com/owfeed/owfeed/blob/main/docs/ECOSYSTEM.md) — карта.

## Пишете luci-app?

В [devkit для разработчиков](https://vizzletf.github.io/luci-theme-footstrap/) — сетка цветовых
токенов, разметка компонентов и проверялка стилей, куда можно вставить свой CSS.

Есть и текстовое руководство:
[как стилизовать приложение LuCI, чтобы оно работало под любой темой](docs/luci-app-styling-guide_ru.md)
— время жизни CSS, неймспейсы, цветовой контракт, детект тёмной темы и что делает эта тема, когда
приложение нарушает правила. Собрано по 30 реальным приложениям и проверено на роутере.

## Документация

Документация для разработчика — в **[docs/](docs/README.md)**: архитектура, дизайн-система, сборка
стилей, SPA-роутер, упаковка и релизный ранбук. Она **на английском**; на русском остаются только
этот README и `CHANGELOG_ru.md`. Начните с [docs/architecture.md](docs/architecture.md) — что такое
тема, — или с [docs/conventions.md](docs/conventions.md) — правила, которым обязана следовать
правка.
