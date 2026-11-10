# Security remediation approval packet

Target: `78.46.229.41` (`dnbradio-trace`), inspected 2026-11-09.
This packet is preparation, not authorization to mutate production. The
operator authorized investigation and local implementation. Explicit approval
of the production scope below is required before rollout.

## Changes prepared

1. Replace chat's 4.4.1 image with the tested custom Lounge 4.5.2 image built
   for linux/amd64 on Node 22.23.4 and Alpine 3.24. Patched dependencies are
   locked in `runtime/package-lock.json`. Preserve the existing config and data
   volume. Serve branding assets from the image. Publish only public ident
   TCP/113, not plaintext HTTP/9003. Chat remains reachable through Traefik.
2. Replace Traefik 2.5.3 with
   `traefik:v3.7.17@sha256:f4bb143d1135a579b630ed491e17ec50f6f7c9c6a30585ff3d385471d2a86f5a`.
   Keep existing command flags, Cloudflare credentials, ACME storage, network,
   and published ports. No certificate renewal or DNS challenge is deliberately
   triggered by the local test. Live issuance/renewal must be verified after
   deployment using the retained state and normal proxy logs.
3. In a separate host maintenance stage, upgrade exactly:
   - `docker-ce=5:29.9.3-1~ubuntu.22.04~jammy`
   - `docker-ce-cli=5:29.9.3-1~ubuntu.22.04~jammy`
   - `containerd.io=2.4.2-3~ubuntu.22.04~jammy`
   The candidate containerd package was downloaded locally, verified against
   the host APT metadata SHA256
   `1d41c79fe4cb891ecd1462ed3d0e247afdc9d67c752af87707c500588101029f`, and its
   extracted runc binary reports **1.5.2**. No packages were installed on the
   server. The native APT simulation proposes three upgrades, no removals,
   and no unrelated package upgrades.

## Security scope

- Supported, security-patched Node runtime addresses the identified bundled
  Brotli exposure. Existing public link previews remain enabled after patching.
- ws 8.22.2 and Engine.IO 6.6.11 address the WebSocket and polling DoS findings.
- Lounge 4.5.2 includes the upstream ident peer-address fix.
- Express 4.22.3, body-parser 1.20.9, path-to-regexp 0.1.13, node-forge 1.4.3,
  Busboy 3.2.5, lodash 4.18.1, and linkify-it 5.0.2 replace affected dependencies.
- file-type 16.5.4 receives the upstream fix for CVE-2026-31808 /
  GHSA-5v7r-6r5c-r473, commit
  `319abf871b50ba2fa221b4a7050059f1ae096f4f`, backported with exact-context guards.
  Its original version remains visible to scanners. This is a source-patched
  finding, not an unexamined suppression.
- zlib is updated to Alpine package 1.4-r0. npm's build-only dependency tree
  is removed from the final image. The running application is UID 1000, with
  capabilities dropped and `no-new-privileges` enabled.
- The separate host ident service/socket remain masked. Do not undo the
  completed availability fix while upgrading the application ident listener.

## Data and rollback prerequisites

Before changing production, create a root-only timestamped release/rollback
directory and save:

- Existing chat/proxy image IDs, inspect state, manifests, restart policies,
  and running container start times.
- `/home/forge/apps/chat/config.js`, current chat Compose file, and its custom
  assets. Do not print config contents or put secrets into this repository.
- A consistent backup of the existing Lounge data volume
  `ccef0d68e8f121eb0ee126698c75925f50283467f2ed1d5c5151f209ad5abd69`.
  Stop chat for the backup immediately before replacement. The public-mode
  sessions will reconnect; in-memory scrollback is not durable across restart.
- Proxy Compose file and `/home/forge/apps/traefik/letsencrypt` ACME data,
  preserving permissions. Keep credential files on the host.

Do not recreate the data volume, delete the old images, run `compose down -v`,
or use the legacy root `docker-compose.yml` for the new chat service.

For stage 3, additionally require a verified host/volume recovery backup and
a maintenance window covering all running containers. Package downgrade alone
is **not** a verified rollback for a Docker/containerd major-version migration.
If those recovery prerequisites are missing, execute approved chat/proxy
stages only and leave host maintenance pending explicitly.

## Deployment order after approval

Use the committed files and the exact tested chat image ID recorded with the
validation evidence. Transfer a saved image archive or use a private registry
digest; do not rebuild from floating tags on the production host.

For chat, export the reviewed image ID as `CHAT_IMAGE`, set
`CHAT_BIND_IP=78.46.229.41`, and set `CHAT_DATA_VOLUME` to the existing volume
above. Check `scripts/reserve-ident-port.sh --check`, then render the new
standalone manifest for inspection with:

```sh
docker compose -p chat -f /path/to/reviewed/deploy/chat.compose.yml config
```

After backups, replace only this service:

```sh
docker compose -p chat -f /path/to/reviewed/deploy/chat.compose.yml up -d --no-deps thelounge
```

The manifest uses explicit router/service names matching the deployed `chat`
router. Do not combine it with the original manifest: Compose port-list
merging could preserve public TCP/9003. Check the actual published ports after
creation, not only the YAML.

For Traefik, use its existing Compose file plus the reviewed image-only override:

```sh
docker compose -p traefik -f /home/forge/apps/traefik/docker-compose.yml -f /path/to/reviewed/deploy/traefik.override.yml up -d --no-deps traefik
```

