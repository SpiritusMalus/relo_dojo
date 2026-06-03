"""App configuration, loaded from environment / .env."""

import os

from dotenv import load_dotenv

load_dotenv()  # reads backend/.env if present

# Ollama server (runs on the backend host, not the phone).
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
# Model name — set in .env to whatever you `ollama pull`ed (e.g. gemma3:12b, qwen3.5:9b).
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")

# Generation temperature: higher = more varied, lower = more deterministic.
# Exercises want variety; answer checking wants consistent, repeatable verdicts.
EXERCISE_TEMPERATURE = float(os.getenv("EXERCISE_TEMPERATURE", "0.7"))
CHECK_TEMPERATURE = float(os.getenv("CHECK_TEMPERATURE", "0.2"))
