const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let listening = false;
let engine = null;

// SRGS grammar for commands AXIOM handles — System.Speech is very
// accurate with custom grammars (unlike free-form dictation)
const GRAMMAR_XML = `<?xml version="1.0" encoding="utf-8"?>
<grammar version="1.0" xml:lang="en-US" root="command"
  xmlns="http://www.w3.org/2001/06/grammar"
  tag-format="semantics/1.0">

  <rule id="command" scope="public">
    <one-of>
      <item><ruleref uri="#greeting"/></item>
      <item><ruleref uri="#open_app"/></item>
      <item><ruleref uri="#search"/></item>
      <item><ruleref uri="#system"/></item>
      <item><ruleref uri="#reminder"/></item>
      <item><ruleref uri="#memory"/></item>
      <item><ruleref uri="#freeform"/></item>
    </one-of>
  </rule>

  <rule id="greeting">
    <one-of>
      <item>hello</item>
      <item>hey</item>
      <item>hi</item>
      <item>hey axiom</item>
      <item>hello axiom</item>
      <item>hi axiom</item>
      <item>good morning</item>
      <item>good afternoon</item>
      <item>good evening</item>
      <item>what's up</item>
      <item>how are you</item>
    </one-of>
  </rule>

  <rule id="open_app">
    <item>
      <one-of>
        <item>open</item>
        <item>launch</item>
        <item>start</item>
        <item>run</item>
      </one-of>
      <ruleref uri="#app_name"/>
    </item>
  </rule>

  <rule id="app_name">
    <one-of>
      <item>chrome</item>
      <item>google chrome</item>
      <item>firefox</item>
      <item>edge</item>
      <item>the browser</item>
      <item>browser</item>
      <item>vs code</item>
      <item>visual studio code</item>
      <item>code</item>
      <item>spotify</item>
      <item>notepad</item>
      <item>calculator</item>
      <item>terminal</item>
      <item>command prompt</item>
      <item>powershell</item>
      <item>explorer</item>
      <item>file explorer</item>
      <item>files</item>
      <item>discord</item>
      <item>slack</item>
      <item>teams</item>
      <item>paint</item>
      <item>word</item>
      <item>excel</item>
      <item>task manager</item>
      <item>settings</item>
      <item>steam</item>
      <item>obs</item>
      <item>zoom</item>
      <item>cursor</item>
    </one-of>
  </rule>

  <rule id="search">
    <item>
      <one-of>
        <item>search for</item>
        <item>search</item>
        <item>google</item>
        <item>look up</item>
      </one-of>
      <ruleref uri="grammar:dictation"/>
    </item>
  </rule>

  <rule id="system">
    <one-of>
      <item>shut down</item>
      <item>shutdown</item>
      <item>shut down the computer</item>
      <item>restart</item>
      <item>restart the computer</item>
      <item>reboot</item>
      <item>lock</item>
      <item>lock the computer</item>
      <item>lock my computer</item>
      <item>lock my pc</item>
      <item>go to sleep</item>
      <item>sleep</item>
      <item>volume up</item>
      <item>volume down</item>
      <item>mute</item>
      <item>unmute</item>
    </one-of>
  </rule>

  <rule id="reminder">
    <item>
      <one-of>
        <item>remind me to</item>
        <item>set a reminder to</item>
        <item>reminder</item>
        <item>remind me</item>
      </one-of>
      <ruleref uri="grammar:dictation"/>
    </item>
  </rule>

  <rule id="memory">
    <one-of>
      <item>forget everything</item>
      <item>clear your memory</item>
      <item>clear memory</item>
      <item>remember that</item>
      <item>remember</item>
    </one-of>
  </rule>

  <rule id="freeform">
    <ruleref uri="grammar:dictation"/>
  </rule>

</grammar>`;