Verify chat and the stream routers before stage 3. Upgrade Traefik **before**
Docker: the old proxy hardcodes Docker API 1.24, which the newer daemon rejects.

Run the exact package upgrades only under the separately approved maintenance
stage with the verified recovery backup. Re-run the APT simulation first and
stop on changed versions, removals, or additional effects. Docker live restore
is currently **false**. Expect interruption/reconnection of chat, Shoutcast,
Icecast, Traefik and MariaDB. Do not silently enable live restore as a workaround.

## Acceptance and rollback

After each application stage: verify HTTPS root and assets, polling-only and
WebSocket-only sessions, expected image/version, logs, container health, and
that the intended data volume is retained. Confirm TCP/9003 is no longer
publicly published/reachable and TCP/113 is still Docker-owned. Do not send
public IRC messages as a smoke test. The local test covers IRC registration,
JOIN, and ident peer isolation using a disposable mock server.

Proxy routes to verify: `chat.dnbradio.com`, `source.dnbradio.com`,
`fw.dnbradio.com`, `streams.dnbradio.com`, `samlegacy.dnbradio.com`,
`trace.dnbradio.com`, `ices.dnbradio.com`. Local fixture tests verify Host
matching, not the real stream content or DNS/ACME integration. Record live
pre-change status/content type for each route and compare after rollout.

After host maintenance, verify all five previously running containers return,
Docker and containerd versions match the approved packages, and the active
runc version is patched. Run a read-only MariaDB health check and verify live
stream availability without publishing or altering broadcasts.

For chat failure, restore the original image and original standalone manifest,
using the same named Compose project and volume; restore the saved volume if
the newer app changed persistent data. This rollback reintroduces old security
risks, so keep it brief and record which risks returned. For proxy failure,
restore the original image/config and saved ACME state if necessary. Do not
roll back Traefik to 2.5.3 while retaining the newer Docker daemon.

## Validation evidence

Validated locally on 2026-11-09 (America/Denver), without production upgrades:

- Candidate image: `dnbradio-chat:security-20261109`, linux/amd64.
- Docker image identity:
  `sha256:99a9a381647e9970b28f1796bb01faae7bf3db2b60bb14b6f0057ebb6d5d1ea8`.
- Saved archive: `security-evidence/dnbradio-chat-security-20261109.tar`.
- Archive SHA256:
  `6e769a2f81c2069293bbd62bf0d4176131346a5389d04f3f73602f8eb14edcb8`.
- `npm test`: 12 tests pass, including ident ownership and fail-closed
  deployment rendering with preservation of the existing volume.
- `npm run test:integration`: passes the occupied-ident-port reproduction,
  proxy 404 / actual client xhr poll error, and transport/restart recovery.
- `npm run test:security`: passes runtime checks, HTTPS and HTTP redirect,
  branding/assets, polling-only and WebSocket-only sessions, mock IRC JOIN,
  ident peer isolation, all shared proxy Host rules, and chat restart recovery.
  The client resolves the production hostname exclusively to the loopback
  fixture. Untrusted TLS is allowed only for this disposable local fixture.
- Trivy 0.72.0 candidate image scan: zero HIGH/CRITICAL findings; one MEDIUM
  version-based finding, CVE-2026-31808 in file-type 16.5.4. The source backport
  and bounded malformed-ASF regression cover this finding. It is retained in
  raw output, not suppressed. This is not a claim of vulnerability absence.
- Runtime npm audit: zero high/critical; two moderate dependency records
  (file-type and its dependent Lounge), attributable to the same backport.
  Development npm audit: zero findings.

Raw build, audit, and test logs remain in ignored `security-evidence/`.
Real ACME/DNS integration, stream content, and host-package upgrade recovery
require the approved deployment checks above; local marker backends cannot
establish those outcomes.

## Advisory evidence and prioritization

The inspected live runtime was Lounge 4.4.1, Node 18.18.2 (Brotli 1.0.9),
ws 8.11.0, Traefik 2.5.3 and runc 1.1.12. These are installed-version findings,
not evidence of exploitation or the cause of the ident-port outage.

- Prioritize the Node runtime because link previews automatically decompress
  remote responses. Brotli CVE-2026-111497 affects its installed version and
  appears in CISA KEV. See the [Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
  and [NVD record with KEV entry](https://nvd.nist.gov/vuln/detail/CVE-2026-111497).
- The installed ws is affected by CVE-2026-48779 (fragmentation memory DoS),
  CVE-2024-37890 (header DoS), and the conditional disclosure CVE-2026-45736.
  See the [upstream fragmentation advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p).
  The examined stock Lounge 4.5.2 image still carried ws 8.11.0, so upgrading
  Lounge alone is insufficient; test the actual nested runtime dependency.
- Lounge's [ident disclosure advisory](https://github.com/thelounge/thelounge/security/advisories/GHSA-g49q-jw42-6x85)
  has no CVE identifier and is fixed from 4.5.0. Our mock test verifies both
  valid ident replies and rejection of a different peer's query.
- Traefik findings include CVE-2022-39271, CVE-2024-28869 and
  CVE-2024-45410 (DoS and forwarded-header manipulation).
- runc findings include CVE-2025-31133, CVE-2025-52565 and CVE-2025-52881;
  exploitation has container/race prerequisites. Installed runc 1.1.12 already
  fixes CVE-2024-21626. Host maintenance is separate from the chat rollout.
- The retained scanner finding is documented in the
  [upstream ASF parser advisory](https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473).
