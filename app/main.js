(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tv = window.tizen, storageKey = 'b1ackha7tv.settings.v1';
  var prefs = {name:'My TV', theme:'midnight', background:'', backgroundVersion:2, preview:true, system:false, favorites:null};
  var editingApps = false;
  var iconResults = Object.create(null), iconCache = Object.create(null);
  var apps = [], log = [], returnFocus, exitFocus;
  var windowVisible = false, windowBusy = false, launching = false, previewBlocked = false;
  var previewNeedsShow = true;
  var launchTimer = null, imageRequest = 0, appRequest = 0;
  var launchGeneration = 0;
  var themes = {
    midnight:'radial-gradient(ellipse at 10% 0%,#244357 0%,transparent 55%),linear-gradient(130deg,#131b33,#090e1b)',
    aurora:'radial-gradient(ellipse at 0% 0%,#24746c 0%,transparent 60%),linear-gradient(130deg,#20224c,#101426)',
    ember:'radial-gradient(ellipse at 0% 0%,#854b39 0%,transparent 60%),linear-gradient(130deg,#3d263c,#121325)'
  };
  function report(message, error) {
    var detail = error ? ' [' + (error.name || 'Error') + ': ' + (error.message || 'No details') + ']' : '';
    $('status').textContent = message + detail;
    log.push(new Date().toLocaleTimeString() + ' ' + message + detail);
    if (log.length > 16) { log.shift(); }
    $('diagnostics').textContent = log.join('\n');
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)); }
    catch (e) { report('Settings work this session, but could not be saved.', e); }
  }
  function focus(el) { if (el && !el.disabled) { el.focus(); } }
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (saved && typeof saved === 'object') {
        if (typeof saved.name === 'string') { prefs.name = cleanName(saved.name); }
        if (Object.prototype.hasOwnProperty.call(themes, saved.theme)) { prefs.theme = saved.theme; }
        if (typeof saved.background === 'string') { prefs.background = saved.background; }
        if (typeof saved.preview === 'boolean') { prefs.preview = saved.preview; }
        if (typeof saved.system === 'boolean') { prefs.system = saved.system; }
        if (Array.isArray(saved.favorites)) { prefs.favorites = saved.favorites.filter(function (id) { return typeof id === 'string'; }); }
        // Clear legacy packaged backgrounds once without losing favorites or TV preferences.
        if (saved.backgroundVersion !== 2) { prefs.background = ''; save(); }
      }
    } catch (e) { report('Saved settings could not be read; using defaults.', e); }
  }
  function cleanName(value) {
    return value.replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,32).trim() || 'My TV';
  }
  function applyName() {
    $('launcher-title').textContent = prefs.name;
    $('launcher-mark').textContent = prefs.name.split(' ').map(function (word) { return word.charAt(0); }).join('').slice(0,2).toUpperCase();
    $('launcher-name').value = prefs.name;
    document.title = prefs.name;
  }
  function safeImagePath(path) {
    return /^(?:assets\/)[a-zA-Z0-9_\-\/ .]+\.(?:png|jpe?g|webp)$/i.test(path) && path.indexOf('..') === -1;
  }
  function background(path, persist) {
    var request = ++imageRequest;
    $('wallpaper').style.backgroundImage = themes[prefs.theme];
    if (!path) { return; }
    if (!safeImagePath(path)) { report('Use a packaged image path such as assets/background.jpg.'); return; }
    var img = new Image();
    img.onload = function () {
      if (request !== imageRequest) { return; }
      $('wallpaper').style.backgroundImage = 'linear-gradient(rgba(5,10,20,.25),rgba(5,10,20,.5)),url("' + path + '")';
      if (persist) { prefs.background = path; save(); report('Custom background saved.'); }
    };
    img.onerror = function () { if (request === imageRequest) { report('Image was not found in the app package.'); } };
    img.src = path;
  }
  function appGroupKey(app) {
    var name = (app.name || '').toLowerCase().replace(/[®™]/g,'').replace(/\+/g,'plus').replace(/[^a-z0-9]/g,'');
    if (/^(amazonprimevideo|primevideo|amazonvideo)$/.test(name)) { return 'brand:prime-video'; }
    if (name === 'disneyplus') { return 'brand:disney-plus'; }
    // Do not merge unrelated apps merely because they have a similar title.
    return 'id:' + app.id;
  }
  function uniqueApps(ownId) {
    var groups = Object.create(null), aliases = Object.create(null), catalog = [];
    apps.forEach(function (app) {
      if (!app || !app.id || app.id === ownId) { return; }
      var key = appGroupKey(app);
      if (!groups[key]) { groups[key] = []; }
      groups[key].push(app);
    });
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      group.sort(function (a,b) {
        // Prefer a menu-visible entry, then the user's existing first shortcut.
        var visibleDifference = Number(a.show === false) - Number(b.show === false);
        if (visibleDifference) { return visibleDifference; }
        var aIndex = (prefs.favorites || []).indexOf(a.id), bIndex = (prefs.favorites || []).indexOf(b.id);
        if (aIndex < 0) { aIndex = Infinity; } if (bIndex < 0) { bIndex = Infinity; }
        if (aIndex !== bIndex) { return aIndex < bIndex ? -1 : 1; }
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      catalog.push(group[0]);
      group.forEach(function (app) { aliases[app.id] = group[0].id; });
    });
    if (prefs.favorites !== null) {
      var selected = [];
      prefs.favorites.forEach(function (id) {
        var canonical = aliases[id] || id;
        if (selected.indexOf(canonical) === -1) { selected.push(canonical); }
      });
      if (JSON.stringify(selected) !== JSON.stringify(prefs.favorites)) { prefs.favorites = selected; save(); }
    }
    return {catalog:catalog, aliases:aliases};
  }
  function renderApps() {
    var oldId = document.activeElement && document.activeElement.getAttribute('data-app-id');
    $('apps').textContent = '';
    var ownId = '';
    try { ownId = tv.application.getCurrentApplication().appInfo.id; } catch (ignore) { /* Browser preview. */ }
    var unique = uniqueApps(ownId);
    oldId = unique.aliases[oldId] || oldId;
    // show=false denotes an entry hidden from the normal system app menu.
    var visible = unique.catalog.filter(function (app) { return prefs.system || app.show !== false; });
    visible.sort(function (a,b) { return (a.name || a.id).localeCompare(b.name || b.id); });
    if (prefs.favorites === null && visible.length) {
      var main = visible.filter(function (app) { return /netflix|youtube|prime video|amazon|disney|hulu|peacock|paramount|apple tv|spectrum|pluto|tubi|plex|\bmax\b/i.test(app.name || ''); });
      prefs.favorites = (main.length ? main : visible).slice(0,9).map(function (app) { return app.id; });
      save();
    }
    if (!editingApps) {
      visible = unique.catalog.filter(function (app) { return (prefs.favorites || []).indexOf(app.id) !== -1; });
      visible.sort(function (a,b) { return prefs.favorites.indexOf(a.id) - prefs.favorites.indexOf(b.id); });
    }
    visible.forEach(function (app) {
      var button = document.createElement('button'); button.className = 'app'; button.setAttribute('data-app-id', app.id);
      button.title = app.name || app.id;
      var initial = document.createElement('span'); initial.className = 'initial'; initial.textContent = (app.name || '?').slice(0,2).toUpperCase(); button.appendChild(initial);
      loadAppIcon(app,button,initial);
      var name = document.createElement('span'); name.className = 'app-name'; name.textContent = app.name || app.id; button.appendChild(name);
      if (editingApps) {
        var selected = (prefs.favorites || []).indexOf(app.id) !== -1;
        button.setAttribute('aria-pressed', String(selected));
        var action = document.createElement('span'); action.className = 'app-action'; action.textContent = selected ? '✓ On Home · Remove' : '+ Add to Home'; button.appendChild(action);
      }
      button.onclick = function () {
        if (!editingApps) { launch(app.id, app.name || app.id); return; }
        if (prefs.favorites === null) { prefs.favorites = []; }
        var index = prefs.favorites.indexOf(app.id);
        if (index === -1) { prefs.favorites.push(app.id); }
        else { prefs.favorites.splice(index,1); }
        save(); renderApps(); report((index === -1 ? 'Added ' : 'Removed ') + (app.name || app.id) + (index === -1 ? ' to Home.' : ' from Home.'));
      };
      $('apps').appendChild(button);
      if (oldId === app.id) { focus(button); }
    });
    $('library-title').textContent = editingApps ? 'Add or remove apps' : 'Your main apps';
    $('edit-apps').textContent = editingApps ? 'Done editing apps' : 'Edit apps';
    $('edit-hint').hidden = !editingApps;
    $('apps').classList.toggle('editing', editingApps);
    $('app-count').textContent = visible.length + (editingApps ? ' available' : ' on Home');
    $('empty').hidden = visible.length > 0;
    if (!visible.length) { $('empty').textContent = tv ? (editingApps ? 'No apps returned. Try Refresh apps or show system entries in Settings.' : 'Choose Edit apps to add your favorite apps to Home.') : 'Open B1ackha7TV on your Samsung TV to see installed apps. TV apps and live input are unavailable in a PC browser.'; }
    if (oldId && document.activeElement === document.body) { focus($('refresh')); }
  }
  function refreshApps() {
    iconCache = Object.create(null); iconResults = Object.create(null);
    if (!tv || !tv.application || !tv.application.getAppsInfo) { renderApps(); report('Browser preview — TV features need the TV.'); return; }
    var request = ++appRequest;
    try {
      tv.application.getAppsInfo(function (list) {
        if (request !== appRequest) { return; }
        apps = list || []; renderApps(); report('App list refreshed.');
      }, function (e) { if (request === appRequest) { report('The TV could not list apps.', e); renderApps(); } });
    } catch (e) { report('App discovery is unavailable.', e); renderApps(); }
  }
  function iconSummary() {
    var missing = Object.keys(iconResults).filter(function (id) { return iconResults[id].failed; }).map(function (id) { return iconResults[id].name; });
    $('icon-status').textContent = missing.length ? 'Pictures unavailable: ' + missing.join(', ') + '. Select Refresh apps to retry.' : 'No missing pictures detected among checked apps.';
  }
  function loadAppIcon(app,button,initial) {
    var image = document.createElement('img'), paths = [], seen = Object.create(null);
    var timer, attempt = 0, refreshed = false, resolved = false, bundled = false, original = app.iconPath || '';
    var cacheKey = app.id + '\n' + original;
    image.alt = ''; image.hidden = true; button.appendChild(image);
    function add(value) {
      if (typeof value !== 'string' || !value || seen[value]) { return; }
      seen[value] = true; paths.push(value);
      // Native absolute filesystem paths must not be interpreted relative to the widget.
      if (value.charAt(0) === '/' && value.charAt(1) !== '/') {
        var uri = 'file://' + value.split('/').map(encodeURIComponent).join('/');
        if (!seen[uri]) { seen[uri] = true; paths.push(uri); }
      }
    }
    function finish(failed) {
      clearTimeout(timer); image.onload = image.onerror = null;
      image.hidden = failed; initial.hidden = !failed;
      if (!failed) { iconCache[cacheKey] = image.getAttribute('src'); }
      iconResults[app.id] = {name:app.name || app.id, failed:failed}; iconSummary();
    }
    function next() {
      clearTimeout(timer);
      if (paths.length) {
        var token = ++attempt, candidate = paths.shift();
        image.onload = function () { if (token === attempt) { finish(false); } };
        image.onerror = function () { if (token === attempt) { next(); } };
        timer = setTimeout(function () { if (token === attempt) { next(); } },3000);
        image.src = candidate; return;
      }
      if (!refreshed) {
        refreshed = true;
        try { if (tv && tv.application && tv.application.getAppInfo) { add(tv.application.getAppInfo(app.id).iconPath); } } catch (ignore) { /* Some system apps hide details. */ }
        if (paths.length) { next(); return; }
      }
      if (!resolved && original && tv && tv.filesystem && tv.filesystem.resolve) {
        resolved = true;
        var finishedResolve = false;
        function resume(value) { if (finishedResolve) { return; } finishedResolve = true; clearTimeout(timer); add(value); next(); }
        timer = setTimeout(function () { resume(''); },3000);
        try { tv.filesystem.resolve(original,function (file) {
          try { resume(file.toURI()); } catch (ignore) { resume(''); }
        },function () { resume(''); },'r'); } catch (ignore) { resume(''); }
        return;
      }
      if (!bundled && /^(amazon)?primevideo$/.test((app.name || '').toLowerCase().replace(/[^a-z0-9]/g,''))) {
        bundled = true; add('assets/prime-video.svg'); next(); return;
      }
      finish(true);
    }
    if (iconCache[cacheKey]) { add(iconCache[cacheKey]); }
    add(original); next();
  }
  function wantedPreview() { return prefs.preview && !document.hidden && !launching && !previewBlocked; }
  function previewLabel(text) { $('preview-message').textContent = text; }
  // Serialize show/hide so a late show callback cannot leave video over another app.
  function syncPreview(done) {
    if (!tv || !tv.tvwindow) { previewLabel('TV preview is available on the Samsung TV.'); if (done) { done(); } return; }
    if (windowBusy) { if (done) { window.setTimeout(function () { syncPreview(done); }, 50); } return; }
    var desired = wantedPreview();
    if (windowVisible === desired && !(desired && previewNeedsShow)) { if (!desired && !previewBlocked) { previewLabel(prefs.preview ? 'Preview paused.' : 'Preview is off.'); } if (done) { done(); } return; }
    windowBusy = true;
    var settled = false;
    var watchdog = setTimeout(function () { completed({name:'TimeoutError',message:'TV did not respond. Select Retry TV.'}); }, 5000);
    function completed(error) {
      if (settled) {
        // A show may complete after the timeout and after this app was hidden.
        if (!error && desired && !wantedPreview()) { windowVisible = true; syncPreview(); }
        return;
      }
      settled = true; clearTimeout(watchdog);
      windowBusy = false;
      if (error) {
        previewNeedsShow = true;
        previewBlocked = true; report('TV preview unavailable. Check input and try again.', error);
        document.body.classList.remove('preview-active');
        previewLabel('Preview unavailable — select Retry TV.');
      } else {
        windowVisible = desired;
        previewNeedsShow = !desired;
        document.body.classList.toggle('preview-active', windowVisible);
        previewLabel(windowVisible ? '' : 'Preview is off.');
      }
      if (!error && wantedPreview() !== windowVisible) { syncPreview(done); }
      else if (done) { done(); }
    }
    try {
      if (desired) {
        var r = $('preview-picture').getBoundingClientRect();
        // Avoid fractional percentage parsing on older TV firmware. Measure after layout
        // and send explicit, integer pixel coordinates for the actual app viewport.
        var rect = [r.left,r.top,r.width,r.height].map(function (value) { return Math.round(value) + 'px'; });
        if (r.width < 100 || r.height < 100) { completed({name:'LayoutError',message:'Preview layout is not ready. Select Retry TV.'}); return; }
        tv.tvwindow.show(function () {
          completed();
          if (typeof tv.tvwindow.getRect === 'function' && wantedPreview()) {
            try { tv.tvwindow.getRect(function (actual) {
              report('TV preview bounds: ' + actual.join(', '));
            }, function (e) { report('Could not check TV preview bounds.',e); }, 'px', 'MAIN'); } catch (ignore) { /* Optional diagnostics. */ }
          }
        }, completed, rect, 'MAIN', 'FRONT');
      } else { tv.tvwindow.hide(function () { completed(); }, completed, 'MAIN'); }
    } catch (e) { completed(e); }
  }
  function updatePreviewToggle() { $('preview-toggle').textContent = prefs.preview ? 'Turn off' : 'Turn on'; }
  function retryPreview() {
    prefs.preview = true; previewBlocked = false; previewNeedsShow = true;
    save(); updatePreviewToggle();
    if (tv && tv.tvwindow) { readCurrentSource(); }
    syncPreview();
  }
  function launch(id, name, appControl) {
    if (launching) { return; }
    if (!tv || !tv.application || typeof tv.application.launch !== 'function') { report('Launching apps is unavailable on this device.'); return; }
    var generation = ++launchGeneration, attempt = 0, routes = [], index = 0;
    var canControl = typeof tv.ApplicationControl === 'function' && typeof tv.application.launchAppControl === 'function';
    function add(target) {
      if (routes.some(function (route) { return route.id === target; })) { return; }
      routes.push({id:target,control:appControl || null});
      if (!appControl && canControl) { routes.push({id:target,control:'default'}); }
    }
    add(id);
    if (!appControl) {
      var selected = apps.filter(function (app) { return app.id === id; })[0];
      if (selected && appGroupKey(selected).indexOf('brand:') === 0) {
        apps.filter(function (app) { return appGroupKey(app) === appGroupKey(selected) && app.id !== id; })
          .sort(function (a,b) { return (a.show === false ? 1 : 0) - (b.show === false ? 1 : 0); })
          .slice(0,2).forEach(function (app) { add(app.id); });
      }
    }
    function message(text, error) {
      $('launch-feedback').hidden = false;
      $('launch-feedback').textContent = text + (error && error.name ? ' (' + error.name + ')' : '');
      report(text,error);
    }
    function active(token) { return generation === launchGeneration && attempt === token && launching && !document.hidden; }
    function stop(error) {
      clearTimeout(launchTimer); ++launchGeneration; launching = false;
      previewBlocked = false; previewNeedsShow = true; syncPreview();
      message('Could not open ' + name + '. You can try another app or open it from Samsung Home.',error);
    }
    function next(error) {
      clearTimeout(launchTimer);
      if (generation !== launchGeneration || document.hidden) { return; }
      if (index >= routes.length) { stop(error || {name:'LaunchTimeout'}); return; }
      var route = routes[index++], token = ++attempt, answered = false;
      message(index === 1 ? 'Opening ' + name + '…' : 'Trying another way to open ' + name + '…');
      // A success callback acknowledges a request; it does not prove a foreground handoff.
      launchTimer = setTimeout(function () { if (active(token)) { next({name:'LaunchTimeout'}); } }, 8000);
      function failed(e) {
        if (!active(token) || answered) { return; }
        answered = true;
        if (e && /^(NotFoundError|UnknownError|NotSupportedError)$/.test(e.name)) { next(e); }
        else { stop(e); }
      }
      function accepted() {
        if (!active(token) || answered) { return; }
        answered = true;
        message('Waiting for ' + name + ' to appear…');
      }
      try {
        var control = route.control === 'default' ? new tv.ApplicationControl('http://tizen.org/appcontrol/operation/default',null,null,null,null,'SINGLE') : route.control;
        if (control) { tv.application.launchAppControl(control, route.id, accepted, failed); }
        else { tv.application.launch(route.id, accepted, failed); }
      } catch (e) { failed(e); }
    }
    launching = true;
    // Preview cleanup must not prevent the launch request when a TV callback stalls.
    syncPreview();
    next();
  }
  function sourceName(source) { return source.type + (source.type === 'TV' ? '' : ' ' + source.number); }
  function readCurrentSource() {
    try { $('source-label').textContent = sourceName(tv.tvwindow.getSource('MAIN')); }
    catch (e) { report('Current input could not be read.', e); }
  }
  function refreshSources() {
    $('sources').textContent = '';
    if (!tv || !tv.systeminfo || !tv.tvwindow) { $('sources').textContent = 'Input selection requires the TV.'; return; }
    readCurrentSource();
    try {
      tv.systeminfo.getPropertyValue('VIDEOSOURCE', function (info) {
        $('sources').textContent = '';
        (info.connected || []).forEach(function (source) {
          var button = document.createElement('button'); button.textContent = sourceName(source);
          button.onclick = function () {
            if (windowBusy) { report('Preview is updating; try again.'); return; }
            windowBusy = true;
            function failed(e) { windowBusy = false; report('Could not change input.',e); syncPreview(); }
            try {
              tv.tvwindow.setSource(source, function () {
                windowBusy = false; readCurrentSource(); previewBlocked = false; previewNeedsShow = true; syncPreview(); report('Input changed.');
              }, failed, 'MAIN');
            } catch (e) { failed(e); }
          };
          $('sources').appendChild(button);
        });
        if (!$('sources').children.length) { $('sources').textContent = 'No connected inputs were reported.'; }
      }, function (e) { report('Input list unavailable.',e); });
    } catch (e) { report('Input selection unavailable.',e); }
  }
  function openTVSettings() {
    var button = $('tv-settings-open'), message = $('tv-settings-status');
    var fallback = 'Direct opening is unavailable. Press Home on your Samsung remote, then select Settings.';
    if (!tv || !tv.application || !tv.ApplicationControl ||
        typeof tv.application.findAppControl !== 'function' || typeof tv.application.launchAppControl !== 'function') {
      message.textContent = fallback; return;
    }
    button.disabled = true; message.textContent = 'Checking TV settings access…';
    var finished = false, timer = setTimeout(function () { finish(null); }, 5000);
    function finish(apps, control, error) {
      if (finished) { return; }
      finished = true; clearTimeout(timer); button.disabled = false;
      if (!apps || !apps.length) {
        message.textContent = fallback;
        if (error) { report('TV settings access unavailable.', error); }
        return;
      }
      message.textContent = 'Requesting TV settings. If they do not open, press Home on your remote, then Settings.';
      launch(apps[0].id, 'TV settings', control);
    }
    try {
      // The standard operation is optional on TVs; never guess a system package ID.
      var control = new tv.ApplicationControl('http://tizen.org/appcontrol/operation/setting');
      tv.application.findAppControl(control, function (apps) { finish(apps, control); }, function (e) { finish(null, null, e); });
    } catch (e) { finish(null, null, e); }
  }
  function settings(open) {
    if (open) { returnFocus = document.activeElement; }
    $('settings').hidden = !open; $('library').hidden = open;
    if (open) { refreshSources(); focus($('settings-close')); }
    else { focus(returnFocus || $('settings-open')); }
  }
  function exitDialog(open) {
    if (open) { exitFocus = document.activeElement; }
    $('exit-dialog').hidden = !open;
    focus(open ? $('exit-cancel') : exitFocus);
  }
  function controls() {
    var root = !$('exit-dialog').hidden ? $('exit-dialog') : (!$('settings').hidden ? $('settings') : document);
    return Array.prototype.filter.call(root.querySelectorAll('button,input,summary'), function (el) { return !el.disabled && el.getClientRects().length > 0; });
  }
  function move(code) {
    if (!$('exit-dialog').hidden) {
      focus(document.activeElement === $('exit-confirm') ? $('exit-cancel') : $('exit-confirm'));
      return;
    }
    var list = controls(), current = document.activeElement;
    if (list.indexOf(current) < 0) { focus(list[0]); return; }
    var rect = current.getBoundingClientRect(), x = rect.left + rect.width/2, y = rect.top + rect.height/2;
    var horizontal = code === 37 || code === 39, sign = code === 37 || code === 38 ? -1 : 1;
    var best = null, score = Infinity;
    list.forEach(function (el) {
      if (el === current) { return; }
      var r = el.getBoundingClientRect(), dx = r.left+r.width/2-x, dy = r.top+r.height/2-y;
      var forward = (horizontal ? dx : dy)*sign, side = Math.abs(horizontal ? dy : dx);
      if (forward > 2 && forward+side*4 < score) { best = el; score = forward+side*4; }
    });
    if (best) { focus(best); best.scrollIntoView({block:'nearest',inline:'nearest'}); }
  }
  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    if (code === 10009 || code === 27) {
      e.preventDefault();
      if (!$('exit-dialog').hidden) { exitDialog(false); }
      else if (!$('settings').hidden) { settings(false); }
      else if (editingApps) { editingApps = false; renderApps(); focus($('edit-apps')); }
      else { exitDialog(true); }
    } else if (code >= 37 && code <= 40) {
      if (document.activeElement.tagName === 'INPUT' && (code === 37 || code === 39)) { return; }
      e.preventDefault(); move(code);
    } else if (code === 13 && document.activeElement.tagName === 'BUTTON') {
      e.preventDefault(); if (!e.repeat) { document.activeElement.click(); }
    } else if (code === 406 && $('exit-dialog').hidden) { e.preventDefault(); settings($('settings').hidden); }
    else if (code === 9) {
      var list = controls(), i = list.indexOf(document.activeElement);
      e.preventDefault(); focus(list[(i+(e.shiftKey ? -1 : 1)+list.length)%list.length]);
    }
  });
  $('refresh').onclick = refreshApps;
  $('edit-apps').onclick = function () { editingApps = !editingApps; renderApps(); focus($('edit-apps')); };
  $('settings-open').onclick = function () { settings(true); };
  $('settings-close').onclick = function () { settings(false); };
  $('name-save').onclick = function () { prefs.name = cleanName($('launcher-name').value); applyName(); save(); report('Display name saved.'); };
  $('name-reset').onclick = function () { prefs.name = 'My TV'; applyName(); save(); report('Display name reset.'); };
  $('tv-settings-open').onclick = openTVSettings;
  $('close-app').onclick = function () { exitDialog(true); };
  $('watch-tv').onclick = function () { launch('org.tizen.tv-viewer', 'TV'); };
  $('sources-refresh').onclick = refreshSources;
  $('preview-retry').onclick = retryPreview;
  $('preview-toggle').onclick = function () { prefs.preview = !prefs.preview; previewBlocked = false; save(); updatePreviewToggle(); syncPreview(); };
  $('system-toggle').onclick = function () { prefs.system = !prefs.system; save(); this.textContent = 'Show system entries: '+(prefs.system ? 'on' : 'off'); renderApps(); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (button) {
    button.onclick = function () { prefs.theme = button.getAttribute('data-theme'); prefs.background = ''; $('background-path').value = ''; background(''); save(); report('Background saved.'); };
  });
  $('background-apply').onclick = function () { background($('background-path').value.trim(), true); };
  $('exit-cancel').onclick = function () { exitDialog(false); };
  $('exit-confirm').onclick = function () {
    if (!tv || !tv.application) { exitDialog(false); report('This browser preview can be closed with its tab.'); return; }
    launching = true;
    // Closing must never wait for the TV video plane to acknowledge hide().
    // The installed v0.4.0 could get stuck waiting for that callback forever.
    try { if (tv.tvwindow) { tv.tvwindow.hide(function () {},function () {},'MAIN'); } } catch (ignore) { /* Best-effort cleanup. */ }
    try { tv.application.getCurrentApplication().exit(); }
    catch (e) { launching = false; exitDialog(false); report('Could not close the app.',e); syncPreview(); }
  };
  document.addEventListener('visibilitychange', function () {
    clearTimeout(launchTimer);
    ++launchGeneration;
    $('launch-feedback').hidden = true;
    if (!document.hidden) { launching = false; previewBlocked = false; previewNeedsShow = true; refreshApps(); if (tv && tv.tvwindow) { readCurrentSource(); } }
    syncPreview();
  });
  function clock() { $('clock').textContent = new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
  loadPrefs(); applyName(); background(prefs.background,false); $('background-path').value = prefs.background;
  $('system-toggle').textContent = 'Show system entries: '+(prefs.system ? 'on' : 'off');
  updatePreviewToggle(); clock(); setInterval(clock,30000);
  if (tv && tv.tvinputdevice) { try { tv.tvinputdevice.registerKey('ColorF3Blue'); } catch (e) { report('Blue-key shortcut unavailable; use Settings.',e); } }
  refreshApps(); if (tv && tv.tvwindow) { readCurrentSource(); }
  requestAnimationFrame(function () { requestAnimationFrame(function () { syncPreview(); }); });
  window.addEventListener('resize',function () { previewNeedsShow = true; syncPreview(); });
  focus($('refresh'));
}());
