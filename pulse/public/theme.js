// 화면 모드(밝은/어두운). 고른 값(localStorage "wp-theme")이 없으면 기기 설정을 따른다.
// 첫 그림 전에 머리의 짧은 인라인 스크립트가 data-theme을 먼저 붙여 깜빡임을 막고, 이 파일은 단추와 기기 설정 변화를 맡는다.
(() => {
  "use strict";
  const root = document.documentElement;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => { try { return localStorage.getItem("wp-theme"); } catch (e) { return null; } };
  function set(t) {
    root.dataset.theme = t;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === "dark" ? "#0D1117" : "#F5F6F8";
    const b = document.getElementById("theme");
    if (b) {
      const label = t === "dark" ? "밝은 화면으로 바꾸기" : "어두운 화면으로 바꾸기";
      b.setAttribute("aria-label", label);
      b.title = label;
    }
  }
  set(saved() || (mq.matches ? "dark" : "light"));
  mq.addEventListener("change", (e) => { if (!saved()) set(e.matches ? "dark" : "light"); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#theme")) return;
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("wp-theme", t); } catch (err) { /* 저장이 막힌 브라우저는 이번 화면에서만 바뀐다 */ }
    set(t);
  });
})();
