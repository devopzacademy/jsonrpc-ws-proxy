#!/usr/bin/env node

import * as http from 'http';
import * as fs from 'fs';

import * as parseArgs from 'minimist';
import * as yaml from 'js-yaml';
import * as ws from 'ws';
import * as rpc from '@sourcegraph/vscode-ws-jsonrpc';
import * as rpcServer from '@sourcegraph/vscode-ws-jsonrpc/lib/server';

// Constants
const DEFAULT_PORT = 3000;
const USAGE_MESSAGE = `Usage: server.js --port 3000 --languageServers config.yml`;

let argv = parseArgs(process.argv.slice(2));

if (argv.help || !argv.languageServers) {
  console.log(USAGE_MESSAGE);
  process.exit(1);
}

let serverPort: number = parseInt(argv.port, 10) || DEFAULT_PORT;

let languageServers;
try {
  let parsed = yaml.safeLoad(fs.readFileSync(argv.languageServers), 'utf8');
  if (!parsed.langservers) {
    console.log('Your langservers file is not a valid format, see README.md');
    process.exit(1);
  }
  languageServers = parsed.langservers;
} catch (e) {
  console.error(`Failed to load or parse language servers config: ${e.message}`);
  process.exit(1);
}

const wss : ws.Server = new ws.Server({
  port: serverPort,
  perMessageDeflate: false
}, () => {
  console.log(`Listening to http and ws requests on ${serverPort}`);
});

function toSocket(webSocket: ws): rpc.IWebSocket {
  return {
      send: content => webSocket.send(content),
      onMessage: cb => webSocket.onmessage = event => cb(event.data),
      onError: cb => webSocket.onerror = event => {
          if ('message' in event) {
              cb((event as any).message)
          }
      },
      onClose: cb => webSocket.onclose = event => cb(event.code, event.reason),
      dispose: () => webSocket.close()
  }
}

wss.on('connection', (client: ws, request: http.IncomingMessage) => {
    const requestedLangServer = request.url?.slice(1);
    const langServer = languageServers[requestedLangServer];

    if (!langServer || langServer.length === 0) {
        console.error('Invalid language server', request.url);
        client.close();
        return;
    }

    const localConnection = rpcServer.createServerProcess('Example', langServer[0], langServer.slice(1));
    const socket: rpc.IWebSocket = toSocket(client);
    const connection = rpcServer.createWebSocketConnection(socket);

    rpcServer.forward(connection, localConnection);
    console.log(`Forwarding new client`);

    socket.onClose((code, reason) => {
        console.log('Client closed', reason);
        localConnection.dispose();
    });
});
