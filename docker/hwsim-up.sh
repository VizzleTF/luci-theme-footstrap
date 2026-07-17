#!/bin/sh
# Give the dev containers wifi: virtual radios, real hostapd, real scans.
#
#   docker/hwsim-up.sh          # build if needed, load, hand out radios, configure
#   docker/hwsim-up.sh --down   # unload; the containers lose their radios
#
# Run it after `docker compose up`, and again after a container is recreated — a phy lives
# in a network namespace, and when that namespace dies the phy goes back to the host.
#
# WHY IT IS NOT PART OF THE IMAGE. A radio is a kernel object, and the kernel here belongs
# to the HOST (WSL): a container brings its own userland, never its own kernel. So the
# radios cannot be built, loaded or owned by the image — only handed to it. Three
# consequences worth knowing before touching this:
#
#   * OpenWrt's own `kmod-mac80211-hwsim` is useless here. It is built against OpenWrt's
#     6.12 kernel; this box runs 6.18.33.2-microsoft-standard-WSL2.
#   * Microsoft ships that kernel with `CONFIG_MAC80211_HWSIM is not set` (mac80211 and
#     cfg80211 themselves ARE there, as modules, for USB adapters over usbipd), so the
#     module is built from the WSL kernel's own source at the tag the running kernel came
#     from. See hwsim/build.sh — it takes a few minutes, once.
#   * A REAL Windows wifi adapter cannot be forwarded instead. usbipd-win only forwards USB
#     devices, and the WSL kernel carries drivers for almost no adapter — a built-in PCIe
#     card is not forwardable at all. Virtual radios are not a compromise on fidelity here;
#     they are the only radios this kernel can have.
#
# Nothing is installed on the host and no sudo is used: the module is built in a throwaway
# ubuntu container and loaded from a privileged one. That is not a trick — being in the
# `docker` group is already root-equivalent on this machine.
set -eu

cd "$(dirname "$0")"
KO_DIR="$(pwd)/hwsim"
KO="$KO_DIR/mac80211_hwsim.ko"
HELPER=ubuntu:24.04
# THREE radios per box, and the third one is a CLIENT, not decoration: Associated Stations
# is a data table this theme keeps getting wrong (issue #7, twice), and with nobody
# associated it renders "No information available" — so the one table whose column crush
# the measured card-stacking exists to catch had no rows on either dev box. A station
# cannot be faked in a lease file: it comes from ubus/iwinfo, i.e. from a real association.
#
# It needs a radio of its OWN because a phy has ONE channel: the client must sit on the
# main AP's channel (6), and the neighbour must not — that is its whole job. Two radios
# forced a choice between the neighbour's channel and having a client at all.
RADIOS=6

# 2.4 GHz ONLY, and that is a limit of this kernel, not a shortcut.
#
# cfg80211 forbids beaconing on every 5 GHz channel here (`PASSIVE-SCAN` in `iw reg get`)
# because it never loads regulatory.db, so the built-in "world" domain is all it has. The
# database cannot be supplied: the WSL kernel resolves a firmware path in a namespace that
# is neither the container's nor the Ubuntu root — regulatory.db placed in BOTH still gave
# `Direct firmware load for regulatory.db failed with error -2` — and
# CONFIG_CFG80211_REQUIRE_SIGNED_REGDB=y rules out handing it one another way.
#
# hwsim's own `regtest` modes bypass the database by applying a driver-supplied domain, and
# that WAS tried: mode 6 gives 5 GHz to only some of the radios (the first two get custom
# domains, the rest stay on world), which would make the two containers behave differently
# for no reason a reader could guess. 2.4 GHz only, identical on both boxes, is the honest
# trade — and the UI surface is the same either way.
#
# The neighbour radio is what makes Channel Analysis show more than one channel: a scan
# shows what other radios are beaconing, so each box carries a neighbour of its own on
# channel 11.
#
# The MEDIUM IS GLOBAL TO THE MODULE — it does NOT stop at a network namespace, and this
# file used to claim the opposite ("a box can only ever hear radios it owns"), which is
# what made "give the box its own neighbour" look mandatory. Measured: a client on 2512
# associated with 2410's AP, and a scan from 2512 lists 2410's SSIDs. Every radio here
# hears every other one, whichever container holds it. So each box owns a neighbour
# because it must not DEPEND on the sibling being up — not because it cannot hear it.

