// public/vendor/map.js 만드는 법(지도에 쓰는 d3 부분만 묶음):
//   npm i esbuild d3-selection d3-geo d3-zoom d3-transition topojson-client
//   npx esbuild scripts/vendor/map-entry.js --bundle --minify --format=iife --legal-comments=none --outfile=public/vendor/map.js
// 세계 지도 데이터 public/vendor/countries-110m.json = world-atlas@2.0.2 countries-110m.json
import { select } from "d3-selection";
import "d3-transition";
import { geoEqualEarth, geoPath } from "d3-geo";
import { zoom, zoomIdentity } from "d3-zoom";
import { feature } from "topojson-client";
window.d3 = { select, geoEqualEarth, geoPath, zoom, zoomIdentity };
window.topojson = { feature };
