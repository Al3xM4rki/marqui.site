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
     Donut (a torus projected into the character grid, after donut.c)
     ---------------------------------------------------------------------- */
  var RAMP = '.:-=+*%@#';            // dark -> bright, from the reference art
  var BLANK = { c: ' ', k: ' ' };
  var CELLS = RAMP.split('').map(function (ch, i) {
    return { c: ch, k: i < 3 ? 'd1' : i < 6 ? 'd2' : 'd3' };
  });
  var TAU = Math.PI * 2;
  var trigTheta = [], trigPhi = [];
  for (var th = 0; th < TAU; th += 0.05) trigTheta.push([Math.cos(th), Math.sin(th)]);
  for (var ph = 0; ph < TAU; ph += 0.014) trigPhi.push([Math.cos(ph), Math.sin(ph)]);

  var A0 = 1.05, B0 = 0.35;               // starting pose: tilted so the hole shows
  var SPIN_A = 0.00085, SPIN_B = 0.0004;  // radians per ms
  var spinStart = 0;

  function donutGrid(A, B) {
    var W = layout.width, H = layout.rows;
    var R1 = 0.95, R2 = 2.2, K2 = 5;   // tube radius, ring radius, camera distance
    var D = Math.min(W * cell.w, H * cell.h);
    // Largest |x/z| or |y/z| over every rotation is ~0.81 for these radii,
    // so this keeps the whole donut inside the box at any angle.
    var K1 = D * 0.49 / 0.82;
    var cx = W * cell.w / 2, cy = H * cell.h / 2;
    var cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
    var zbuf = new Float32Array(W * H);   // 0 = empty
    var lum = new Float32Array(W * H);

    for (var i = 0; i < trigTheta.length; i++) {
      var ct = trigTheta[i][0], st = trigTheta[i][1];
      var circx = R2 + R1 * ct, circy = R1 * st;
      for (var j = 0; j < trigPhi.length; j++) {
        var cp = trigPhi[j][0], sp = trigPhi[j][1];
        var x = circx * (cB * cp + sA * sB * sp) - circy * cA * sB;
        var y = circx * (sB * cp - sA * cB * sp) + circy * cA * cB;
        var ooz = 1 / (K2 + cA * circx * sp + circy * sA);
        var col = Math.floor((cx + K1 * ooz * x) / cell.w);
        var row = Math.floor((cy - K1 * ooz * y) / cell.h);
        if (col < 0 || col >= W || row < 0 || row >= H) continue;
        var idx = row * W + col;
        if (ooz > zbuf[idx]) {
          zbuf[idx] = ooz;
          lum[idx] = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
        }
      }
    }

    var grid = [];
    for (var r = 0; r < H; r++) {
      var out = [];
      for (var c = 0; c < W; c++) {
        var k = r * W + c;
        if (!zbuf[k]) { out.push(BLANK); continue; }
        var t = (lum[k] + Math.SQRT2) / (2 * Math.SQRT2);   // 0..1
        out.push(CELLS[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]);
      }
      grid.push(out);
    }
    return grid;
  }

  function donutAt(now) {
    var t = now - spinStart;
    return donutGrid(A0 + t * SPIN_A, B0 + t * SPIN_B);
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
  var phase = 'intro';    // 'intro' | 'spin' | 'cleared'
  var onScreen = true;
  var GLYPHS = '0123456789ABCDEF./\\|_[]<>=-+*#';

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
    }).observe(dumpEl);
  }

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

  // Scramble cell-by-cell from a grid into a target, sweeping left to right.
  // `to(now)` returns the target grid, so the target can already be moving.
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
        if (t >= dur) { render(to(now)); return resolve(); }
        if (now - last >= 33) {
          last = now;
          var target = to(now);
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

  // Keep the donut turning at ~30fps while it is on screen.
  function spin(id) {
    var last = 0;
    function frame(now) {
      if (cancelled(id)) return;
      if (onScreen && now - last >= 33) { last = now; render(donutAt(now)); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function startSpin() {
    var id = ++runId;
    phase = 'spin';
    dumpEl.hidden = false;
    measureCell();
    if (reduceMotion) { render(donutGrid(A0, B0)); return; }
    if (!spinStart) spinStart = performance.now();
    spin(id);
  }

  async function intro() {
    var id = ++runId;
    phase = 'intro';
    spinStart = 0;
    layout = computeLayout();
    dumpEl.hidden = false;
    measureCell();
    hexGrid = buildHexGrid(makeBytes());

    if (reduceMotion) { startSpin(); return; }

    try {
      dumpEl.textContent = '';
      await typeRows(hexGrid, id);
      await wait(1100, id);
      spinStart = performance.now();
      await morph(hexGrid, donutAt, 1700, id);
      startSpin();
    } catch (e) {
      if (e !== 'cancel') throw e;
    }
  }

  // Visitor interacted: skip the rest of the intro straight to the donut.
  function settle() {
    if (phase === 'intro') startSpin();
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout = computeLayout();
      if (phase !== 'cleared') startSpin();
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
    frag.append('github   ', link('https://github.com/Al3xM4rki', 'github.com/Al3xM4rki'));
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
     Start
     ---------------------------------------------------------------------- */
  paintPrompt();
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  intro();
})();
