# LUCI-THEME-FOOTSTRAP

[English](README.md) · **Русский** ·
**[Песочница — всё можно потрогать без роутера](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

<img src="assets/readme/overview-top-dark.png" width="100%" alt="Тот же обзор в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">

[Ещё скриншоты →](docs/screenshots/)

<img src="assets/readme/section-what.svg" width="100%" alt="Что умеет">

<br clear="left">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/appearance-dark.png">
  <img align="right" width="279" src="assets/readme/appearance-light.png" alt="Попап Appearance: раскладка, тема, палитра, плотность, обои, оттенок, акцент, скругление, подменю, обновления и Save/Reset как умолчание роутера.">
</picture>

## Стилизует приложения, а не только стоковые страницы.

## Работает на телефоне.

## Лёгкая.

## Быстрее bootstrap

## Умеет обновляться сама.

## Свои настройки внешнего вида.


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


<img src="assets/readme/section-speed.svg" width="100%" alt="Замерено, а не заявлено">

<br clear="right">
<img src="assets/readme/speed.svg" width="720" alt="Замер: Wireless status 288 мс → 16 мс, Interfaces 367 → 63, DNS 328 → 84, Firewall zones 300 → 88. Весь прогон из 36 страниц 7458 → 3196 мс, в 2.33 раза; медианная страница в 3.04 раза; запросов на страницу 15–48 → 0–8.">

<br clear="right">

<img src="assets/readme/section-install.svg" width="100%" alt="Установка">

<br clear="right">

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

Дальше выберите **Footstrap** в **System → System → Language and Style**, поле «Design». Это
единственное, что задаётся на роутере. Нужна конкретная версия — добавьте тег: `... | sh -s v0.9.0`.

<br clear="right">

<img src="assets/readme/section-devkit.svg" width="100%" alt="Пишете luci-app?">

<br clear="right">

В [devkit для разработчиков](https://vizzletf.github.io/luci-theme-footstrap/) — сетка цветовых
токенов, разметка компонентов и проверялка стилей, куда можно вставить свой CSS.

Есть и текстовое руководство:
[как стилизовать приложение LuCI, чтобы оно работало под любой темой](docs/20-luci-app-styling-guide.ru.md)
— время жизни CSS, неймспейсы, цветовой контракт, детект тёмной темы и что делает эта тема, когда
приложение нарушает правила. Собрано по 30 реальным приложениям и проверено на роутере.

## Лицензия

Тема под Apache-2.0, и это не свободный выбор: `styles/base/` начинался как форк `cascade.css` из
[luci-theme-bootstrap](https://github.com/openwrt/luci), ucode-шаблоны производны от шаблонов LuCI, а
часть JS-хелперов скопирована из LuCI дословно. Всё это Apache-2.0, его notices едут вместе с ним, и
экосистема LuCI/OpenWrt тоже Apache-2.0.

Встроенные шрифты под неё не попадают. Manrope и JetBrains Mono — под
[SIL Open Font License 1.1](luci-theme-footstrap/htdocs/luci-static/footstrap/fonts/OFL.txt); её текст
и notices едут рядом со шрифтами, как того требует сама лицензия.

---

Внутреннее устройство, сборка и заметки по разработке — в [docs/](docs/). Ассеты самого README лежат в
[assets/readme/](assets/readme/), скриншоты воспроизводятся скриптом
[tools/readme-shots.py](tools/readme-shots.py).
