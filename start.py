"""
start.py — single-command launcher for AI Benchmarking Dashboard

Usage:
    python start.py

Starts the FastAPI backend (port 8000) and the Vite frontend (port 5173)
in parallel, streams their output with prefixes, and shuts both down cleanly
on Ctrl+C.
"""

import os
import signal
import subprocess
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")

CYAN    = "\033[96m"
MAGENTA = "\033[95m"
YELLOW  = "\033[93m"
GREEN   = "\033[92m"
RESET   = "\033[0m"
BOLD    = "\033[1m"


def stream(proc, label, color):
    """Forward a process's stdout/stderr to the console with a colored prefix."""
    prefix = f"{color}{BOLD}[{label}]{RESET} "
    for line in iter(proc.stdout.readline, b""):
        sys.stdout.write(prefix + line.decode(errors="replace"))
        sys.stdout.flush()


def check_deps():
    """Warn if node_modules or pip packages look missing."""
    nm = os.path.join(FRONTEND_DIR, "node_modules")
    if not os.path.isdir(nm):
        print(f"{YELLOW}[setup]{RESET} frontend/node_modules not found — run: npm install (inside frontend/)")
    try:
        import fastapi  # noqa: F401
    except ImportError:
        print(f"{YELLOW}[setup]{RESET} Python deps missing — run: pip install -r requirements.txt")


def main():
    check_deps()

    print(f"\n{BOLD}AI Benchmarking Dashboard{RESET}")
    print(f"  {CYAN}backend{RESET}  → http://localhost:8000")
    print(f"  {MAGENTA}frontend{RESET} → http://localhost:5173")
    print(f"  Press {BOLD}Ctrl+C{RESET} to stop both.\n")

    backend_cmd  = [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"]
    frontend_cmd = ["npm", "run", "dev"]

    # On Windows, npm needs shell=True
    shell = sys.platform == "win32"

    backend = subprocess.Popen(
        backend_cmd,
        cwd=BACKEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    frontend = subprocess.Popen(
        frontend_cmd,
        cwd=FRONTEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=shell,
    )

    procs = [backend, frontend]

    threading.Thread(target=stream, args=(backend,  "backend",  CYAN),    daemon=True).start()
    threading.Thread(target=stream, args=(frontend, "frontend", MAGENTA), daemon=True).start()

    def shutdown(sig=None, frame=None):
        print(f"\n{YELLOW}Shutting down…{RESET}")
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Wait — exit if either process dies unexpectedly
    while True:
        for p in procs:
            if p.poll() is not None:
                print(f"\n{YELLOW}A process exited unexpectedly (code {p.returncode}). Stopping.{RESET}")
                shutdown()
        threading.Event().wait(1)


if __name__ == "__main__":
    main()
