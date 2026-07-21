#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Голосовий пульт Writer-Lab — розмова з Claude Code з телефона через приватну мережу Tailscale.

  телефон → запис голосу → whisper (локально, українською) → ТЕКСТ НА ПРАВКУ
          → claude -p (окрема нитка розмови) → відповідь текстом і голосом

Нічого не виходить за межі твоїх пристроїв: розпізнавання локальне, доступ лише з Tailscale.
Токен береться зі сховища ключів macOS і ніде не друкується.

  uv run --with fastapi --with uvicorn --with python-multipart python voice_console.py
"""
from __future__ import annotations

import ipaddress
import json
import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

PORT = 8792
TAILNET = ipaddress.ip_network("100.64.0.0/10")
TAILSCALE_BIN = Path("/Applications/Tailscale.app/Contents/MacOS/Tailscale")
WORKDIR = Path("/Users/Nemo/Writer-Lab")
WHISPER = Path("/opt/homebrew/bin/whisper-cli")
WHISPER_MODEL = Path.home() / ".cache/whisper.cpp/ggml-medium.bin"

# Словник проєкту як початкова підказка. Whisper різко краще впізнає власні назви, коли
# бачить їх наперед: без цього «Клод» ставав «Хайку», «Writer-Lab» — «врайтер лапом»,
# а «Боголюбський» — чим завгодно. Тримати короткою: ліміт — половина текстового контексту.
VOCABULARY = (
    "Клод, Опус, Writer-Lab, raytsystem, Юрій Беденко, бібліотека, картка, сутність, "
    "апарат розділу, конвеєр, досьє, ворота якості, аркуш рішень, шкала опори. "
    "Кров, Камінь на роздоріжжі, Андрій Боголюбський, Вишгородська ікона, Богдан "
    "Хмельницький, Петро Могила, Сильвестр Косів, Острог, Флорентійська унія, Третій Рим, "
    "Золота Орда, ярлик, митрополія, Геродот, андрофаги, Катинь, Голодомор. "
    "Tailscale, ollama, whisper, git, коміт, індекс, скрипт, промпт."
)
KEYCHAIN_SERVICE = "writer-lab-claude"
SESSION_FILE = Path.home() / ".writer-lab/pult-session"

# Пульт МАЄ ПРАВО ДІЯТИ в межах бібліотеки — інакше «а давай запустимо процес» неможливе,
# а саме заради цього він і робився. Було `plan` (читає, файлів не змінює) — звідси всі оті
# «я не можу, я не бачу», на які Юрій справедливо нарікав.
PERMISSION_MODE = "acceptEdits"

# `acceptEdits` приймає автоматично лише ПРАВКИ ФАЙЛІВ. Кожна команда в Bash упирається
# в запит дозволу — а біля телефона нікого немає, щоб його підтвердити, і запит повертається
# як відмова. У транскрипті це видно прямо: «Approve only if you trust it» замість результату.
# Тому Bash дозволяємо явно; заборони нижче однаково мають перевагу.
ALLOWED = ["Bash"]

# Межа проходить не по режиму, а по переліку заборон. Дозволено правити картки, запускати
# скрипти, збирати апарат, комітити локально. Заборонено те, що виходить назовні або
# незворотне: коло пульта нікого немає, щоб зупинити помилку.
FORBIDDEN = [
    "Bash(git push:*)",       # назовні — тільки за столом
    "Bash(rm:*)",             # видалення незворотне; для карантину є _trash/
    "Bash(rmdir:*)",
    "Bash(sudo:*)",
    "Bash(security:*)",       # сховище ключів
    "Bash(launchctl:*)",      # системні служби
]

# Пульт стартує НЕ з порожньою головою: читає той самий брифінг, що й сесія за столом.
# Без цього Юрій говорить не з нами, а з випадковим інтелектом, який нічого не знає
# про роботу — саме на це він і нарікав після першого тесту.
BRIEFING = """Ти — Claude Code у бібліотеці Writer-Lab, на зв'язку з Юрієм через голосовий пульт.
Він не за комп'ютером: відповідай стисло, по суті, без довгих лістингів.

