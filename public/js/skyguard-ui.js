/**
 * SkyGuard — UI ringan (toast). Dipanggil dari index.html.
 * Jangan mengubah ID elemen: toast, toastMessage, toastIcon.
 */
(function (global) {
  "use strict";

  function showToast(message, type) {
    if (type === undefined || type === null) type = "success";
    var toast = document.getElementById("toast");
    if (!toast) {
      console.warn("[SkyGuard UI] Elemen #toast tidak ada:", message);
      try {
        alert(message);
      } catch (e) {}
      return;
    }
    var msgEl = document.getElementById("toastMessage");
    var iconEl = document.getElementById("toastIcon");
    if (msgEl) msgEl.textContent = message;
    if (iconEl) {
      iconEl.className =
        type === "success"
          ? "fas fa-check-circle text-green-400 text-xl"
          : "fas fa-exclamation-circle text-red-400 text-xl";
    }
    toast.classList.remove("translate-y-20", "opacity-0");
    setTimeout(function () {
      toast.classList.add("translate-y-20", "opacity-0");
    }, 3000);
  }

  global.showToast = showToast;
})(typeof window !== "undefined" ? window : this);