pid_of() { docker inspect -f '{{.State.Pid}}' "$1"; }
in_ct()  { docker exec "$1" sh -c "$2"; }

# A privileged container in the HOST's network and pid namespaces: this is what stands in
# for `sudo` on the host, and it is where every kernel-side step happens.
host_helper() {
	docker run --rm --privileged --net=host --pid=host \
		-v /lib/modules:/lib/modules:ro -v "$KO_DIR:/ko:ro" \
		"$HELPER" bash -c "
			apt-get update -qq >/dev/null 2>&1
			DEBIAN_FRONTEND=noninteractive apt-get install -y -qq kmod iw >/dev/null 2>&1
			$1"
}

if [ "${1:-}" = "--down" ]; then
	host_helper 'rmmod mac80211_hwsim 2>&1 || echo "not loaded"'
	echo "hwsim unloaded — the containers have no radios until this script runs again."
	exit 0
fi

if [ ! -f "$KO" ]; then
	echo "==> building mac80211_hwsim for $(uname -r) (a few minutes, once)"
	docker run --rm -v "$(pwd)/hwsim:/hwsim:ro" -v "$KO_DIR:/out" "$HELPER" bash /hwsim/build.sh
fi

echo "==> loading hwsim ($RADIOS radios)"
# Idempotent: an already-loaded module owns the radios the containers are using, and
# reloading it would take them away mid-session.
host_helper "
	lsmod | grep -q '^mac80211_hwsim' && { echo 'already loaded'; exit 0; }
	modprobe cfg80211 && modprobe mac80211
	insmod /ko/mac80211_hwsim.ko radios=$RADIOS
	echo loaded
"

# Three radios each — the router's AP, a neighbour on another channel, and the client that
# associates with the AP. See the RADIOS note at the top for why the client needs a phy of
# its own.
echo "==> handing out radios"
# The phys are DISCOVERED, never named phy0..phy3. The index is a kernel counter that keeps
# climbing: reload the module a few times while working on this and the same four radios
# come back as phy4..phy7, then phy8..phy11. Hardcoding the names cost an afternoon of
# "not on the host (already handed out?)" against a host that had all four sitting there.
avail="$(host_helper 'ls /sys/class/ieee80211/ 2>/dev/null | tr "\n" " "' | tr -d '\r')"
echo "  on the host: ${avail:-none}"

for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || { echo "  skip $ct (not running)"; continue; }
	have="$(in_ct "$ct" 'ls /sys/class/ieee80211/ 2>/dev/null | wc -l')"
	if [ "$have" -ge 3 ]; then
		echo "  $ct already has $have phy(s)"
		continue
	fi
	pid="$(pid_of "$ct")"
	take="$(echo "$avail" | tr ' ' '\n' | grep -v '^$' | head -3 | tr '\n' ' ')"
	[ -n "$take" ] || { echo "  $ct: no phy left on the host"; continue; }
	for p in $take; do
		host_helper "iw phy $p set netns $pid" >/dev/null 2>&1 && echo "  $p -> $ct" \
			|| echo "  $p -> $ct FAILED"
		avail="$(echo "$avail" | sed "s/\b$p\b//")"
	done
done

