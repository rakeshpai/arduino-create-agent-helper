// Here be dragons!
// Arduino Create's Agent API is very weird to use.
// I've tried to wrap over the beast, and expose a simpler API
// Limitation: You can only have one open port at a time.

const io = require('socket.io-client');

const portRange = Array(11).fill(0).map((x, i) => i + 8990);
const logAgentComms = false;

// queues/state
let connectionRequests = null;
const listPortsRequests = [];
let portOpenRequest = null;
let messageBuffer = '';

let agentConnection = null;
let openPort = null;

const discoverAgent = () => Promise.all(
  portRange.map(
    port => fetch(`https://localhost:${port}/info`)
      .then(response => response.json())
      .catch(e => null)
  )
).then(agentCandidates => agentCandidates.find(a => !!a));

const resolveAll = (queue, value) => { while(queue.length) queue.pop().resolve(value); }
const rejectAll = (queue, value) => { while(queue.length) queue.pop().reject(value); }

const connectToAgent = () => {
  if(agentConnection) return Promise.resolve(agentConnection);

  return new Promise((resolve, reject) => {
    if(connectionRequests !== null) return connectionRequests.push({resolve, reject});

    connectionRequests = [{resolve, reject}];

    discoverAgent().then(agent => {
      if(!agent) {
        rejectAll(connectionRequests, 'Agent not found');
        connectionRequests = null;
        return;
      }

      return new Promise(resolve => {
        agentConnection = io(agent.wss);
        agentConnection.on('message', onMessage);
        agentConnection.on('connect', () => {
          send('log on');
          if(!connectionRequests) return;

          resolveAll(connectionRequests, agentConnection);
          connectionRequests = null;
        });
        agentConnection.on('connect_error', () => {
          if(openPort) {
            openPort.onclose && openPort.onclose('Connection error');
            openPort = null;
          }

          if(!connectionRequests) return;

          resolveAll(connectionRequests, 'WSS connect error');
          connectionRequests = null;
        });
      });
    });
  });
}

const onMessage = msg => {
  let message;
  try {
    message = JSON.parse(msg);
  } catch(e) {}

  if(!message) return;

  logAgentComms && console.log('[AGENT][RECD]:', message);

  // Port request messages
  if(message.Ports && 'Network' in message && message.Network === false) {
    resolveAll(listPortsRequests, message.Ports.map(port => ({
      vendorId: port.VendorID,
      path: port.Name,
      productId: port.ProductID,
      isOpen: port.IsOpen
    })));
  }

  if(message.Cmd === 'OpenFail' && portOpenRequest) {
    portOpenRequest.reject(message.Desc);
    portOpenRequest = null;
  }

  if(message.Cmd === 'Close' && openPort) {
    openPort.onclose && openPort.onclose();
    openPort = null;
  }

  if(message.Cmd === 'Open') {
    openPort = {
      path: message.Port,
      baud: message.Baud,
      vendorId: portOpenRequest.vendorId,
      productId: portOpenRequest.productId,
      onmessage: null,
      send: message => send(`send ${openPort.path} ${message}`),
      close: message => send(`close ${openPort.path}`),
      onclose: null
    };

    portOpenRequest.resolve(openPort);
    portOpenRequest = null;
  }

  if(message.D && openPort) {
    openPort.onmessage && openPort.onmessage(message.D);
    messageBuffer = `${messageBuffer}${message.D}`;

    while(messageBuffer.indexOf('\n') !== -1) {
      const line = messageBuffer.substr(0, messageBuffer.indexOf('\n'));
      messageBuffer = messageBuffer.slice(messageBuffer.indexOf('\n') + 1);
      if(openPort.online) openPort.online(line);
    }
  }
}

const send = (command) => {
  logAgentComms && console.log('[AGENT][SEND]:', command);
  agentConnection.emit('command', command);
}

module.exports.isSupported = () => new Promise(resolve => {
  connectToAgent().then(c => resolve(!!c)).catch(r => resolve(false));
});

const listPorts = module.exports.listPorts = () => new Promise((resolve, reject) => {
  listPortsRequests.push({resolve, reject});
  connectToAgent().then(() => send('list')).catch(reject);
});

module.exports.open = (path, baud) => new Promise((resolve, reject) => {
  if(openPort) return reject('Another port is already open.');

  listPorts().then(ports => {
    const matchingPort = ports.find(p => p.path === path);
    if(!matchingPort) return reject('No such port');

    portOpenRequest = {
      resolve, reject,
      path, baud,
      vendorId: matchingPort.vendorId,
      productId: matchingPort.productId
    };

    if(matchingPort.isOpen) {
      send(`close ${path}`);
      setTimeout(() => send(`open ${path} ${baud}`), 500);
      return;
    }

    send(`open ${path} ${baud}`);
  }).catch(reject);
});
