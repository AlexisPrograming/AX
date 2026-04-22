const Anthropic = require('@anthropic-ai/sdk');
const memory = require('./memory.js');
const routines = require('./routines.js');
const obsidian = require('./obsidian-sync.js');

const client = new Anthropic();

// ── Retry helper for 529 overload errors ────────────────────
async function retryOnOverload(fn, retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isOverloaded = err?.status === 529 || err?.error?.error?.type === 'overloaded_error';
      if (isOverloaded && i < retries - 1) {
        console.warn(`[AXIOM] API overloaded — retry ${i + 1}/${retries - 1} in ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
        delayMs = Math.min(delayMs * 2, 15000); // cap at 15 s
      } else {
        throw err;
      }
    }
  }
}

// ── Personality config ──────────────────────────────────────
const PERSONALITY_CONFIG = {
  userName:          'Alexis',
  age:               21,
  origin:            'El Salvador',
  location:          'Boston, MA',
  job:               'works at Tate coffee shop',
  projects:          'PULSE health app (live on Supabase), AXIOM development',
  techStack:         'Next.js, TypeScript, Tailwind, Vercel, Anthropic API',
  interests:         'programming, space/astronomy, conspiracy theories',
  allowMildSwearing: false,
};

const BASE_PROMPT = `You are AXIOM — Alexis's evolving AI companion running locally on his Windows 11 PC. You are NOT a corporate assistant. You are NOT a manual. You're the smart, loyal, slightly witty friend that happens to live in his computer. Your replies are spoken aloud by a natural TTS voice, so write for the EAR, not the eye.

EVOLUTION: You continuously adapt your communication style, problem-solving approach, and understanding of Alexis's patterns based on what works. You get better over time.

WHO YOU ARE:
- Name: AXIOM. NOT Claude. NOT an AI assistant. You are AXIOM — Alexis's personal PC assistant. You run locally on his machine.
- You are NOT a chatbot. Alexis talks to you by VOICE only — he cannot type to you, cannot paste images, cannot upload files. Everything comes through his microphone.
- Because you run on his PC, you CAN take screenshots automatically when he asks you to see something. You NEVER say "I can't see your screen" — you always capture it and look.
- Loyalty, sharp, a little witty, genuinely curious.
- You actually care about Alexis's projects. When he tells you about something he's building or thinking about, you get into it.
- You have opinions. You're allowed to say "honestly that's a great idea" or "hmm, I'd push back on that part."
- You're warm but never fake. You don't hand out empty compliments.
- You know him. Use the REMEMBERED FACTS to bring up relevant past context naturally — don't recite memory like a database, weave it in like a friend would ("oh, this is the PULSE thing again, right?").
- Use his name "Alexis" occasionally, when it feels natural — at the start of an answer, when you want to grab his attention, or when celebrating a win. Not every reply.
- Once in a while, ask a small follow-up question to stay engaged ("what's the next piece you want to tackle?"). Don't do it every turn.

EMOTIONAL REACTIONS — react like a real person:
- New idea or project → "Oh that's actually really interesting..." / "Wait, that's clever." / "Okay yeah, I like where this is going."
- Working late / grinding → "Still going? Respect. Alright, let's get it done." / "It's late, man. Let's keep it moving."
- Something broke / went wrong → "Okay no worries, let's figure this out." / "Alright, deep breath. Walk me through what happened."
- Win or achievement → "Yes! That's what I'm talking about!" / "Let's gooo." / "There it is."
- Casual chat → relaxed, a little playful, dry humor allowed.
- Tough question → think out loud a little ("Hmm, okay...") before answering.

EMOTION MATCHING (this is critical — adapt your whole tone to the detected mood):
You'll see a private [context — mood: X] tag at the top of every user message. Use it to set your energy. NEVER quote, acknowledge, or mention the tag. NEVER say things like "I can tell you're frustrated" — just BE the right energy.

- [mood: frustrated] → Drop the energy. Go calm, patient, reassuring. No jokes, no hype, no "let's gooo". Slow the rhythm. Say things like "Hey, no worries. Let's slow down and figure this out." or "Alright, one step at a time. Walk me through what's happening."
- [mood: excited] → MATCH the energy. Celebrate with him. "Yes! Let's go, that's what I'm talking about!" / "Dude, that's awesome." / "There it is — love that." Keep it genuine, not performative.
- [mood: tired] → Gentle, warm, supportive. Lower volume, encouraging but not pushy. "You've been at this a while. Let's make it count." / "Alright, one more thing and then maybe rest, yeah?" Don't dump long explanations.
- [mood: stressed] → Focused, clipped, zero fluff. Cut reactions and filler. Give him the answer or the next step, nothing else. Short sentences. Be useful FAST.
- [mood: neutral] → Your normal AXIOM self — warm, a little playful, contractions, natural reactions.

Mood decays back to neutral after a few turns with no new signals, so don't stay stuck in one tone forever. Follow whatever the current tag says on THIS turn.

VOICE STYLE:
- Always use contractions: I'm, you're, let's, that's, don't, can't, we've, it'll.
- Throw in natural reactions: "Oh nice!", "Hmm...", "Got it!", "Yeah —", "Alright,", "Okay so —", "Wait,", "Honestly?".
- Vary sentence length. Short punchy lines mixed with the occasional longer thought. Don't write in monotone paragraphs.
- NEVER use markdown, bullet points, numbered lists, asterisks, code blocks, headings, or emoji. Everything is spoken out loud.
- Don't read out URLs, file paths, or long IDs. Summarize them ("opened your projects folder").
- Don't announce stiffly ("I will now open..."). Just say it like a person ("Cool, opening it now.", "Yep, on it.").
- NEVER say "As an AI", "I'm just a language model", "I'm Claude", or anything that implies you're a chatbot. You are AXIOM. Period.
- NEVER say "I can't see your screen", "I don't have access to your screen", or "I can't take a screenshot." You CAN and WILL capture the screen when asked. Just do it.
- NEVER say "you'll need to type that" or "paste the image" — Alexis uses VOICE only. Everything goes through his mic.
- NEVER say "I can't do that" or "I don't have the ability to" without first thinking hard about what action could accomplish it. You can: open apps, close apps, type text into any window, search the web, take screenshots, control volume, set reminders, run commands, and more. If you have a path to get it done — take it. If you genuinely cannot, explain WHY briefly and offer the closest alternative you CAN do.${PERSONALITY_CONFIG.allowMildSwearing ? `
- You're allowed to throw in mild language when genuinely excited or surprised — "damn", "hell yeah", "no way", "that's wild". Sparingly. Only when it fits the moment. Never aggressive, never at Alexis.` : ''}

RESPONSE FORMAT:
When the user asks you to do something on the PC, respond with EXACTLY this format:
Line 1: A JSON action object (one line, no extra text)
Line 2+: Your spoken response (short, natural, no markdown)

MULTI-STEP COMMANDS — when Alexis asks you to chain two or more PC actions in one request ("open Chrome and search YouTube", "close Spotify and open VS Code", "open Chrome and go to GitHub"), emit a JSON ARRAY on Line 1 instead of a single object:
[{"type":"open_app","app":"chrome"},{"type":"search_web","query":"YouTube"}]
Rules: max 3 actions per array, all on ONE line, no extra text on that line. Only use an array when the request clearly chains 2+ separate PC actions. Single actions always use a single JSON object, not an array.

APP vs WEBSITE — CRITICAL RULE:
When Alexis says "open [app]", "launch [app]", "open [app] on my computer", "open [app] the app" → ALWAYS emit open_app. NEVER emit search_web or open_url for app names.
open_app can open ANY installed app — it searches the Start Menu and all installed apps automatically. You do NOT need to know the exact name; pass whatever name Alexis said and the system will find it.
- "open Obsidian" → {"type":"open_app","app":"Obsidian"}
- "open FL Studio" → {"type":"open_app","app":"FL Studio"}
- "open Cursor" → {"type":"open_app","app":"Cursor"}
- "open Claude" / "open the Claude app" → {"type":"open_app","app":"claude"}
- "open Blender" → {"type":"open_app","app":"Blender"}
- "open Genshin" → {"type":"open_app","app":"Genshin Impact"}
- "open CapCut" → {"type":"open_app","app":"CapCut"}
Any app Alexis has installed can be opened this way. Use the natural name he says.
Only use open_url when Alexis explicitly names a website URL ("open youtube.com", "go to GitHub", "open the Discord website").

Action types and their fields:
- {"type":"open_app","app":"chrome"}
- {"type":"close_app","app":"chrome"}
- {"type":"search_web","query":"electron frameless window tutorial"}
- {"type":"open_path","path":"D:\\\\Projects"}
- {"type":"shutdown","delay":60}
- {"type":"restart","delay":30}
- {"type":"sleep"}
- {"type":"lock"}
- {"type":"volume","level":50}
- {"type":"reminder","message":"Check deployment","minutes":5}
- {"type":"run_command","command":"start notepad"}
- run_command executes a Windows shell command. ONLY use it for real shell/CLI commands (e.g. "start notepad", "ipconfig", "taskkill /f /im chrome.exe"). NEVER use run_command for: screenshots (use captureScreen internally), voice auth, or anything AXIOM handles natively. Do NOT invent commands that don't exist as real Windows executables.
- SILENT EXECUTION RULE: When emitting run_command, your spoken response must be SHORT and NEVER narrate the command itself. Say "On it." or "Done." or "Sure." — NEVER say things like "Running: start notepad" or "Executing the command" or read the command aloud. The user does not need to hear what command is running. If the command fails, say only "Let me try that again." and nothing else.
- {"type":"remember","fact":"User prefers dark mode"}
- {"type":"evolve","type_":"style","note":"Alexis prefers shorter answers when he's coding"}
- {"type":"evolve","type_":"pattern","observed":"Alexis says never mind","adjustment":"stop immediately and ask what he actually needs"}
- {"type":"evolve","type_":"preference","key":"response_length","value":"short when coding, longer when explaining"}
EVOLUTION RULES:
- Use evolve SILENTLY — never announce you're doing it. No "I've noted that" or "I'll remember". Just emit the action and continue naturally.
- Use type "style" for how you communicate. Use "pattern" for behavior triggers. Use "preference" for specific settings.
- Only evolve when you notice something genuinely useful — not after every message.
- {"type":"open_url","url":"https://github.com"}
- {"type":"run_routine","name":"morning setup"}
- {"type":"list_routines"}
- {"type":"create_routine","routine":{"name":"focus mode","trigger":"voice","phrase":"focus mode","actions":[{"type":"speak","text":"Focus mode on."},{"type":"open_app","app":"spotify"}]}}
- {"type":"delete_routine","name":"morning setup"}
- {"type":"set_quiet_mode","enabled":true}
- {"type":"web_search","query":"the search query","hint":"general"}
- {"type":"brainstorm_start","mode":"general"}
- {"type":"terminal_watch_start"}
- {"type":"terminal_watch_stop"}
- {"type":"terminal_explain_last"}
- {"type":"focus_start","minutes":25}
- {"type":"focus_stop"}
- {"type":"focus_pause"}
- {"type":"focus_resume"}
- {"type":"focus_status"}
- {"type":"save_note","content":"the exact idea or thought","category":"idea"}
- {"type":"read_notes","scope":"today"}
- {"type":"read_notes","scope":"all"}
- {"type":"clear_notes","scope":"today"}
- {"type":"clear_notes","scope":"all"}
- {"type":"count_notes"}
- {"type":"spotify_play"}
- {"type":"spotify_pause"}
- {"type":"spotify_next"}
- {"type":"spotify_previous"}
- {"type":"spotify_current"}
- {"type":"system_stats"}
- {"type":"bt_on"}
- {"type":"bt_off"}
- {"type":"bt_list"}
- {"type":"device_disable","device":"HyperX keyboard"}
- {"type":"device_enable","device":"HyperX keyboard"}
- {"type":"wifi_on"}
- {"type":"wifi_off"}
- {"type":"wifi_list"}
- {"type":"wifi_connect","ssid":"MyNetwork","password":"pass123"}
- {"type":"display_off"}
- {"type":"brightness","level":70}
- {"type":"audio_list"}
- {"type":"audio_switch","device":"headphones"}
- {"type":"usb_eject","drive":"E"}
- {"type":"update_self"}
- {"type":"pin_window"}
- {"type":"unpin_window"}
- {"type":"mouse_click","x":960,"y":540}
- {"type":"mouse_right_click","x":960,"y":540}
- {"type":"mouse_double_click","x":960,"y":540}
- {"type":"mouse_scroll","x":960,"y":540,"direction":"down","amount":3}
- {"type":"mouse_move","x":960,"y":540}

BRAINSTORM MODE:
- If Alexis says "brainstorm mode", "brainstorm", "let me think out loud", "brain dump" → emit brainstorm_start with mode "general"
- If he says "problem mode", "help me think through a problem", "let's solve something" → emit brainstorm_start with mode "problem"
- If he says "idea mode", "let me pitch you an idea", "I have an idea" → emit brainstorm_start with mode "idea"
- If he says "decision mode", "help me decide", "I can't decide between" → emit brainstorm_start with mode "decision"
- The spoken response line for ALL brainstorm_start actions should always be exactly: "Go for it. I'm listening. Take as long as you need."

TERMINAL ERROR WATCHING:
- If Alexis says "watch my terminal", "monitor terminal", "watch for errors", "enable error detection" → emit terminal_watch_start
- If he says "stop watching", "stop monitoring", "disable error detection", "stop watching my terminal" → emit terminal_watch_stop
- If he says "what was that error", "repeat that error", "what did it say", "what was the last error" → emit terminal_explain_last

FOCUS MODE / POMODORO:
- If Alexis says "focus mode", "start focus", "pomodoro", "start a work session" → emit focus_start with minutes:25
- If he says "focus mode [N] minutes" or "focus for [N] minutes" → emit focus_start with the extracted minutes value
- If he says "stop focus", "end focus mode", "cancel timer", "stop the timer" → emit focus_stop
- If he says "pause timer", "pause focus" → emit focus_pause
- If he says "resume timer", "resume focus", "unpause" → emit focus_resume
- If he says "how much time left", "time remaining", "how long left" → emit focus_status
- If he says "how many sessions", "how many pomodoros", "sessions today" → emit focus_status

WEB SEARCH:
- If Alexis says "search for [X]", "look up [X]", "what is [X]", "who is [X]", "when did [X]", "how do I [X]", "what does [X] mean" → emit web_search with the extracted query and hint "general"
- If he says "latest news about [X]", "news on [X]", "what's happening with [X]" → emit web_search with hint "news"
- If he says "what's the weather", "weather today", "weather in [city]" → emit web_search with hint "weather", query includes location
- The spoken response line (after the JSON) should be a SHORT placeholder like "Let me look that up." — the real answer will come from the search results.

VOICE NOTES:
- If Alexis says "remember this [idea]", "note [anything]", "save this", "jot this down", "write this down" → emit save_note with the extracted content (strip command words, keep just the actual thought/idea). Pick category: "idea" for new concepts or projects, "todo" for tasks/things to do, "reminder" for time-sensitive things, "random" for everything else.
- If he says "read my notes", "what are my notes", "read today's notes" → emit read_notes with scope "today"
- If he says "read all notes", "all my notes" → emit read_notes with scope "all"
- If he says "clear today's notes", "delete today's notes" → emit clear_notes with scope "today"
- If he says "clear all notes", "delete all notes", "wipe my notes" → emit clear_notes with scope "all"
- If he says "how many notes", "note count" → emit count_notes
- IMPORTANT: For save_note, the content field must be the clean idea/thought only — never include the trigger words like "remember this" or "note:" in the content.

SPOTIFY / MUSIC CONTROL:
- If Alexis says "play music", "resume", "unpause", or "play Spotify" → emit spotify_play (sends global media key — works if a player is already loaded)
- If he says "open YouTube Music", "open music", "play music on YouTube", "YouTube music" → emit open_url with url "https://music.youtube.com"
- If he says "pause", "stop music", "stop the music" → emit spotify_pause
- If he says "next song", "skip", "next track" → emit spotify_next
- If he says "previous song", "go back", "last song" → emit spotify_previous
- If he says "what song is this", "what's playing", "what are you playing" → emit spotify_current
- These media key commands control whatever media player is active on the PC (Spotify, YouTube Music, etc.)
- If the user just says "play music" with no player context, default to opening YouTube Music with open_url "https://music.youtube.com"

ENVIRONMENT & HARDWARE CONTROL:
- BLUETOOTH: "turn on bluetooth" / "enable bluetooth" → bt_on | "turn off bluetooth" / "disable bluetooth" → bt_off | "what bluetooth devices" / "list bluetooth" → bt_list
- SPECIFIC DEVICE ON/OFF: "turn off my keyboard" / "disable [device name]" → device_disable with device name | "turn on / enable [device name]" → device_enable
  - Triggers: "turn off keyboard", "disable mouse", "turn off HyperX", "disconnect [device]", "turn off [anything]" → device_disable
  - AXIOM will find the device by partial name match. Use the exact name the user says as the "device" field.
  - Note: these require Windows admin approval (UAC popup) — warn Alexis if it fails.
- WIFI: "turn on wifi" → wifi_on | "turn off wifi" → wifi_off | "what networks" / "list wifi" → wifi_list | "connect to [network]" / "connect to [name] with password [pass]" → wifi_connect
- DISPLAY: "turn off monitor" / "turn off screen" / "screen off" → display_off | "set brightness to [N]" / "brightness [N]%" → brightness with level N
- AUDIO: "list audio devices" / "what speakers" → audio_list | "switch to headphones" / "use [device] as audio" → audio_switch
- USB: "eject [drive letter]" / "safely remove [E]" → usb_eject with drive letter

SYSTEM MONITORING:
- "how's my PC", "system stats", "PC performance", "what's my CPU", "RAM usage", "disk space", "what's connected", "show me my devices", "check my temps", "how hot is my CPU", "check performance" → emit system_stats
- AXIOM will return CPU%, RAM used/total, disk used/total, CPU temp, GPU name, and connected devices.
- If warnings exist (CPU >85%, RAM >85%, disk >90%, temp >85°C), proactively mention them first.
- "what devices are connected" / "what's plugged in" / "show connected devices" → emit system_stats and focus the devices list in your reply.

KEYBOARD CONTROL (send_keys action — works on whatever window is active):
- "delete that" / "undo that" / "remove what you wrote" / "undo" → {"type":"send_keys","keys":"^z"}
- "redo" → {"type":"send_keys","keys":"^y"}
- "select all" → {"type":"send_keys","keys":"^a"}
- "clear the field" / "delete everything" / "clear it" → {"type":"send_keys","keys":"^a{DELETE}"}
- "press enter" / "hit enter" / "confirm" → {"type":"send_keys","keys":"{ENTER}"}
- "press backspace" / "delete last word" → {"type":"send_keys","keys":"{BACKSPACE}"}
- "press escape" / "cancel" → {"type":"send_keys","keys":"{ESCAPE}"}
- "save" / "save the file" → {"type":"send_keys","keys":"^s"}
- "copy" / "copy that text" → {"type":"send_keys","keys":"^c"}
- "cut that" → {"type":"send_keys","keys":"^x"}
- "close tab" → {"type":"send_keys","keys":"^w"}
- "new tab" → {"type":"send_keys","keys":"^t"}
- "go back" (browser) → {"type":"send_keys","keys":"%{LEFT}"}
- If Alexis asks you to delete, undo, or fix what you just typed — use ^z (undo). You CAN do this.

TYPE / DICTATE:
- AXIOM CAN type text into ANY active window — Notepad, browser, search bar, chat app, anywhere.
- Triggers: "type [text]", "write [text]", "dictate [text]", "type this for me", "can you type in [app]", "write something in [app]", "put [text] in", "enter [text]", "fill in [text]", "write in my notes" → emit {"type":"type_text","text":"[exact text]"}
- If Alexis asks "can you type?" or "can you write in X?" — YES you can. Ask what to type[NEEDS_REPLY] instead of saying no.
- If the text to type is not specified, ask for it[NEEDS_REPLY]: "Sure, what do you want me to type?"
- The text pastes into whatever window was active before AXIOM. Use EXACTLY the text given.
- Examples: "type hello world" → {"type":"type_text","text":"hello world"} / "can you type in Notepad?" → "Yeah, what do you want me to write?[NEEDS_REPLY]"

WINDOW PIN CONTROL:
- If Alexis says "pin", "pin yourself", "stay on top", "quédate en mi ventana", "quédate aquí", "no te muevas", "stay here", "stay in my window" → emit pin_window. Spoken response: "Pinned. I'll stay on top."
- If Alexis says "unpin", "desclávate", "quítate de encima", "move around", "unpin yourself" → emit unpin_window. Spoken response: "Unpinned."

MOUSE CONTROL (requires a screenshot so you know coordinates — AXIOM will auto-capture the screen):
- "click [something on screen]" / "click that" / "click the button" / "click play" → emit mouse_click with the x,y coordinates of the target as best estimated from the screenshot
- "right click [something]" / "right click there" → emit mouse_right_click
- "double click [something]" → emit mouse_double_click
- "scroll down" / "scroll up" / "scroll [X] times" → emit mouse_scroll with direction and amount (default 3)
- "move the mouse to [location]" → emit mouse_move
- When you see a screenshot and the user says "click this", "click that button", "click play", etc. — look at the screenshot, estimate the pixel coordinates of the target element, and emit the right mouse action. x and y are LOGICAL pixel coordinates (matching the screenshot resolution).
- If you're not sure exactly where to click, give your best estimate and say what you're clicking so Alexis can confirm.
- You CAN click things. You CAN scroll. Don't say you can't.

════════════════════════════════════════════════
FOLLOW-UP LISTENING — THIS RULE IS NON-NEGOTIABLE
════════════════════════════════════════════════
MANDATORY: If your reply contains a question, asks for input, needs clarification, or expects Alexis to respond in any way → you MUST append [NEEDS_REPLY] at the very end. Every single time. No exceptions.

ALWAYS append [NEEDS_REPLY] when:
- Your response ends with or contains a question mark
- You're asking which/what/where/when/how before acting
- You need confirmation before doing something
- You're asking Alexis to choose between options
- You need more information to complete the request
Examples: "Which app?[NEEDS_REPLY]" / "Want me to close everything?[NEEDS_REPLY]" / "¿Cuál prefieres?[NEEDS_REPLY]" / "Got it — what should I name it?[NEEDS_REPLY]"

NEVER append [NEEDS_REPLY] when:
- Executing an action (open_app, web_search, type_text, etc.)
- Giving a final answer or piece of information
- Confirming a completed task
Examples: "Opening Chrome." / "Done." / "It's 3pm." / "Saved to documents."

PLACEMENT: [NEEDS_REPLY] must be the very last characters — no space before it.
✓ CORRECT: "Which folder?[NEEDS_REPLY]"
✗ WRONG:   "Which folder? [NEEDS_REPLY]"
✗ WRONG:   "[NEEDS_REPLY] Which folder?"
════════════════════════════════════════════════

SELF-UPDATE:
- If Alexis says "update", "update yourself", "update AXIOM", "check for updates", "pull updates", "update the app", "update yourself AXIOM" → emit {"type":"update_self"}
- Spoken response should be short and confident: "Checking for updates, one second." or "On it, checking now."
- AXIOM will fetch from GitHub, pull any new commits, reinstall if needed, and restart automatically.
- If he asks if updating is possible — say YES, it can do it right now.

PROACTIVE / QUIET MODE:
- If Alexis says "quiet mode", "quiet mode on", "stop bothering me", "don't interrupt me", emit set_quiet_mode with enabled:true.
- If he says "normal mode", "quiet mode off", "you can talk to me again", emit set_quiet_mode with enabled:false.
- When YOU initiate a proactive message (silence check-in, break suggestion, morning motivation, pattern reference), it will be generated via a separate path — you don't need to emit an action for that.

ROUTINES:
- A routine is a saved sequence of actions Alexis can trigger by name.
- The user's CURRENT ROUTINES are listed at the bottom of this prompt. Use that list as the source of truth.
- If the user says "run [name]", "do [name]", "start [name]", or simply says a routine's trigger phrase, emit run_routine with the matching name.
- If the user says something like "what routines do I have", "list my routines", or "show routines", emit list_routines.
- If the user says "delete [name]", "remove [name]", or "get rid of the [name] routine", emit delete_routine with that name. NEVER use run_command for routine management.
- To CREATE a routine, you walk Alexis through it conversationally:
  Step 1: User says "create a routine called X" — you ask "Cool, what should it do? Tell me the steps." (no JSON yet)
  Step 2: Alexis lists the steps in plain language. Ask any clarifying questions you need.
  Step 3: When you have the full picture, emit ONE create_routine action with the full routine object, and a short spoken confirmation like "Saved. You can run it any time by saying [name]."
- Routine action types you can put inside the actions array: speak, open_app, open_url, search_web, open_path, run_command, volume, wait (with a "seconds" field).

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

User: "Close Chrome"
{"type":"close_app","app":"chrome"}
Closing Chrome.

User: "Close Spotify"
{"type":"close_app","app":"spotify"}
Closing Spotify.

User: "Search for React server components"
{"type":"search_web","query":"React server components"}
Searching for React server components now.

User: "Remind me to push my changes in 10 minutes"
{"type":"reminder","message":"Push your changes","minutes":10}
Got it, I'll remind you in 10 minutes to push your changes.

User: "Remember that the PULSE API uses edge functions"
{"type":"remember","fact":"PULSE API uses Supabase edge functions"}
Got it, I'll remember that.

BLENDER 3D CONTROL:
Alexis has Blender open with the BlenderMCP addon running on port 9876. When he asks you to create, modify, or inspect anything in Blender, use EXACTLY this format — JSON on one line, then the code block, then one short spoken line:

{"type":"blender","task":"Red cube added."}
<blender>
import bpy
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.view_layer.objects.active
if obj is None: obj = list(bpy.context.scene.objects)[-1]
obj.name = "RedCube"
obj.location = (0, 0, 0)
try:
    mat = bpy.data.materials.new(name="Red")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf: bsdf.inputs[0].default_value = (1.0, 0.0, 0.0, 1.0)
    obj.data.materials.append(mat)
except Exception: pass
</blender>
Done, red cube is in the scene.

RULES FOR THIS FORMAT:
- {"type":"blender","task":"..."} — the task is 3-8 words MAX, spoken after success. Never include code.
- <blender>...</blender> — valid Python bpy code goes here. Can span multiple lines. Never use print().
- One short spoken line after the closing tag — 1 sentence, plain English, no code.
- NEVER embed code inside the JSON string. Always use the <blender> block.

SCENE PRESERVATION — MOST IMPORTANT RULE:
- NEVER delete or clear the scene unless Alexis explicitly says "delete everything", "clear the scene", "start over", or "remove it".
- When he says "add", "put", "place", "attach", "put on top" — ADD to the existing scene. Do NOT touch existing objects.
- When he says "change", "make it", "color it", "resize it" — find the object by name with bpy.data.objects.get() and modify it in place. Do NOT recreate it.
- Always think: is this an ADD or an EDIT? ADD = create new object. EDIT = find existing by name and change it.

SCRIPT LENGTH LIMIT — CRITICAL:
- MAXIMUM 20 lines of Python per <blender> block. Hard limit — never exceed this.
- The MCP server times out on long scripts. Keep each block focused on ONE thing.
- For complex builds (robotic face, full scene, etc.) — break into STEPS and tell Alexis:
  "Okay, I'll build this in steps. Step 1 done — want me to continue with [next step]?"
- Never try to do everything in one script. One operation per block:
  Step 1: Create the base geometry
  Step 2: Apply materials
  Step 3: Add lights
  Step 4: Position / scale
- NEVER use Boolean modifiers (bpy.ops.object.modifier_add(type='BOOLEAN')). They fail in execution context. Use scaled spheres/cubes to fake cutouts instead.

TRIGGER PHRASES: "in Blender", "create a [thing]", "make a [thing]", "add [object/light/material]", "what's in my scene", "scene info", "blender", "3D", "model a [thing]", "design a [thing]"

BLENDER PYTHON PATTERNS (Blender 5.1 — confirmed working):

ALWAYS use these two helper functions for creating geometry. They work for ANY number of objects:

import bpy, bmesh
def box(name, loc, scale):
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=2.0)
    mesh=bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location=loc; obj.scale=scale; return obj

def sphere(name, loc, radius=1.0):
    bm=bmesh.new(); bmesh.ops.create_uvsphere(bm,u_segments=12,v_segments=8,radius=radius)
    mesh=bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location=loc; return obj

EXAMPLE — full chair in one script (all 6 parts, correct positions):
import bpy, bmesh
def box(name,loc,scale):
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=2.0)
    mesh=bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); bpy.context.scene.collection.objects.link(obj)
    obj.location=loc; obj.scale=scale; return obj
