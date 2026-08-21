# LUCI-THEME-FOOTSTRAP

[English](README.md) · **Русский** ·
**[Песочница — всё можно потрогать без роутера](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap.json)](https://owfeed.org/install/ru/)
[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap-releases.json)](https://owfeed.org/install/ru/)

Тема LuCI для OpenWrt 23.05 и новее. Без фреймворка, единственная зависимость — `luci-base`.

> **23.05** поддерживается и проверяется наравне с остальными: перед каждым релизом те же живые
> проверки прогоняются на роутере 23.05. Единственное, чего в этом выпуске нет, — `ui.RangeSlider`
> (появился в 24.10), поэтому ползунки на вкладке Appearance там свои, с той же разметкой и
> поведением.

<picture>
  <source media="(max-width: 767px)" srcset="assets/readme/phone-menu-dark.png">
  <img src="assets/readme/overview-top-dark.png" width="100%" alt="Тот же обзор в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">
</picture>

<details>
<summary>Настройки внешнего вида</summary>

<img src="assets/readme/appearance-dark.png" width="100%" alt="Вкладка Footstrap в «Система → Система»: раскладка, тема, палитра, плотность и скругление; поля цвета для акцента, статусов и поверхностей — каждое со словесной оценкой контраста; выбор обоев с котами на фоне страницы; и «Сохранить как умолчание» рядом с двумя сбросами.">

</details>

## Установка

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

Скрипт добавляет свой фид пакетов и ставит тему из него. Дальше тема обновляется вместе с роутером:
`apk update && apk upgrade` (или `opkg`). Повторный запуск обновляет тему и печатает, что именно
сделал — поставил, обновил с какой версии или всё уже актуально.

`raw.githubusercontent.com` лимитируется по адресу, поэтому если он ответил 429 (общий выход, CGNAT),
тот же скрипт приложен к каждому релизу и раздаётся с CDN без такого лимита — с подписью, так что его
можно проверить до запуска:

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

После этого выберите **Footstrap** в **System → System → Language and Style**, поле «Design».

[Ещё скриншоты →](docs/screenshots/)

## Что умеет

- **Стилизует любую страницу, стоковую и нет** — но не перебивает то, что приложение красит само
- **Работает на телефоне** и ставится на его домашний экран — иконка, своё окно, без адресной строки
- **Быстрее bootstrap** — цифры ниже
- **Обновляется вместе с роутером**, из фида пакетов
- **Двадцать одна ось внешнего вида**, применяются сразу, всё в одной вкладке

## Замерено, а не заявлено

Время до первой отрисовки, тот же роутер, те же страницы.

| Страница | bootstrap | footstrap |
|---|---:|---:|
| Wireless status | 271 мс | **54 мс** |
| Interfaces | 374 мс | **111 мс** |
| DNS | 329 мс | **108 мс** |
| Firewall zones | 311 мс | **79 мс** |
| Прогон 38 страниц | 11 306 мс | **4933 мс** |
| Запросов/стр. | 15–47 | **0–7** |

Медианная страница — **в 3.03 раза быстрее**, весь прогон — **в 2.29 раза**. Процессорное время
роутера на тот же обход: 37.3 с против **18.4 с**. Замерено на железе, пять прогонов; методика и
полные данные — [docs/benchmark.md](docs/benchmark.md).

## Документация

Документация для разработчика — в **[docs/](docs/README.md)**: архитектура, дизайн-система, сборка
стилей, SPA-роутер, упаковка, релизный ранбук. Она **на английском**; на русском остаются только
этот README и `CHANGELOG_ru.md`. Начните с [architecture.md](docs/architecture.md) — что такое
тема, — или с [conventions.md](docs/conventions.md) — правила, которым обязана следовать правка.

Пишете `luci-app`? Прочитайте,
[как стилизовать его, чтобы он работал под любой темой](docs/luci-app-styling-guide_ru.md), и
вставьте свой CSS в [devkit](https://vizzletf.github.io/luci-theme-footstrap/) — сетка токенов,
разметка компонентов, проверялка стилей.
