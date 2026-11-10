const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID, createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {io} = require('socket.io-client');
const root = path.resolve(__dirname, '..');
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
const image = process.env.TEST_CHAT_IMAGE || 'dnbradio-chat:security-20261109';
const proxy = 'traefik:v3.7.17@sha256:f4bb143d1135a579b630ed491e17ec50f6f7c9c6a30585ff3d385471d2a86f5a';
// Node's fetch can discard a custom Host header. Use the HTTP API so these
// assertions actually exercise production host matching. Only local fixture
// TLS uses an untrusted generated certificate; never use this helper remotely.
const get = (url, host) => new Promise((resolve, reject) => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  const client = target.protocol === 'https:' ? https : http;
  const request = client.get(target, {headers: host ? {Host: host} : {}, rejectUnauthorized: false}, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('error', reject);
    response.on('end', () => {const body=Buffer.concat(chunks); resolve({status: response.statusCode,
      headers: response.headers, text: async () => body.toString(), arrayBuffer: async () => body});});
  });
  request.on('error', reject);
  request.setTimeout(3000, () => request.destroy(new Error('Fixture HTTP timeout')));
});
async function until(check) {
  const deadline = Date.now() + 30000;
  do {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('Fixture did not become ready');
}
function connect(url, transport) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    // XHR overwrites Host from the URL. Resolve the production hostname only
    // to our loopback fixture, without touching DNS or the real service.
    const target = new URL(url);
    target.hostname = 'chat.dnbradio.com';
    const agent = new https.Agent({lookup: (hostname, options, callback) => {
      assert.equal(hostname, 'chat.dnbradio.com');
      callback(null, options.all ? [{address: '127.0.0.1', family: 4}] : '127.0.0.1', 4);
    }});
    const socket = io(target.href, {transports: [transport], reconnection: false, timeout: 5000,
      rejectUnauthorized: false, agent});
    socket.once('disconnect', () => agent.destroy());
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', error => {console.error('Transport failure', transport, error.description, error.context?.status, error.context?.responseText); socket.disconnect(); reject(error);});
  });
}

