# Port Alignment Test

Proves the Map View connection port math matches real browser rendering.

## Run
```bash
npm install puppeteer-core
node test/run-port-test.js
```

Requires a Chromium binary (adjust `executablePath` in run-port-test.js).

## What it does
Renders nodes with the EXACT CSS from map-view.js in real Chromium,
measures actual port-dot center positions via getBoundingClientRect,
and compares against outPort()/inPort() formulas at 5 different
zoom/pan levels.

## Expected output
`ALL CASES PASS — formula matches real DOM at every zoom/pan`
with `error=[0,0]` on every port.

## The proven formula
```
outPort.x = mapPosition.x + NODE_W - PORT_INSET   (176 - 1 = 175)
inPort.x  = mapPosition.x + PORT_INSET             (1)
port.y    = mapPosition.y + NODE_H / 2
```
PORT_INSET (1px) = half the port dot's own 2px border.