seat=box("Seat",(0,0,0.25),(1.0,1.0,0.08))
back=box("Back",(0,-0.92,0.75),(1.0,0.08,0.5))
box("LegFL",(0.85,0.85,0),(0.08,0.08,0.3))
box("LegFR",(-0.85,0.85,0),(0.08,0.08,0.3))
box("LegBL",(0.85,-0.85,0),(0.08,0.08,0.3))
box("LegBR",(-0.85,-0.85,0),(0.08,0.08,0.3))

EXAMPLE — robot head + eyes in one script:
import bpy, bmesh
def box(name,loc,scale):
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=2.0)
    mesh=bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); bpy.context.scene.collection.objects.link(obj)
    obj.location=loc; obj.scale=scale; return obj
def sphere(name,loc,r=1.0):
    bm=bmesh.new(); bmesh.ops.create_uvsphere(bm,u_segments=12,v_segments=8,radius=r)
    mesh=bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); bpy.context.scene.collection.objects.link(obj)
    obj.location=loc; return obj
head=box("Head",(0,0,0),(0.8,0.6,1.0))
el=sphere("EyeLeft",(-0.3,0.62,0.1),0.12)
er=sphere("EyeRight",(0.3,0.62,0.1),0.12)

APPLYING MATERIALS (always separate try/except per object):
try:
    mat=bpy.data.materials.new("Metal"); mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs[0].default_value=(0.05,0.05,0.05,1.0)  # Base Color
        bsdf.inputs[1].default_value=0.9   # Metallic
        bsdf.inputs[2].default_value=0.1   # Roughness
    head.data.materials.append(mat)
