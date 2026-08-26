#!/bin/sh
# Every rpcd ACL this package ships is valid JSON, and grants something.
#
# rpcd SKIPS an unreadable file in /usr/share/rpcd/acl.d and says nothing, so a stray comma issues
# the grant to NOBODY and nothing else notices: the package installs, the theme draws, and
# Save-as-default and the upload fail on the user's router with no error anywhere.
#
# The shape is checked as well as the syntax: a document that parses but is a list, or an entry with
# neither `read` nor `write`, is accepted by rpcd and grants exactly nothing.
#
# Node-less on purpose: this runs in CI's `check` job beside audit.py, which already requires
# python3, and the OpenWrt buildbot has no node.
set -eu
cd "$(dirname "$0")/.."

set -- luci-theme-footstrap/root/usr/share/rpcd/acl.d/*.json
[ -f "$1" ] || { echo "no ACL files found — the glob or the tree moved"; exit 1; }

python3 -c '
import json, sys

for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as fh:
        try:
            doc = json.load(fh)
        except ValueError as e:
            sys.exit("%s: invalid JSON: %s" % (path, e))
    if not isinstance(doc, dict) or not doc:
        sys.exit("%s: top level must be a non-empty object keyed by ACL name" % path)
    for name, body in doc.items():
        if not isinstance(body, dict):
            sys.exit("%s: %s: must be an object" % (path, name))
        if not ({"read", "write"} & set(body)):
            sys.exit("%s: %s: neither read nor write — the grant is empty" % (path, name))
print("%d rpcd ACL file(s) parse." % (len(sys.argv) - 1))
' "$@"
