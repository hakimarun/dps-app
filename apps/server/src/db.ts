// Speicher mit der eingebauten SQLite von Node: Konten, Anmeldecodes, Sitzungen, Freigaben, Übungen.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Defs } from "@dps/engine";
import { addRecord, createExercise, type Exercise, type Header } from "./exercise.ts";

export type Db = DatabaseSync;
const hash = (s: string) => createHash("sha256").update(s).digest();
const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists users (id text primary key, email text unique not null, created integer not null);
    create table if not exists login_codes (email text primary key, code_hash blob not null, expires integer not null, attempts integer not null, created integer not null);
    create table if not exists sessions (token_hash blob primary key, user_id text not null, created integer not null);
    create table if not exists approvals (user_id text not null, item text not null, version integer not null, at integer not null, primary key (user_id, item));
    create table if not exists exercises (code text primary key, owner text not null, header text not null);
    create table if not exists controls (code text not null, at integer not null, type text not null);
    create table if not exists records (seq integer primary key autoincrement, code text not null, id text not null, t real not null, event text not null, name text, trupp text);
  `);
  // Datenbanken aus Meilenstein 3/4 haben noch keine Trupp-Spalte.
  const cols = db.prepare("pragma table_info(records)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "trupp")) db.exec("alter table records add column trupp text");
  return db;
}

// Anmeldung per E-Mail-Code: 6 Ziffern, 15 Minuten gültig, höchstens 5 Versuche, neuer Code frühestens nach 1 Minute.
export function requestLogin(db: Db, email: string, now: number): { code: string } | { error: string } {
  email = email.toLowerCase();
  const prev = db.prepare("select created from login_codes where email = ?").get(email) as { created: number } | undefined;
  if (prev && now - prev.created < 60_000) return { error: "Bitte eine Minute warten" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  db.prepare("insert or replace into login_codes values (?, ?, ?, 0, ?)").run(email, hash(`${email}:${code}`), now + CODE_MINUTES * 60_000, now);
  return { code };
}

export function verifyLogin(db: Db, email: string, code: string, now: number): { token: string; userId: string } | null {
  email = email.toLowerCase();
  const row = db.prepare("select code_hash, expires, attempts from login_codes where email = ?").get(email) as
    | { code_hash: Uint8Array; expires: number; attempts: number }
    | undefined;
  if (!row || row.expires < now || row.attempts >= MAX_ATTEMPTS) return null;
  if (!timingSafeEqual(hash(`${email}:${code}`), row.code_hash)) {
    db.prepare("update login_codes set attempts = attempts + 1 where email = ?").run(email);
    return null;
  }
  db.prepare("delete from login_codes where email = ?").run(email);
  db.prepare("insert or ignore into users values (?, ?, ?)").run(crypto.randomUUID(), email, now);
  const { id } = db.prepare("select id from users where email = ?").get(email) as { id: string };
  const token = randomBytes(32).toString("base64url");
  db.prepare("insert into sessions values (?, ?, ?)").run(hash(token), id, now);
  return { token, userId: id };
}

export function userByToken(db: Db, token: string): { id: string; email: string } | null {
  return (db.prepare("select u.id, u.email from sessions s join users u on u.id = s.user_id where s.token_hash = ?").get(hash(token)) as
    | { id: string; email: string }
    | undefined) ?? null;
}

// Freigaben: jeder Praxisanleiter gibt Fälle nur für sich frei, gebunden an die Version.
export function myApprovals(db: Db, userId: string): Map<string, number> {
  const rows = db.prepare("select item, version from approvals where user_id = ?").all(userId) as { item: string; version: number }[];
  return new Map(rows.map((r) => [r.item, r.version]));
}

export function approvalCounts(db: Db): Map<string, number> {
  const rows = db.prepare("select item, count(*) as n from approvals group by item").all() as { item: string; n: number }[];
  return new Map(rows.map((r) => [r.item, r.n]));
}

export function setApproval(db: Db, userId: string, item: string, version: number, approved: boolean, now: number) {
  if (approved) db.prepare("insert or replace into approvals values (?, ?, ?, ?)").run(userId, item, version, now);
  else db.prepare("delete from approvals where user_id = ? and item = ?").run(userId, item);
}

// Übungen: Kopf, Steuerbefehle und Aktionen werden sofort geschrieben, beim Start alles wieder geladen.
function persist(db: Db, ex: Exercise): Exercise {
  const ins = db.prepare("insert into records (code, id, t, event, name, trupp) values (?, ?, ?, ?, ?, ?)");
  ex.onRecord = (r) => ins.run(ex.code, r.id, r.t, JSON.stringify(r.event), r.name ?? null, r.trupp ?? null);
  const ctl = db.prepare("insert into controls values (?, ?, ?)");
  ex.onControl = (c) => ctl.run(ex.code, c.at, c.type);
  return ex;
}

export function saveExercise(db: Db, h: Header, defs: Defs): Exercise {
  db.prepare("insert into exercises values (?, ?, ?)").run(h.code, h.owner, JSON.stringify(h));
  return persist(db, createExercise(h, defs));
}

export function loadExercises(db: Db, defs: Defs): Exercise[] {
  const heads = db.prepare("select header from exercises").all() as { header: string }[];
  return heads.map(({ header }) => {
    const ex = createExercise(JSON.parse(header) as Header, defs);
    for (const c of db.prepare("select at, type from controls where code = ? order by rowid").all(ex.code) as Exercise["controls"]) ex.controls.push(c);
    const recs = db.prepare("select id, t, event, name, trupp from records where code = ? order by seq").all(ex.code) as
      { id: string; t: number; event: string; name: string | null; trupp: string | null }[];
    for (const r of recs) addRecord(ex, { id: r.id, t: r.t, event: JSON.parse(r.event), name: r.name ?? undefined, trupp: r.trupp ?? undefined });
    return persist(db, ex);
  });
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ohne leicht verwechselbare Zeichen
export function newCode(taken: (code: string) => boolean): string {
  for (;;) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (!taken(code)) return code;
  }
}