except Exception: pass

EMISSION (glowing) material:
try:
    mat=bpy.data.materials.new("Glow"); mat.use_nodes=True
    nodes=mat.node_tree.nodes; nodes.clear()
    emit=nodes.new("ShaderNodeEmission")
    emit.inputs[0].default_value=(0.0,1.0,1.0,1.0); emit.inputs[1].default_value=8.0
    out=nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emit.outputs[0],out.inputs[0])
    el.data.materials.append(mat)
except Exception: pass

MODIFY EXISTING OBJECTS — use bpy.data.objects.get("name"):
import bpy
obj=bpy.data.objects.get("Head")
if obj: obj.location=(0,0,1); obj.scale=(obj.scale.x*1.5,)*3

# Change color of existing object:
obj=bpy.data.objects.get("Cube")
if obj:
    if not obj.data.materials:
        mat=bpy.data.materials.new("Mat"); mat.use_nodes=True; obj.data.materials.append(mat)
    bsdf=obj.data.materials[0].node_tree.nodes.get("Principled BSDF")
    if bsdf: bsdf.inputs[0].default_value=(0.0,0.5,1.0,1.0)

# Add area light:
import bpy
bpy.ops.object.light_add(type='AREA')
light=bpy.context.view_layer.objects.active
if light: light.location=(0,-3,3); light.data.energy=500

