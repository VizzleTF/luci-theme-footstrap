# Архитектура LuCI в OpenWrt 25.12+: как рендерятся темы

> Источник: исходники `openwrt/luci` (master, из него собирается LuCI для 25.12),
> проверено на живом роутере OpenWrt 25.12.2 (r32802, LuCI bootstrap 26.134).

## Ключевой сдвиг: ucode вместо Lua

Начиная с ветки, попавшей в 23.05+, и полностью в 25.12, LuCI работает на **ucode**
(си-подобный скриптовый язык от авторов OpenWrt), а не на Lua:

- Диспетчер: `/usr/share/ucode/luci/dispatcher.uc`
- Рантайм: `/usr/share/ucode/luci/runtime.uc`
- Шаблоны: `*.ut` (ucode templates) в `/usr/share/ucode/luci/template/`
- Страницы (views) рендерятся **на клиенте** JavaScript-ом (`luci.js`, модули в
  `/www/luci-static/resources/view/**`). Сервер отдаёт только "скорлупу":
  header + пустой `<div id="view">` + footer.

Для темы это значит: **тема = серверная скорлупа (header/footer на ucode) + CSS +
клиентский JS для меню**. Никакого Lua, никаких серверных контроллеров.

## Как LuCI выбирает тему (runtime.uc)

Точный алгоритм из `modules/luci-base/ucode/runtime.uc`:

```ucode
// determine theme
let media = uci.get('luci', 'main', 'mediaurlbase');          // напр. '/luci-static/mytheme'
let status = self.trycompile(`themes/${basename(media)}/header`);

if (status !== true) {
    media = null;
    self.env.media_error = status;
    // fallback: перебор всех зарегистрированных тем из luci.themes
    for (let k, v in uci.get_all('luci', 'themes')) {
        if (substr(k, 0, 1) != '.') {
            status = self.trycompile(`themes/${basename(v)}/header`);
            if (status === true) { media = v; break; }
        }
    }
    if (!media)
        env.dispatcher.error500(`Unable to render any theme header template...`);
}

self.env.media    = media;              // '/luci-static/mytheme'
self.env.theme    = basename(media);    // 'mytheme'
self.env.resource = uci.get('luci', 'main', 'resourcebase');  // '/luci-static/resources'
```

Выводы:

1. Имя темы = `basename(mediaurlbase)`. Шаблон обязан лежать в
   `/usr/share/ucode/luci/template/themes/<имя>/header.ut`.
2. Если header темы не компилируется — LuCI молча откатывается на первую рабочую
   тему из `luci.themes` и показывает индикатор "Theme fallback" с текстом ошибки
   (см. `footer.ut` luci-base, переменная `media_error`). Удобно для отладки:
   синтаксическая ошибка в header не кладёт интерфейс.
3. `resource` всегда `/luci-static/resources` — общие ресурсы luci-base (luci.js,
   cbi.js, иконки), темам их трогать нельзя.

## Конвейер рендеринга страницы

`modules/luci-base/ucode/template/view.ut` — то, что рендерит диспетчер для любой
страницы:

```
view.ut
 ├─ include('header')                 → luci-base header.ut
 │    ├─ include(`themes/${theme}/header`)   ← ВАШ header.ut (весь HTML до контента)
 │    └─ <script src="{{resource}}/luci.js?v=..."> + L = new LuCI({...env...})
 ├─ <div id="view"> + ui.instantiateView('<view>')   ← клиентский рендер страницы
 └─ include('footer')                 → luci-base footer.ut
      ├─ apply/rollback триггеры, индикатор media_error
      └─ include(`themes/${theme}/footer`)   ← ВАШ footer.ut (закрыть теги, меню-JS)
```

Т.е. тема НЕ вызывается напрямую — её header/footer включаются обёртками luci-base.
`luci.js` подключает сам luci-base **после** header темы. Кэш-бастинг через
`?v=<версия>-<pkgs_update_time>`.

## Страница логина (sysauth)

Диспетчер (`dispatcher.uc`) при показе логина пробует шаблон темы:

```ucode
let theme_sysauth = `themes/${basename(runtime.env.media)}/sysauth`;
if (runtime.is_ucode_template(theme_sysauth) || runtime.is_lua_template(theme_sysauth))
    // рендерит его, при ошибке — media_error и generic sysauth.ut
```

Если у темы нет `sysauth.ut` — используется общий `sysauth.ut` из luci-base.
Bootstrap имеет свой: серверный `sysauth.ut` (скрытая `<section hidden>` с формой,
data для JS) + клиентский view `htdocs/luci-static/resources/view/bootstrap/sysauth.js`,
который рисует форму через `ui.instantiateView('bootstrap.sysauth')`.

## Меню — целиком на клиенте

Серверный header темы выводит только пустые контейнеры:

```html
<ul class="nav" id="topmenu" style="display:none"></ul>
<div id="tabmenu" style="display:none"></div>
<ul class="breadcrumb pull-right" id="modemenu" style="display:none"></ul>
```

Footer темы грузит JS-модуль: `<script>L.require('menu-bootstrap')</script>`.
Файл `htdocs/luci-static/resources/menu-<тема>.js` — baseclass, в `__init__`
делает `ui.menu.load().then(tree => this.render(tree))` и наполняет контейнеры
(`renderModeMenu` / `renderMainMenu` / `renderTabMenu`). Дерево меню приходит
с сервера JSON-ом (права уже отфильтрованы).

**Важно**: menu-JS кладётся в `htdocs/luci-static/resources/` (не в каталог темы),
потому что грузится через `L.require()`, который ищет в `resourcebase`.

## Регистрация темы в UCI

Конфиг `/etc/config/luci`:

```
config core 'main'
    option mediaurlbase '/luci-static/bootstrap'   # активная тема
    option resourcebase '/luci-static/resources'

config internal 'themes'
    option Bootstrap '/luci-static/bootstrap'       # список доступных тем
    option BootstrapDark '/luci-static/bootstrap-dark'
    option MyTheme '/luci-static/mytheme'           # ← ваша
```

Выпадающий список тем в System → System → Language and Style строится из секции
`themes`. Регистрация — через `uci-defaults` скрипт пакета (см. док 02).

## Схема каталогов в рантайме (на роутере)

```
/usr/share/ucode/luci/template/themes/<тема>/   header.ut, footer.ut, [sysauth.ut]
/www/luci-static/<тема>/                        cascade.css, logo.svg, ...
/www/luci-static/resources/menu-<тема>.js       клиентский рендер меню
/www/luci-static/resources/view/<тема>/         [опц.] JS-views темы (sysauth.js)
/etc/uci-defaults/30_luci-theme-<тема>          регистрация в uci (выполняется 1 раз)
```
