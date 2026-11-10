// Local-only IRC/ident fixture. No external network destinations.
const net = require('node:net');
const http = require('node:http');
const state = {registered: false, joined: false, ident: null, pair: null, loungeAddress: null};
net.createServer(connection => {
  let buffer = '', nick = '', user = false, welcomed = false;
  const send = line => connection.write(line + '\r\n');
  connection.on('error', () => {});
  connection.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.startsWith('CAP LS')) send(':mock CAP * LS :');
      if (line.startsWith('NICK ')) nick = line.slice(5);
      if (line.startsWith('USER ')) user = true;
      if (line.startsWith('PING ')) send('PONG ' + line.slice(5));
      if (nick && user && !welcomed) {
        welcomed = state.registered = true;
        send(`:mock 001 ${nick} :Welcome`);
        send(`:mock 005 ${nick} CHANTYPES=# :supported`);
        send(`:mock 376 ${nick} :End of MOTD`);
      }
      if (line.startsWith('JOIN ')) {
        state.joined = true;
        const channel = line.slice(5).replace(/^:/, '');
        send(`:${nick}!test@mock JOIN ${channel}`);
        send(`:mock 353 ${nick} = ${channel} :${nick}`);
        send(`:mock 366 ${nick} ${channel} :End of names`);
        state.pair = `${connection.remotePort}, ${connection.localPort}`;
        state.loungeAddress = connection.remoteAddress;
        const ident = net.connect(9001, connection.remoteAddress, () => ident.write(state.pair + '\r\n'));
        ident.setTimeout(3000, () => ident.destroy());
        ident.on('data', data => {state.ident = data.toString().trim(); ident.end();});
        ident.on('error', error => {state.ident = 'ERROR: ' + error.message;});
      }
    }
  });
}).listen(6667, '0.0.0.0');
http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(state));
}).listen(8000, '0.0.0.0');
