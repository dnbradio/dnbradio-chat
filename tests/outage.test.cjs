// Opt-in local Docker test. No production config, IRC connections, or messages.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {io} = require('socket.io-client');
const {randomUUID} = require('node:crypto');

const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
const get = url => fetch(url, {signal: AbortSignal.timeout(3000)});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 20000;
  do {
    if (await check()) return;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error('Local fixture did not become ready within 20 seconds');
}
function socketResult(url, transport) {
  return new Promise(resolve => {
    const socket = io(url, {transports: [transport], reconnection: false, timeout: 5000});
    socket.once('connect', () => { socket.disconnect(); resolve('connected'); });
    socket.once('connect_error', error => { socket.disconnect(); resolve(error.message); });
  });
}

test('ident collision removes chat route; releasing ident restores both transports', {timeout: 90000}, async () => {
  const prefix = `dnbradio-outage-test-${randomUUID().slice(0, 8)}`;
  const names = {holder: `${prefix}-ident`, lounge: `${prefix}-lounge`, proxy: `${prefix}-proxy`};
  const loungeImage = 'thelounge/thelounge:4.4.1';
  // Production's v2.5.3 hardcodes Docker API 1.24, rejected by Docker 29.
  // Use a compatible proxy only in this local fixture; no deploy change.
  const proxyImage = process.env.TEST_TRAEFIK_IMAGE || 'traefik:v3.6.2';
  const created = [];
  docker('network', 'create', prefix);
  try {
    // Model systemd's occupied port using an isolated container listener.
    // Bind a random loopback port, never the host's real ident port.
    docker('create', '--name', names.holder, '--network', prefix,
      '-p', '127.0.0.1::9001', '--entrypoint', 'node', loungeImage,
      '-e', "require('net').createServer().listen(9001, '0.0.0.0')");
    created.push(names.holder);
    docker('start', names.holder);
    const identPort = docker('port', names.holder, '9001/tcp').split(':').pop();

    docker('create', '--name', names.proxy, '--network', prefix,
      '-p', '127.0.0.1::8080', '-v', '/var/run/docker.sock:/var/run/docker.sock:ro',
      proxyImage, '--providers.docker=true', '--providers.docker.exposedbydefault=false',
      `--providers.docker.constraints=Label(\`outage.test\`,\`${prefix}\`)`,
      '--providers.providersThrottleDuration=100ms', '--entrypoints.web.address=:8080');
    created.push(names.proxy);
    docker('start', names.proxy);
    const url = `http://${docker('port', names.proxy, '8080/tcp')}`;
    await until(async () => {try {return (await get(url)).status === 404;} catch {return false;}});

    // Use the real Lounge version observed on production. Lock the
    // fixture's IRC target to loopback; no IRC connect event is ever emitted.
    docker('create', '--name', names.lounge, '--network', prefix,
      '-p', `127.0.0.1:${identPort}:9001`,
      '--label', `outage.test=${prefix}`, '--label', 'traefik.enable=true',
      '--label', `traefik.http.routers.${prefix}.rule=PathPrefix(\`/\`)`,
      '--label', `traefik.http.routers.${prefix}.entrypoints=web`,
      '--label', `traefik.http.services.${prefix}.loadbalancer.server.port=9000`,
      '--entrypoint', 'sh', loungeImage, '-c',
      'printf \'%s\\n\' \'module.exports = {public: true, lockNetwork: true, defaults: {host: "127.0.0.1", port: 6667, tls: false, join: ""}, identd: {enable: true, port: 9001}};\' > /var/opt/thelounge/config.js; exec docker-entrypoint.sh thelounge start');
    created.push(names.lounge);
    assert.throws(() => docker('start', names.lounge), /port is already allocated|address already in use/);
    assert.equal((await get(url)).status, 404);
    assert.equal((await get(`${url}/socket.io/?EIO=4&transport=polling`)).status, 404);
    assert.equal(await socketResult(url, 'polling'), 'xhr poll error');

    docker('stop', names.holder);
    // Newer Docker engines can discard the endpoint after a failed port bind.
    // Reattach the fixture if necessary before checking application recovery.
    const networks = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', names.lounge));
    if (!networks[prefix]) docker('network', 'connect', prefix, names.lounge);
    docker('start', names.lounge);
    await until(async () => (await get(url)).status === 200);
    const response = await get(`${url}/socket.io/?EIO=4&transport=polling`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^0\{"sid":/);
    assert.equal(await socketResult(url, 'polling'), 'connected');
    assert.equal(await socketResult(url, 'websocket'), 'connected');
    // Restart once with the competing listener absent, modeling the repaired boot.
    docker('restart', names.lounge);
    await until(async () => (await get(url)).status === 200);
    assert.equal(await socketResult(url, 'polling'), 'connected');
    console.log('Reproduced 404 + xhr poll error; port release restores HTTP, polling, WebSocket, and restart.');
  } catch (error) {
    for (const name of created) console.error(name,
      docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', name),
      docker('logs', '--tail', '20', name));
    throw error;
  } finally {
    // Delete only containers and anonymous fixture volumes created by this test.
    for (const name of created.reverse()) docker('rm', '-f', '-v', name);
    docker('network', 'rm', prefix);
  }
});
