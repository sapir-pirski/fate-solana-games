import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";

const telemetry=readFileSync(new URL("../lib/telemetry.ts",import.meta.url),"utf8");
const alerts=readFileSync(new URL("../deploy/local/prometheus/alerts.yml",import.meta.url),"utf8");
const compose=readFileSync(new URL("../compose.local.yaml",import.meta.url),"utf8");
const localDashboard=JSON.parse(readFileSync(new URL("../deploy/local/grafana/dashboards/fate-local.json",import.meta.url),"utf8"));

test("telemetry scrubs sensitive and unbounded attributes",()=>{assert.match(telemetry,/wallet\|signature\|token\|secret\|private/);assert.match(telemetry,/operation\.\?id\|ip/);assert.match(telemetry,/AbortSignal\.timeout\(1500\)/);assert.doesNotMatch(telemetry,/console\.log\([^\n]*attributes\)/);});
test("OTLP tracing is optional and W3C-compatible",()=>{assert.match(telemetry,/traceparent/);assert.match(telemetry,/OTEL_EXPORTER_OTLP_ENDPOINT/);assert.match(telemetry,/\/v1\/traces/);assert.match(compose,/tempo:/);});
test("every operational alert has severity, impact, and a runbook",()=>{const definitions=alerts.split(/\n\s+- alert: /).slice(1);assert.ok(definitions.length>=10);for(const definition of definitions){assert.match(definition,/severity:/);assert.match(definition,/impact:/);assert.match(definition,/runbook_url:/);}});
test("Grafana dashboards are valid JSON with bounded metric queries",()=>{const directory=new URL("../deploy/local/grafana/dashboards/",import.meta.url);for(const file of readdirSync(directory).filter(name=>name.endsWith(".json"))){const dashboard=JSON.parse(readFileSync(new URL(file,directory),"utf8"));assert.ok(dashboard.uid);assert.ok(Array.isArray(dashboard.panels));for(const panel of dashboard.panels)for(const target of panel.targets??[])assert.doesNotMatch(target.expr??"",/wallet|signature|operation_id/i);}});
test("local dashboard is incident-oriented and filterable",()=>{const panels=new Map(localDashboard.panels.map(panel=>[panel.title,panel]));assert.equal(panels.get("Service status history")?.type,"status-history");assert.equal(panels.get("Filtered FATE application logs")?.type,"logs");assert.match(panels.get("P95 request latency")?.targets[0].expr,/histogram_quantile\(0\.95/);for(const variable of ["service","level","component","game","search","trace"])assert.ok(localDashboard.templating.list.some(item=>item.name===variable));});
test("latency observations expose cumulative histogram buckets",()=>{assert.match(telemetry,/durationBuckets/);assert.match(telemetry,/_bucket/);assert.match(telemetry,/"\+Inf"/);});
