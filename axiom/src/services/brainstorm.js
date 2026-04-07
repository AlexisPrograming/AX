// Brainstorm mode — organizes free-form spoken thoughts via Claude
// Supports four modes: general | problem | idea | decision

const Anthropic = require('@anthropic-ai/sdk');
const client    = new Anthropic();

// Stop phrases — strip from end of transcript before processing
const STOP_PHRASES = [
  /\bthat'?s? it\b\.?$/i,
  /\bi'?m done\b\.?$/i,
  /\bdone\b\.?$/i,
  /\bend brainstorm\b\.?$/i,
  /\bstop\b\.?$/i,
  /\bokay done\b\.?$/i,
];

function stripStopPhrase(text) {
  let t = text.trim();
  for (const re of STOP_PHRASES) {
    t = t.replace(re, '').trim();
  }
  return t;
}

// ── Mode prompts ──────────────────────────────────────────────

function buildPrompt(transcript, mode) {
  const modeInstructions = {
    general: `Alexis just spoke freely for a few minutes. Organize his thoughts like a smart friend who was listening closely.

Your response structure (spoken aloud, no markdown, no bullets, no lists):
1. Start with: "Okay, here's what I got from that."
2. "The core idea is..." — one sentence, sharp and clear.
3. "A few key things you touched on:" — then name 2-4 main points naturally in flowing sentences, like you're recapping a conversation ("you mentioned X, and there was also Y...").
4. "What I think you're actually trying to solve:" — your interpretation in one sentence.
5. "One thing worth thinking about:" — one genuine insight, question, or angle they might've missed.
6. End with: "Want to dig into any of those?"

Rules: Warm, direct, conversational. Sound like a friend, not a consultant. No "certainly!" no stiff language. Use contractions. Keep the whole thing under 120 words.`,

    problem: `Alexis just described a problem he's working through. Help him think it through.

Your response structure (spoken aloud, no markdown):
1. Start with: "Okay, let me reflect that back."
2. "The core problem you're describing is..." — one clear sentence.
3. "What's making it hard:" — name 1-2 root causes or blockers you heard.
4. "The way I see it, you have a few options:" — describe 2-3 concrete directions naturally, in sentences.
5. "If I had to pick one to try first, I'd go with..." — give a direct recommendation with a short reason.
6. End with: "Does that match what you're thinking?"

Warm, smart, direct. No fluff. Under 130 words.`,

    idea: `Alexis just shared an idea. Build on it, expand it, get him excited about what it could become.

Your response structure (spoken aloud, no markdown):
1. Start with: "Okay, I like where this is going."
2. "The core of what you're building is..." — sharp one-sentence capture.
3. "What's interesting about this:" — 1-2 genuine angles that make the idea compelling.
4. "Here's where it could go further:" — 1-2 natural extensions or possibilities he didn't mention.
5. "The one thing I'd nail down first:" — most critical next step or open question.
6. End with: "What part do you want to build out first?"

Genuine enthusiasm. Sound like someone who gets it and wants to help it grow. Under 120 words.`,

    decision: `Alexis is trying to make a decision. Help him think through both sides clearly.

Your response structure (spoken aloud, no markdown):
1. Start with: "Alright, let me lay this out."
2. "The decision you're weighing is..." — name both sides clearly in one sentence.
3. "What's pulling you toward [option A]:" — name the real reasons.
4. "What's pulling you toward [option B]:" — name those reasons too.
5. "What I think this actually comes down to:" — cut through to the real underlying question or value trade-off.
6. "If I'm being honest, I'd lean toward..." — give a direct take with a short reason. Don't hedge.
7. End with: "But you know the context better than I do. What's your gut saying?"

Clear, decisive, warm. No waffling. Under 140 words.`,
  };

  const instruction = modeInstructions[mode] || modeInstructions.general;

  return `${instruction}

Here is what Alexis said:
"${transcript}"`;
}

// ── Main export ───────────────────────────────────────────────

async function processThoughts(transcript, mode = 'general') {
  const clean = stripStopPhrase(transcript);
  if (!clean || clean.length < 10) {
    return "Hmm, I didn't catch enough to work with. Want to try again?";
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are AXIOM — a sharp, warm, loyal voice assistant. You speak naturally, like a smart friend. No markdown, no bullets, no headers — pure spoken language only. Use contractions. Vary your sentence rhythm. Be direct and genuine.`,
      messages: [{ role: 'user', content: buildPrompt(clean, mode) }],
    });
    return response.content[0].text.trim();
  } catch (err) {
    console.error('[AXIOM brainstorm] generation failed:', err.message);
    return "I got all of that but hit a snag putting it together. Want to try again?";
  }
}

module.exports = { processThoughts };
