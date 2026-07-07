# Дизайн-система footstrap (из макета «OpenWrt Status Redesign»)

Источник: Claude Design проект `a8c4bddc-b860-4d57-8229-50f157ea06bb`,
файл `OpenWrt Status Redesign.dc.html`. Референс: `docs/design/`.

Макет даёт **два направления одной системы**: 1A Sidebar Console (навигация
слева) и 1B Bento Grid (навигация сверху). Обе используют одинаковые токены и
компоненты — отличается только раскладка хрома. Реализуем в порядке:
**сначала sidebar (1A), потом top nav (1B)**.

## Токены (CSS custom properties)

Обе схемы — один набор переменных, разные значения. Переключатель темы меняет
их на `:root`/wrapper. В LuCI это ложится на механику `data-darkmode` (док 04).

### Dark (по умолчанию)

```css
--bg:          #0a0d13;   /* фон страницы */
--panel:       #111620;   /* карточка/сайдбар/топбар */
--panel2:      #161c28;   /* вложенная плитка (порт, device-strip) */
--border:      #232b3a;
--text:        #e8edf5;
--dim:         #8b95a7;    /* вторичный текст, лейблы */
--accent:      #3ba7ff;
--accent-soft: rgba(59,167,255,.14);  /* фон активного пункта/бейджа */
--track:       #1b2230;    /* трек прогресс-бара, off-состояние */
--good:        #43e0a0;    /* success/link up */
--warn:        #ffb454;    /* warning/half-duplex */
--danger:      #ff6b6b;    /* error/высокая загрузка */
--shadow:      0 1px 2px rgba(0,0,0,.4);
```

### Light

```css
--bg:          #eef1f6;
--panel:       #ffffff;
--panel2:      #f6f8fb;
--border:      #e4e9f1;
--text:        #101725;
--dim:         #5b6675;
--accent:      #1f8fe8;
--accent-soft: rgba(31,143,232,.10);
--track:       #eaeef4;
--good:        #17b978;
--warn:        #e08a1e;
--danger:      #e04f4f;
--shadow:      0 1px 3px rgba(15,23,37,.08);
```

Переключатель knob: dark `--knob-x:3px` (влево), light `--knob-x:27px` (вправо);
`--knob-bg` = accent соответствующей схемы.

## Типографика

- Sans: **Manrope** (400/500/600/700/800) — интерфейс, заголовки.
- Mono: **JetBrains Mono** (400/500/600) — все числовые значения, hostname,
  версии, имена портов, тех.данные.
- Правило: любое машинное/числовое значение → mono. Подписи/лейблы → sans dim.

Размеры (px): заголовок страницы 17/800; заголовок карточки 14/700; KPI-число
27/800 mono; крупное число (кольцо/uptime) 38–40/800 mono; тело 13–14; лейбл
uppercase 11/700 `letter-spacing:.05em`; микроподпись 11–12 dim.

Шрифты грузятся с Google Fonts в макете. **Для темы шрифты надо
самохостить** (роутер офлайн, CSP, приватность) — упаковать `.woff2` в
`htdocs/luci-static/footstrap/fonts/` и объявить `@font-face`. См. док 09.

## Компоненты (визуальные примитивы → на что мапятся в LuCI)

| Компонент макета | Спека | LuCI-класс для стилизации |
|---|---|---|
| **Панель/карточка** | `background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:20px 22px` | `.cbi-section`, `.cbi-map > *`, `.table` контейнеры |
| **KPI-карточка** | radius 15px, padding 15–16, колонка: лейбл-uppercase + число-mono-27 + подпись-dim | нет прямого аналога — блоки status overview |
| **Прогресс-бар** | трек `height:8px; background:var(--track); border-radius:99px`; заливка `background:var(--good/accent/danger)` по % | `.cbi-progressbar` (LuCI рисует его в overview: память/диск) |
| **Бейдж %** | `font:11/700; border-radius:6px; padding:2px 7px`; цвет+фон soft по статусу (danger/accent/good) | инлайн-статус в `.cbi-progressbar`, zonebadge |
| **Pill статуса** | `border-radius:99px; padding:6px 13px`; точка 8px + текст | индикаторы `#indicators .indicator` |
| **Живая точка** | 8px круг, `animation:livepulse 2s infinite` (только good) | online-индикатор в шапке |
| **Пункт меню** | `padding:10px 11px; border-radius:10px; gap:11px`; активный — `background:var(--accent-soft); color:var(--accent)`; неактивный — `color:var(--dim)` | `#topmenu li a`, sidebar nav (наш menu-JS) |
| **Логотип** | 32px квадрат `border-radius:9px; background:linear-gradient(135deg,var(--accent),#7ec8ff)` + белый SVG wifi-иконка + wordmark 16/800 | `.brand` в header.ut |
| **Переключатель темы** | 52×28 pill, knob 22px, `transition:left .28s cubic-bezier(.4,0,.2,1)` | наш JS + `data-darkmode` |
| **Строка таблицы** | `display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--border)`; лейбл dim, значение mono | `.cbi-value`, `.table .tr` |
| **Кольцо (donut)** | SVG r=66, `stroke-width:15`, трек `--track`, дуга по статусу, `stroke-linecap:round` | контент view (не тема) — см. границы |
| **Спарклайн** | inline SVG polyline `stroke:var(--accent); stroke-width:1.8` | контент view (не тема) |
| **Порт-плитка** | `--panel2` фон, radius 12, точка статуса + имя-mono + скорость-dim | контент view (не тема) |

Радиусы-шкала: pill 99px; панель 16–18px (внешняя рамка экрана 22px);
KPI 15px; плитка/бейдж 12/6px; лого/knob 9px; пункт меню 10px.

## Границы: что делает ТЕМА, а что — приложение

**Критично для честных ожиданий.** LuCI рендерит контент страниц на клиенте
из view-JS приложений (`luci-mod-status`, `luci-mod-system`, …). Тема отдаёт
только серверный хром (header/footer) + общий CSS (см. док 01).

Тема **может** (без правки приложений):
- Sidebar/topnav хром, лого, шапку страницы, pill uptime, переключатель темы.
- Задать весь дизайн-язык через `cascade.css` + переменные: панели, радиусы,
  шрифты, цвета. Стандартные виджеты (cbi-таблицы, `.cbi-progressbar`, кнопки,
  alert, dropdown, вкладки) станут выглядеть в новом стиле.
- Стандартный Status→Overview автоматически получит панели-карточки, mono-числа,
  цветные прогресс-бары памяти/диска.

Тема **не может** (это контент, а не оформление):
- Превратить overview в точный KPI-дэшборд с кольцом памяти, спарклайном load,
  графической «задней панелью» портов. Такой layout генерит view-JS
  (`luci-mod-status/.../view/status/include/*.js`) — его структура фиксирована
  приложением. Кольцо/спарклайн/port-strip — это **отдельный view-мод**
  (пакет `luci-app-*` или переопределение status include), фаза за рамками темы.

**Вывод по фазам:**
1. **Тема (сейчас):** хром sidebar/topnav + дизайн-язык CSS. Overview выглядит
   стильно, но структурно стандартный.
2. **Опционально позже:** кастомный status-view (KPI/кольцо/порты как в макете) —
   отдельный пакет-мод, использует токены темы.

Эта дока описывает полную систему; доки 09 (sidebar) и 10 (topnav) — что именно
и как из неё реализуется в теме.
