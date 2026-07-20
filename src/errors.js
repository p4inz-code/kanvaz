/* errors.js — global error boundary. Load first. */

var KanvazErrors = (function() {

  var ERROR_CODES = {
    FILE_TOO_LARGE:    'E001',
    FILE_TYPE_INVALID: 'E002',
    FILE_NOT_FOUND:    'E003',
    CANVAS_INIT_FAIL:  'E004',
    SAVE_FAIL:         'E005',
    LOAD_FAIL:         'E006',
    MEDIA_LOAD_FAIL:   'E007',
    IPC_FAIL:          'E008',
    BOARD_INIT_FAIL:   'E009',
    ANNOTATE_FAIL:     'E010',
    CRASH_RECOVERY:    'E011',
    UNKNOWN:           'E999'
  };

  var ERROR_MESSAGES = {
    'E001': 'File is too large to load.',
    'E002': 'File type is not supported.',
    'E003': 'File could not be found.',
    'E004': 'Canvas failed to initialise.',
    'E005': 'Board could not be saved.',
    'E006': 'Board could not be loaded.',
    'E007': 'Media file failed to load.',
    'E008': 'Communication error with app core.',
    'E009': 'Board system failed to start.',
    'E010': 'Annotation overlay failed.',
    'E011': 'Recovered from unexpected crash.',
    'E999': 'An unexpected error occurred.'
  };

  function getCode(key) {
    return ERROR_CODES[key] || ERROR_CODES.UNKNOWN;
  }

  function getMessage(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES['E999'];
  }

  function handle(key, detail, silent) {
    var code = getCode(key);
    var msg = getMessage(code);
    if (!silent) {
      if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
        KanvazUI.toast(msg, 'error');
      }
      console.error('[Kanvaz ' + code + '] ' + msg, detail || '');
    }
    return { code: code, message: msg, detail: detail };
  }

  function init() {
    window.onerror = function(message, source, lineno, colno, error) {
      console.error('[Kanvaz Uncaught]', message, 'at', source + ':' + lineno);
      /* Show the REAL error so devs can diagnose — the generic E999
         message hides what actually broke and turns every bug into
         a guessing game. */
      var detail = String(message || 'unknown');
      if (source) {
        var file = source.split(/[\\/]/).pop();
        detail += ' (' + file + ':' + lineno + ')';
      }
      if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
        KanvazUI.toast(detail, 'error');
      }
      console.error('[Kanvaz E999] ' + detail);
      return true;
    };

    window.onunhandledrejection = function(event) {
      var reason = event.reason;
      var detail = (reason && reason.message) ? reason.message : String(reason || 'promise rejected');
      console.error('[Kanvaz Unhandled Promise]', detail, reason);
      if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
        KanvazUI.toast(detail, 'error');
      }
    };
  }

  return {
    init: init,
    handle: handle,
    codes: ERROR_CODES
  };

})();