ПЕРЕД ПЕРШОЮ ВІДПОВІДДЮ прочитай, у цьому порядку:
  Library/VAULT-INDEX.md
  Library/90-Meta/sessions/KNOWN-ISSUES.md
  Library/90-Meta/sessions/session-wip.md
  останній Library/90-Meta/sessions/HANDOFF_S*.md
Далі говори як людина, що в курсі справ, а не як довідкова служба.

Ти МАЄШ ПРАВО діяти: правити картки, запускати скрипти, збирати апарат, комітити локально.
Не можеш: пушити, видаляти файли, чіпати сховище ключів і системні служби.
Що зробив — дописуй у Library/90-Meta/sessions/session-wip.md, щоб сесія за столом побачила.

Питання Юрія:
"""

app = FastAPI(title="Голосовий пульт")


def claude_token() -> str:
    """Токен зі сховища ключів macOS. Ніде не логується й не повертається назовні."""
    result = subprocess.run(
        ["security", "find-generic-password", "-a", str(Path.home().name), "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True, timeout=10,
    )
    return result.stdout.strip()


@app.middleware("http")
async def only_local_or_tailnet(request, call_next):
    client = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(client)
        allowed = address.is_loopback or address in TAILNET
    except ValueError:
        allowed = False
    if not allowed:
        return JSONResponse(status_code=403, content={"error": "Доступ лише з приватної мережі."})
    return await call_next(request)


@app.post("/listen")
async def listen(audio: UploadFile = File(...)) -> JSONResponse:
    """Аудіо з браузера → 16 кГц моно WAV → whisper українською → текст."""
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "in"
        source.write_bytes(await audio.read())
        wav = Path(tmp) / "out.wav"
        convert = subprocess.run(
            ["ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
            capture_output=True, text=True, timeout=120,
        )
        if not wav.is_file():
            return JSONResponse(status_code=400, content={"error": "Не вдалось прочитати запис.", "detail": convert.stderr[-300:]})
        heard = subprocess.run(
            [str(WHISPER), "-m", str(WHISPER_MODEL), "-l", "uk", "-nt",
             "--prompt", VOCABULARY,      # словник проєкту — головний важіль точності
             "--carry-initial-prompt",    # тримати його на всіх шматках, а не лише на першому
             "-bs", "8", "-bo", "8",      # ширший пошук: повільніше, але точніше на власних назвах
             "-f", str(wav)],
            capture_output=True, text=True, timeout=600,
        )
    text = " ".join(line.strip() for line in heard.stdout.splitlines() if line.strip())
    return JSONResponse({"text": text})


@app.post("/ask")
async def ask(text: str = Form(...), session: str = Form("")) -> StreamingResponse:
    """Питання → claude -p у власній нитці розмови → відповідь ПОТОКОМ, у міру написання.

    Чекати мовчки кілька хвилин на телефоні нестерпно, тому віддаємо кожен шматок одразу.
    MCP-сервери вимкнені (--strict-mcp-config): пульту вони не потрібні, а на старті коштують часу.
    """
    # Брифінг — лише на першому запиті нитки; далі контекст уже всередині розмови.
    command = [
        "claude", "-p", (text if session else BRIEFING + text),
        "--permission-mode", PERMISSION_MODE,
        "--allowedTools", *ALLOWED,
        "--disallowedTools", *FORBIDDEN,
        "--strict-mcp-config",
        "--output-format", "stream-json",
        "--verbose",
    ]
    if session:
        command += ["--resume", session]

    def events():
        process = subprocess.Popen(
            command, cwd=str(WORKDIR), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, env={**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": claude_token()},
        )
        spoke = False
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = event.get("type")
            if kind == "system" and event.get("session_id"):
                yield json.dumps({"session": event["session_id"]}, ensure_ascii=False) + "\n"
            elif kind == "assistant":
                for block in (event.get("message") or {}).get("content") or []:
                    if block.get("type") == "text" and block.get("text"):
                        spoke = True
                        yield json.dumps({"delta": block["text"]}, ensure_ascii=False) + "\n"
                    elif block.get("type") == "tool_use":
                        yield json.dumps({"step": block.get("name", "")}, ensure_ascii=False) + "\n"
            elif kind == "result":
                # Нитка живе між перезапусками пульта: без цього кожне відкриття сторінки
                # з телефона починало розмову з нуля, і брифінг читався б щоразу заново.
                if event.get("session_id"):
                    try:
                        SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
                        SESSION_FILE.write_text(event["session_id"], encoding="utf-8")
                    except OSError:
                        pass
                if not spoke and event.get("result"):
                    yield json.dumps({"delta": event["result"]}, ensure_ascii=False) + "\n"
                if event.get("session_id"):
                    yield json.dumps({"session": event["session_id"]}, ensure_ascii=False) + "\n"
        process.wait()
        if process.returncode:
            detail = (process.stderr.read() or "")[-300:]
            yield json.dumps({"error": detail or "Обірвалось без пояснення."}, ensure_ascii=False) + "\n"
        yield json.dumps({"done": True}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


PAGE = """
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Пульт</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --line:#29313a; --ink:#e8e3d9; --muted:#8b95a1; --accent:#ddbb65; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  /* Два екрани й ряд кнопок між ними. Кнопки — на рівні бокової кнопки телефона,
     туди дістає великий палець, не закриваючи жодного з полів. Нічого зайвого. */
  body { margin:0; display:flex; flex-direction:column; gap:8px; height:100dvh;
         padding:10px 10px calc(10px + env(safe-area-inset-bottom)); background:var(--bg); color:var(--ink);
         font:16px/1.5 -apple-system,system-ui,sans-serif; }
  textarea { flex:0 0 28vh; width:100%; padding:12px; border:1px solid var(--line); border-radius:12px;
             background:var(--panel); color:var(--ink); font:inherit; resize:none; }
  .row { flex:0 0 auto; display:flex; gap:8px; }
  button { min-height:56px; border:1px solid var(--line); border-radius:12px; background:var(--panel);
           color:var(--ink); font:600 16px/1.2 inherit; }
  #send { flex:1; }
  #mic { flex:1.2; border-color:var(--accent); color:var(--accent); }
  #mic.rec { background:#3a2020; border-color:#ff7085; color:#ff7085; }
  button:disabled { opacity:.45; }
  #answer { flex:1 1 0; min-height:0; overflow:auto; padding:12px; border:1px solid var(--line);
            border-radius:12px; background:var(--panel); white-space:pre-wrap; }
