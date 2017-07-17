Incomplete.

Example
---
Add your page to the allowed origins in the config.ini for Arduino Create agent:
```
origins = http://webide.arduino.cc:8080, http://localhost:3000
```

```javascript
const { isSupported, listPorts, open } = require('arduino-create-agent-helper');

isSupported().then(supported => {
  console.log("Create Agent found", supported);
  if(!supported) return;

  listPorts().then(ports => {
    console.log('Ports', ports);

    // Example:
    // [
    //   {
    //     "vendorId": "0x1a86",
    //     "path": "/dev/ttyUSB0",
    //     "productId": "0x7523",
    //     "isOpen": false
    //   }
    // ]

    open(ports[0].path, 9600).then(port => {
      console.log('Opened connection to', port);

      port.online = line => console.log('LINE:', line); // framed by newline
      // port.onmessage <- raw, without framing
      port.onclose = () => console.log('CLOSED');

      setTimeout(() => port.close(), 5000);
    });
  });
});
```