const PS_SCRIPT = `
param([string]$GrammarPath)

Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

# Load command grammar (high priority — very accurate for known phrases)
$cmdGrammar = New-Object System.Speech.Recognition.Grammar($GrammarPath)
$cmdGrammar.Name = "commands"
$cmdGrammar.Priority = 127
$recognizer.LoadGrammar($cmdGrammar)

# Also load dictation grammar (low priority — fallback for free-form)
$dictGrammar = New-Object System.Speech.Recognition.DictationGrammar
$dictGrammar.Name = "dictation"
$dictGrammar.Priority = 0
$recognizer.LoadGrammar($dictGrammar)

$recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1500)
$recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(2000)

Write-Output "::READY::"
[Console]::Out.Flush()

while ($true) {
    $cmd = [Console]::In.ReadLine()
    if ($cmd -eq "QUIT") { break }
    if ($cmd -ne "GO") { continue }

    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(4)

    try {
        $result = $recognizer.Recognize()

        if (-not $result -or -not $result.Text) {
            Write-Output "::NO_SPEECH::"
            [Console]::Out.Flush()
            continue
        }

        # If matched via command grammar, trust it at lower confidence
        $minConf = 0.5
        if ($result.Grammar.Name -eq "commands") {
            $minConf = 0.3
        }

        if ($result.Confidence -lt $minConf) {
            Write-Output "::NO_SPEECH::"
            [Console]::Out.Flush()
            continue
        }

        # For dictation results, filter low-confidence words
        $text = $result.Text
        if ($result.Grammar.Name -eq "dictation") {
            $goodWords = @()
            foreach ($w in $result.Words) {
                if ($w.Confidence -ge 0.4) {
                    $goodWords += $w.Text
                }
            }
            $text = ($goodWords -join " ").Trim()
        }

        if ($text.Length -ge 2) {
            Write-Output "::RESULT::$text"
        } else {
            Write-Output "::NO_SPEECH::"
        }
    } catch {
        Write-Output "::ERROR::$($_.Exception.Message)"
    }
    [Console]::Out.Flush()
}

$recognizer.Dispose()
`;

let grammarPath = null;
let scriptPath = null;

function writeFiles() {
  if (grammarPath) return;
  const tmpDir = os.tmpdir();
  grammarPath = path.join(tmpDir, 'axiom-commands.grxml');
  scriptPath = path.join(tmpDir, 'axiom-speech-engine.ps1');
  fs.writeFileSync(grammarPath, GRAMMAR_XML, 'utf8');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
}

function ensureEngine() {
  if (engine && !engine.killed) return;

  writeFiles();

  engine = spawn('powershell', [
    '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath, '-GrammarPath', grammarPath,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  engine.on('exit', () => {
    engine = null;
    listening = false;
  });

  engine.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error('[speech engine]', msg);
  });
}

function recognize() {
  return new Promise((resolve, reject) => {
    if (listening) return reject(new Error('Already listening'));

    ensureEngine();
    listening = true;

    let resolved = false;
    let outputBuffer = '';

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        listening = false;
        resolve({ text: null, error: 'timeout' });
      }
    }, 15000);

    const onData = (data) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('::READY::')) continue;

        if (line.startsWith('::RESULT::') && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          listening = false;
          engine.stdout.removeListener('data', onData);
          resolve({ text: line.replace('::RESULT::', ''), error: null });
        } else if (line === '::NO_SPEECH::' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          listening = false;
          engine.stdout.removeListener('data', onData);
          resolve({ text: null, error: 'no-speech' });
        } else if (line.startsWith('::ERROR::') && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          listening = false;
          engine.stdout.removeListener('data', onData);
          resolve({ text: null, error: line.replace('::ERROR::', '') });
        }
      }
    };

    engine.stdout.on('data', onData);
    engine.stdin.write('GO\n');
  });
}

function stopListening() {
  listening = false;
}

function shutdown() {
  if (engine && !engine.killed) {
    engine.stdin.write('QUIT\n');
    setTimeout(() => {
      if (engine && !engine.killed) engine.kill();
    }, 1000);
  }
}

module.exports = { recognize, stopListening, shutdown };