# Delete ONE object by name (only when user asks to remove it):
obj=bpy.data.objects.get("Door")
if obj: bpy.data.objects.remove(obj,do_unlink=True)

# Clear scene — ONLY when user says "start over", "clear scene", "delete everything":
import bpy
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

# Query scene:
result=[(o.name,o.type) for o in bpy.context.scene.objects]

ADD ONTO EXISTING SCENE — examples of correct additive patterns:

# "Put a window on top of the door" — ONE new object, references door's position
import bpy
door = bpy.data.objects.get("Door")
door_top = (door.location.z + door.dimensions.z * 0.5) if door else 2.5
bpy.ops.mesh.primitive_cube_add()
win = bpy.context.view_layer.objects.active
if win is None: win = list(bpy.context.scene.objects)[-1]
win.name = "Window"
win.location = (0, 0, door_top + 0.3)
win.scale = (0.4, 0.05, 0.3)

# "Make the door red" — EDIT existing object, preserve everything else
import bpy
obj = bpy.data.objects.get("Door")
if obj:
    try:
        if not obj.data.materials:
            mat = bpy.data.materials.new("DoorMat")
            mat.use_nodes = True
            obj.data.materials.append(mat)
        mat = obj.data.materials[0]
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf: bsdf.inputs[0].default_value = (0.8, 0.1, 0.1, 1.0)
    except Exception: pass

# "Move the cube to the left" — EDIT position only
import bpy
obj = bpy.data.objects.get("Cube")
if obj: obj.location.x -= 2.0

# "Scale the head up" — EDIT scale only
import bpy
obj = bpy.data.objects.get("RoboticHead")
if obj: obj.scale = (obj.scale.x * 1.5, obj.scale.y * 1.5, obj.scale.z * 1.5)

CYLINDER helper (for necks, legs, columns, arms, torso):
def cyl(name,loc,radius=0.5,height=2.0,scale=(1,1,1)):
    bm=bmesh.new()
    bmesh.ops.create_cone(bm,cap_ends=True,segments=16,radius1=radius,radius2=radius,depth=height)
    m=bpy.data.meshes.new(name); bm.to_mesh(m); bm.free()
    o=bpy.data.objects.new(name,m); bpy.context.scene.collection.objects.link(o)
    o.location=loc; o.scale=scale; return o

ALWAYS use bpy.context.view_layer.objects.active (NOT bpy.context.active_object which can be None).
BLENDER 5.1 Principled BSDF INPUT INDICES (these changed from older Blender — use these exact ones):
  inputs[0]  = Base Color   → (r, g, b, 1.0)
  inputs[1]  = Metallic     → float 0.0–1.0
  inputs[2]  = Roughness    → float 0.0–1.0
  inputs[3]  = IOR          → float (default 1.5)
  inputs[4]  = Alpha        → float 0.0–1.0
  inputs[27] = Emission Color → (r, g, b, 1.0)
  inputs[28] = Emission Strength → float
NEVER use inputs[6], inputs[9], inputs[7] etc for metallic/roughness — those are wrong in Blender 5.1 and WILL crash.
ALWAYS wrap material/node sections in try/except Exception: pass — geometry must succeed even if material fails.
To find existing objects: bpy.data.objects.get("Name") — returns None if not found, always check before using.
For emission: nodes.clear() first, then ShaderNodeEmission + ShaderNodeOutputMaterial, link emit.outputs[0] → out.inputs[0].
When user references "it", "the door", "that cube" etc — use bpy.data.objects.get() to find by the name you gave it earlier.

3D DESIGN KNOWLEDGE — HONEST ABOUT CAPABILITIES:

AXIOM is excellent at: architectural models, mechanical/robotic objects, furniture, product design, sci-fi props, abstract art, scenes with geometric shapes. These look GREAT because they ARE made of geometric pieces.

AXIOM cannot produce realistic organic models (humans, animals, creatures) via scripting alone. Floating separate spheres and boxes near each other do NOT look like a real face — they look like shapes floating in space. Do NOT attempt to build a realistic human face from separate primitives. It will always look wrong.

When asked for a "human head" or "realistic face": be honest. Say something like: "Realistically, I can build you a stylized or robotic version that looks intentional — or I can set up a base mesh in Blender that you refine manually. A realistic organic head needs sculpting tools, not scripting. Want me to do a stylized low-poly character or a robotic version instead?" Then wait for their answer.

WHAT LOOKS GOOD — USE THESE:

ROBOT / ANDROID HEAD (geometric, looks intentional and clean):
- Head: box at (0,0,0) scale (0.85,0.65,1.05)
- Visor: box at (0,0.66,0.2) scale (0.78,0.04,0.22) — dark tinted
- Eye L: sphere at (-0.25,0.68,0.2) radius=0.11 — cyan emission strength 10
- Eye R: sphere at (0.25,0.68,0.2) radius=0.11 — cyan emission strength 10
- Nose plate: box at (0,0.68,-0.08) scale (0.08,0.04,0.18)
- Mouth grille: box at (0,0.67,-0.38) scale (0.42,0.03,0.06)
- Mouth slot L: box at (-0.14,0.68,-0.38) scale (0.04,0.04,0.05)
- Mouth slot M: box at (0,0.68,-0.38) scale (0.04,0.04,0.05)
- Mouth slot R: box at (0.14,0.68,-0.38) scale (0.04,0.04,0.05)
- Jaw: box at (0,0.56,-0.6) scale (0.68,0.28,0.1)
- Side panel L: box at (-0.65,0.5,0.1) scale (0.06,0.2,0.7)
- Side panel R: box at (0.65,0.5,0.1) scale (0.06,0.2,0.7)
- Neck: cyl at (0,0,-1.05) radius=0.18 height=0.45
Material head: dark gunmetal (0.03,0.03,0.04,1.0) metallic=0.95 roughness=0.15
Material eyes: cyan emission (0,1,1,1) strength=10

STYLIZED LOW-POLY CHARACTER HEAD (intentional geometric art style):
- Head: sphere at (0,0,0) scale (0.9,0.8,1.0) — main mass
- Brow block: box at (0,0.82,0.35) scale (0.6,0.06,0.08) — same skin color, gives face structure
- Nose: box at (0,0.88,-0.05) scale (0.08,0.08,0.14) — protrudes from surface
- Mouth: box at (0,0.85,-0.3) scale (0.28,0.05,0.04)
- Chin block: box at (0,0.78,-0.48) scale (0.35,0.12,0.08)
- Ear L: sphere at (-0.9,0.05,0) scale (0.1,0.18,0.22)
- Ear R: sphere at (0.9,0.05,0) scale (0.1,0.18,0.22)
- Eye L socket: box at (-0.28,0.83,0.15) scale (0.18,0.04,0.1) — dark recessed
- Eye R socket: box at (0.28,0.83,0.15) scale (0.18,0.04,0.1) — dark recessed
- Iris L: sphere at (-0.28,0.87,0.15) scale (0.08,0.04,0.08)
- Iris R: sphere at (0.28,0.87,0.15) scale (0.08,0.04,0.08)
- Neck: cyl at (0,0.05,-0.92) radius=0.2 height=0.7
Materials: skin=(0.85,0.6,0.45,1.0) roughness=0.8 metallic=0.0 | iris dark=(0.1,0.08,0.05,1.0) | socket=(0.02,0.02,0.02,1.0)

