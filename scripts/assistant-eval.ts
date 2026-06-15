// Local dev harness: run the REAL askAssistant pipeline (intent + retrieval +
// generation) over a list of questions, against whatever model ASSISTANT_FM_URL
// points at (the mini) or the grounded stub if unset. Not shipped — eval only.
//
//   cd ~/mlr-fm
//   ASSISTANT_FM_URL=http://127.0.0.1:8788/assistant ASSISTANT_FM_TOKEN=$(cat /tmp/fm-secret.txt) \
//     npx tsx scripts/assistant-eval.ts [questions.json] [nowISO]
import { readFileSync } from "node:fs";
import { askAssistant } from "@/lib/assistant";

const file = process.argv[2];
const now = new Date(process.argv[3] || "2026-07-26T18:00:00");

let questions: string[];
if (file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  questions = (Array.isArray(parsed) ? parsed : parsed.questions).map((x: unknown) =>
    typeof x === "string" ? x : (x as { q: string }).q,
  );
} else {
  questions = [
    "Who's leading the welcome bonfire?",
    "What's for dinner Friday?",
    "What's the front desk number?",
  ];
}

async function main() {
  const results: unknown[] = [];
  for (const q of questions) {
    const t0 = Date.now();
    try {
      const res = await askAssistant({ message: q, signedIn: true, userId: "eval", now });
      results.push({
        q,
        intent: res.intent,
        sources: res.sources.map((s) => `${s.type}:${s.id}`),
        answer: res.answer,
        ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({ q, error: String((e as Error)?.message || e) });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}
void main();
