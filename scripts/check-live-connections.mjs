import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(fs.readFileSync("src/twitch/twitchApi.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sockets = [];
class Socket {
  constructor(url) { this.url = url; sockets.push(this); }
  close() { this.closed = true; this.onclose?.(); }
}
const context = { exports: {}, require: () => ({ apiUrl: (url) => url, apiWebSocketUrl: () => "ws://test/live", backendSessionKey: "test-session" }), WebSocket: Socket, crypto, window: { setTimeout, clearTimeout }, console };
vm.runInNewContext(code, context);
const { observeLiveEvents, connectLiveEvents } = context.exports;
let identity = 0, first = 0, second = 0;
const stopObserving = observeLiveEvents(() => identity++);
assert.equal(sockets.length, 0, "identity observer must not connect");
const stopFirst = connectLiveEvents(() => first++);
const stopSecond = connectLiveEvents(() => second++);
assert.equal(sockets.length, 1, "two consumers share one transport");
sockets[0].onmessage({ data: JSON.stringify({ type: "twitch-session", payload: {} }) });
assert.deepEqual([identity, first, second], [1, 1, 1]);
stopFirst(); assert.equal(sockets[0].closed, undefined);
stopSecond(); assert.equal(sockets[0].closed, true);
stopObserving();
console.log("Live connection checks passed: passive identity observer, one shared transport and last-subscriber cleanup.");
