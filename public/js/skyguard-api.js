/**
 * SkyGuard — helper API (JSON). fetch global tetap di-patch oleh auth di index.html.
 */
(function (global) {
  "use strict";

  var SgApi = global.SgApi || {};

  SgApi.parseJsonOrThrow = async function (res) {
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || ct.indexOf("application/json") === -1) {
      throw new Error(
        "API tidak terjangkau. Pastikan layanan SkyGuard API berjalan (pm2 restart).",
      );
    }
    return res.json();
  };

  global.SgApi = SgApi;
})(typeof window !== "undefined" ? window : this);
