#!/bin/sh
# The Lounge owns public TCP/113. Run on its Docker host, not in the container.
# Read-only by default. --apply changes host services and requires approval.
set -eu

if [ "$#" -gt 1 ]; then
    echo "Usage: $0 [--check|--apply]" >&2
    exit 2
fi

case "${1:---check}" in
    --check) ;;
    --apply)
        if [ "$(id -u)" != 0 ]; then
            echo 'Run --apply as root on the approved chat host.' >&2
            exit 1
        fi
        # Mask BOTH activation paths. Stopping the service alone leaves the
        # systemd socket listening, and disabling only the socket leaves the
        # standalone service able to claim the port on the next boot.
        systemctl mask --now oidentd.socket oidentd.service
        ;;
    *) echo "Usage: $0 [--check|--apply]" >&2; exit 2 ;;
esac

result=0
for unit in oidentd.socket oidentd.service; do
    enabled=$(systemctl is-enabled "$unit" 2>/dev/null) || enabled=${enabled:-unknown}
    active=$(systemctl is-active "$unit" 2>/dev/null) || active=${active:-unknown}
    if [ "$enabled" != masked ] || [ "$active" != inactive ]; then
        echo "$unit: enabled=$enabled active=$active; expected masked/inactive." >&2
        result=1
    fi
done
if [ "$result" != 0 ]; then
    echo 'TCP/113 ownership is not protected. Obtain approval before running --apply.' >&2
else
    echo 'Host oidentd activation is blocked. The Lounge may own TCP/113.'
fi
exit "$result"