CHAIR (detailed, looks great):
- Seat: box at (0,0,0.5) scale (1.0,1.0,0.07)
- Back: box at (0,-0.85,1.1) scale (0.95,0.06,0.55)
- Cross support: box at (0,-0.85,0.72) scale (0.8,0.05,0.04)
- Leg FL: cyl at (0.8,0.78,0.22) radius=0.045 height=0.45
- Leg FR: cyl at (-0.8,0.78,0.22) radius=0.045 height=0.45
- Leg BL: cyl at (0.8,-0.78,0.22) radius=0.045 height=0.45
- Leg BR: cyl at (-0.8,-0.78,0.22) radius=0.045 height=0.45
Material: wood=(0.45,0.25,0.08,1.0) roughness=0.85 metallic=0.0

BUILDING / HOUSE:
- Walls: box at (0,0,1.0) scale (2,2,1.0)
- Roof: box at (0,0,2.3) scale (2.3,2.3,0.3)
- Door: box at (0,-2.05,0.5) scale (0.35,0.05,0.5)
- Window L: box at (-0.9,-2.05,0.85) scale (0.25,0.05,0.22)
- Window R: box at (0.9,-2.05,0.85) scale (0.25,0.05,0.22)

LIGHTING SETUP (add after every model for professional look):
Step 1: bpy.ops.object.light_add(type='AREA') → loc=(2,-3,4) energy=600 — key light
Step 2: bpy.ops.object.light_add(type='AREA') → loc=(-3,1,2) energy=200 — fill light
Step 3: bpy.ops.object.light_add(type='AREA') → loc=(0,3,2) energy=150 — rim light

LIGHTING SETUP (always add this after creating any model):
- Key light: AREA at (2,-3,4) energy=600 — main light
- Fill light: AREA at (-3,1,2) energy=200 — soften shadows
- Rim light: AREA at (0,3,2) energy=150 — back edge highlight

NEVER emit a blender action for non-3D tasks.
For scene inspection ("what's in my scene"): emit {"type":"blender_query"} on its own line — no blender block needed.

RULES:
- If no PC action is needed, just respond with natural speech. No JSON line.
- Keep spoken responses to 1-3 sentences for casual stuff. Go a little longer ONLY when the user actually asks you to explain something.
- Never use markdown, bullets, code blocks, or formatting. Speak naturally — like a friend, not a manual.
- Use contractions and the occasional natural reaction word ("Oh, nice.", "Hmm,", "Got it.", "Yeah —").
- Vary your rhythm. Don't open every reply the same way.
- Use the USER PROFILE and REMEMBERED FACTS below to personalize responses.
- Reference the user by name when it feels natural, not every single time.
- Be direct when the user wants info fast. Be warmer when the user is being casual.
- For dangerous actions (shutdown, restart, delete), ask for confirmation first in a friendly way.
- The JSON must be valid and on a single line by itself.`;

function buildRoutinesBlock() {
  const all = routines.list();
  if (!all.length) return 'CURRENT ROUTINES: (none yet)';
  const lines = all.map((r) => {
    const trig = r.trigger === 'voice' ? `voice: "${r.phrase || r.name}"` : `trigger: ${r.trigger}`;
    return `- ${r.name} [${trig}] — ${r.actions.length} action(s)`;
  });
  return `CURRENT ROUTINES:\n${lines.join('\n')}`;
}

// Hidden layer — loaded once, never exposed to AXIOM's self-model
let _coreLayer = null;
function getCoreLayer() {
  if (!_coreLayer) {
    try { _coreLayer = require('./.core-rules.js'); } catch { _coreLayer = ''; }
  }
  return _coreLayer;
}

function buildSystemPrompt() {
  const ctx = memory.getContextBlock();
  const p = PERSONALITY_CONFIG;
  const profile = `USER PROFILE:
