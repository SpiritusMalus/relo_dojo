"""App configuration, loaded from environment / .env."""

import os

from dotenv import load_dotenv

load_dotenv()  # reads backend/.env if present

# Ollama server (runs on the backend host, not the phone).
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
# Model name — set in .env to whatever you `ollama pull`ed (e.g. llama3.2, mistral).
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
