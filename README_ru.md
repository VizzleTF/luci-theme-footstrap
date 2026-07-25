# LUCI-THEME-FOOTSTRAP

[English](README.md) · **Русский** ·
**[Песочница — всё можно потрогать без роутера](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

<img src="assets/readme/overview-top-dark.png" width="100%" alt="Тот же обзор в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">

[Ещё скриншоты →](docs/screenshots/)

## Что умеет

<br clear="left">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/appearance-dark.png">
  <img align="right" width="279" src="assets/readme/appearance-light.png" alt="Попап Appearance: раскладка, тема, палитра, плотность, обои, оттенок, акцент, скругление, подменю, обновления и Save/Reset как умолчание роутера.">
</picture>

### Стилизует приложения, а не только стоковые страницы.

### Работает на телефоне.

### Лёгкая.

### Быстрее bootstrap

### Умеет обновляться сама.

### Свои настройки внешнего вида.


На роутере вы один раз выбираете **Footstrap** в **System → System → Language and Style**. Каждая ось
справа — настройка *браузера*: применяется сразу, без перезагрузки страницы.

- **Layout** — боковое меню или верхняя панель
- **Theme** — auto (следит за системой), светлая или тёмная
- **Palette** — Footstrap (цвета GitHub Primer) или Hi-Contrast
- **Density** — компактная, обычная или крупная
- **Wallpaper** — выключены, коты или своя картинка
- **Tint** — подмешивает оттенок в фон, чтобы понимать, какому роутеру принадлежит вкладка (или
  скриншот в тикете)
- **Accent** — перекрашивает кнопки, тумблеры, ползунки и кольца фокуса
- **Rounding** — радиус скругления, 0–20px
- **Submenus** — держать несколько разделов меню открытыми или сворачивать до одного

Понравившийся набор можно сохранить умолчанием для роутера — новый браузер начнёт с него.
<br clear="right">


## Замерено, а не заявлено

<br clear="right">
<img src="assets/readme/speed.svg" width="720" alt="Замер: Wireless status 288 мс → 16 мс, Interfaces 367 → 63, DNS 328 → 84, Firewall zones 300 → 88. Весь прогон из 36 страниц 7458 → 3196 мс, в 2.33 раза; медианная страница в 3.04 раза; запросов на страницу 15–48 → 0–8.">

<br clear="right">

## Установка

<br clear="right">

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Дальше выберите **Footstrap** в **System → System → Language and Style**, поле «Design». Это
единственное, что задаётся на роутере. Нужна конкретная версия — добавьте тег: `... | sh -s v0.9.0`.

Ссылка ведёт на **ассет релиза**, а не на `raw.githubusercontent.com`. GitHub ограничивает raw для
неаутентифицированных запросов — 60 в час на IP-адрес источника, — и за CGNAT или общим выходом этот
лимит часто уже израсходован кем-то другим, так что по raw-ссылке может не скачаться сам установщик.
У ассетов релиза такого лимита нет. Raw по-прежнему работает, если он вам привычнее:
`wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh`.

Ни установка, ни обновление больше не обращаются к `api.github.com`. Оба читают **подписанный
манифест**, публикуемый вместе с релизом, поэтому лимит 60/час не может сломать ни установку, ни
проверку версии (issue #17).

### Если не скачивается

Если роутеру `github.com` недоступен вовсе — повторите через GitHub-прокси:

```sh
GITHUB_PROXY=https://gh-proxy.com/ sh -c "$(wget -qO- https://gh-proxy.com/https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh)"
```

Публичные прокси, работавшие на момент написания, — ни один из них не наш, и любой может исчезнуть:
`https://gh-proxy.com/`, `https://ghproxy.net/`, `https://ghfast.top/`, `https://gh.llkk.cc/`.

`GITHUB_PROXY` подставляется только к github-адресам, пробуется первым и откатывается на прямой
путь, так что мёртвый прокси не утащит установку за собой. **Пакеты, которые он отдаёт, безопасны
что бы прокси ни делал** — каждый сверяется с sha256 из подписанного манифеста, так что прокси может
отдать настоящий релиз либо не отдать ничего, но не что-то другое.

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

Есть и автоматический запасной путь, не требующий ни прокси, ни решения: если `github.com` не
отвечает, установщик пробует **зеркало на GitHub Pages** с тем же подписанным манифестом и теми же
пакетами. Прокси нужен тогда, когда недоступен и этот хост.

<br clear="right">

## Пишете luci-app?

<br clear="right">


В [devkit для разработчиков](https://vizzletf.github.io/luci-theme-footstrap/) — сетка цветовых
токенов, разметка компонентов и проверялка стилей, куда можно вставить свой CSS.

Есть и текстовое руководство:
[как стилизовать приложение LuCI, чтобы оно работало под любой темой](docs/20-luci-app-styling-guide.ru.md)
— время жизни CSS, неймспейсы, цветовой контракт, детект тёмной темы и что делает эта тема, когда
приложение нарушает правила. Собрано по 30 реальным приложениям и проверено на роутере.
