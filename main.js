(function () {
  'use strict';

  var root = document.documentElement;
  var dumpEl = document.getElementById('dump');
  var logEl = document.getElementById('log');
  var promptEl = document.getElementById('prompt');
  var input = document.getElementById('cmd');
  var typedEl = document.getElementById('typed');
  var themeLabel = document.getElementById('theme-label');
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     Theme
     ---------------------------------------------------------------------- */
  function paintThemeLabel() {
    themeLabel.textContent = root.dataset.theme === 'light' ? 'Dark mode' : 'Light mode';
  }
  function toggleTheme() {
    var t = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
    paintThemeLabel();
    if (phase === 'ready') showPortraitNow();   // portrait shading depends on theme
    return 'Switched to ' + t + ' mode.';
  }
  paintThemeLabel();

  /* ------------------------------------------------------------------------
     Hex dump
     ---------------------------------------------------------------------- */
  var MESSAGE = 'al3xm4rki :: marqui.site v0.1 :: ' +
                'hello, curious one. type `help` to look around.';

  var layout = null;   // { cols, rows, width }
  var hexGrid = null;
  var cell = { w: 7.2, h: 18 };   // measured character cell in px

  function computeLayout() {
    var cols = window.innerWidth < 700 ? 8 : 16;
    return {
      cols: cols,
      rows: cols === 16 ? 24 : 20,
      width: 8 + 2 + cols * 3 + (cols > 8 ? 1 : 0) + 1 + cols
    };
  }

  function measureCell() {
    if (dumpEl.hidden) return;
    var probe = document.createElement('span');
    probe.textContent = '0'.repeat(50);
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    dumpEl.append(probe);
    var w = probe.getBoundingClientRect().width / 50;
    probe.remove();
    var cs = getComputedStyle(dumpEl);
    var h = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    if (w > 0) cell = { w: w, h: h };
  }

  function rand(n) { return Math.floor(Math.random() * n); }
  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16).toUpperCase(); }
  function asciiOf(b) {
    if (b >= 32 && b < 127) return String.fromCharCode(b);
    if (b >= 161 && b <= 255 && b !== 173) return String.fromCharCode(b);
    return '.';
  }

  function makeBytes() {
    var cols = layout.cols;
    var total = cols * layout.rows;
    var bytes = new Array(total).fill(0);
    var i;
    bytes[0] = 1;
    // a row of noise, then the message, then noise fading into zeros
    var p = cols * 2;
    for (i = 0; i < cols; i++) bytes[p++] = rand(256);
    for (i = 0; i < MESSAGE.length && p < total; i++) bytes[p++] = MESSAGE.charCodeAt(i);
    for (i = 0; i < cols * 2 && p < total; i++) bytes[p++] = rand(256);
    while (p < total) {
      bytes[p] = Math.random() < 0.12 ? rand(256) : 0;
      p++;
    }
    return bytes;
  }

  function buildHexGrid(bytes) {
    var cols = layout.cols;
    var grid = [];
    for (var r = 0; r < layout.rows; r++) {
      var row = [];
      var put = function (str, k) {
        for (var j = 0; j < str.length; j++) row.push({ c: str[j], k: k });
      };
      put((r * cols).toString(16).toUpperCase().padStart(8, '0'), 'o');
      put('  ', ' ');
      for (var i = 0; i < cols; i++) {
        var b = bytes[r * cols + i];
        put(hex2(b), b === 0 ? 'z' : 'h');
        put(' ', ' ');
        if (i === 7 && cols > 8) put(' ', ' ');
      }
      put(' ', ' ');
      for (i = 0; i < cols; i++) put(asciiOf(bytes[r * cols + i]), 'a');
      grid.push(row);
    }
    return grid;
  }

  /* ------------------------------------------------------------------------
     Portraits: images converted to ASCII at runtime. One is picked at random
     every time the art appears. They use a "dense" grid - half-size font in
     the same box - for 2x the columns and 2.5x the rows of the hex dump.
     ---------------------------------------------------------------------- */
  var PORTRAITS = [
    { name: 'hellsing', src: 'assets/hellsing.jpg',
      crop: { l: 0.1, r: 0.07, t: 0, b: 0 },            // trim the white page margins
      levels: { black: 0.2, white: 0.85, gamma: 0.65 } },
    { name: 'vagabond', src: 'assets/vagabond.png',
      crop: { l: 0, r: 0, t: 0, b: 0 },
      // The wall is nearly as bright as the face: steeper curve + fade the edges.
      levels: { black: 0.4, white: 1, gamma: 1.8 },
      vignette: { cx: 0.5, cy: 0.58, r: 0.34, soft: 0.34 } }
  ];
  var RAMP = ' .:-=+*%@#';            // dark -> bright
  var BLANK = { c: ' ', k: ' ' };
  var portrait = null;                // the one showing (or about to)
  var images = {};                    // src -> Promise<HTMLImageElement>

  function pickPortrait() {
    return PORTRAITS[rand(PORTRAITS.length)];
  }

  function loadImage(src) {
    if (!images[src]) {
      images[src] = new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = src;
      });
      images[src].catch(function () { delete images[src]; });
    }
    return images[src];
  }

  function denseDims() {
    return { W: layout.width * 2, H: Math.round(layout.rows * 2.5) };
  }

  function blankGrid(W, H) {
    var grid = [];
    for (var r = 0; r < H; r++) {
      var row = [];
      for (var c = 0; c < W; c++) row.push(BLANK);
      grid.push(row);
    }
    return grid;
  }

  function portraitGrid(img, p) {
    var d = denseDims();
    var sx = img.width * p.crop.l, sy = img.height * p.crop.t;
    var sw = img.width * (1 - p.crop.l - p.crop.r);
    var sh = img.height * (1 - p.crop.t - p.crop.b);
    // Fit the image inside the box, respecting the (non-square) character cell.
    var scale = Math.min(d.W * cell.w / sw, d.H * cell.h / sh);
    var cols = Math.max(1, Math.min(d.W, Math.round(sw * scale / cell.w)));
    var rows = Math.max(1, Math.min(d.H, Math.round(sh * scale / cell.h)));

    var canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
    var px = ctx.getImageData(0, 0, cols, rows).data;

    // Bright pixels become dense glyphs; flip in light mode so the picture
    // stays a positive (skin light, hair dark) against the page.
    var invert = root.dataset.theme === 'light';
    var L = p.levels, V = p.vignette, n = RAMP.length;
    var grid = blankGrid(d.W, d.H);
    var left = Math.floor((d.W - cols) / 2), top = Math.floor((d.H - rows) / 2);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = (r * cols + c) * 4;
        var lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        lum = Math.min(1, Math.max(0, (lum - L.black) / (L.white - L.black)));
        lum = Math.pow(lum, L.gamma);
        if (V) {   // fade towards the edges (distance in image-relative units)
          var dist = Math.hypot(c / cols - V.cx, r / rows - V.cy);
          var f = Math.min(1, Math.max(0, (dist - V.r) / V.soft));
          lum *= 1 - f * f * (3 - 2 * f);
        }
        if (invert) lum = 1 - lum;
        var k = Math.min(n - 1, Math.floor(lum * n));
        if (k === 0) continue;
        grid[top + r][left + c] = { c: RAMP[k], k: k < 4 ? 'd1' : k < 7 ? 'd2' : 'd3' };
      }
    }
    return grid;
  }

  /* ------------------------------------------------------------------------
     Rendering
     ---------------------------------------------------------------------- */
  function esc(c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c;
  }

  function render(grid, visibleRows) {
    var n = visibleRows == null ? grid.length : visibleRows;
    var out = [];
    for (var r = 0; r < n; r++) {
      var row = grid[r], html = '', run = '', k = null;
      for (var c = 0; c < row.length; c++) {
        var cur = row[c];
        if (cur.k !== k) {
          if (run) html += k === ' ' ? run : '<span class="' + k + '">' + run + '</span>';
          run = '';
          k = cur.k;
        }
        run += esc(cur.c);
      }
      if (run) html += k === ' ' ? run : '<span class="' + k + '">' + run + '</span>';
      out.push(html);
    }
    dumpEl.innerHTML = out.join('\n');
  }

  /* ------------------------------------------------------------------------
     Animation
     ---------------------------------------------------------------------- */
  var runId = 0;          // bump to cancel whatever is running
  var phase = 'intro';    // 'intro' | 'ready' | 'cleared'
  var GLYPHS = '0123456789ABCDEF./\\|_[]<>=-+*#';

  function cancelled(id) { return id !== runId; }

  function wait(ms, id) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { cancelled(id) ? reject('cancel') : resolve(); }, ms);
    });
  }

  function typeRows(grid, id) {
    return new Promise(function (resolve, reject) {
      var r = 0;
      (function step() {
        if (cancelled(id)) return reject('cancel');
        render(grid, ++r);
        if (r >= grid.length) return resolve();
        setTimeout(step, 55);
      })();
    });
  }

  // Scramble cell-by-cell from one grid into another, sweeping left to right.
  // `to()` returns the target, so it can change mid-way (e.g. a theme switch).
  function morph(from, to, dur, id) {
    return new Promise(function (resolve, reject) {
      var rows = from.length, width = from[0].length;
      var win = dur * 0.15;
      var delays = from.map(function (row) {
        return row.map(function (_, c) { return (c / width) * dur * 0.5 + Math.random() * dur * 0.35; });
      });
      var t0 = null, last = 0;
      function frame(now) {
        if (cancelled(id)) return reject('cancel');
        if (t0 === null) t0 = now;
        var t = now - t0;
        if (t >= dur) { render(to()); return resolve(); }
        if (now - last >= 33) {
          last = now;
          var target = to();
          var cur = [];
          for (var r = 0; r < rows; r++) {
            var row = [];
            for (var c = 0; c < width; c++) {
              var d = delays[r][c], a = from[r][c], b = target[r][c];
              if (t < d) row.push(a);
              else if (t >= d + win) row.push(b);
              else if (a.c === ' ' && b.c === ' ') row.push(b);
              else row.push({ c: GLYPHS[rand(GLYPHS.length)], k: 'g' });
            }
            cur.push(row);
          }
          render(cur);
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function setDense(on) {
    dumpEl.classList.toggle('is-dense', on);
    measureCell();
  }

  // Draw the current portrait straight away (skip, resize, theme change).
  function showPortraitNow() {
    var id = ++runId;
    var p = portrait;
    phase = 'ready';
    dumpEl.hidden = false;
    setDense(true);
    loadImage(p.src).then(function (img) {
      if (!cancelled(id)) render(portraitGrid(img, p));
    }, function () {});
  }

  // Hex dump types out, scrambles away, and a random portrait scrambles in.
  async function intro() {
    var id = ++runId;
    phase = 'intro';
    portrait = pickPortrait();
    var p = portrait;
    var imgReady = loadImage(p.src);    // loads while the dump types
    layout = computeLayout();
    dumpEl.hidden = false;
    setDense(false);
    hexGrid = buildHexGrid(makeBytes());

    if (reduceMotion) { showPortraitNow(); return; }

    try {
      dumpEl.textContent = '';
      await typeRows(hexGrid, id);
      await wait(1100, id);
      var empty = blankGrid(layout.width, layout.rows);
      await morph(hexGrid, function () { return empty; }, 700, id);

      var img = await imgReady;
      if (cancelled(id)) return;
      setDense(true);
      var targets = {};   // per theme, so a mid-animation theme switch stays right
      var target = function () {
        var t = root.dataset.theme;
        return targets[t] || (targets[t] = portraitGrid(img, p));
      };
      var d = denseDims();
      await morph(blankGrid(d.W, d.H), target, 1400, id);
      phase = 'ready';
    } catch (e) {
      if (e === 'cancel') return;
      phase = 'ready';   // image failed to load: leave the screen as it is
    }
  }

  // Visitor interacted: skip the rest of the intro straight to the portrait.
  function settle() {
    if (phase === 'intro') showPortraitNow();
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout = computeLayout();
      if (phase !== 'cleared') showPortraitNow();
    }, 150);
  });

  // Webfont widths differ from the fallback font: re-measure once it loads.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureCell);
  }

  /* ------------------------------------------------------------------------
     Commands
     ---------------------------------------------------------------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function link(href, text) {
    var a = el('a', null, text);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  function contactOut() {
    var frag = document.createDocumentFragment();
    frag.append(
      'github      ', link('https://github.com/Al3xM4rki', 'github.com/Al3xM4rki'), '\n',
      'hackerone   ', link('https://hackerone.com/al3xm4rki?type=user', 'hackerone.com/al3xm4rki')
    );
    return frag;
  }

  var COMMANDS = {
    help: {
      desc: 'list available commands',
      run: function () {
        var grid = el('div', 'cmd-table');
        Object.keys(COMMANDS).forEach(function (name) {
          if (COMMANDS[name].hidden) return;
          var b = el('button', null, name);
          b.type = 'button';
          b.dataset.cmd = name;
          grid.append(b, el('span', 'dim', COMMANDS[name].desc));
        });
        return grid;
      }
    },
    whoami: {
      desc: 'who is behind this',
      run: function () {
        return 'al3xm4rki.\n' +
               'This is v0.1 of my portfolio; more is on the way.';
      }
    },
    ls: {
      desc: 'list what is here',
      run: function () { return 'projects/   writeups/   design/   contact.txt'; }
    },
    projects: {
      desc: 'software & tools',
      run: function () { return 'Nothing published yet. Projects land here soon.'; }
    },
    writeups: {
      desc: 'security & CTF writeups',
      run: function () { return 'No writeups yet. Security and CTF writeups are coming.'; }
    },
    design: {
      desc: 'design & creative work',
      run: function () { return 'Design work is on its way.'; }
    },
    contact: {
      desc: 'ways to reach me',
      run: contactOut
    },
    theme: {
      desc: 'toggle light / dark (⌃+M)',
      run: toggleTheme
    },
    replay: {
      desc: 'replay the intro',
      run: function () { logEl.textContent = ''; intro(); return null; }
    },
    clear: {
      desc: 'clear the screen (⌃+L)',
      run: function () {
        runId++;
        phase = 'cleared';
        dumpEl.hidden = true;
        logEl.textContent = '';
        return null;
      }
    },
    cat: {
      hidden: true,
      run: function (args) {
        if (!args[0]) return 'usage: cat <file>';
        if (args[0] === 'contact.txt') return contactOut();
        return 'cat: ' + args[0] + ': No such file or directory';
      }
    },
    cd: {
      hidden: true,
      run: function (args) {
        return args[0] ? 'cd: ' + args[0] + ': not open yet. Try `ls`.' : null;
      }
    },
    echo: { hidden: true, run: function (args) { return args.join(' '); } },
    date: { hidden: true, run: function () { return new Date().toString(); } },
    sudo: { hidden: true, run: function () { return 'Nice try. This incident will be reported.'; } },
    exit: { hidden: true, run: function () { return 'There is no escape. Try `clear`.'; } }
  };

  var history = [];
  var histPos = 0;

  function run(line) {
    var text = line.trim();
    settle();
    if (text) { history.push(text); }
    histPos = history.length;

    var parts = text.split(/\s+/);
    var name = parts[0].toLowerCase();
    var cmd = COMMANDS[name];

    if (name === 'clear') { cmd.run(); scrollToPrompt(); return; }

    var entry = el('div', 'entry');
    var echo = el('div', 'echo');
    echo.append(el('span', 'ps1', '~ $'), text);
    entry.append(echo);

    var result = !text ? null
      : cmd ? cmd.run(parts.slice(1))
      : 'command not found: ' + name + '. Type `help`.';

    if (result != null) {
      var out = el('div', 'out');
      out.append(result);
      entry.append(out);
    }
    if (name !== 'replay') logEl.append(entry);
    scrollToPrompt();
  }


  function scrollToPrompt() {
    promptEl.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function complete(value) {
    var matches = Object.keys(COMMANDS).filter(function (n) {
      return !COMMANDS[n].hidden && n.indexOf(value) === 0;
    });
    return matches.length === 1 ? matches[0] : value;
  }

  /* ------------------------------------------------------------------------
     Prompt input
     ---------------------------------------------------------------------- */
  function paintPrompt() {
    var v = input.value;
    var p = input.selectionStart == null ? v.length : input.selectionStart;
    var cursor = el('span', 'cursor', v.charAt(p) || ' ');
    typedEl.textContent = '';
    typedEl.append(v.slice(0, p), cursor, v.slice(p + 1));
  }

  input.addEventListener('input', function () { settle(); paintPrompt(); });
  input.addEventListener('focus', function () { promptEl.classList.add('is-focused'); paintPrompt(); });
  input.addEventListener('blur', function () { promptEl.classList.remove('is-focused'); });
  document.addEventListener('selectionchange', function () {
    if (document.activeElement === input) paintPrompt();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      run(v);
      paintPrompt();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histPos > 0) input.value = history[--histPos];
      setTimeout(paintPrompt);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histPos < history.length - 1) input.value = history[++histPos];
      else { histPos = history.length; input.value = ''; }
      setTimeout(paintPrompt);
    } else if (e.key === 'Tab' && input.value) {
      e.preventDefault();
      input.value = complete(input.value.toLowerCase());
      paintPrompt();
    } else {
      setTimeout(paintPrompt);
    }
  });

  // Global shortcuts
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      var k = e.key.toLowerCase();
      if (k === 'l') { e.preventDefault(); run('clear'); return; }
      if (k === 'm') { e.preventDefault(); toggleTheme(); return; }
    }
    if (e.target === input || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); run('help'); input.focus({ preventScroll: true }); return; }
    // Typing anywhere goes to the prompt.
    if (e.key.length === 1 && !/^(BUTTON|A)$/.test(e.target.tagName)) {
      input.focus({ preventScroll: true });
    }
  });

  // Clickable commands (top bar, hints, help table)
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (b) {
      run(b.dataset.cmd);
      if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
      return;
    }
    // Clicking empty space in the shell focuses the prompt (unless selecting text).
    if (e.target.closest('.shell') && !e.target.closest('a, button') &&
        !String(window.getSelection())) {
      input.focus({ preventScroll: true });
    }
  });

  /* ------------------------------------------------------------------------
     Dock magnification (after Aceternity's Floating Dock): each item grows
     with cursor proximity and eases there on a small spring.
     ---------------------------------------------------------------------- */
  (function () {
    var dock = document.getElementById('dock');
    if (reduceMotion || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var BASE = 36, MAX = 54, RANGE = 140;   // px
    var items = [].slice.call(dock.querySelectorAll('.dock__item'));
    var state = items.map(function () { return { s: BASE, v: 0 }; });
    var mouseX = null, raf = 0, lastT = 0;

    function tick(now) {
      // Step the spring in 60fps units so it feels the same on any refresh rate.
      var steps = lastT ? Math.min(4, Math.max(1, Math.round((now - lastT) / 16.67))) : 1;
      lastT = now;
      var moving = false;
      items.forEach(function (item, i) {
        var target = BASE;
        if (mouseX != null) {
          var r = item.getBoundingClientRect();
          var d = Math.abs(mouseX - (r.left + r.width / 2));
          target = BASE + (MAX - BASE) * Math.max(0, 1 - d / RANGE);
        }
        var st = state[i];
        for (var n = 0; n < steps; n++) {
          st.v = (st.v + (target - st.s) * 0.25) * 0.6;
          st.s += st.v;
        }
        if (Math.abs(target - st.s) < 0.1 && Math.abs(st.v) < 0.1) { st.s = target; st.v = 0; }
        else moving = true;
        item.style.setProperty('--s', st.s.toFixed(2) + 'px');
      });
      raf = moving ? requestAnimationFrame(tick) : 0;
      if (!raf) lastT = 0;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    dock.addEventListener('mousemove', function (e) { mouseX = e.clientX; kick(); });
    dock.addEventListener('mouseleave', function () { mouseX = null; kick(); });
  })();

  /* ------------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */
  paintPrompt();
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  intro();
})();
