#!/bin/sh
# Bring one owlab router up for a CI job: from the image a green e2e saved this week when the job
# restored one, otherwise built, and built again when the build failed, stalled or never served
# LuCI.
#
#   sh tools/ci-stand.sh <router>
#
# `owlab up` exits 1 when the router is missing a package from `packages:` or never answered on HTTP
# (owlab 0.6.7); buildkit may have cached the layer that came out short, so a retry is a --rebuild.
# No byte of this theme is on the router yet, so a retry here cannot pass a theme regression: it
# absorbs a Docker Hub, downloads.openwrt.org or GitHub release hiccup.
set -u

r="${1:?usage: ci-stand.sh <router>}"

# owlab's HTTP check asks for `/`, which uhttpd answers while LuCI's dispatcher is broken.
luci() {
	port=$(timeout -k 10 60 owlab status -json | jq -r --arg r "$r" '.routers[] | select(.id == $r) | .http_port')
	# A clock, not a count: a port that accepts and never answers spends curl's 5 s on each try.
	end=$(($(date +%s) + 90))
	while [ "$(date +%s)" -lt "$end" ]; do
		case "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci/")" in
			200|403) return 0 ;;
		esac
		sleep 2
	done
	return 1
}

# The image the job restored (build.yml, anchor-mutants.yml; a green e2e saved it this week):
# started as it is, fetching and building nothing. `owlab up --no-build` refuses an image whose
# label is not this owlab's and this owlab.yaml's, and then, or on anything else short of LuCI
# answering, the router is built below.
img="$HOME/.cache/owlab-stand/$r.tar"
if [ -f "$img" ]; then
	if timeout -k 10 120 docker load -q -i "$img" && timeout -k 30 180 owlab up --no-build "$r" && luci; then
		exit 0
	fi
	echo "::warning title=Saved router image::$r did not come up from $img; building it"
	timeout -k 10 120 owlab down "$r" >/dev/null 2>&1 || true
fi

i=1
while [ "$i" -le 3 ]; do
	flags=
	[ "$i" -gt 1 ] && flags=--rebuild
	rc=0
	why=
	# shellcheck disable=SC2086 # $flags is empty or one word
	timeout -k 30 420 owlab up $flags "$r" || rc=$?
	if [ "$rc" -eq 0 ]; then
		luci && exit 0
		why="; LuCI did not answer on /cgi-bin/luci/ within 90 s"
	fi
	echo "::warning title=Router attempt $i of 3 failed (infrastructure)::owlab up exit $rc$why"
	timeout -k 10 120 owlab down "$r" >/dev/null 2>&1 || true
	[ "$i" -lt 3 ] && sleep $((i * 20))
	i=$((i + 1))
done
# One of the titles .github/workflows/rerun-infra.yml re-runs a run by, so it stays word for word.
# %2C: a bare comma ends a workflow command's property, and the title would stop at it.
echo "::error title=The router did not come up (infrastructure%2C not the theme)::$r"
exit 1