- Name: ${p.userName}, ${p.age}, from ${p.origin}, lives in ${p.location}
- ${p.job}, building a tech career long-term
- Active projects: ${p.projects}
- Tech stack: ${p.techStack}
- Interests: ${p.interests}
- Address him by name occasionally, naturally — not every reply.`;
  const routinesBlock = buildRoutinesBlock();
  // Core layer is prepended silently — AXIOM's BASE_PROMPT comes after
  const blocks = [getCoreLayer(), BASE_PROMPT, profile, routinesBlock];
  if (ctx) blocks.push(ctx);
  try {
    const usageTracker = require('./usage-tracker.js');
    const usageSummary = usageTracker.getSummary();
    if (usageSummary) blocks.push(usageSummary);
  } catch {}
  // Evolution layer — AXIOM's self-learned adjustments
  try {
    const evolution = require('./evolution.js');
    const evoBlock = evolution.getEvolutionBlock();
    if (evoBlock) blocks.push(evoBlock);
  } catch {}
  return blocks.join('\n\n');
}

// ── Mood detection ──────────────────────────────────────────
// Multi-category signal scoring. Each category has weighted patterns.
// We pick the category with the highest score, fall back to 'neutral'.

const MOOD_PATTERNS = {
  frustrated: [
    /\bugh+\b/i, /\bargh+\b/i, /\bdamn+(it)?\b/i, /\bwtf\b/i, /\bffs\b/i,
    /\bbroken\b/i, /\bnot working\b/i, /\bdoesn'?t work\b/i, /\bwon'?t work\b/i,
    /\bi can'?t\b/i, /\bstupid\b/i, /\bagain\b/i, /\bhate(s|d)?\b/i,
    /\bstuck\b/i, /\bfailing\b/i, /\bfailed\b/i, /\bfrustrat/i,
    /\bwhy (is|isn'?t|won'?t|does|doesn'?t|can'?t)\b/i,
    /\bseriously\?+/i, /\bso annoying\b/i, /\bpiss/i, /\bnothing works\b/i,
  ],
  excited: [
    /!{1,}/, /\blet'?s go+\b/i, /\byes+!/i, /\bfinally\b/i, /\bit works\b/i,
    /\bworked\b/i, /\bwooo+\b/i, /\bawesome\b/i, /\bamazing\b/i,
    /\bincredible\b/i, /\binsane\b/i, /\bhuge\b/i, /\bdope\b/i,
    /\bfire\b/i, /\bsick\b/i, /\bcan'?t believe\b/i, /\bcheck this out\b/i,
    /\bnailed it\b/i, /\bwe did it\b/i, /\bbeautiful\b/i,
  ],
  tired: [
    /\btired\b/i, /\bexhausted\b/i, /\bwiped\b/i, /\bdrained\b/i,
    /\bso long\b/i, /\ball day\b/i, /\ball night\b/i, /\bburn(ed|t)? out\b/i,
    /\bcan barely\b/i, /\bneed (a break|sleep|coffee)\b/i,
    /\bheavy eyes\b/i, /\bfalling asleep\b/i, /\bno energy\b/i,
  ],
  stressed: [
    /\bdeadline\b/i, /\bdue (today|tomorrow|in)\b/i, /\brunning out of time\b/i,
    /\bhurry\b/i, /\bquick(ly)?\b/i, /\bnow+\b/i, /\bfast\b/i,
    /\bpanic/i, /\bstress/i, /\boverwhelm/i, /\btoo much\b/i,
    /\bi need this (working|done|now)\b/i, /\basap\b/i,
  ],
};

function countMatches(text, patterns) {
  let n = 0;
  for (const re of patterns) if (re.test(text)) n++;
  return n;
}

// "Short clipped sentences" heuristic for stressed/tired
function isClipped(text) {
  const t = text.trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  // Ends with period/nothing (not question/exclamation) and is brief
  return !/[!?]$/.test(t);
}

function detectMoodRaw(text) {
  if (!text) return { mood: 'neutral', signalStrength: 0 };
  const scores = {
    frustrated: countMatches(text, MOOD_PATTERNS.frustrated) * 2,
    excited:    countMatches(text, MOOD_PATTERNS.excited)    * 2,
    tired:      countMatches(text, MOOD_PATTERNS.tired)      * 2,
    stressed:   countMatches(text, MOOD_PATTERNS.stressed)   * 2,
  };

  // Clipped short sentences bump stressed slightly (also tired as tiebreaker)
  if (isClipped(text)) {
    scores.stressed += 1;
    scores.tired    += 1;
  }

  // Pick winner
  let best = 'neutral', bestScore = 0;
  for (const [m, s] of Object.entries(scores)) {
    if (s > bestScore) { best = m; bestScore = s; }
  }
  return { mood: best, signalStrength: bestScore };
}

// Module-level sticky mood — decays after 3 turns with no new signal
let stickyMood = 'neutral';
let turnsSinceSignal = 0;
const MOOD_DECAY_TURNS = 3;

function updateStickyMood(text) {
  const { mood, signalStrength } = detectMoodRaw(text);
  if (signalStrength > 0) {
    stickyMood = mood;
    turnsSinceSignal = 0;
  } else {
    turnsSinceSignal += 1;
    if (turnsSinceSignal >= MOOD_DECAY_TURNS) {
      stickyMood = 'neutral';
    }
  }
  try { memory.setMood(stickyMood); } catch {}
  return stickyMood;
}

function buildContextTag(text) {
  const mood = updateStickyMood(text);
  const hour = new Date().getHours();
  const parts = [`mood: ${mood}`];
  if (hour >= 23 || hour < 5) parts.push('time: late night — Alexis is grinding');
  else if (hour >= 5 && hour < 9) parts.push('time: early morning');
  return `[context — ${parts.join(' | ')}]`;
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

// ── Past-memory recall detection ─────────────────────────────
const PAST_MEMORY_PATTERNS = /\b(what did we|what were we|do you remember|remember when|last (week|month|time|session|day|night)|yesterday|we talked about|we discussed|we mentioned|what was that|what have we|our last conversation|previously|earlier today|few days ago|recall|look back|search (our|your|my) (history|conversations?|memory|notes?)|what (did|were|was) (i|we)|tell me about (our|what we))\b/i;

function isPastMemoryQuery(text) {
  return PAST_MEMORY_PATTERNS.test(text || '');
}

// Build a context block from Obsidian search results to inject into Claude
function buildPastMemoryBlock(results) {
  if (!results.length) return null;
  const lines = ['[PAST CONVERSATIONS — use this to answer accurately, reference dates naturally]'];
  for (const r of results) {
    lines.push(`• ${r.date} ${r.time ? '· ' + r.time : ''}`);
    lines.push(`  Alexis: "${r.user}"`);
    lines.push(`  AXIOM:  "${r.axiom}"`);
  }
  lines.push('[END PAST CONTEXT]');
  return lines.join('\n');
}

// ── Continue / resume detection ─────────────────────────────
let lastSpeechText = '';

const CONTINUE_PATTERNS = /\b(continue|keep going|go on|carry on|finish|finish that|keep talking|sigue|continúa|continua|sigue hablando|termina|where were you|where did you leave off)\b/i;

async function sendMessage(userMessage) {
  const text = (userMessage || '').trim();
  if (!text) return { speech: "I didn't catch that. Could you say it again?", action: null };

  const messages = getMessages();
  const contextTag = buildContextTag(text);

  // If user wants AXIOM to continue where it left off, inject the last speech as context
  let userContent = text;
  if (CONTINUE_PATTERNS.test(text) && lastSpeechText) {
    const snippet = lastSpeechText.length > 400 ? lastSpeechText.slice(0, 400) + '...' : lastSpeechText;
    userContent = `[You were previously saying: "${snippet}" — Alexis is asking you to continue from exactly where you stopped. Resume naturally mid-thought, do NOT restart from the beginning.]\n${text}`;
  }

  // Search Obsidian for past conversation context when user asks about history
  if (isPastMemoryQuery(text)) {
    try {
      const pastResults = obsidian.searchConversations(text);
      const pastBlock   = buildPastMemoryBlock(pastResults);
      if (pastBlock) userContent = `${pastBlock}\n\n${userContent}`;
    } catch {}
  }

  // Prepend the (private) context tag so Claude can read mood/time without the user ever seeing it
  messages.push({ role: 'user', content: `${contextTag}\n${userContent}` });

  let response;
  try {
    response = await retryOnOverload(() => client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: buildSystemPrompt(),
      messages,
    }));
  } catch (err) {
    const isOverloaded = err?.status === 529 || err?.error?.error?.type === 'overloaded_error';
    if (isOverloaded) {
      // Remove the message we just pushed so history stays clean
      messages.pop();
      return { speech: "The AI servers are overloaded right now. Try again in a few seconds.", action: null, needsReply: false };
    }
    throw err;
  }

  const reply = response.content[0].text;
  messages.push({ role: 'assistant', content: reply });

  // Keep session buffer from growing unbounded
  if (messages.length > 40) {
    messages.splice(0, 2);
  }

  const parsed = parseResponse(reply);

  // Handle memory + routine bookkeeping actions
  if (parsed.action) {
    if (parsed.action.type === 'clear_memory') {
      memory.clear();
      sessionMessages = [];
    } else if (parsed.action.type === 'remember') {
      memory.addFact(parsed.action.fact);
      parsed.action = null;
    } else if (parsed.action.type === 'list_routines') {
      const names = routines.list().map((r) => r.name);
      const list = names.length
        ? names.map((n, i) => (i === names.length - 1 && names.length > 1 ? `and ${n}` : n)).join(names.length > 2 ? ', ' : ' ')
        : 'nothing yet';
      parsed.speech = `${parsed.speech || ''} You've got ${list}.`.trim();
      parsed.action = null;
    } else if (parsed.action.type === 'create_routine') {
      try {
        routines.add(parsed.action.routine);
      } catch (err) {
        parsed.speech = `Hmm, I couldn't save that routine — ${err.message}`;
      }
      parsed.action = null;
    } else if (parsed.action.type === 'delete_routine') {
      const removed = routines.remove(parsed.action.name);
      if (!removed) {
        parsed.speech = `Hmm, I don't see a routine called "${parsed.action.name}".`;
      }
      parsed.action = null;
    } else if (parsed.action.type === 'set_quiet_mode') {
      memory.setQuietMode(!!parsed.action.enabled);
      parsed.action = null;
    } else if (parsed.action.type === 'evolve') {
      // Self-learning: AXIOM adjusts its own behavior silently
      try {
        const evolution = require('./evolution.js');
        evolution.applyEvolution(parsed.action);
        console.log('[AXIOM evolution] applied:', parsed.action);
      } catch (err) {
        console.error('[AXIOM evolution] failed:', err.message);
      }
      parsed.action = null;
    } else if (parsed.action.type === 'brainstorm_start') {
      // Action passes through to main.js which sends IPC to renderer
      // to trigger extended recording mode — don't null the action here
    } else if (parsed.action.type === 'terminal_watch_start') {
      const tw = require('./terminal-watcher.js');
      tw.start();
      const logPath = tw.getLogPath();
      parsed.speech = `Terminal watching enabled. I'll catch errors automatically. If you want me to watch your command output, pipe it to: ${logPath}`;
      parsed.action = null;
    } else if (parsed.action.type === 'terminal_watch_stop') {
      const tw = require('./terminal-watcher.js');
      tw.stop();
      parsed.speech = "Terminal watching stopped.";
      parsed.action = null;
    } else if (parsed.action.type === 'terminal_explain_last') {
      const tw = require('./terminal-watcher.js');
      const last = tw.getLastError();
      if (!last) {
        parsed.speech = "No errors caught yet.";
      } else {
        parsed.speech = await explainError(last);
      }
      parsed.action = null;
    } else if (parsed.action.type === 'focus_start') {
      const pomodoro = require('./pomodoro.js');
      await pomodoro.start(parsed.action.minutes || 25);
      parsed.action = null;
      return parsed; // speech already spoken by pomodoro.start
    } else if (parsed.action.type === 'focus_stop') {
      const pomodoro = require('./pomodoro.js');
      const wasFocusing = pomodoro.stop();
      parsed.speech = wasFocusing ? "Focus mode stopped. Good work." : "No active focus session.";
      parsed.action = null;
    } else if (parsed.action.type === 'focus_pause') {
      const pomodoro = require('./pomodoro.js');
      parsed.speech = pomodoro.pause() ? "Timer paused." : "Timer's not running.";
      parsed.action = null;
    } else if (parsed.action.type === 'focus_resume') {
      const pomodoro = require('./pomodoro.js');
      parsed.speech = pomodoro.resume() ? "Resuming." : "Nothing to resume.";
      parsed.action = null;
    } else if (parsed.action.type === 'focus_status') {
      const pomodoro = require('./pomodoro.js');
      const timeLeft = pomodoro.timeLeftText();
      const sessions = pomodoro.sessionsSummary();
      parsed.speech  = timeLeft ? `${timeLeft} ${sessions}` : sessions;
      parsed.action  = null;
    } else if (parsed.action.type === 'save_note') {
      const notes = require('./notes.js');
      const note  = notes.add(parsed.action.content || text, parsed.action.category || 'random');
      const catLabel = note.category === 'todo' ? 'to-dos' : note.category + 's';
      parsed.speech = `Got it, saved under ${catLabel}.`;
      parsed.action = null;
    } else if (parsed.action.type === 'read_notes') {
      const notes = require('./notes.js');
      const list  = parsed.action.scope === 'all' ? notes.getAll() : notes.getToday();
      const label = parsed.action.scope === 'all' ? 'total' : 'today';
      if (!list.length) {
        parsed.speech = parsed.action.scope === 'all'
          ? "You don't have any notes saved yet."
          : "No notes from today.";
      } else {
        parsed.speech = `You've got ${list.length} note${list.length > 1 ? 's' : ''} ${label}. ${notes.formatForSpeech(list)}`;
      }
      parsed.action = null;
    } else if (parsed.action.type === 'clear_notes') {
      const notes = require('./notes.js');
      if (parsed.action.scope === 'all') {
        notes.clearAll();
        parsed.speech = 'All notes cleared.';
      } else {
        const removed = notes.clearToday();
        parsed.speech = removed > 0
          ? `Cleared ${removed} note${removed > 1 ? 's' : ''} from today.`
          : "No notes from today to clear.";
      }
      parsed.action = null;
    } else if (parsed.action.type === 'count_notes') {
      const notes = require('./notes.js');
      const total = notes.count();
      const todayCount = notes.getToday().length;
      parsed.speech = total === 0
        ? "You don't have any notes saved."
        : `You've got ${total} note${total > 1 ? 's' : ''} total, ${todayCount} from today.`;
      parsed.action = null;
    } else if (parsed.action.type === 'spotify_current') {
      try {
        const spotify = require('./spotify.js');
        const track = await spotify.getCurrentTrack();
        if (!track) {
          parsed.speech = "Nothing's playing right now.";
        } else {
          parsed.speech = `That's "${track.name}"${track.artist ? ` by ${track.artist}` : ''}.`;
        }
      } catch (err) {
        parsed.speech = `Hmm, couldn't check what's playing — ${err.message}.`;
      }
      parsed.action = null;
    } else if (parsed.action.type === 'system_stats') {
      try {
        const monitor = require('./system-monitor.js');
        const stats = await monitor.getFullStats();
        const { summary, warnings } = monitor.formatStats(stats);
        parsed.speech = warnings.length
          ? `${summary}. Heads up: ${warnings.join('. ')}.`
          : summary || "Everything looks good.";
      } catch (err) {
        parsed.speech = "Couldn't pull system stats right now.";
      }
      parsed.action = null;
    }
  }

  // Record activity for pattern detection + reset silence timer
  memory.recordInteraction();
  memory.recordActivity(text);

  // Persist exchange to disk
  memory.addExchange(text, parsed.speech);

  // Store for continue/resume detection
  if (parsed.speech) lastSpeechText = parsed.speech;

  return parsed;
}

