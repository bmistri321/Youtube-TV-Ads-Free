/* Loading overlay — a centered buffer spinner while a video is stalled.
   Diagnostic UX only. Never touches playback, networking, or DRM. */
(function () {
  'use strict';
  try {
    if (JSON.__bishalYtvLoadingV1) return;
    var overlay = null;
    var stallTimer = null;
    var shownAt = 0;
    var armed = false;
    var styleInjected = false;

    function injectStyle() {
      if (styleInjected) return;
      try {
        var css = '@keyframes __bishalYtvSpin{to{transform:rotate(360deg)}}' +
          '.__bishalYtvSpinRing{width:64px;height:64px;border-radius:50%;' +
          'border:6px solid rgba(255,255,255,0.25);border-top-color:#fff;' +
          'box-sizing:border-box;animation:__bishalYtvSpin 1s linear infinite}';
        var style = document.createElement('style');
        style.textContent = css;
        var head = document.head || (document.getElementsByTagName('head')[0]);
        if (head) { head.appendChild(style); }
        else if (document.body) { document.body.appendChild(style); }
        styleInjected = true;
      } catch (ignored) {}
    }

    function clearOverlay() {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      shownAt = 0;
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }

    function showOverlay() {
      if (overlay) return;
      try {
        injectStyle();
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:50%;left:50%;width:64px;height:64px;' +
          'transform:translate(-50%,-50%);z-index:2147483647;pointer-events:none;';
        var ring = document.createElement('div');
        ring.className = '__bishalYtvSpinRing';
        overlay.appendChild(ring);
        document.body.appendChild(overlay);
        shownAt = Date.now();
      } catch (ignored) {}
    }

    function video() {
      var videos = document.getElementsByTagName('video');
      return videos.length === 1 ? videos[0] : null;
    }

    function stalled(v) {
      return !!v && (v.readyState < 2 || v.currentTime === 0);
    }

    function check() {
      try {
        if ((location.hash || '').indexOf('#/watch') !== 0) { clearOverlay(); return; }
        var v = video();
        if (!v) { clearOverlay(); return; }
        if (overlay && Date.now() - shownAt > 30000) { clearOverlay(); return; }
        if (stalled(v)) {
          if (!stallTimer) stallTimer = setTimeout(showOverlay, 600);
        } else {
          clearOverlay();
        }
      } catch (ignored) {}
    }

    function bind(v) {
      ['playing', 'loadstart', 'pause', 'error', 'ended'].forEach(function (ev) {
        v.addEventListener(ev, clearOverlay);
      });
      v.addEventListener('waiting', check);
      v.addEventListener('waitingforkey', check);
    }

    JSON.__bishalYtvLoadingV1 = function () {
      if (armed) return;
      armed = true;
      try {
        setInterval(function () {
          try {
            var v = video();
            if (v && !v.__bishalYtvBound) { v.__bishalYtvBound = true; bind(v); }
            check();
          } catch (ignored) {}
        }, 250);
      } catch (ignored) {}
    };
  } catch (ignored) {}
}());
