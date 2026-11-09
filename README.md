# dnbradio-chat
The Lounge custom docker build

## Deployment prerequisites

The production webchat is <https://chat.dnbradio.com/>. The Lounge serves its
frontend and Socket.IO endpoint (`/socket.io/`) on container TCP/9000. Traefik
terminates HTTPS. The Lounge connects to `euroserv.fr.quakenet.org:6667` and
joins `#dnbradio` when a visitor submits the connect form.

Production also publishes host TCP/113 to The Lounge's ident daemon on
container TCP/9001. **Only The Lounge may own that host port.** A competing
host listener prevents the entire container from starting, including HTTP.
Stopping `oidentd.service` alone is insufficient: `oidentd.socket` can hold the
port independently.

Run the read-only prerequisite check on the chat Docker host:

```sh
sh scripts/reserve-ident-port.sh --check
```

After explicit operator approval, reserve the port permanently by stopping and
masking both host activation paths:

```sh
sudo sh scripts/reserve-ident-port.sh --apply
```

This does not restart Docker or the chat container. It changes only
`oidentd.socket` and `oidentd.service`. Save both units' enabled/active states
before applying. Rollback is `systemctl unmask oidentd.socket oidentd.service`,
followed by restoring the saved enabled/active states. Do not start either host
unit while Docker owns port 113. If another application needs host oidentd,
resolve that ownership requirement before applying this fix.

The checked-in Compose file is **not an exact production deployment manifest**.
Do not run `compose up` on production from it as part of this repair. The
observed deployment and approval scope are recorded in
[the incident report](docs/incident-2026-11-09.md).

## Tests

```sh
npm ci --ignore-scripts
npm test
npm run test:integration
```

The integration test requires Node 18+, Python 3, and a local Docker daemon
with `thelounge/thelounge:4.4.1` and `traefik:v3.6.2` images available. It creates
uniquely named disposable containers and a network, publishes random loopback
ports, and removes those fixtures and their anonymous volumes afterward. The
test proxy reads the local Docker socket with a test-specific label filter.
Use a development Docker context, never the production daemon. Its Lounge IRC
target is locked to loopback and no IRC connect or message events are sent.

Production's Traefik 2.5.3 hardcodes Docker API 1.24, which modern Docker
daemons reject. The fixture uses 3.6.2 for local Docker compatibility only.
On an older development daemon, set `TEST_TRAEFIK_IMAGE=traefik:v2.5.3` to test
the deployed proxy version. This is not a production proxy-upgrade proposal.

The test reproduces an occupied ident port, failed chat-container startup,
Traefik 404s, and the actual Socket.IO client `xhr poll error`. It then releases
the conflicting listener and verifies HTTP, polling, WebSocket, and container
restart recovery. Unit tests cover the read-only default, both activation
paths, failed remediation, unknown service states, and privilege checks.
