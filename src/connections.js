/* connections.js — reference relationship system (v3.0)
 *
 * Manages directional connections between references.
 * A connection goes FROM one reference TO another, with a
 * relationship type, optional note, priority, and timestamps.
 *
 * Connections are stored flat (not per-board), so the data model itself
 * doesn't prevent a connection between cards on different boards. In
 * practice there's currently no UI path to create one, though: only one
 * board's cards are ever loaded into memory at a time (see boards.js —
 * switching boards swaps the active card set), so the Inspector's
 * "Connect to" picker can only ever offer cards from the board you're
 * currently on. Cross-board linking would need its own UI (a way to
 * browse/pick a card from another board while a different one is
 * active) — it's a real feature to design properly later, not something
 * that falls out of the data model for free.
 */

var KanvazConnections = (function() {

  /* ── Connection types ── */
  var CONNECTION_TYPES = [
    'RelatedTo',
    'InspiredBy',
    'DerivedFrom',
    'AlternativeTo',
    'Supports',
    'UsedIn',
    'References',
    /* Direct request: connections should support "direction and label
       both optional" — Plain is a real type like any other (goes through
       the exact same create/serialise/type-picker path), it just carries
       no relationship meaning. typeColor()/typeLabel() in map-view.js and
       inspector.js already fall back to a neutral gray + the bare word
       for any type they don't have a specific color for, so this needed
       no changes there. */
    'Plain'
  ];

  /* ── State ── */
  var connections = {};   /* id → connection object */

  /* Direct request: a node can connect to up to 8 others, "incoming or
     outgoing, no matter — 8 per node" (total connections touching it,
     either direction combined). Enforced at every creation entry point
     (Map View's drag-to-wire gesture and the Inspector's "Add
     connection" dialog) via canAddConnection(), below — never silently
     allowed past 8 and cleaned up later. */
  var MAX_CONNECTIONS_PER_NODE = 8;

  /* ── Helpers ── */

  function nextId() {
    return 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  function isValidType(type) {
    return CONNECTION_TYPES.indexOf(type) !== -1;
  }

  /* ── CRUD ── */

  function create(fromRefId, toRefId, type, opts) {
    if (!fromRefId || !toRefId) return null;
    if (fromRefId === toRefId) return null;
    if (!isValidType(type)) type = 'RelatedTo';

    opts = opts || {};

    /* Prevent duplicate: same from → to with same type */
    for (var k in connections) {
      var existing = connections[k];
      if (existing.fromRefId === fromRefId &&
          existing.toRefId   === toRefId &&
          existing.type      === type) {
        return existing;
      }
    }

    var now = new Date().toISOString();
    var conn = {
      id:           nextId(),
      fromRefId:    fromRefId,
      toRefId:      toRefId,
      type:         type,
      note:         opts.note     || '',
      priority:     opts.priority || 1,
      dateCreated:  now,
      dateModified: now
    };

    connections[conn.id] = conn;
    if (typeof KanvazApp !== 'undefined') KanvazApp.markDirty();
    return conn;
  }

  function remove(connId) {
    if (!connections[connId]) return false;
    delete connections[connId];
    if (typeof KanvazApp !== 'undefined') KanvazApp.markDirty();
    return true;
  }

  function update(connId, changes) {
    var conn = connections[connId];
    if (!conn) return null;

    if (changes.type !== undefined && isValidType(changes.type)) {
      conn.type = changes.type;
    }
    if (changes.note !== undefined)     conn.note     = changes.note;
    if (changes.priority !== undefined) conn.priority  = changes.priority;

    conn.dateModified = new Date().toISOString();
    if (typeof KanvazApp !== 'undefined') KanvazApp.markDirty();
    return conn;
  }

  function get(connId) {
    return connections[connId] || null;
  }

  /* ── Queries ── */

  function getFrom(refId) {
    var out = [];
    for (var k in connections) {
      if (connections[k].fromRefId === refId) out.push(connections[k]);
    }
    return out;
  }

  function getTo(refId) {
    var out = [];
    for (var k in connections) {
      if (connections[k].toRefId === refId) out.push(connections[k]);
    }
    return out;
  }

  function getAll(refId) {
    var out = [];
    for (var k in connections) {
      var c = connections[k];
      if (c.fromRefId === refId || c.toRefId === refId) out.push(c);
    }
    return out;
  }

  /* True if creating a NEW connection between these two refs would keep
     both of them at or under MAX_CONNECTIONS_PER_NODE. A duplicate
     from/to/type (create()'s own de-dupe, above) doesn't count as new,
     so re-picking the same relationship never falsely trips the cap. */
  function canAddConnection(fromRefId, toRefId) {
    if (!fromRefId || !toRefId || fromRefId === toRefId) return false;
    for (var k in connections) {
      var existing = connections[k];
      if (existing.fromRefId === fromRefId && existing.toRefId === toRefId) return true;
    }
    return getAll(fromRefId).length < MAX_CONNECTIONS_PER_NODE &&
           getAll(toRefId).length   < MAX_CONNECTIONS_PER_NODE;
  }

  function getByType(type) {
    var out = [];
    for (var k in connections) {
      if (connections[k].type === type) out.push(connections[k]);
    }
    return out;
  }

  function count() {
    var n = 0;
    for (var k in connections) n++;
    return n;
  }

  /* ── Cascade delete — remove all connections referencing a ref ── */

  function removeAllFor(refId) {
    var toDelete = [];
    for (var k in connections) {
      var c = connections[k];
      if (c.fromRefId === refId || c.toRefId === refId) {
        toDelete.push(k);
      }
    }
    for (var i = 0; i < toDelete.length; i++) {
      delete connections[toDelete[i]];
    }
    if (toDelete.length > 0 && typeof KanvazApp !== 'undefined') {
      KanvazApp.markDirty();
    }
    return toDelete.length;
  }

  /* ── Serialise / Deserialise ── */

  function serialise() {
    var out = [];
    for (var k in connections) {
      var c = connections[k];
      out.push({
        id:           c.id,
        fromRefId:    c.fromRefId,
        toRefId:      c.toRefId,
        type:         c.type,
        note:         c.note || '',
        priority:     c.priority || 1,
        dateCreated:  c.dateCreated,
        dateModified: c.dateModified
      });
    }
    return out;
  }

  function deserialise(arr) {
    connections = {};
    if (!arr || !arr.length) return;
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (c && c.id && c.fromRefId && c.toRefId) {
        connections[c.id] = {
          id:           c.id,
          fromRefId:    c.fromRefId,
          toRefId:      c.toRefId,
          type:         isValidType(c.type) ? c.type : 'RelatedTo',
          note:         c.note || '',
          priority:     c.priority || 1,
          dateCreated:  c.dateCreated  || new Date().toISOString(),
          dateModified: c.dateModified || new Date().toISOString()
        };
      }
    }
  }

  function clear() {
    connections = {};
  }

  /* ── Public API ── */

  return {
    CONNECTION_TYPES: CONNECTION_TYPES,
    MAX_CONNECTIONS_PER_NODE: MAX_CONNECTIONS_PER_NODE,
    canAddConnection: canAddConnection,
    create:          create,
    remove:          remove,
    update:          update,
    get:             get,
    getFrom:         getFrom,
    getTo:           getTo,
    getAll:          getAll,
    getByType:       getByType,
    count:           count,
    removeAllFor:    removeAllFor,
    serialise:       serialise,
    deserialise:     deserialise,
    clear:           clear
  };

})();
