/* net-guard.js — refuses requests to loopback/private/link-local/reserved
   addresses (SSRF guard for the URL-card preview fetch).

   Found by the 2026-09-20 security re-audit: fetchUrlBuffer() in main.js
   accepted any http/https URL, followed redirects without re-checking
   where they pointed, and would happily fetch http://127.0.0.1:…,
   http://192.168.x.x, http://169.254.169.254 (cloud metadata) or a
   public hostname that DNS-resolves to one of those. The click is
   user-initiated, but a pasted link (or a redirect behind it) shouldn't
   be able to probe the local network from the user's machine.

   Two layers, both needed:
   1. assertPublicHost() — rejects literal IPs (Node never calls a custom
      lookup for those) and "localhost" before any socket is opened.
   2. safeLookup() — passed as the request's `lookup` option, so the
      address that is actually CONNECTED to is validated, not just an
      earlier resolution of the same name (closes DNS rebinding's
      check-then-use gap). Handles both the single-address and
      all:true callback shapes (newer Node's autoSelectFamily uses the
      latter), so it survives the Electron upgrade on the roadmap.

   Node-only on purpose (no electron require) so test/net-guard-test.js
   can exercise it directly. ES5/var-only like the rest of src/. */

var dns = require('dns');
var net = require('net');

var V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];

function parseIPv4(s) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s));
  if (!m) return null;
  var o = [];
  for (var i = 1; i <= 4; i++) {
    var n = parseInt(m[i], 10);
    if (n > 255) return null;
    o.push(n);
  }
  return o;
}

function v4ToInt(o) {
  return ((o[0] * 16777216) + (o[1] * 65536) + (o[2] * 256) + o[3]);
}

function isBlockedV4(o) {
  var ip = v4ToInt(o);
  for (var i = 0; i < V4_BLOCKED.length; i++) {
    var base = v4ToInt(parseIPv4(V4_BLOCKED[i][0]));
    var size = Math.pow(2, 32 - V4_BLOCKED[i][1]);
    if (ip >= base && ip < base + size) return true;
  }
  return false;
}

function parseIPv6(str) {
  var s = String(str);
  var pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);
  if (!net.isIPv6(s)) return null;
  var lastColon = s.lastIndexOf(':');
  var tail = s.slice(lastColon + 1);
  if (tail.indexOf('.') !== -1) {
    var v4 = parseIPv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0] * 256) + v4[1]).toString(16) + ':' + ((v4[2] * 256) + v4[3]).toString(16);
  }
  var halves = s.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [];
  var rest = (halves.length === 2 && halves[1]) ? halves[1].split(':') : [];
  var groups = head;
  if (halves.length === 2) {
    var fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    for (var f = 0; f < fill; f++) groups = groups.concat(['0']);
    groups = groups.concat(rest);
  }
  if (groups.length !== 8) return null;
  var out = [];
  for (var i = 0; i < 8; i++) {
    var n = parseInt(groups[i], 16);
    if (isNaN(n) || n < 0 || n > 65535) return null;
    out.push(n);
  }
  return out;
}

function embeddedV4(hi, lo) {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/* True if `addr` (v4 or v6 text, brackets/zone tolerated) is anything
   other than an ordinary public unicast address. Fails CLOSED: text
   that can't be parsed as an IP at all is reported blocked. */
function isPrivateAddress(addr) {
  var s = String(addr || '').replace(/^\[|\]$/g, '');
  var fam = net.isIP(s.indexOf('%') !== -1 ? s.slice(0, s.indexOf('%')) : s);
  if (fam === 4) return isBlockedV4(parseIPv4(s));
  if (fam !== 6) return true;

  var g = parseIPv6(s);
  if (!g) return true;

  var firstFiveZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (firstFiveZero && g[5] === 0xffff) return isBlockedV4(embeddedV4(g[6], g[7]));            /* ::ffff:a.b.c.d mapped */
  if (firstFiveZero && g[5] === 0) {                                                             /* ::, ::1, ::a.b.c.d */
    if (g[6] === 0 && g[7] <= 1) return true;
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isBlockedV4(embeddedV4(g[6], g[7]));                                                  /* NAT64 */
  }
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2]));                               /* 6to4 */
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                                   /* fc00::/7 unique-local */
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                                   /* fe80::/10 link-local */
  if ((g[0] & 0xffc0) === 0xfec0) return true;                                                   /* fec0::/10 site-local */
  if ((g[0] & 0xff00) === 0xff00) return true;                                                   /* ff00::/8 multicast */
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                           /* documentation */
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;                    /* 100::/64 discard */
  return false;
}

/* Throws for a hostname that is (or trivially is) non-public — literal
   IPs and localhost. Named hosts that merely RESOLVE somewhere private
   are caught by safeLookup() at connect time instead. */
function assertPublicHost(hostname) {
  var h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) throw new Error('blocked: empty host');
  if (h === 'localhost' || /\.localhost$/.test(h)) throw new Error('blocked: ' + h + ' is a loopback name');
  if (net.isIP(h.indexOf('%') !== -1 ? h.slice(0, h.indexOf('%')) : h) && isPrivateAddress(h)) {
    throw new Error('blocked: ' + h + ' is a private/reserved address');
  }
}

function blockedError(hostname) {
  var e = new Error('blocked: ' + hostname + ' resolves to a private/reserved address');
  e.code = 'EBLOCKED';
  return e;
}

/* Drop-in for the http(s).get `lookup` option. */
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, options, function(err, address, family) {
    if (err) { callback(err); return; }
    var list = Array.isArray(address) ? address : [{ address: address, family: family }];
    for (var i = 0; i < list.length; i++) {
      if (isPrivateAddress(list[i].address)) { callback(blockedError(hostname)); return; }
    }
    if (Array.isArray(address)) callback(null, address);
    else callback(null, address, family);
  });
}

module.exports = {
  isPrivateAddress: isPrivateAddress,
  assertPublicHost: assertPublicHost,
  safeLookup: safeLookup
};
