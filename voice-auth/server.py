"""
AXIOM Voice Authentication Server
Local speaker verification — no external APIs.
Runs on http://localhost:8080
"""

import os
import io
import json
import pickle
import tempfile
import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from flask import Flask, request, jsonify
from speechbrain.inference.speaker import EncoderClassifier

# ── Config ────────────────────────────────────────────────────
PORT            = 8080
MODEL_SOURCE    = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_DIR       = os.path.join(os.path.dirname(__file__), "models", "ecapa")
EMBEDDING_FILE  = os.path.join(os.path.dirname(__file__), "enrolled_voice.pkl")
THRESHOLD       = 0.75   # cosine similarity threshold (0–1). Raise to be stricter.
TARGET_SR       = 16000

app = Flask(__name__)

# ── Model (loaded once at startup) ────────────────────────────
print("[AXIOM Voice Auth] Loading speaker model…")
classifier = EncoderClassifier.from_hparams(
    source=MODEL_SOURCE,
    savedir=MODEL_DIR,
    run_opts={"device": "cpu"},
)
print("[AXIOM Voice Auth] Model ready.")

# ── Stored voice embedding ─────────────────────────────────────
enrolled_embedding = None

def load_enrolled():
    global enrolled_embedding
    if os.path.exists(EMBEDDING_FILE):
        with open(EMBEDDING_FILE, "rb") as f:
            enrolled_embedding = pickle.load(f)
        print(f"[AXIOM Voice Auth] Enrolled voice loaded ({EMBEDDING_FILE})")
    else:
        print("[AXIOM Voice Auth] No enrolled voice found — run enroll.py first.")

load_enrolled()


# ── Audio helpers ──────────────────────────────────────────────

def bytes_to_tensor(audio_bytes: bytes) -> torch.Tensor:
    """Load raw audio bytes (WAV/WebM/etc.) → 16kHz mono tensor."""
    try:
        signal, sr = sf.read(io.BytesIO(audio_bytes))
    except Exception:
        # Try writing to temp file if soundfile can't handle the buffer
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        signal, sr = sf.read(tmp_path)
        os.unlink(tmp_path)

    # Mono
    if signal.ndim > 1:
        signal = signal.mean(axis=1)

    # Resample to 16kHz if needed
    if sr != TARGET_SR:
        import torchaudio
        waveform = torch.tensor(signal, dtype=torch.float32).unsqueeze(0)
        waveform = torchaudio.functional.resample(waveform, sr, TARGET_SR)
        signal = waveform.squeeze(0).numpy()

    return torch.tensor(signal, dtype=torch.float32).unsqueeze(0)  # [1, samples]


def get_embedding(audio_tensor: torch.Tensor) -> torch.Tensor:
    """Return L2-normalised speaker embedding for audio tensor."""
    with torch.no_grad():
        lengths = torch.tensor([1.0])
        emb = classifier.encode_batch(audio_tensor, lengths)  # [1, 1, 192]
        emb = emb.squeeze()                                    # [192]
        emb = F.normalize(emb, dim=0)
    return emb


# ── Routes ─────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "enrolled": enrolled_embedding is not None,
        "threshold": THRESHOLD,
    })


@app.route("/verify", methods=["POST"])
def verify():
    """
    POST /verify
    Body: raw audio file (WAV preferred, 16kHz mono ideal)
    Returns: { "verified": bool, "score": float, "threshold": float }
    """
    if enrolled_embedding is None:
        return jsonify({"error": "No enrolled voice. Run enroll.py first."}), 503

    audio_bytes = request.get_data()
    if not audio_bytes:
        return jsonify({"error": "No audio data received."}), 400

    try:
        tensor = bytes_to_tensor(audio_bytes)
        emb    = get_embedding(tensor)
        score  = float(F.cosine_similarity(emb.unsqueeze(0), enrolled_embedding.unsqueeze(0)))
        verified = score >= THRESHOLD
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500

    return jsonify({
        "verified":  verified,
        "score":     round(score, 4),
        "threshold": THRESHOLD,
    })


@app.route("/enroll", methods=["POST"])
def enroll():
    """
    POST /enroll
    Body: multipart/form-data with one or more audio files (field: 'samples')
    Saves the mean embedding and reloads it into memory.
    """
    files = request.files.getlist("samples")
    if not files:
        return jsonify({"error": "No audio samples provided."}), 400

    embeddings = []
    for f in files:
        try:
            audio_bytes = f.read()
            tensor = bytes_to_tensor(audio_bytes)
            emb    = get_embedding(tensor)
            embeddings.append(emb)
        except Exception as ex:
            return jsonify({"error": f"Failed to process sample: {ex}"}), 500

    mean_emb = torch.stack(embeddings).mean(dim=0)
    mean_emb = F.normalize(mean_emb, dim=0)

    os.makedirs(os.path.dirname(EMBEDDING_FILE), exist_ok=True)
    with open(EMBEDDING_FILE, "wb") as f:
        pickle.dump(mean_emb, f)

    load_enrolled()

    return jsonify({
        "enrolled":      True,
        "samples_used":  len(embeddings),
        "embedding_dim": mean_emb.shape[0],
    })


@app.route("/threshold", methods=["POST"])
def set_threshold():
    """POST /threshold  body: { "value": 0.80 }"""
    global THRESHOLD
    data = request.get_json(silent=True) or {}
    val  = data.get("value")
    if val is None or not (0 < val <= 1):
        return jsonify({"error": "Provide { value: 0.0–1.0 }"}), 400
    THRESHOLD = float(val)
    return jsonify({"threshold": THRESHOLD})


# ── Entry point ────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[AXIOM Voice Auth] Starting on http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
