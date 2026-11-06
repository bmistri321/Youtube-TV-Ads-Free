/* Bishal's YouTube TV ad filter — our own implementation.
   Wraps JSON.parse and strips ad inventory out of YouTube's own JSON
   responses before the Cobalt frontend reads them.
   Fail-open: any error returns the original parsed result. */
(function () {
  'use strict';
  try {
    var originalParse = JSON.parse;
    if (originalParse.__bishalYtvFilterV1) return;
    var hasOwn = Object.prototype.hasOwnProperty;
    var playerNoticed = false;

    function dropAdSlots(items) {
      if (!Array.isArray(items)) return items;
      return items.filter(function (item) {
        return !item || typeof item !== 'object' || !hasOwn.call(item, 'adSlotRenderer');
      });
    }

    function stripPlayerAds(response) {
      if (!response || typeof response !== 'object') return;
      if (hasOwn.call(response, 'adPlacements')) response.adPlacements = [];
      if (hasOwn.call(response, 'adSlots')) response.adSlots = [];
      if (hasOwn.call(response, 'playerAds')) response.playerAds = false;
      /* Some endpoints nest the player response one level down. */
      if (response.playerResponse && typeof response.playerResponse === 'object') {
        stripPlayerAds(response.playerResponse);
      }
    }

    function stripBrowseAds(response) {
      var browse = response.contents && response.contents.tvBrowseRenderer;
      var surface = browse && browse.content && browse.content.tvSurfaceContentRenderer;
      var list = surface && surface.content && surface.content.sectionListRenderer;
      if (!list || !Array.isArray(list.contents)) return;
      list.contents = dropAdSlots(list.contents);
      list.contents.forEach(function (entry) {
        var shelf = entry && entry.shelfRenderer;
        var horizontal = shelf && shelf.content && shelf.content.horizontalListRenderer;
        if (horizontal && Array.isArray(horizontal.items)) {
          horizontal.items = dropAdSlots(horizontal.items);
        }
      });
    }

    function parse() {
      var result = originalParse.apply(this, arguments);
      try {
        if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
        if (result.responseContext) {
          if (typeof JSON.__bishalYtvAboutV1 === 'function') JSON.__bishalYtvAboutV1();
          if (typeof JSON.__bishalYtvProfileV1 === 'function') JSON.__bishalYtvProfileV1();
          if (result.streamingData && result.videoDetails && result.playabilityStatus &&
              result.playabilityStatus.status === 'OK' &&
              typeof JSON.__bishalYtvLoadingV1 === 'function') {
            JSON.__bishalYtvLoadingV1();
          }
        }
        var hadAds = hasOwn.call(result, 'adPlacements') ||
          hasOwn.call(result, 'adSlots') || hasOwn.call(result, 'playerAds');
        stripPlayerAds(result);
        stripBrowseAds(result);
        if (hadAds && !playerNoticed) {
          playerNoticed = true;
          try {
            if (typeof console !== 'undefined' && console.log) {
              console.log('BISHAL_YTV_FILTER player ads stripped');
            }
          } catch (ignored) {}
        }
      } catch (ignored) { /* Return the original result. */ }
      return result;
    }

    Object.defineProperty(parse, '__bishalYtvFilterV1', { value: true });
    JSON.parse = parse;
    try {
      if (typeof console !== 'undefined' && console.log) {
        console.log('BISHAL_YTV_FILTER installed');
      }
    } catch (ignored) {}
  } catch (ignored) { /* Leave JSON.parse untouched. */ }
}());
