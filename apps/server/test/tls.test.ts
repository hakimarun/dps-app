// N3: selbst signiertes Zertifikat für den Betrieb vor Ort ohne Internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { createServer, get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selfSigned } from "../src/tls.ts";

test("Zertifikat für die WLAN-Adressen: wird erzeugt, bei gleichem Netz wiederverwendet, bei neuem Netz erneuert", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dps-tls-"));
  const first = selfSigned(dir, ["192.168.1.50"]);
  const text = execFileSync("openssl", ["x509", "-in", join(dir, "cert.pem"), "-noout", "-text"]).toString();
  assert.match(text, /IP Address:192\.168\.1\.50/);
  assert.match(text, /IP Address:127\.0\.0\.1/);
  const mtime = statSync(join(dir, "cert.pem")).mtimeMs;
  selfSigned(dir, ["192.168.1.50"]);
  assert.equal(statSync(join(dir, "cert.pem")).mtimeMs, mtime); // gleiches Netz: nicht neu erzeugt
  selfSigned(dir, ["10.0.0.7"]);
  assert.match(execFileSync("openssl", ["x509", "-in", join(dir, "cert.pem"), "-noout", "-text"]).toString(), /IP Address:10\.0\.0\.7/);
  // ein HTTPS-Server startet damit
  const server = createServer(first, (_q, r) => r.end("ok")).listen(0);
  const port = (server.address() as { port: number }).port;
  const body = await new Promise<string>((ok, fail) => get({ host: "127.0.0.1", port, rejectUnauthorized: false }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok(b)); }).on("error", fail));
  server.close();
  assert.equal(body, "ok");
});
