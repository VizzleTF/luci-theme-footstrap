# luci-theme-footstrap

Тема LuCI для OpenWrt 24.10 и новее. Зависит только от `luci-base`, оформляет каждую страницу LuCI,
включая сторонние `luci-app-*`, и не трогает то, что приложение оформляет само. Работает на телефоне и ставится на его домашний
экран. 21 настройка внешнего вида (раскладка, палитра, плотность, цвета, обои) применяется без
перезагрузки страницы.

[English](README.md) · [Песочница: тема в браузере, роутер не нужен](https://vizzletf.github.io/luci-theme-footstrap/playground/)

<picture>
  <source media="(max-width: 767px)" srcset="assets/readme/phone-menu-dark.png">
  <img src="assets/readme/overview-top-dark.png" width="100%" alt="Страница обзора в тёмной теме с верхней панелью: меню стоит в строке бренда, контент идёт во всю ширину.">
</picture>

## Установка

Нужны OpenWrt 24.10 или новее и браузер не старше Chrome 108, Firefox 101 или Safari 15.4. На 23.05
установщик ставит 0.14.2: более новые версии используют виджет LuCI, которого в 23.05 нет.

Выполните на роутере под root, по SSH:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

Скрипт добавляет фид пакетов темы, проверяет подпись и контрольную сумму пакета и ставит тему.
Потом печатает, что сделал: поставил, обновил с такой-то версии или всё уже актуально. Новые версии дальше приходят вместе с `apk upgrade` или `opkg upgrade`
роутера.

Если `raw.githubusercontent.com` отвечает 429 (общий выход или CGNAT), запустите подписанную копию,
приложенную к последнему релизу:

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Затем откройте **System → System → Language and Style**, выберите **Footstrap** в поле **Design** и
нажмите **Save & Apply**. Удалить тему: `apk del luci-theme-footstrap` (или
`opkg remove luci-theme-footstrap`); LuCI вернётся к bootstrap.

## Скорость

На том же роутере медианная страница отрисовывается в 3.03 раза быстрее, чем со стоковой темой
bootstrap. Обход 38 страниц занимает 4.9 с вместо 11.3 с. Методика и данные:
[docs/benchmark.md](docs/benchmark.md).

## Ссылки

- [Скриншоты](docs/screenshots/)
- [Документация для разработчика](docs/README.md), на английском: начните с
  [architecture.md](docs/architecture.md) и [conventions.md](docs/conventions.md)
- [Как оформить `luci-app`, чтобы он работал под любой темой](docs/luci-app-styling-guide_ru.md) и
  [devkit](https://vizzletf.github.io/luci-theme-footstrap/), который проверяет его CSS
- [История изменений](CHANGELOG_ru.md) · [Фид пакетов](https://owfeed.org/install/ru/) ·
  [Лицензия: Apache-2.0](LICENSE)
