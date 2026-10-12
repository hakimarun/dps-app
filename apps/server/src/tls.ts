// N3: Betrieb ohne Internet (Laptop + WLAN-Router vor Ort). Handys geben Kamera (QR-Scan) und Mikrofon nur über HTTPS frei;
// ohne Internet gibt es kein öffentliches Zertifikat, darum ein selbst signiertes für die eigenen WLAN-Adressen.
// Jedes Handy bestätigt die Warnung einmal. Wechselt das Netz (neue Adresse), wird das Zertifikat neu erzeugt.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

export const lanAddresses = () =>
  Object.values(networkInterfaces()).flat().flatMap((a) => (a && a.family === "IPv4" && !a.internal ? [a.address] : []));

export function selfSigned(dir: string, ips = lanAddresses()): { key: Buffer; cert: Buffer } {
  const [key, cert, list] = ["key.pem", "cert.pem", "ips.txt"].map((f) => join(dir, f));
  const wanted = ["127.0.0.1", ...ips].join(",");
  if (!existsSync(cert) || !existsSync(list) || readFileSync(list, "utf8") !== wanted) {
    mkdirSync(dir, { recursive: true });
    const san = ["DNS:localhost", ...wanted.split(",").map((ip) => `IP:${ip}`)].join(",");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "825", "-subj", "/CN=dPS vor Ort", "-addext", `subjectAltName=${san}`], { stdio: "ignore" });
    writeFileSync(list, wanted);
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
