import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// CI など CPU 負荷が高い環境で既定の 1000ms では描画待ちが足りないため延長する。
configure({ asyncUtilTimeout: 5000 });

// テスト間でブラウザ状態が漏れないよう、共通で後始末する。
afterEach(() => {
  cleanup();
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.title = "";
});