echo "==> configuring wifi"
for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || continue
	in_ct "$ct" '
		# wifi-scripts owns /sbin/wifi and the netifd wireless glue. It is NOT pulled by
		# `luci`, and without it there is no /etc/config/wireless at all.
		command -v wifi >/dev/null || {
			(apk update >/dev/null 2>&1; apk add wifi-scripts >/dev/null 2>&1) ||
			(opkg update >/dev/null 2>&1; opkg install wifi-scripts >/dev/null 2>&1)
		}

		# hostapd and netifd both cache what the kernel had when they STARTED, and both
		# started at boot — before this script handed the box its first phy. Without this
		# restart hostapd dies inside its own ucode
		#   (`Exception: left-hand side expression is null In __phy_is_fullmac()`)
		# and netifd just says "Wireless module not found". Neither error mentions the
		# actual cause, which is that the radios did not exist yet.
		/etc/init.d/wpad restart >/dev/null 2>&1
		/etc/init.d/network restart >/dev/null 2>&1
		sleep 5

		# `wifi config` writes a radio section per phy — the same call /etc/init.d/boot
		# makes on a real router. It cannot run at boot here: the phys arrive after.
		#
		# ALWAYS regenerate, and do not try to be clever about when. `wifi config` skips a
		# file that already exists, while the uci batch below happily writes wifi-iface
		# sections into a file with no matching radios in it — `uci -q set` on a missing
		# section says nothing at all. Every attempt to guess when the file is still good
		# has been wrong: testing that radio0 exists survived a module reload that handed
		# the box a THIRD radio, so radio2 was never generated and its settings went
		# nowhere; and the hwsim index in each radio path changes on every reload, so even
		# a config with the right NUMBER of radios can point at phys that no longer exist —
		# which is not an error anywhere, it just brings every SSID up as "unknown".
		# Nothing else owns this file: the batch below rewrites every section anyway.
		rm -f /etc/config/wireless
		wifi config >/dev/null 2>&1
		uci -q get wireless.radio2 >/dev/null 2>&1 ||
			{ echo "  fewer than 3 radios detected"; exit 1; }

		# `wifi config` writes country=00 itself, and it must be DELETED, not merely left
		# unset. With no regulatory.db (see the top of this file) a country hint cannot be
		# resolved, and the 25.12 hostapd refuses the whole config over it:
		#   Line 7: Invalid country_code 00
		#   Cannot enable IEEE 802.11d without setting the country_code
		# then `hostapd.add_iface failed for phy phy4`, and the MAIN AP of that box was
		# never on air — on the 25.12 box only; the 24.10 hostapd accepts the same line.
		# The page still rendered radios, SSIDs and a scan, because those come from uci and
		# from the OTHER container beacons: the only visible symptom was that nothing could
		# ever associate, which reads as "hwsim does not do clients".
		#
		# Everything below only re-states what a lived-in router would have: a main SSID, a
		# guest SSID on its own network, a neighbour on another channel, and a disabled one
		# (LuCI renders a disabled iface differently, and that state needs styling too).
		uci -q batch <<-EOF
			delete wireless.radio0.country
			delete wireless.radio1.country
			delete wireless.radio2.country

			set wireless.radio0.band="2g"
			set wireless.radio0.channel="6"
			set wireless.radio0.htmode="HT20"
			set wireless.radio0.cell_density="0"
			delete wireless.radio0.disabled
			set wireless.default_radio0.ssid="footstrap-dev"
			set wireless.default_radio0.encryption="psk2"
			set wireless.default_radio0.key="footstrap123"
			set wireless.default_radio0.network="lan"
			delete wireless.default_radio0.disabled

			set wireless.radio1.band="2g"
			set wireless.radio1.channel="11"
			set wireless.radio1.htmode="HT20"
			set wireless.radio1.cell_density="0"
			delete wireless.radio1.disabled
			set wireless.default_radio1.ssid="footstrap-neighbour"
			set wireless.default_radio1.encryption="sae-mixed"
			set wireless.default_radio1.key="footstrap123"
			set wireless.default_radio1.network="lan"
			delete wireless.default_radio1.disabled

			set wireless.guest_ap=wifi-iface
			set wireless.guest_ap.device="radio0"
			set wireless.guest_ap.mode="ap"
			set wireless.guest_ap.network="guest"
			set wireless.guest_ap.ssid="footstrap-guest"
			set wireless.guest_ap.encryption="none"
			set wireless.guest_ap.isolate="1"

			set wireless.iot_ap=wifi-iface
			set wireless.iot_ap.device="radio0"
			set wireless.iot_ap.mode="ap"
			set wireless.iot_ap.network="iot"
			set wireless.iot_ap.ssid="footstrap-iot"
			set wireless.iot_ap.encryption="psk2"
			set wireless.iot_ap.key="iot12345678"
			set wireless.iot_ap.disabled="1"

			set wireless.radio2.band="2g"
			set wireless.radio2.channel="6"
			set wireless.radio2.htmode="HT20"
			set wireless.radio2.cell_density="0"
			delete wireless.radio2.disabled
			delete wireless.default_radio2
			set wireless.client=wifi-iface
			set wireless.client.device="radio2"
			set wireless.client.mode="sta"
			set wireless.client.network="lan"
			set wireless.client.ssid="footstrap-dev"
			set wireless.client.encryption="psk2"
			set wireless.client.key="footstrap123"
			commit wireless
		EOF
		wifi up >/dev/null 2>&1
		sleep 8

		# PIN the client to this box AP by BSSID. Both boxes beacon the same SSID and the
		# hwsim medium is global (see the top of this file), so an unpinned client picks
		# whichever AP it hears first: measured, both clients landed on the SAME box — one
		# Associated Stations table with two rows, the other with none, and which box won
		# changed between runs. The BSSID is only knowable once the radio is up, and it
		# moves every time the module is reloaded, which is why it is derived here on every
		# run rather than written into a config.
		ap="$(ubus call network.wireless status | jsonfilter -e "@.radio0.interfaces[0].ifname")"
		bssid="$(cat "/sys/class/net/$ap/address" 2>/dev/null)"
		if [ -n "$bssid" ]; then
			uci -q set wireless.client.bssid="$bssid"
			uci -q commit wireless
			wifi reload >/dev/null 2>&1
			sleep 10
		fi

		# Give the station a NAME. LuCI resolves the Host column of Associated Stations
		# through hosthints — the lease file and the neighbour table, by MAC — and with
		# neither it prints "?", which is exactly the short cell that hides the column
		# crush this table keeps being fixed for. It cannot be a static line in rc.local
		# beside the other fake clients: the MAC comes from hwsim and depends on which phy
		# the box was handed, so it is only knowable here, after the radio exists.
		sta="$(iw dev | awk "/Interface/{i=\$2} /type managed/{print i; exit}")"
		mac="$(cat "/sys/class/net/$sta/address" 2>/dev/null)"
		if [ -n "$mac" ]; then
			lf="$(uci -q get dhcp.@dnsmasq[0].leasefile)"; lf="${lf:-/tmp/dhcp.leases}"
			grep -qi "$mac" "$lf" 2>/dev/null ||
				echo "4102444800 $mac 172.31.0.40 wifi-client 01:$mac" >> "$lf"
			# Both families: the Host cell reads "name (v4, v6)", and it is the IPv6 that
			# makes it long enough to be a realistic neighbour for the first column.
			ip neigh replace 172.31.0.40 lladdr "$mac" dev eth0 nud stale 2>/dev/null
			ip -6 neigh replace fd00:1::40 lladdr "$mac" dev eth0 nud stale 2>/dev/null
		fi
	' || echo "  $ct: wifi config failed"
done

sleep 3
for ct in footstrap-2512 footstrap-2410; do
	docker inspect "$ct" >/dev/null 2>&1 || continue
	echo "--- $ct"
	in_ct "$ct" 'iwinfo 2>/dev/null | grep -E "ESSID|Channel" | head -6' || true
done
echo
echo "Wireless is up. Network -> Wireless, and Channel Analysis scans for real."
