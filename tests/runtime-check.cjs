// Executed only inside the offline candidate container by security.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {Worker} = require('node:worker_threads');
const root = '/opt/dnbradio-chat';
const requireRuntime = createRequire(`${root}/node_modules/thelounge/package.json`);

(async () => {
  const semver = requireRuntime('semver');
  assert(semver.gte(process.versions.node, '22.23.4'));
  assert.equal(process.getuid(), 1000);
  const socketRequire = createRequire(requireRuntime.resolve('socket.io'));
  const engineRequire = createRequire(socketRequire.resolve('engine.io'));
  assert(semver.gte(engineRequire('ws/package.json').version, '8.22.2'));
  for (const [name, version] of Object.entries({express: '4.22.3', 'node-forge': '1.4.3', lodash: '4.18.1'})) {
    assert.equal(requireRuntime(`${name}/package.json`).version, version);
  }
  const links = requireRuntime('linkify-it')().match('Listen at https://dnbradio.com/player');
  assert.equal(links[0].url, 'https://dnbradio.com/player');
  const Busboy = requireRuntime('@fastify/busboy');
  await new Promise((resolve, reject) => {
    const parser = new Busboy({headers: {'content-type': 'multipart/form-data; boundary=fixture'}});
    let field;
    parser.on('field', (name, value) => { field = [name, value]; });
    parser.on('error', reject);
    parser.on('finish', () => {try { assert.deepEqual(field, ['name', 'test']); resolve(); } catch (e) {reject(e);} });
    parser.end('--fixture\r\nContent-Disposition: form-data; name="name"\r\n\r\ntest\r\n--fixture--\r\n');
  });
  const fileType = requireRuntime('file-type');
  const logo = fs.readFileSync(`${root}/node_modules/thelounge/public/img/logo-grey-bg-192x192px.png`);
  assert.equal((await fileType.fromBuffer(logo)).ext, 'png');
  // A separate worker bounds the original infinite-loop regression. This
  // fixture is NEVER sent to the production server.
  await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const {parentPort, workerData} = require('node:worker_threads');
      const fileType = require(workerData);
      const input = Buffer.alloc(55);
      Buffer.from('3026b2758e66cf11a6d9', 'hex').copy(input);
      fileType.fromBuffer(input).then(result => parentPort.postMessage(result));
    `, {eval: true, workerData: requireRuntime.resolve('file-type')});
    const timeout = setTimeout(() => {worker.terminate(); reject(new Error('ASF parser failed to terminate'));}, 5000);
    worker.on('error', error => {clearTimeout(timeout); reject(error);});
    worker.once('message', result => {
      clearTimeout(timeout);
      worker.terminate();
      try {assert.deepEqual(result, {ext: 'asf', mime: 'application/vnd.ms-asf'}); resolve();} catch (error) {reject(error);}
    });
  });
  console.log('Patched runtime, real Socket.IO ws, link parser, multipart API and ASF regression: PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
