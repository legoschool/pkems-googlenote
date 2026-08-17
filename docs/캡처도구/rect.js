/* rect.js - paste into the page console (or run via javascript_tool)
 *
 * Turns element positions into SCREEN coordinates in physical pixels,
 * ready to hand to shotbox.ps1 -Boxes / -Hide / -X -Y -W -H.
 *
 *   __r('#btn')            -> "x,y,w,h"          (css selector, 6px padding)
 *   __r('#btn', 12)        -> wider padding
 *   __t('Use this template')  -> "x,y,w,h"       (find by visible text)
 *   __all('Create','Settings')-> "x,y,w,h;x,y,w,h"
 *   __crop(0,0,2000,1400)  -> "-X 0 -Y 0 -W .. -H .."  (region args)
 *   __clean()              -> hide the extension overlays before shooting
 */
(function () {
  var dpr  = function () { return window.devicePixelRatio || 1; };
  var offX = function () { return (window.screenX + (outerWidth - innerWidth) / 2) * dpr(); };
  var offY = function () { return (window.screenY + (outerHeight - innerHeight)) * dpr(); };

  window.__scr = function (r, pad) {
    pad = (pad == null) ? 6 : pad;
    return [
      Math.round((r.left - pad) * dpr() + offX()),
      Math.round((r.top  - pad) * dpr() + offY()),
      Math.round((r.width  + pad * 2) * dpr()),
      Math.round((r.height + pad * 2) * dpr())
    ].join(',');
  };

  window.__r = function (sel, pad) {
    var e = document.querySelector(sel);
    if (!e) { return 'NOT FOUND: ' + sel; }
    e.scrollIntoView({ block: 'center' });
    return __scr(e.getBoundingClientRect(), pad);
  };

  /* find by visible text - returns the INNERMOST element that contains it,
     so you box the button itself and not its whole toolbar */
  window.__t = function (txt, pad) {
    var hit = null;
    var all = document.querySelectorAll('button,a,summary,[role=button],[role=menuitem],label,span,div');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if ((e.innerText || '').trim().indexOf(txt) === -1) { continue; }
      var r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { continue; }
      if (!hit || (r.width * r.height) < hit.a) { hit = { e: e, a: r.width * r.height }; }
    }
    if (!hit) { return 'NOT FOUND: ' + txt; }
    hit.e.scrollIntoView({ block: 'center' });
    return __scr(hit.e.getBoundingClientRect(), pad);
  };

  window.__all = function () {
    return Array.prototype.slice.call(arguments).map(function (s) {
      return (s.charAt(0) === '#' || s.charAt(0) === '.' || s.indexOf('[') > -1) ? __r(s) : __t(s);
    }).join(';');
  };

  /* whole browser viewport as capture-region args */
  window.__crop = function (l, t, w, h) {
    if (l == null) {
      l = Math.round(offX()); t = Math.round(offY());
      w = Math.round(innerWidth * dpr()); h = Math.round(innerHeight * dpr());
    }
    return '-X ' + l + ' -Y ' + t + ' -W ' + w + ' -H ' + h;
  };

  /* the agent extension paints a cursor and a glowing border ON the page.
     they land in the screenshot unless hidden first. */
  window.__clean = function () {
    ['claude-phantom-cursor', 'claude-agent-glow-border'].forEach(function (id) {
      var e = document.getElementById(id); if (e) { e.style.display = 'none'; }
    });
    document.querySelectorAll('.iorad-extension-widget').forEach(function (e) {
      e.style.display = 'none';
    });
    return 'cleaned';
  };

  return 'rect.js ready: __r __t __all __crop __clean';
})();