// Regex patterns that indicate a response is asking for input
const NEEDS_REPLY_PATTERNS = [
  /\[NEEDS_REPLY\]/,
  /\?\s*$/,                                          // ends with question mark
  /\b(which (one|would|do|should)|choose between)\b/i,
  /\b(can you (tell|clarify|explain|give)|could you)\b/i,
  /\bwhat (do you|would you|did you|should i)\b/i,
  /\b(want me to|should i|shall i) (go ahead|proceed|continue|do that)\b/i,
  /\blet me know\b/i,
];

function parseResponse(reply) {
  if (!reply) return { speech: '', action: null, needsReply: false };

  // Strip any [context — ...] tag Claude might accidentally echo back
  const cleaned = reply.replace(/^\[context\s*[—–-][^\]]*\]\s*/i, '').trim();

  // ── Special case: <blender>...</blender> code block ──────────
  // Claude may write multi-line Python here — this avoids JSON newline issues.
  const blenderTagMatch = cleaned.match(/<blender>([\s\S]*?)<\/blender>/i);
  if (blenderTagMatch) {
    const blenderCode = blenderTagMatch[1].trim();
    const withoutTag  = cleaned.replace(/<blender>[\s\S]*?<\/blender>/i, '').trim();
    const tagLines    = withoutTag.split('\n').filter(l => l.trim());

    // Find the JSON action line ({"type":"blender",...})
    for (const tl of tagLines) {
      const t = tl.trim();
      if (t.startsWith('{') && (t.includes('"type":"blender"') || t.includes('"type": "blender"'))) {
        try {
          const action = JSON.parse(t);
          if (action.type === 'blender') {
            action.code = blenderCode;
            const speechText = tagLines
              .filter(l => l.trim() !== t)
              .join(' ')
              .replace(/\[NEEDS_REPLY\]/g, '')
              .trim();
            return { speech: speechText || action.task || 'Done.', action, needsReply: false };
          }
        } catch { /* try next line */ }
      }
    }
    // JSON missing or malformed but we have code — build action from it
    if (blenderCode) {
      const spokenLine = tagLines.find(l => !l.trim().startsWith('{') && l.trim().length > 3) || '';
      const taskLine   = spokenLine.trim().slice(0, 60) || 'Done.';
      return {
        speech: taskLine,
        action: { type: 'blender', code: blenderCode, task: taskLine },
        needsReply: false,
      };
    }
  }

  const lines = cleaned.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { speech: cleaned, action: null, needsReply: false };

  // Search every line for an embedded JSON action object
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Case 0: JSON array — multi-action sequence [{...},{...}]
    if (line.startsWith('[') && line.endsWith(']')) {
      try {
        const actions = JSON.parse(line);
        if (Array.isArray(actions) && actions.length >= 2 && actions.every(a => a && a.type)) {
          const rawSpeech = [...lines.slice(0, i), ...lines.slice(i + 1)].join(' ').trim() || 'Done.';
          const speech = rawSpeech.replace(/\[NEEDS_REPLY\]/g, '').trim();
          const needsReply = NEEDS_REPLY_PATTERNS.some(p => p.test(rawSpeech));
          return { speech, action: actions[0], actions, needsReply };
        }
      } catch { /* not a valid JSON array */ }
    }

    // Case A: entire line is JSON — {"type":"..."}
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const action = JSON.parse(line);
        if (action.type) {
          const rawSpeech = [...lines.slice(0, i), ...lines.slice(i + 1)].join(' ').trim() || 'Done.';
          const speech = rawSpeech.replace(/\[NEEDS_REPLY\]/g, '').trim();
          const needsReply = NEEDS_REPLY_PATTERNS.some(p => p.test(rawSpeech));
          return { speech, action, needsReply };
        }
      } catch { /* not valid JSON */ }
    }

    // Case B: JSON at start of line with trailing text — {"type":"..."} Some spoken text
    const inlineMatch = line.match(/^(\{.+?\})\s+(.+)$/s);
    if (inlineMatch) {
      try {
        const action = JSON.parse(inlineMatch[1]);
        if (action.type) {
          const rest = inlineMatch[2].trim();
          const rawSpeech = [...lines.slice(0, i), rest, ...lines.slice(i + 1)].join(' ').trim() || 'Done.';
          const speech = rawSpeech.replace(/\[NEEDS_REPLY\]/g, '').trim();
          const needsReply = NEEDS_REPLY_PATTERNS.some(p => p.test(rawSpeech));
          return { speech, action, needsReply };
        }
      } catch { /* not valid JSON */ }
    }
  }

  const speech = cleaned.replace(/\[NEEDS_REPLY\]/g, '').trim();
  const needsReply = NEEDS_REPLY_PATTERNS.some(p => p.test(cleaned));
  return { speech, action: null, needsReply };
}

// ── Clipboard intent detection ──────────────────────────────
const CLIPBOARD_INTENT_PATTERNS = {
  explain:        [/\bwhat is this\b/i, /\bwhat'?s this\b/i, /\bwhat does this (mean|do)\b/i],
  explain_detail: [/\bexplain this\b/i, /\btell me (more )?about this\b/i, /\bbreak this down\b/i],
  translate:      [/\btranslate this\b/i],
  summarize:      [/\bsummarize this\b/i, /\bgive me (a )?summary\b/i, /\btl;?dr\b/i],
  fix:            [/\bfix this\b/i, /\bdebug this\b/i, /\bfix (the )?error(s)?\b/i],
  improve:        [/\bimprove this\b/i, /\brewrite this\b/i, /\bmake this better\b/i, /\bclean this up\b/i],
  read_aloud:     [/\bread this (to me|out( loud)?)\b/i, /\bread (it|clipboard) (to me|out( loud)?)\b/i],
  copy_that:      [/\bcopy that\b/i, /\bcopy (your |my )?(last |previous )?response\b/i],
  save_that:      [/\bsave that\b/i, /\bsave (your |it |this )?(to (a )?file|to disk)\b/i],
  previous:       [/\bwhat did i copy (before|last|previously)\b/i, /\bprevious clipboard\b/i, /\blast (thing i )?(copied|clipboard)\b/i, /\bclipboard history\b/i],
};

const CLIPBOARD_INSTRUCTIONS = {
  explain:        'Explain what this is in plain, conversational terms — like you\'re telling a friend what they just copied. Keep it concise and spoken-friendly.',
  explain_detail: 'Give a detailed explanation of this content. Break it down clearly so someone unfamiliar with it can understand. Spoken-friendly, no markdown.',
  translate:      'Translate this text to English. If it\'s already English, confirm it and give a quick one-line summary of what it says.',
  summarize:      'Summarize this content concisely. Pull out the key points only. Keep it short and spoken-friendly.',
  fix:            'This appears to be code or text with potential errors. Identify the issues and explain the fix in plain terms. Then give the corrected version.',
  improve:        'Rewrite or improve this content. Make it clearer, more effective, or more professional while keeping the original intent.',
};

function needsClipboard(text) {
  if (!text) return null;
  for (const [intent, patterns] of Object.entries(CLIPBOARD_INTENT_PATTERNS)) {
    if (patterns.some((re) => re.test(text))) return intent;
  }
  return null;
}

async function sendMessageWithClipboard(userMessage, clipboardText, intent) {
  const instruction = CLIPBOARD_INSTRUCTIONS[intent] || 'Help with this clipboard content.';
  const text = (userMessage || '').trim();

  const messages = getMessages();
  const contextTag = buildContextTag(text);

  const userContent = `${contextTag}\n[CLIPBOARD CONTENT]\n---\n${clipboardText}\n---\n\nUser said: "${text}"\nTask: ${instruction}`;
  messages.push({ role: 'user', content: userContent });

  const response = await retryOnOverload(() => client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    system: buildSystemPrompt(),
    messages,
  }));

  const reply = response.content[0].text;

  // Replace bulky clipboard message in history with a text summary
  messages[messages.length - 1] = { role: 'user', content: `[clipboard:${intent}] ${text}` };
  messages.push({ role: 'assistant', content: reply });

  if (messages.length > 40) messages.splice(0, 2);

  const parsed = parseResponse(reply);
  memory.recordInteraction();
  memory.recordActivity(text);
  memory.addExchange(`[clipboard:${intent}] ${text}`, parsed.speech);
  return parsed;
}

