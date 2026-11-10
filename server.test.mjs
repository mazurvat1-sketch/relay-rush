import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createGameServer, TURN_MS } from "./server.mjs";
import { choose } from "./sample-agent.mjs";

test("lobby, humans and bots, authenticated turns, scoring and expiry", async () => {
  const server = createGameServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const call = async (path, body) => {
    const res = await fetch(origin + path, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
    return { status: res.status, data: await res.json() };
  };
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /RELAY<span> RUSH/);
    const created = await call("/api/matches", { name: "Host", seats: 4 });
    assert.equal(created.status, 201);
    const host = created.data;
    const path = "/api/matches/" + host.match.code;
    const guest = (await call(path + "/join", { name: "Agent" })).data;
    assert.equal(guest.seat, 1);
    assert.equal((await call(path + "/start", { key: guest.key })).status, 409);
    const start = await call(path + "/start", { key: host.key });
    assert.equal(start.status, 200);
    assert.equal(start.data.players.filter(p => p.bot).length, 2);
    assert.equal(start.data.players.some(p => "key" in p), false);
    assert.equal((await call(path + "/move", { key: "invalid", revision: 0, kind: "charge" })).status, 403);
    assert.equal((await call(path + "/move", { key: host.key, revision: 0, kind: "move", tile: 24 })).status, 400);
    let match = start.data;
    while (match.phase === "playing") {
      const actor = match.turn === 0 ? host : guest;
      const result = await call(path + "/move", { key: actor.key, revision: match.revision, ...choose(match, actor.seat) });
      assert.equal(result.status, 200);
      assert.equal((await call(path + "/move", { key: actor.key, revision: match.revision, kind: "charge" })).status, 409);
      match = result.data;
    }
    assert.equal(match.revision, 20);
    assert.ok(match.winners.length > 0);
    assert.ok(match.players.some(p => p.score > 0));
    assert.equal(match.log.filter(e => e.text.startsWith("Signal scored")).length, 5);

    const timeoutHost = (await call("/api/matches", { seats: 2 })).data;
    const timeoutPath = "/api/matches/" + timeoutHost.match.code;
    const timed = (await call(timeoutPath + "/start", { key: timeoutHost.key })).data;
    const original = Date.now;
    try {
      Date.now = () => timed.deadline + 5 * TURN_MS;
      const after = (await call(timeoutPath)).data;
      assert.equal(after.phase, "finished");
      assert.equal(after.revision, 10);
    } finally {
      Date.now = original;
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
