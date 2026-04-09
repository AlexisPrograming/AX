"""
AXIOM Voice Enrollment Script
Records multiple samples of your voice and sends them to the server for enrollment.
Run ONCE before using voice auth.

Usage:
    python enroll.py                  # interactive recording (microphone)
    python enroll.py --files a.wav b.wav c.wav   # use existing WAV files
"""

import argparse
import sys
import os
import time
import io
import wave
import struct
import requests

SERVER = "http://localhost:8080"
SAMPLE_RATE  = 16000
CHANNELS     = 1
CHUNK        = 1024
RECORD_SECS  = 5   # seconds per sample
NUM_SAMPLES  = 5   # how many samples to record


def record_sample(index: int, seconds: int) -> bytes:
    """Record `seconds` of audio from the default microphone. Returns WAV bytes."""
    try:
        import pyaudio
    except ImportError:
        print("pyaudio not installed. Run:  pip install pyaudio")
        sys.exit(1)

    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )

    print(f"\n[{index}/{NUM_SAMPLES}] Speak naturally for {seconds} seconds…  (3-2-1)")
    for i in (3, 2, 1):
        print(f"  {i}…"); time.sleep(1)
    print("  🔴 RECORDING")

    frames = []
    total  = int(SAMPLE_RATE / CHUNK * seconds)
    for _ in range(total):
        frames.append(stream.read(CHUNK, exception_on_overflow=False))

    stream.stop_stream(); stream.close(); pa.terminate()
    print("  ✅ Done")

    # Pack into WAV bytes
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b"".join(frames))
    buf.seek(0)
    return buf.read()


def enroll_from_mic():
    print("=" * 50)
    print("  AXIOM Voice Enrollment")
    print("  Speak naturally — say anything you like.")
    print("=" * 50)

    samples = []
    for i in range(1, NUM_SAMPLES + 1):
        wav_bytes = record_sample(i, RECORD_SECS)
        samples.append(("samples", (f"sample_{i}.wav", wav_bytes, "audio/wav")))
        time.sleep(0.5)

    print("\nSending samples to server…")
    send_enrollment(samples)


def enroll_from_files(paths: list):
    print(f"Enrolling from {len(paths)} file(s)…")
    samples = []
    for p in paths:
        if not os.path.exists(p):
            print(f"File not found: {p}")
            continue
        with open(p, "rb") as f:
            samples.append(("samples", (os.path.basename(p), f.read(), "audio/wav")))
    if not samples:
        print("No valid files.")
        sys.exit(1)
    send_enrollment(samples)


def send_enrollment(samples: list):
    try:
        r = requests.post(f"{SERVER}/enroll", files=samples, timeout=60)
        data = r.json()
    except Exception as ex:
        print(f"Error connecting to server: {ex}")
        print("Make sure server.py is running.")
        sys.exit(1)

    if "error" in data:
        print(f"Server error: {data['error']}")
        sys.exit(1)

    print("\n✅ Enrollment complete!")
    print(f"   Samples used:  {data['samples_used']}")
    print(f"   Embedding dim: {data['embedding_dim']}")
    print("\nYou can now start using voice authentication.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AXIOM Voice Enrollment")
    parser.add_argument("--files", nargs="+", help="Existing WAV files to use instead of recording")
    parser.add_argument("--samples", type=int, default=NUM_SAMPLES, help=f"Number of samples to record (default: {NUM_SAMPLES})")
    parser.add_argument("--seconds", type=int, default=RECORD_SECS, help=f"Seconds per sample (default: {RECORD_SECS})")
    args = parser.parse_args()

    NUM_SAMPLES = args.samples
    RECORD_SECS = args.seconds

    # Quick health check
    try:
        r = requests.get(f"{SERVER}/health", timeout=5)
        print(f"Server OK — enrolled: {r.json().get('enrolled', False)}")
    except Exception:
        print("Cannot reach server. Start it first:  python server.py")
        sys.exit(1)

    if args.files:
        enroll_from_files(args.files)
    else:
        enroll_from_mic()
