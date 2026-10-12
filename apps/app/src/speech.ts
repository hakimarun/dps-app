// Sprechen statt Tippen (G6) mit den Sprachfunktionen des Browsers: Spracherkennung für die Frage, Sprachausgabe für die Antwort.
// Die Pilot-Helfer nutzen die Web-App; in der nativen App fehlen beide Funktionen, dann bleibt Tippen.
// ponytail: nur Web Speech API; für die native App expo-speech und ein Spracherkennungsmodul ergänzen.
import { Platform } from "react-native";
import type { Voice } from "./voice";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const w = (Platform.OS === "web" && typeof window !== "undefined" ? window : null) as (Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }) | null;
const Recognizer = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;

export const canListen = !!Recognizer;
export const canSpeak = !!w && "speechSynthesis" in w;

// Hört zu, meldet den Zwischenstand und am Ende den fertigen Satz. Gibt eine Funktion zum Abbrechen zurück.
export function listen(onText: (text: string, final: boolean) => void, onEnd: () => void): () => void {
  const r = new Recognizer!();
  r.lang = "de-DE";
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    onText(Array.from(e.results).map((x) => x[0].transcript).join(""), last.isFinal);
  };
  r.onend = onEnd;
  r.onerror = onEnd;
  r.start();
  return () => r.stop();
}

// Deutsche Stimme passend zur Persona; Namen der Systemstimmen als grober Hinweis auf weiblich/männlich.
const FEMALE = /anna|petra|helena|marlene|vicki|katja|hedda|sabine|frau|female|google deutsch$/i;
export function speak(text: string, v: Voice) {
  if (!canSpeak) return;
  const synth = w!.speechSynthesis;
  const de = synth.getVoices().filter((x) => x.lang.toLowerCase().startsWith("de"));
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  u.voice = (v.female === null ? de[0] : de.find((x) => FEMALE.test(x.name) === v.female)) ?? de[0] ?? null;
  u.pitch = v.pitch;
  u.rate = v.rate;
  synth.cancel(); // nur die neueste Antwort
  synth.speak(u);
}
export const stopSpeaking = () => void (canSpeak && w!.speechSynthesis.cancel());