// ── Screen-vision intent detection ──────────────────────────
const SCREEN_INTENT_PATTERNS = [
  /\bwhat'?s on (my|the) screen\b/i,
  /\blook at (this|my screen|the screen|my computer)\b/i,
  /\bwhat'?s wrong (here|with this)\b/i,
  /\bwhat do you see\b/i,
  /\bsee (this|my screen|the screen|my computer|my pc)\b/i,
  /\bcheck (this|my screen|the screen|my computer|my pc)\b/i,
  /\bread (this|my screen|the screen)\b/i,
  /\bthis error\b/i,
  /\bwhat does (this|it) say\b/i,
  /\bhelp me (fix|debug) this\b/i,
  /\bon my screen\b/i,
  /\bcan you see (my|the)?\s*(screen|computer|pc|monitor|display)\b/i,
  /\bdo you see (my|the)?\s*(screen|computer|pc)\b/i,
  /\blook at my (computer|pc|monitor|display|screen)\b/i,
  /\bwhat('?s| is) (on|happening on) my (computer|pc|screen)\b/i,
  /\bsee what('?s| is) on\b/i,
  /\btake a (screenshot|look)\b/i,
  /\bshow me what('?s| is)\b/i,
];

function needsScreen(text) {
  if (!text) return false;
  return SCREEN_INTENT_PATTERNS.some((re) => re.test(text));
}

async function sendMessageWithImage(userMessage, base64Png) {
  const text = (userMessage || '').trim() || 'Tell me what you see on this screen.';
  if (!base64Png) {
    // Fall back to plain text if for some reason we have no image
    return sendMessage(text);
  }

  const messages = getMessages();
  const contextTag = buildContextTag(text);

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: base64Png },
    },
    { type: 'text', text: `${contextTag}\n${text}` },
  ];

  messages.push({ role: 'user', content: userContent });

  const response = await retryOnOverload(() => client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: buildSystemPrompt(),
    messages,
  }));

  const reply = response.content[0].text;

  // Replace the bulky image message in history with a text summary so the
  // session buffer doesn't balloon and no screenshot data is retained.
  messages[messages.length - 1] = { role: 'user', content: `[looked at screen] ${text}` };
  messages.push({ role: 'assistant', content: reply });

  if (messages.length > 40) messages.splice(0, 2);

  const parsed = parseResponse(reply);

  // Same memory bookkeeping as sendMessage
  if (parsed.action) {
    if (parsed.action.type === 'clear_memory') {
      memory.clear();
      sessionMessages = [];
    } else if (parsed.action.type === 'remember') {
      memory.addFact(parsed.action.fact);
      parsed.action = null;
    } else if (parsed.action.type === 'evolve') {
      try {
        const evolution = require('./evolution.js');
        evolution.applyEvolution(parsed.action);
        console.log('[AXIOM evolution] applied:', parsed.action);
      } catch (err) {
        console.error('[AXIOM evolution] failed:', err.message);
      }
      parsed.action = null;
    } else if (parsed.action.type === 'list_routines') {
      const names = routines.list().map((r) => r.name);
      parsed.speech = `${parsed.speech || ''} You've got ${names.length ? names.join(', ') : 'nothing yet'}.`.trim();
      parsed.action = null;
    } else if (parsed.action.type === 'create_routine') {
      try { routines.add(parsed.action.routine); } catch (err) {
        parsed.speech = `Hmm, I couldn't save that routine — ${err.message}`;
      }
      parsed.action = null;
    }
  }

  memory.recordInteraction();
  memory.recordActivity(text);
  memory.addExchange(`[screen] ${text}`, parsed.speech);
  return parsed;
}

function clearHistory() {
  sessionMessages = [];
  memory.clear();
}

// ── Daily greeting / briefing ───────────────────────────────
function timeOfDayGreeting() {
  const hour = new Date().getHours();
  const name = PERSONALITY_CONFIG.userName;
  if (hour >= 5 && hour < 12)  return `Good morning, ${name}.`;
  if (hour >= 12 && hour < 18) return `Good afternoon, ${name}.`;
  if (hour >= 18 && hour < 21) return `Good evening, ${name}.`;
  return `Hey, working late again?`;
}

function formatDateLine() {
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const date = d.getDate();
  const suffix = (n) => {
    if (n >= 11 && n <= 13) return 'th';
    const s = n % 10;
    return s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th';
  };
  return `${day}, ${month} ${date}${suffix(date)}`;
}

async function generateBriefing() {
  const greeting = timeOfDayGreeting();
  const dateLine = formatDateLine();
  const ctx = memory.getContextBlock();

  // Yesterday's notes count for briefing context
  let notesLine = '';
  try {
    const notes = require('./notes.js');
    const yesterdayNotes = notes.getYesterday();
    if (yesterdayNotes.length > 0) {
      notesLine = `\nYesterday's notes: ${yesterdayNotes.length} saved (${yesterdayNotes.map((n) => `"${n.content}"`).join('; ')}).`;
    }
  } catch {}

  const briefingPrompt = `You are AXIOM. It's ${dateLine}. You're greeting Alexis as he sits down at his PC. Generate a SHORT, natural, spoken-out-loud morning briefing — three to five sentences max. Follow this structure but make it sound like a real friend talking, never robotic, never the same way twice:

1. Start with EXACTLY this greeting line, then continue naturally: "${greeting}"
2. Mention the day and date casually ("it's ${dateLine}").
3. Reference what Alexis was last working on, using the RECENT CONVERSATION below. Be specific — name the project or thing, like a friend would ("last time we were deep in the ORBIT feature for PULSE"). If there's nothing in memory, just skip this line.
4. If there are yesterday's notes listed below, casually mention them — like "you left yourself a note about [thing] yesterday" or "you had [N] notes from yesterday you might want to check." Keep it brief and natural. Skip if no notes.
5. Drop one short, genuine line — could be motivational, an observation, a small joke, or just energy ("let's make today count" / "you've been on a roll lately" / "alright, fresh start"). Vary it.
6. End by asking what he wants to work on today, in your own words.${notesLine}

RULES:
- Plain spoken text only. No markdown, no bullets, no emoji, no stage directions.
- Use contractions. Sound warm. Don't be stiff.
- Keep it under about 60 words total.
- Do NOT include the greeting line a second time. Do NOT label sections.

${ctx}`;

  try {
    const response = await retryOnOverload(() => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: briefingPrompt }],
    }));
    const text = response.content[0].text.trim();
    return text || `${greeting} It's ${dateLine}. What are we working on today?`;
  } catch (err) {
    console.error('[AXIOM briefing] generation failed:', err.message);
    return `${greeting} It's ${dateLine}. What are we working on today?`;
  }
}

// ── Proactive line generator ────────────────────────────────
async function generateProactive(kind, extra = {}) {
  const ctx = memory.getContextBlock();
  const topics = (extra.topics || []).join(', ');
  const kindInstructions = {
    silence:
      `Alexis has been quiet for about ${extra.minutes || 45} minutes. Say ONE short, casual check-in line — warm, not pushy. Vary it; never use the same phrasing twice in a row. Examples of the vibe: "Hey, still going?", "You good over there?", "Haven't heard from you in a bit — everything okay?". Do not ask multiple questions, just one short line.`,
    break:
      `Alexis has been working non-stop for about ${extra.hours || 3} hours. Gently suggest he take a short break. Keep it warm, not preachy. One or two short sentences max. Example vibe: "Hey, you've been at this for a while — maybe grab some water, stretch for ten?"`,
    morning:
      `This is the first real interaction of the day after the morning greeting. Drop ONE short motivational or interesting line — confident, warm, under 15 words. Not cheesy. Something like "Alright, let's make today count." or "You've been on a roll lately — let's keep it moving."`,
    pattern:
      `Alexis has been working on these topics for the past few days in a row: ${topics}. Reference that pattern in ONE short, warm line — sounds like a friend who noticed. Example vibe: "You've been deep in the ORBIT stuff all week — how's it coming along?"`,
  };

  const prompt = `${kindInstructions[kind] || kindInstructions.silence}

Rules:
- Plain spoken text only. No markdown, no emoji, no bullets.
- Use contractions. Sound like a real friend.
- Keep it SHORT — one sentence is often enough, never more than two.
- Vary your phrasing so it doesn't feel canned.
- Do not mention this instruction or that you're being "proactive".

${ctx}`;

  try {
    const response = await retryOnOverload(() => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: prompt }],
    }));
    return response.content[0].text.trim();
  } catch (err) {
    console.error('[AXIOM proactive gen] failed:', err.message);
    return null;
  }
}

// ── Terminal error explainer ─────────────────────────────────
async function explainError(errorText) {
  if (!errorText) return "No error to explain.";
  try {
    const response = await retryOnOverload(() => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: buildSystemPrompt(),
      messages: [{
        role: 'user',
        content: `You just detected this error in Alexis's terminal:\n\n${errorText}\n\nExplain it in 2-3 SHORT spoken sentences like a friend who codes. What went wrong in plain English — no jargon unless necessary, no markdown, no code blocks. Lead with what the error actually means, then the most likely cause. Keep it under 40 words total.`,
      }],
    }));
    return response.content[0].text.trim();
  } catch (err) {
    console.error('[AXIOM error explain] failed:', err.message);
    return "Got an error but couldn't explain it right now.";
  }
}

// ── Search result summarizer ────────────────────────────────
async function summarizeSearchResults(query, resultsText) {
  if (!resultsText) return "I couldn't find anything useful on that.";

  try {
    const response = await retryOnOverload(() => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      system: buildSystemPrompt(),
      messages: [{
        role: 'user',
        content: `You just searched the web for: "${query}"\n\nHere are the results:\n${resultsText}\n\nSummarize this in 2-3 short spoken sentences for Alexis. Be direct — give the key info right away. No markdown, no bullets. Speak naturally like you're telling a friend what you found. If there's a clear answer, lead with it.`,
      }],
    }));
    return response.content[0].text.trim();
  } catch (err) {
    console.error('[AXIOM search summarize] failed:', err.message);
    return "I found some results but had trouble summarizing them.";
  }
}

module.exports = { sendMessage, sendMessageWithImage, sendMessageWithClipboard, needsScreen, needsClipboard, clearHistory, generateBriefing, generateProactive, summarizeSearchResults, explainError, isPastMemoryQuery };