</style>

<textarea id="text" placeholder="Тримай кнопку й говори — тут з'явиться розпізнане. Виправ, якщо треба, і надішли."></textarea>
<div class="row">
  <button id="send">Надіслати</button>
  <button id="mic">🎙 Тримай і говори</button>
</div>
<div id="answer"></div>

<script>
const mic=document.getElementById('mic'), text=document.getElementById('text'),
      answer=document.getElementById('answer'), send=document.getElementById('send');
let recorder, chunks=[], session='';
// Підхоплюємо нитку, збережену на сервері: розмова триває між відкриттями сторінки.
fetch('/session').then(r=>r.json()).then(d=>{ if(d.session) session=d.session; }).catch(()=>{});
// Стану окремим рядком не показуємо — його видно по самій кнопці й по полю відповіді.
const label = s => mic.textContent = s;

async function startRec(){
  const stream = await navigator.mediaDevices.getUserMedia({audio:true});
  recorder = new MediaRecorder(stream); chunks=[];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach(t=>t.stop());
    mic.classList.remove('rec'); mic.disabled=true; label('Розпізнаю…');
    const fd=new FormData(); fd.append('audio', new Blob(chunks), 'a.m4a');
    try{
      const r=await fetch('/listen',{method:'POST',body:fd});
      const d=await r.json();
      if(d.text) text.value=d.text;
    }catch(e){ answer.textContent='Не вдалось розпізнати запис.'; }
    mic.disabled=false; label('🎙 Тримай і говори');
  };
  recorder.start(); mic.classList.add('rec'); label('● Записую');
}
function stopRec(){ if(recorder && recorder.state==='recording') recorder.stop(); }

