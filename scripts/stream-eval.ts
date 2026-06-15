// Dev harness: exercise the streaming pipeline (streamAssistant -> streamFromModel
// -> the mini's SSE endpoint) against the live model. Not shipped.
//   cd ~/mlr-fm
//   ASSISTANT_FM_URL=http://127.0.0.1:8788/assistant ASSISTANT_FM_TOKEN=$(cat /tmp/fm-secret.txt) \
//     npx tsx scripts/stream-eval.ts "What's the schedule this week?"
import { streamAssistant } from "@/lib/assistant";

const q = process.argv[2] || "What's the schedule this week?";

async function main() {
  const t0 = Date.now();
  const { intent, sources, stream } = await streamAssistant({
    message: q,
    signedIn: true,
    userId: "eval",
    now: new Date("2026-07-26T18:00:00"),
  });
  console.log(`Q: ${q}`);
  console.log(`intent=${intent} sources=${sources.map((s) => `${s.type}:${s.id}`).join(",")}`);
  console.log("--- streamed answer ---");
  let first = 0;
  let acc = "";
  for await (const d of stream) {
    if (!first) first = Date.now() - t0;
    acc += d;
    process.stdout.write(d);
  }
  console.log(`\n--- first-token ${first}ms, total ${Date.now() - t0}ms, ${acc.length} chars ---`);
}
void main();
