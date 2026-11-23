// 링크 모음(hub) 정적 페이지 점검 — node --test hub/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);

test("서비스 링크는 모두 https이고 새 창으로 열린다", () => {
  const svc = [...html.matchAll(/<a class="r"[^>]*>/g)].map((m) => m[0]);
  assert.ok(svc.length >= 5, `서비스 링크 ${svc.length}개`);
  for (const a of svc) {
    assert.match(a, /href="https:\/\//);
    assert.match(a, /rel="noopener"/);
  }
});

test("공개 서비스가 모두 들어 있다", () => {
  for (const host of ["kson-ledger", "world-pulse", "wnm", "econ-flow", "research-notes"]) {
    assert.ok(links.some((u) => u.includes(`${host}.jinhj423-42b.workers.dev`)), host);
  }
});

test("뺀 서비스는 페이지에 없다", () => {
  for (const host of ["second-brain", "trade-journal", "money-flow", "reading-tracker"]) assert.ok(!html.includes(host), host);
});

test("광고·추적 스크립트가 없다", () => {
  assert.ok(!/adsbygoogle|googletagmanager|gtag\(/.test(html));
});

test("숫자 띠의 개수가 실제 링크 수와 같다", () => {
  const n = Number(html.match(/data-count="total">(\d+)</)?.[1]);
  const svc = html.match(/<a class="r"/g).length;
  assert.equal(n, svc);
});
