#!/usr/bin/env node
/* ============================================================
   Kanvaz — net-guard.js test (SSRF guard for URL-card previews)
   Usage: node test/net-guard-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var http = require('http');
var guard = require(path.join(__dirname, '..', 'src', 'net-guard.js'));

var PRIVATE = [
  '0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
  '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.0.0.1', '192.0.2.5', '192.168.0.1', '192.168.255.255', '198.18.0.1', '198.19.255.255',
  '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:169.254.169.254',
  'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1',
  '2001:db8::1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::1', '2002:c0a8:1::1',
  '::127.0.0.1', '100::1', '[::1]', 'not-an-ip', ''
];

var PUBLIC = [
  '1.1.1.1', '8.8.8.8', '93.184.216.34', '100.63.255.255', '100.128.0.1', '172.15.255.255',
  '172.32.0.1', '192.167.255.255', '192.169.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255',
  '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808',
  '2002:808:808::1', '2a00:1450:4001:81b::200e'
];

var LIT_BLOCKED = ['localhost', 'LOCALHOST', 'foo.localhost', '127.0.0.1', '[::1]', '10.0.0.5', '169.254.169.254', '0.0.0.0'];
var LIT_ALLOWED = ['example.com', 'github.com', '8.8.8.8', '[2606:4700:4700::1111]'];

function run(done) {
  PRIVATE.forEach(function(a) {
    assert.strictEqual(guard.isPrivateAddress(a), true, 'must be blocked: "' + a + '"');
  });
  console.log('  ✓ ' + PRIVATE.length + ' private/reserved/unparseable addresses blocked');

  PUBLIC.forEach(function(a) {
    assert.strictEqual(guard.isPrivateAddress(a), false, 'must be allowed: "' + a + '"');
  });
  console.log('  ✓ ' + PUBLIC.length + ' ordinary public addresses allowed (incl. range edges)');

  LIT_BLOCKED.forEach(function(h) {
    assert.throws(function() { guard.assertPublicHost(h); }, /blocked/, 'assertPublicHost must reject ' + h);
  });
  LIT_ALLOWED.forEach(function(h) {
    assert.doesNotThrow(function() { guard.assertPublicHost(h); }, 'assertPublicHost must allow ' + h);
  });
  console.log('  ✓ assertPublicHost rejects localhost/literal private IPs, allows real hostnames');

  /* safeLookup — real dns.lookup against localhost, both callback shapes */
  guard.safeLookup('localhost', {}, function(err) {
    assert.ok(err && err.code === 'EBLOCKED', 'localhost must be blocked at lookup time, got: ' + (err && err.message));
    guard.safeLookup('localhost', { all: true }, function(err2) {
      assert.ok(err2 && err2.code === 'EBLOCKED', 'all:true shape must also block localhost');

      /* End to end: a real local HTTP server must be unreachable through
         a request that uses safeLookup, even by a name that resolves to it. */
      var server = http.createServer(function(req, res) { res.end('secret'); });
      server.listen(0, '127.0.0.1', function() {
        var port = server.address().port;
        var req = http.get('http://localhost:' + port + '/', { lookup: guard.safeLookup }, function(res) {
          server.close();
          assert.fail('request to a loopback server must never connect');
        });
        req.on('error', function(e) {
          server.close();
          assert.ok(/blocked/.test(e.message), 'expected a blocked error, got: ' + e.message);
          console.log('  ✓ a real request through safeLookup cannot reach a loopback server');
          done();
        });
      });
    });
  });
}

try {
  run(function() {
    console.log('\nALL NET GUARD TESTS PASSED');
    process.exit(0);
  });
} catch (e) {
  console.error('\nNET GUARD TEST FAILED');
  console.error(e);
  process.exit(1);
}
process.on('uncaughtException', function(e) {
  console.error('\nNET GUARD TEST FAILED');
  console.error(e);
  process.exit(1);
});
