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
    DISK_FULL:         'E012',
    FILE_LOCKED:       'E013',
    FILE_CORRUPT:      'E014',
    PERMISSION_DENIED: 'E015',
    UNKNOWN:           'E999'
  };

  /* Each entry: message (what happened) + action (what to do) */
  var ERROR_INFO = {
    'E001': { msg: 'File is too large to load.',            action: 'Try a smaller file or split it into multiple boards.' },
    'E002': { msg: 'File type is not supported.',           action: 'Kanvaz supports images, GIFs, MP4/WebM video, MP3/WAV/OGG audio, and .kanvaz files.' },
    'E003': { msg: 'File could not be found.',              action: 'The file may have been moved or deleted. Check the file path.' },
    'E004': { msg: 'Canvas failed to initialise.',          action: 'Try restarting Kanvaz. If it persists, reset via Settings → Reset.' },
    'E005': { msg: 'Board could not be saved.',             action: 'Check disk space and file permissions, then try Save As to a different location.' },
    'E006': { msg: 'Board could not be loaded.',            action: 'The file may be corrupted. Check if a .kanvaz.tmp backup exists in the same folder.' },
    'E007': { msg: 'Media file failed to load.',            action: 'The file may be corrupted or in an unsupported format. MP4 (H.264) and WebM are recommended for video.' },
    'E008': { msg: 'Communication error with app core.',    action: 'Restart Kanvaz. If it persists, reinstall.' },
    'E009': { msg: 'Board system failed to start.',         action: 'Restart Kanvaz. If it persists, reset via Settings → Reset.' },
    'E010': { msg: 'Annotation overlay failed.',            action: 'Press Esc to close, then try annotating again.' },
    'E011': { msg: 'Recovered from unexpected crash.',      action: 'Your work was restored from the autosave. Save (Ctrl+S) to keep it.' },
    'E012': { msg: 'Disk is full — cannot save.',      action: 'Free up disk space, then try saving again.' },
    'E013': { msg: 'File is locked by another program.',    action: 'Close the file in the other program, then try again.' },
    'E014': { msg: 'File appears to be corrupted.',         action: 'Check if a .kanvaz.tmp backup exists in the same folder.' },
    'E015': { msg: 'Permission denied.',                    action: 'Try saving to a different folder, or run Kanvaz as administrator.' },
    'E999': { msg: 'An unexpected error occurred.',         action: 'Try restarting Kanvaz. If it persists, export debug info (Settings → Developer) and report the issue.' }
  };

  function getCode(key) {
    return ERROR_CODES[key] || ERROR_CODES.UNKNOWN;
  }

  function getMessage(code) {
    var info = ERROR_INFO[code] || ERROR_INFO['E999'];
    return info.msg;
  }

  function getAction(code) {
    var info = ERROR_INFO[code] || ERROR_INFO['E999'];
    return info.action;
  }

  /* Detect specific OS-level errors and map to a Kanvaz error code */
  function classifyError(err) {
    if (!err) return 'UNKNOWN';
    var msg = (err.message || String(err)).toLowerCase();
    var code = err.code || '';
    if (code === 'ENOSPC' || msg.indexOf('no space') !== -1) return 'DISK_FULL';
    if (code === 'EACCES' || code === 'EPERM' || msg.indexOf('permission') !== -1) return 'PERMISSION_DENIED';
    if (code === 'EBUSY' || msg.indexOf('locked') !== -1) return 'FILE_LOCKED';
    if (code === 'ENOENT' || msg.indexOf('not found') !== -1 || msg.indexOf('no such file') !== -1) return 'FILE_NOT_FOUND';
    if (msg.indexOf('unexpected token') !== -1 || msg.indexOf('json') !== -1) return 'FILE_CORRUPT';
    return null;
  }

  function handle(key, detail, silent) {
    /* Auto-classify OS errors if key is generic */
    if (key === 'UNKNOWN' || key === 'SAVE_FAIL' || key === 'LOAD_FAIL') {
      var autoKey = classifyError(detail);
      if (autoKey) key = autoKey;
    }

    var code = getCode(key);
    var msg = getMessage(code);
    var action = getAction(code);

    if (!silent) {
      if (typeof KanvazUI !== 'undefined' && KanvazUI.toast) {
        KanvazUI.toast(code + ': ' + msg + ' ' + action, 'error');
      }
      console.error('[Kanvaz ' + code + '] ' + msg + ' → ' + action, detail || '');
    }
    return { code: code, message: msg, action: action, detail: detail };
  }

  function init() {
    /* Audit fix: these two handlers used to build their own toast text
       by hand from the raw JS error message + file:line, instead of
       calling handle('UNKNOWN', ...) like every other failure path in
       the app — which produces the polished "E999: An unexpected error
       occurred... [action]" message this module's own catalog already
       defines for exactly this case. That inconsistency matters more
       now than it used to: since a plugin's entry script runs in the
       same page context as the rest of the app (see plugin-api.js), a
       plugin's own uncaught top-level error is a real, live path into
       window.onerror — and users were seeing raw technical stack text
       here instead of the same guidance every other error in Kanvaz
       gives them. */
    window.onerror = function(message, source, lineno, colno, error) {
      console.error('[Kanvaz Uncaught]', message, 'at', source + ':' + lineno);
      var detail = String(message || 'unknown');
      if (source) {
        var file = source.split(/[\\/]/).pop();
        detail += ' (' + file + ':' + lineno + ')';
      }
      handle('UNKNOWN', detail);
      return true;
    };

    window.onunhandledrejection = function(event) {
      var reason = event.reason;
      var detail = (reason && reason.message) ? reason.message : String(reason || 'promise rejected');
      console.error('[Kanvaz Unhandled Promise]', detail, reason);
      handle('UNKNOWN', detail);
    };
  }

  return {
    init: init,
    handle: handle,
    classify: classifyError,
    codes: ERROR_CODES
  };

})();
