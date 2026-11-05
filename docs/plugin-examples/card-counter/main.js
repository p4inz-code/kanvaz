/* Card Counter: a small example plugin.
   Adds "Card Counter: Count cards" to the Command Palette (Ctrl+K). It reads the board
   through the read-only data API and shows the result in Kanvaz's own toast.
   It asks for no permissions and never touches the network or your files. */

(function() {

  /* captured once, at the top, because document.currentScript is only reliable now */
  var PLUGIN_ID = document.currentScript
    ? document.currentScript.getAttribute('data-plugin-id')
    : 'yourname.card-counter';

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  KanvazPluginAPI.registerCommand('card-counter.count', {
    label: 'Card Counter: Count cards',
    run: function() {
      var cards = KanvazPluginAPI.getCards();
      var selected = KanvazPluginAPI.getSelected();
      var message = 'This board has ' + plural(cards.length, 'card') + '.';
      if (selected.length) message += ' ' + selected.length + ' selected.';
      KanvazPluginAPI.showToast(message, 'success');
    }
  });

  /* remember how many times it was used: per-plugin storage returns Promises */
  KanvazPluginAPI.on('boardLoad', function() {
    KanvazPluginAPI.storage.load(PLUGIN_ID).then(function(data) {
      var loads = ((data && data.boardLoads) || 0) + 1;
      KanvazPluginAPI.storage.save(PLUGIN_ID, { boardLoads: loads });
    });
  });

})();
