# LUCI-THEME-FOOTSTRAP

[English](README.md) · **Русский** ·
**[Песочница — всё можно потрогать без роутера](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap.json)](https://owfeed.org/install/ru/)
[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap-releases.json)](https://owfeed.org/install/ru/)

<picture>
  <source media="(max-width: 767px)" srcset="assets/readme/phone-menu-dark.png">
  <img src="assets/readme/overview-top-dark.png" width="100%" alt="Тот же обзор в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">
</picture>

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Добавляет свой фид пакетов и ставит из него — дальше тема обновляется вместе с роутером,
`apk update && apk upgrade`.

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

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Скрипт добавляет свой фид пакетов и ставит тему из него, поэтому дальше всё сводится к
`apk update && apk upgrade` (или `opkg`) — тема обновляется вместе с остальным роутером.

После этого выберите **Footstrap** в **System → System → Language and Style**, поле «Design». Это
единственное, что задаётся на роутере; всё остальное лежит на соседней вкладке **Footstrap** той же
страницы и принадлежит вашему браузеру.

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