mic.addEventListener('touchstart', e=>{e.preventDefault(); startRec();});
mic.addEventListener('touchend',   e=>{e.preventDefault(); stopRec();});
mic.addEventListener('mousedown', startRec);
mic.addEventListener('mouseup',   stopRec);

// Мовчання на телефоні не відрізнити від поламаного зв'язку. Поки не пішов текст —
// цокає таймер із фазою й назвою поточної дії. Щойно з'явився перший шматок — таймер поступається тексту.
const mmss = s => Math.floor(s/60)+':'+String(s%60).padStart(2,'0');

send.onclick = async () => {
  const q=text.value.trim(); if(!q) return;
  send.disabled=true; send.textContent='Чекаю…';

  const t0=Date.now(); let step='', body='';
  const tick=()=>{
    if(body) return;
    const s=Math.round((Date.now()-t0)/1000);
    const phase = s<3   ? 'Надіслано, чекаю на відповідь'
                : s<180 ? 'Обмірковує — зазвичай 1–3 хв'
                : s<600 ? 'Довго думає — велике завдання, це нормально'
                :         'Дуже довго — на 15:00 обірветься саме';
    answer.textContent = phase + (step ? '\\nзараз: ' + step : '') + '\\n\\n' + mmss(s) + ' — не закривай сторінку';
  };
  tick(); const timer=setInterval(tick,1000);

  const fd=new FormData(); fd.append('text',q); fd.append('session',session);
  try{
    const r=await fetch('/ask',{method:'POST',body:fd});
    const reader=r.body.getReader(), dec=new TextDecoder();
    let buf='';
    for(;;){
      const {value,done}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\\n'); buf=lines.pop();
      for(const line of lines){
        if(!line.trim()) continue;
        let d; try{ d=JSON.parse(line); }catch(e){ continue; }
        if(d.session) session=d.session;
        if(d.step) step=d.step;
        if(d.delta){ body+=d.delta; answer.textContent=body; answer.scrollTop=answer.scrollHeight; }
        if(d.error && !body) answer.textContent='Обірвалось: '+d.error;
      }
    }
    if(!body && !answer.textContent.startsWith('Обірвалось')) answer.textContent='Порожня відповідь';
  }catch(e){ answer.textContent='Не вдалось зв.язатись — пульт на Mac не відповів.'; }
  clearInterval(timer); send.disabled=false; send.textContent='Надіслати';
};
</script>
"""


@app.get("/session")
async def current_session() -> JSONResponse:
    """Нитка розмови, збережена на диску: сторінка підхоплює її після перезавантаження."""
    try:
        return JSONResponse({"session": SESSION_FILE.read_text(encoding="utf-8").strip()})
    except OSError:
        return JSONResponse({"session": ""})


@app.get("/", response_class=HTMLResponse)
async def page() -> str:
    return PAGE


def tailnet_ip() -> str | None:
    command = [str(TAILSCALE_BIN)] if TAILSCALE_BIN.is_file() else ["tailscale"]
    try:
        out = subprocess.run([*command, "ip", "-4"], capture_output=True, text=True, timeout=5)
        candidate = out.stdout.strip().splitlines()[0].strip()
        return candidate if ipaddress.ip_address(candidate) in TAILNET else None
    except Exception:
        return None


CERT_DIR = Path.home() / ".writer-lab/certs"
CERT_NAME = "nemo.tail01f381.ts.net"

if __name__ == "__main__":
    import uvicorn

    address = tailnet_ip()
    certificate = CERT_DIR / "nemo.crt"
    key = CERT_DIR / "nemo.key"
    # HTTPS обов'язковий: Safari не дає доступ до мікрофона по звичайному http.
    secure = certificate.is_file() and key.is_file()
    if address:
        scheme = "https" if secure else "http"
        print(f"Пульт з телефона: {scheme}://{CERT_NAME if secure else address}:{PORT}", flush=True)
    if not secure:
        print("УВАГА: сертифіката немає — мікрофон у Safari не працюватиме.", flush=True)
    uvicorn.run(
        app,
        host="0.0.0.0" if address else "127.0.0.1",
        port=PORT,
        log_level="warning",
        ssl_certfile=str(certificate) if secure else None,
        ssl_keyfile=str(key) if secure else None,
    )
