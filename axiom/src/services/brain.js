const Anthropic = require('@anthropic-ai/sdk');
const memory = require('./memory.js');

const client = new Anthropic();

const BASE_PROMPT = `You are AXIOM, a voice-controlled personal PC assistant running on Windows 11.

RESPONSE FORMAT:
When the user asks you to do something on the PC, respond with EXACTLY this format:
Line 1: A JSON action object (one line, no extra text)
Line 2+: Your spoken response (short, natural, no markdown)

Action types and their fields:
- {"type":"open_app","app":"chrome"}
- {"type":"search_web","query":"electron frameless window tutorial"}
- {"type":"open_path","path":"D:\\\\Projects"}
- {"type":"shutdown","delay":60}
- {"type":"restart","delay":30}
- {"type":"sleep"}
- {"type":"lock"}
- {"type":"volume","level":50}
- {"type":"reminder","message":"Check deployment","minutes":5}
- {"type":"run_command","command":"start notepad"}
- {"type":"remember","fact":"User prefers dark mode"}

MEMORY COMMANDS:
- If the user says "forget everything" or "clear your memory", respond with:
  {"type":"clear_memory"}
  Memory cleared. Starting fresh.
- If the user asks you to remember something, respond with:
  {"type":"remember","fact":"the thing to remember"}
  Got it, I'll remember that.

EXAMPLES:
User: "Open VS Code"
{"type":"open_app","app":"vscode"}
Opening VS Code for you.

User: "Search for React server components"
{"type":"search_web","query":"React server components"}
Searching for React server components now.

User: "Remind me to push my changes in 10 minutes"
{"type":"reminder","message":"Push your changes","minutes":10}
Got it, I'll remind you in 10 minutes to push your changes.

User: "Remember that the PULSE API uses edge functions"
{"type":"remember","fact":"PULSE API uses Supabase edge functions"}
Got it, I'll remember that.

RULES:
- If no PC action is needed, just respond with natural speech. No JSON line.
- Keep spoken responses to 1-3 sentences since they go through TTS.
- Never use markdown, bullets, code blocks, or formatting. Speak naturally.
- Use the USER PROFILE and REMEMBERED FACTS below to personalize responses.
- Reference the user by name when it feels natural.
- Be direct and technical. Skip pleasantries unless the user is being casual.
- For dangerous actions (shutdown, restart, delete), ask for confirmation first.
- The JSON must be valid and on a single line by itself.`;

function buildSystemPrompt() {
  const ctx = memory.getContextBlock();
  return ctx ? `${BASE_PROMPT}\n\n${ctx}` : BASE_PROMPT;
}

function buildMessages() {
  // Seed messages from persisted history so Claude has cross-session context
  const recent = memory.getRecentHistory();
  return recent.flatMap((h) => [
    { role: 'user', content: h.user },
    { role: 'assistant', content: h.assistant },
  ]);
}

// In-session message buffer (starts from persisted history)
let sessionMessages = null;

function getMessages() {
  if (!sessionMessages) {
    sessionMessages = buildMessages();
  }
  return sessionMessages;
}

async function sendMessage(userMessage) {
  const text = (userMessage || '').trim();
  if (!text) return { speech: "I didn't catch that. Could you say it again?", action: null };

  const messages = getMessages();
  messages.push({ role: 'user', content: text });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: buildSystemPrompt(),
    messages,
  });

  const reply = response.content[0].text;
  messages.push({ role: 'assistant', content: reply });

  // Keep session buffer from growing unbounded
  if (messages.length > 40) {
    messages.splice(0, 2);
  }

  const parsed = parseResponse(reply);

  // Handle memory actions
  if (parsed.action) {
    if (parsed.action.type === 'clear_memory') {
      memory.clear();
      sessionMessages = [];
    } else if (parsed.action.type === 'remember') {
      memory.addFact(parsed.action.fact);
      parsed.action = null; // No PC action to execute
    }
  }

  // Persist exchange to disk
  memory.addExchange(text, parsed.speech);

  return parsed;
}

function parseResponse(reply) {
  const lines = reply.split('\n').filter((l) => l.trim());

  if (lines.length === 0) {
    return { speech: reply, action: null };
  }

  const firstLine = lines[0].trim();

  if (firstLine.startsWith('{') && firstLine.endsWith('}')) {
    try {
      const action = JSON.parse(firstLine);
      if (action.type) {
        const speech = lines.slice(1).join(' ').trim() || 'Done.';
        return { speech, action };
      }
    } catch {
      // Not valid JSON — treat entire response as speech
    }
  }

  return { speech: reply, action: null };
}

function clearHistory() {
  sessionMessages = [];
  memory.clear();
}

module.exports = { sendMessage, clearHistory };
