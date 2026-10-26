#!/bin/sh
# What a router was doing when a check went red: the container's state, its processes, whether rpcd
# and uhttpd still answered, uhttpd's settings and the last 300 lines of its log.
#
#   sh tools/ci-stand-state.sh <router> <file>
#
# The one stand death on record (run 40168981468) left nothing to name its cause by. Best effort:
# it decides nothing, and a dead container must not turn the step red. Every docker call has a
# clock, because it also runs between a check and its retry on a fresh router.
r="${1:?usage: ci-stand-state.sh <router> <file>}"
out="${2:?usage: ci-stand-state.sh <router> <file>}"
mkdir -p "$(dirname "$out")"
# owlab asks Docker for each router's state, so it gets a clock as well
c="owlab-$(timeout -k 10 30 owlab status -json | jq -r .project)-$r"
{
	date -u
	timeout 30 docker inspect -f '{{json .State}}' "$c"
	timeout 30 docker stats --no-stream "$c"
	free -m
	uptime
	timeout 60 docker exec "$c" sh -c '
		cat /proc/loadavg; ps w
		ubus -t 5 call session access "{\"ubus_rpc_session\":\"00000000000000000000000000000000\",\"object\":\"session\",\"function\":\"login\"}"
		echo "rpcd=$?"
		wget -q -T 5 -O /dev/null http://127.0.0.1/luci-static/resources/luci.js
		echo "uhttpd=$?"
		uci show uhttpd.main
		netstat -ltn
		logread | tail -n 300'
	timeout 30 docker logs --tail 300 "$c"
} >"$out" 2>&1
exit 0
