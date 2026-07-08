#!/bin/sh
# Залить тему footstrap (sidebar + top-nav варианты) на роутер (ssh router).
# Регистрирует темы, НЕ активирует.
set -e

R="${1:-router}"
N=footstrap
D="$(cd "$(dirname "$0")" && pwd)"

ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N \
	/usr/share/ucode/luci/template/themes/$N-top \
	/www/luci-static/$N /www/luci-static/resources/view/$N \
	/www/luci-static/resources/view/status/include"

# sidebar templates (+ partials/) + top-nav templates
scp -q  "$D"/ucode/template/themes/$N/*.ut      "$R":/usr/share/ucode/luci/template/themes/$N/
ssh "$R" "mkdir -p /usr/share/ucode/luci/template/themes/$N/partials"
scp -q  "$D"/ucode/template/themes/$N/partials/*.ut "$R":/usr/share/ucode/luci/template/themes/$N/partials/
scp -q  "$D"/ucode/template/themes/$N-top/*.ut  "$R":/usr/share/ucode/luci/template/themes/$N-top/

# shared static (cascade.css, fonts, logo) + menu renderers (+ shared common)
scp -qr "$D"/htdocs/luci-static/$N/*                     "$R":/www/luci-static/$N/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N-common.js "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N.js        "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/menu-$N-top.js    "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/fs-select.js      "$R":/www/luci-static/resources/
scp -q  "$D"/htdocs/luci-static/resources/view/$N/*      "$R":/www/luci-static/resources/view/$N/
scp -q  "$D"/htdocs/luci-static/resources/view/status/include/05_${N}_dashboard.js \
	"$R":/www/luci-static/resources/view/status/include/

ssh "$R" "
# media symlinks (dark/light + top share the footstrap assets dir)
cd /www/luci-static
ln -sf $N $N-dark; ln -sf $N $N-light
ln -sf $N $N-top; ln -sf $N $N-top-dark; ln -sf $N $N-top-light
# template symlinks (dark/light reuse base templates per layout)
cd /usr/share/ucode/luci/template/themes
ln -sf $N $N-dark; ln -sf $N $N-light
ln -sf $N-top $N-top-dark; ln -sf $N-top $N-top-light
# register (idempotent)
uci -q get luci.themes.Footstrap >/dev/null || {
	uci set luci.themes.Footstrap=/luci-static/$N
	uci set luci.themes.FootstrapDark=/luci-static/$N-dark
	uci set luci.themes.FootstrapLight=/luci-static/$N-light
	uci commit luci
}
uci -q get luci.themes.FootstrapTop >/dev/null || {
	uci set luci.themes.FootstrapTop=/luci-static/$N-top
	uci set luci.themes.FootstrapTopDark=/luci-static/$N-top-dark
	uci set luci.themes.FootstrapTopLight=/luci-static/$N-top-light
	uci commit luci
}
touch /lib/apk/db/installed
rm -f /tmp/luci-indexcache*"

echo "synced to $R (sidebar + top-nav registered, active theme unchanged)"
