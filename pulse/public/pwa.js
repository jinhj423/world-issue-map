// 앱 설치: 서비스 워커 등록 + 머리의 "앱 설치" 단추(크롬·엣지·삼성 인터넷이 설치를 허락할 때만 보인다).
(() => {
  "use strict";
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* 막힌 브라우저는 설치 없이 그대로 쓴다 */ }));
  }
  let ask = null;
  const btn = () => document.getElementById("install");
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    ask = e;
    const b = btn();
    if (b) b.hidden = false;
  });
  addEventListener("appinstalled", () => {
    ask = null;
    const b = btn();
    if (b) b.hidden = true;
  });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#install") || !ask) return;
    const p = ask;
    ask = null;
    p.prompt();
    await p.userChoice;
    const b = btn();
    if (b) b.hidden = true;
  });
})();
