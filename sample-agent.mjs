import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function choose(match, seat) {
  const player = match.players[seat];
  const options = match.legal;
  const claim = options.filter(o => o.kind === "claim").sort((a,b) => (b.tile === 12) - (a.tile === 12))[0];
  if (claim) return claim;
  const targets = Object.keys(match.relays).map(Number).filter(t => match.relays[t] !== seat);
  const distance = (a,b) => Math.abs(a%5-b%5) + Math.abs(Math.floor(a/5)-Math.floor(b/5));
  const nearest = tile => Math.min(...targets.map(target => distance(tile,target)));
  const move = options.filter(o => o.kind === "move")
    .sort((a,b) => nearest(a.tile) - nearest(b.tile) || a.cost - b.cost)[0];
  return move && player.energy > 1 && nearest(move.tile) < nearest(player.position) ? move : { kind: "charge" };
}

async function run(origin, code, name) {
  const root = new URL("/api/matches/" + code, origin).href;
  async function request(path = "", data) {
    const response = await fetch(root + path, data ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    } : undefined);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  const { key, seat } = await request("/join", { name });
  console.log("Agent seated. Ask the host to launch the match.");
  for (;;) {
    const match = await request();
    if (match.phase === "finished") return console.log("Final scores:", match.players.map(p => p.name + " " + p.score).join(", "));
    if (match.phase === "playing" && match.turn === seat) {
      const move = choose(match, seat);
      await request("/move", { key, revision: match.revision, ...move });
      console.log("Round", match.round, move.kind, move.tile ?? "");
    }
    await new Promise(resolve => setTimeout(resolve, 800));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [, , origin, code, name = "Relay Agent"] = process.argv;
  if (!origin || !/^[A-Fa-f0-9]{6}$/.test(code ?? "")) {
    console.error("Usage: node sample-agent.mjs http://localhost:8788 MATCH_CODE");
    process.exitCode = 1;
  } else {
    run(origin, code, name).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