test('candidate patches, public chat flow, ident privacy and all shared proxy host rules', {timeout: 120000}, async () => {
  const name = `dnbradio-security-test-${randomUUID().slice(0, 8)}`;
  const containers = [], clients = [];
  docker('network', 'create', name);
  const create = (suffix, args) => {
    const container = `${name}-${suffix}`;
    docker('create', '--name', container, '--network', name, ...args);
    containers.push(container);
    return container;
  };
  try {
    const irc = create('irc', ['--entrypoint', 'node', image, '/tmp/irc.cjs']);
    docker('cp', path.join(__dirname, 'irc-fixture.cjs'), `${irc}:/tmp/irc.cjs`);
    docker('start', irc);
    const config = {public: true, reverseProxy: true, lockNetwork: true, theme: 'default',
      prefetch: true, fileUpload: {enable: false}, ldap: {enable: false},
      defaults: {host: irc, port: 6667, tls: false, nick: 'security-test', username: 'security-test', join: '#security-test'},
      identd: {enable: true, port: 9001}, transports: ['polling', 'websocket']};
    const chat = create('chat', ['--init', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--label', `outage.test=${name}`, '--label', 'traefik.enable=true',
      '--label', `traefik.http.routers.${name}-chat.rule=Host(\`chat.dnbradio.com\`) && PathPrefix(\`/\`)`,
      '--label', `traefik.http.routers.${name}-chat.entrypoints=websecure`,
      '--label', `traefik.http.services.${name}-chat.loadbalancer.server.port=9000`,
      '--entrypoint', 'sh', image, '-c',
      `cat > /var/opt/thelounge/config.js <<'CONFIG'\nmodule.exports = ${JSON.stringify(config)};\nCONFIG\nexec /opt/dnbradio-chat/node_modules/.bin/thelounge start`]);
    docker('cp', path.join(__dirname, 'runtime-check.cjs'), `${chat}:/tmp/runtime-check.cjs`);
    docker('start', chat);
    console.log(docker('exec', chat, 'node', '/tmp/runtime-check.cjs'));
    // Disposable marker backend uses every other deployed proxy Host rule.
    const hosts = ['source.dnbradio.com', 'fw.dnbradio.com', 'streams.dnbradio.com', 'samlegacy.dnbradio.com', 'trace.dnbradio.com', 'ices.dnbradio.com'];
    const backend = create('routes', ['--label', `outage.test=${name}`, '--label', 'traefik.enable=true',
      '--label', `traefik.http.routers.${name}-routes.rule=${hosts.map(host => `Host(\`${host}\`)`).join(' || ')}`,
      '--label', `traefik.http.routers.${name}-routes.entrypoints=websecure`,
      '--label', `traefik.http.services.${name}-routes.loadbalancer.server.port=8080`,
      '--entrypoint', 'node', image, '-e', 'require("http").createServer((q,s)=>s.end("route:"+q.headers.host)).listen(8080,"0.0.0.0")']);
    docker('start', backend);
    const gateway = create('proxy', ['-p', '127.0.0.1::8080', '-p', '127.0.0.1::8443', '-v', '/var/run/docker.sock:/var/run/docker.sock:ro',
      proxy, '--providers.docker=true', '--providers.docker.exposedbydefault=false',
      `--providers.docker.constraints=Label(\`outage.test\`,\`${name}\`)`,
      '--providers.providersThrottleDuration=100ms', '--entrypoints.web.address=:8080',
      '--entrypoints.websecure.address=:8443', '--entrypoints.websecure.http.tls=true',
      '--entrypoints.web.http.redirections.entrypoint.to=websecure',
      '--entrypoints.web.http.redirections.entrypoint.scheme=https']);
    docker('start', gateway);
    const url = `https://${docker('port', gateway, '8443/tcp')}`;
    await until(async () => {try {return (await get(url, 'chat.dnbradio.com')).status === 200;} catch {return false;}});
    const redirect = await get(`http://${docker('port', gateway, '8080/tcp')}`, 'chat.dnbradio.com');
    assert([301, 302, 307, 308].includes(redirect.status));
    assert.match(redirect.headers.location, /^https:\/\/chat\.dnbradio\.com/);
    const html = await (await get(url, 'chat.dnbradio.com')).text();
    assert.match(html, /<title>dnbradio on Internet Relay Chat/);
    const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^\"]*)?)"/g)].map(match => match[1]);
    assert(assets.length > 0);
    for (const asset of assets) assert.equal((await get(new URL(asset, url), 'chat.dnbradio.com')).status, 200, asset);
    const logo = Buffer.from(await (await get(`${url}/img/logo-grey-bg-192x192px.png`, 'chat.dnbradio.com')).arrayBuffer());
    assert.equal(createHash('sha256').update(logo).digest('hex'),
      createHash('sha256').update(fs.readFileSync(path.join(root, 'custom/public/img/logo-grey-bg-192x192px.png'))).digest('hex'));
    for (const host of hosts) assert.equal(await (await get(url, host)).text(), `route:${host}`);
    assert.equal((await get(url, 'unknown.invalid')).status, 404);
    assert.deepEqual(JSON.parse(docker('inspect', '--format', '{{json .HostConfig.PortBindings}}', chat)) || {}, {});
    for (const transport of ['polling', 'websocket']) clients.push(await connect(url, transport));
    // Only the disposable mock IRC server can be selected by this fixture.
    clients[0].emit('network:new', {name: 'Test', host: irc, port: 6667, tls: false, nick: 'security-test', username: 'security-test', realname: 'Test', join: '#security-test'});
    const readState = () => JSON.parse(docker('exec', irc, 'node', '-e', 'fetch("http://127.0.0.1:8000").then(r=>r.text()).then(console.log)'));
    await until(async () => {const s=readState(); return s.joined && s.ident;});
    const state = readState();
    assert.equal(state.registered, true);
    assert.match(state.ident, /USERID.*security-test/);
    // A different peer must not be able to enumerate the active IRC ident.
    const unrelated = docker('exec', backend, 'node', '-e',
      'const s=require("net").connect(9001,process.argv[1],()=>s.write(process.argv[2]+"\\r\\n")); s.setTimeout(3000,()=>{s.destroy();process.exitCode=1});s.on("data",d=>{console.log(d.toString());s.end()});',
      state.loungeAddress, state.pair);
    assert.match(unrelated, /ERROR/);
    assert.doesNotMatch(unrelated, /USERID/);
    clients.forEach(socket => socket.disconnect());
    docker('restart', chat);
    await until(async () => (await get(url, 'chat.dnbradio.com')).status === 200);
    const restarted = await connect(url, 'polling');
    restarted.disconnect();
    console.log('HTTP/assets/branding, polling, WebSocket, mock IRC JOIN, ident peer isolation, shared Host rules, and restart: PASS');
  } catch (error) {
    for (const container of containers) console.error(container, docker('logs', '--tail', '10', container));
    throw error;
  } finally {
    clients.forEach(socket => socket.disconnect());
    for (const container of containers.reverse()) docker('rm', '-f', '-v', container);
    docker('network', 'rm', name);
  }
});
