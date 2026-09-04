/* My Plugin — starting point for a Kanvaz plugin.
   See docs/PLUGIN_AUTHORING.md for the full walkthrough this scaffold
   follows. Copy this whole folder, rename it, edit plugin.json's id/name/
   description, then start replacing the example code below.

   Zero permissions requested — this scaffold only uses the always-available
   registerCommand/on/storage surface, none of which touch the network or
   filesystem outside Kanvaz's own managed plugin-storage folder. If you
   later need the gated `mcpBridge` namespace, read
   official-plugins/mcp-bridge/main.js first — it uses a different, safer
   reference-capture pattern than this file does, and PLUGIN_AUTHORING.md
   explains why. */

(function() {

  /* document.currentScript is only reliable during this synchronous
     top-level run — capture it now, not later inside a callback. */
  var PLUGIN_ID = document.currentScript
    ? document.currentScript.getAttribute('data-plugin-id')
    : 'yourname.my-plugin';

  /* ── Example: a Command Palette entry (Ctrl+K) ──
     Delete this and replace with your own command, or remove it entirely
     if your plugin doesn't need one. */
  KanvazPluginAPI.registerCommand('my-plugin.hello', {
    label: 'My Plugin: Say Hello',
    run: function() {
      console.log('[My Plugin] Hello from ' + PLUGIN_ID);
    }
  });

  /* ── Example: persistent per-plugin storage ──
     load()/save() both return Promises; storage is a plain JSON object,
     size-capped, private to this plugin's id. */
  KanvazPluginAPI.storage.load(PLUGIN_ID).then(function(data) {
    var count = (data && data.hellosSaid) || 0;
    console.log('[My Plugin] loaded storage — hellosSaid so far:', count);
  });

  /* ── Example: reacting to board events ──
     Uncomment to see it fire. Valid events: cardCreate, cardUpdate,
     cardDelete, boardLoad, boardSave, selectionChange. */
  // KanvazPluginAPI.on('cardCreate', function(card) {
  //   console.log('[My Plugin] a new card was created:', card.id, card.type);
  // });

  /* ── Example: a new card type (commented out — uncomment to try it) ──
     render(el, card) is required; create(x, y) is optional but needed if
     you want your card type to be creatable from a toolbar/menu entry you
     build yourself (registerCardType alone doesn't add UI to trigger it). */
  // KanvazPluginAPI.registerCardType('my-plugin.example', {
  //   label: 'My Card',
  //   render: function(el, card) {
  //     el.textContent = card.text || 'Hello from My Plugin';
  //   }
  // });

  console.log('[My Plugin] loaded (' + PLUGIN_ID + ')');

})();
