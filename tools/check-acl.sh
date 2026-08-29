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
# …and the shape of every `file.exec` grant, which is the primitive behind most of the LuCI security
# advisories of the last two years (advanced-reboot exposing /bin/sh, samba4 exposing smbd,
# dockerman exposing ttyd_start — each a delegated user reaching root). Three rules, and this
# package already satisfies all three, which is the point of writing them down before it does not:
#
#   1. No exec in a `read` ACL. A read grant is handed to accounts that are supposed to look and not
#      touch; every one of those advisories is that sentence.
#   2. No interpreter as the program. `/bin/sh /etc/foo.sh` is `/bin/sh <anything>` to rpcd.
#   3. A whole command line, never a bare binary. rpcd matches the string it is given; a bare
#      program name lets the caller supply the arguments.
#
# Node-less on purpose: this runs in CI's `check` job beside audit.py, which already requires
# python3, and the OpenWrt buildbot has no node.
set -eu
cd "$(dirname "$0")/.."

set -- luci-theme-footstrap/root/usr/share/rpcd/acl.d/*.json
[ -f "$1" ] || { echo "no ACL files found — the glob or the tree moved"; exit 1; }

python3 -c '
import json, sys

# Anything that takes a program (or a script) as an argument: granting one is granting everything
# it can run. busybox is on the list because `busybox sh` is a shell.
INTERPRETERS = {
    "sh", "ash", "bash", "dash", "busybox", "env", "lua", "ucode", "perl", "awk", "sed",
    "python", "python2", "python3", "xargs", "find", "nice", "timeout", "setsid", "chroot",
}
exec_grants = 0

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
        for scope in ("read", "write"):
            files = (body.get(scope) or {}).get("file")
            if not isinstance(files, dict):
                continue
            for cmd, methods in files.items():
                if "exec" not in (methods or []):
                    continue
                where = "%s: %s: %s.file %r" % (path, name, scope, cmd)
                if scope == "read":
                    sys.exit("%s: exec in a READ acl — a look-only grant must not run anything"
                             % where)
                argv = cmd.split()
                if len(argv) < 2:
                    sys.exit("%s: exec on a bare program — grant the whole command line, or the "
                             "caller chooses the arguments" % where)
                prog = argv[0].rsplit("/", 1)[-1]
                if prog in INTERPRETERS:
                    sys.exit("%s: exec on the interpreter %r — rpcd matches the string, so this "
                             "grants everything that interpreter can run" % (where, prog))
                exec_grants += 1
print("%d rpcd ACL file(s) parse; %d scoped file.exec grant(s), none in a read acl."
      % (len(sys.argv) - 1, exec_grants))
' "$@"
