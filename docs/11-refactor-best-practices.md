# Рефакторинг по best practices (SOLID / KISS / DRY)

Итог глубокого ресерча (104 агента, adversarial-verify, high-confidence) +
аудит кода. Что применено и что в roadmap.

## Выводы ресерча (verified)

1. **CSS — слои и токены против override-sprawl.** Слоёная архитектура
   (ITCSS / нативные `@layer`): поздние слои побеждают вне зависимости от
   специфичности → убирает эскалацию оверрайдов. Дизайн-токены (CSS custom
   properties) — прямой DRY-антидот повторяющимся литералам. Реальные LuCI-темы
   (kucat, aurora) гонят цвета из токенов. Снижать sprawl: объединять селекторы,
   снижать специфичность, убирать дубли, избегать `!important`-гонки.
2. **Client JS — baseclass + `E()` + декомпозиция.** Апстрим `menu-bootstrap.js`
   = `baseclass.extend({...})`, строит DOM через `E()` (не innerHTML), render
   делегирует в мелкие методы (renderModeMenu/renderMainMenu/renderTabMenu).
   Для untrusted HTML — safe sinks (`textContent`) или DOMPurify (OWASP).
3. **ucode-шаблоны — общие partials.** Каноничный LuCI-DRY: общий хром в
   header/footer/sysauth-partials, подключаемые через `include()`.
4. **Dead-rule elimination — осторожно.** Coverage-инструменты видят только
   выполненное; JS-инъектируемые классы легко удалить по ошибке.

Источники: itcss (xfive), CSS cascade layers (Smashing/MDN), legacy CSS refactor
(dev.to kathryngrayson), OWASP XSS Cheat Sheet, openwrt/luci, ThemesHowTo,
luci-theme-kucat/aurora/argon.

## Ключевой урок из luci-app-podkop (itdoginfo/podkop)

Podkop — не тема, но образцовый LuCI-фронтенд. Паттерн шаринга кода между
модулями: **композиция, не наследование.** `'require view.podkop.main as main'`
даёт singleton, у которого ВЫЗЫВАЮТ функции (`main.DashboardTab.render()`,
`main.injectGlobalStyles()`); тонкие entrypoints (dashboard.js/section.js по 20
строк) экспортят по одной функции-конфигуратору, а корневой view (`podkop.js`)
их орхестрирует. Вариативность — через колбэки/параметры, не через override
метода класса.

Это снимает ограничение, из-за которого «общая база» через `extend` не
работала (required-модуль = singleton, класс-наследование недоступно).

## Применено (проверено скриншотами, вывод не изменился)

- **Menu JS DRY — через композицию (паттерн podkop).** Общая логика
  (`renderTabMenu` / `renderModeMenu` / `wireThemeToggle` / `bootstrap`, ~90
  строк дубля) вынесена в `menu-footstrap-common.js`, который экспортит
  `bootstrap(renderMainMenu)`. Оба меню `'require menu-footstrap-common as
  common'` и в `__init__` вызывают `common.bootstrap(<свой renderMainMenu>)` —
  layout-специфичный рендер инжектится колбэком (SOLID DI). Осталось только
  `renderMainMenu` в каждом файле (sidebar vertical-collapsible / top
  horizontal-dropdown). Обе раскладки рендерятся, консоль чистая.
- **ucode partials (head).** Дублированный `<head>` вынесен в
  `themes/footstrap/partials/head.ut`, подключается `include()` из обоих
  header'ов. Каноничный LuCI-DRY, один источник правды.
- **Dashboard DRY — leasesCard.** DHCPv4 и DHCPv6 строили идентичные строки-
  таблицы (~40 строк дубля, различие — только поле адреса). Вынесено в
  `leasesCard(title, subLabel, addrHeader, leases, addrOf)`; адрес извлекается
  колбэком `addrOf`. Два вызова вместо двух блоков. Вывод идентичен.
- **Dashboard DRY — nf().** `.fs-nf` (label+value) строился инлайн 10 раз
  (network upstream 6 + wifi radios 4). Вынесено в `nf(label, value)`.
- **CSS токен `--accent-lt`.** Логотип-градиент `#7ec8ff` (дубль в 2 местах) →
  токен `var(--accent-lt)`.
- **CSS.** Все интерполяции в dashboard-JS уже проходят `esc()` (XSS-safe).

## Что НЕ работает в LuCI (зафиксировано)

- Межмодульное **наследование классов** (`base.extend` из другого модуля) —
  `base.extend is not a function` (required = singleton). Плоский объект —
  `factory yields invalid constructor` (модуль обязан вернуть класс).
  → использовать композицию (выше), не наследование.

## Отклонено с обоснованием (не просто «отложено»)

- **CSS `@layer`-миграция — НЕ подходит для темы.** Идея: обернуть базу/оверрайды
  в cascade-layers, чтобы поздние слои побеждали без `!important`. Но:
  **все unlayered-правила побеждают любые layered.** CSS LuCI-приложений
  (грузится через `node.css` per-page: statistics, и т.д.) — **unlayered**.
  Если увести темовый CSS в слои, app-CSS начнёт побеждать темовые правила →
  регрессии на app-специфичных страницах. Поэтому тема, которая обязана
  переопределять произвольный app-CSS, должна оставаться unlayered с высокой
  специфичностью. `@layer` тут — антипаттерн. (Актуально именно для тем; для
  self-contained app как podkop — ок.)
- **Полный переход dashboard на `E()`** вместо innerHTML-шаблонов. Каноничнее,
  но: `E()` использует `document.createElement` (HTML-namespace), а весь дизайн —
  SVG (иконки/бары/кольца) → нужен `createElementNS`, чего `E()` не делает;
  ~250 строк HTML → сотни вызовов. Текущее решение (innerHTML + `esc()` на всех
  интерполяциях + `textContent` для user-данных в меню) XSS-безопасно. Переход
  не оправдан.
