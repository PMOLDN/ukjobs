"""
Score each occupation's AI exposure using an LLM.

Reads Markdown descriptions from pages/, sends each to a chat-completions
endpoint with a scoring rubric, and collects structured scores. Results are
cached incrementally to scores.json so the script can be resumed if
interrupted.

Providers:
- openrouter: uses OPENROUTER_API_KEY against https://openrouter.ai/api/v1
- ollama: uses a local Ollama OpenAI-compatible endpoint at
  http://localhost:11434/v1 by default

Usage:
    python score.py
    python score.py --provider openrouter --model google/gemini-3-flash-preview
    python score.py --provider ollama --model llama3.2
    python score.py --provider ollama --model llama3.2 --start 0 --end 10
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_OPENROUTER_MODEL = "google/gemini-3-flash-preview"
DEFAULT_OLLAMA_MODEL = "llama3.2"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"
OUTPUT_FILE = "scores.json"
MAX_PARSE_RETRIES = 3

SYSTEM_PROMPT = """\
You are an expert analyst evaluating how exposed different occupations are to \
AI. You will be given a detailed description of an occupation.

Rate the occupation's overall AI Exposure on a scale from 0 to 10.

AI Exposure measures: how much will AI reshape this occupation? Consider both \
direct effects (AI automating tasks currently done by humans) and indirect \
effects (AI making each worker so productive that fewer are needed).

A key signal is whether the job's work product is fundamentally digital. If \
the job can be done entirely from a home office on a computer - writing, \
coding, analyzing, communicating - then AI exposure is inherently high (7+), \
because AI capabilities in digital domains are advancing rapidly. Even if \
today's AI cannot handle every aspect of such a job, the trajectory is steep \
and the ceiling is very high. Conversely, jobs requiring physical presence, \
manual skill, or real-time human interaction in the physical world have a \
natural barrier to AI exposure.

Use these anchors to calibrate your score:

- 0-1: Minimal exposure. The work is almost entirely physical, hands-on, or \
requires real-time human presence in unpredictable environments. AI has \
essentially no impact on daily work. Examples: roofer, landscaper, \
commercial diver.

- 2-3: Low exposure. Mostly physical or interpersonal work. AI might help \
with minor peripheral tasks (scheduling, paperwork) but does not touch the \
core job. Examples: electrician, plumber, firefighter, dental hygienist.

- 4-5: Moderate exposure. A mix of physical/interpersonal work and knowledge \
work. AI can meaningfully assist with the information-processing parts but a \
substantial share of the job still requires human presence. Examples: \
registered nurse, police officer, veterinarian.

- 6-7: High exposure. Predominantly knowledge work with some need for human \
judgment, relationships, or physical presence. AI tools are already useful \
and workers using AI may be substantially more productive. Examples: teacher, \
manager, accountant, journalist.

- 8-9: Very high exposure. The job is almost entirely done on a computer. All \
core tasks - writing, coding, analyzing, designing, communicating - are in \
domains where AI is rapidly improving. The occupation faces major \
restructuring. Examples: software developer, graphic designer, translator, \
data analyst, paralegal, copywriter.

- 10: Maximum exposure. Routine information processing, fully digital, with \
no physical component. AI can already do most of it today. Examples: data \
entry clerk, telemarketer.

Respond with ONLY a JSON object in this exact format, no other text:
{
  "exposure": <0-10>,
  "rationale": "<2-3 sentences explaining the key factors>"
}\
"""


@dataclass
class ProviderConfig:
    provider: str
    model: str
    base_url: str
    api_url: str
    api_key: str | None
    timeout: float


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def parse_response_json(content: str) -> dict:
    """Extract a JSON object from a model response."""
    content = content.strip()

    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            raise ValueError(f"Model did not return JSON: {content[:200]}")
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError(f"Expected a JSON object, got: {type(parsed).__name__}")

    exposure = parsed.get("exposure")
    rationale = parsed.get("rationale")
    if not isinstance(exposure, int) or not 0 <= exposure <= 10:
        raise ValueError(f"Invalid exposure value: {exposure!r}")
    if not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("Missing rationale in model response")

    return {
        "exposure": exposure,
        "rationale": rationale.strip(),
    }


def resolve_config(args: argparse.Namespace) -> ProviderConfig:
    provider = args.provider

    if provider == "openrouter":
        model = args.model or os.getenv("OPENROUTER_MODEL") or DEFAULT_OPENROUTER_MODEL
        base_url = args.base_url or os.getenv("OPENROUTER_BASE_URL") or DEFAULT_OPENROUTER_BASE_URL
        api_key = args.api_key or os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise SystemExit(
                "OPENROUTER_API_KEY is required for --provider openrouter "
                "(or pass --api-key explicitly)."
            )
    else:
        model = args.model or os.getenv("OLLAMA_MODEL") or DEFAULT_OLLAMA_MODEL
        base_url = args.base_url or os.getenv("OLLAMA_BASE_URL") or DEFAULT_OLLAMA_BASE_URL
        api_key = args.api_key or os.getenv("OLLAMA_API_KEY")

    return ProviderConfig(
        provider=provider,
        model=model,
        base_url=normalize_base_url(base_url),
        api_url=f"{normalize_base_url(base_url)}/chat/completions",
        api_key=api_key,
        timeout=args.timeout,
    )


def ollama_tags_url(base_url: str) -> str:
    if base_url.endswith("/v1"):
        return f"{base_url[:-3]}/api/tags"
    return f"{base_url}/api/tags"


def resolve_ollama_model(client: httpx.Client, config: ProviderConfig) -> ProviderConfig:
    """Resolve short Ollama model aliases against installed local models."""
    if config.provider != "ollama":
        return config

    try:
        response = client.get(ollama_tags_url(config.base_url), timeout=config.timeout)
        response.raise_for_status()
        installed = [model["name"] for model in response.json().get("models", [])]
    except Exception:
        return config

    if not installed:
        raise SystemExit("No local Ollama models are installed. Run `ollama pull <model>` first.")

    if config.model in installed:
        return config

    matches = [name for name in installed if name == config.model or name.startswith(f"{config.model}:")]
    if len(matches) == 1:
        print(f"Resolved Ollama model {config.model} -> {matches[0]}")
        config.model = matches[0]
        return config

    installed_list = ", ".join(installed)
    raise SystemExit(
        f"Ollama model `{config.model}` was not found.\n"
        f"Installed models: {installed_list}"
    )


def score_occupation(client: httpx.Client, text: str, config: ProviderConfig) -> dict:
    """Send one occupation to the configured chat-completions endpoint."""
    headers = {}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"

    base_messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]

    last_error = None
    for attempt in range(1, MAX_PARSE_RETRIES + 1):
        messages = list(base_messages)
        if attempt > 1:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous reply was not valid JSON. "
                        "Return only a valid JSON object with double quotes and no markdown."
                    ),
                }
            )

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": 0.2,
            "stream": False,
            "max_tokens": 220,
        }
        if config.provider == "ollama":
            payload["response_format"] = {"type": "json_object"}

        response = client.post(
            config.api_url,
            headers=headers,
            json=payload,
            timeout=config.timeout,
        )
        response.raise_for_status()
        response_payload = response.json()
        content = response_payload["choices"][0]["message"]["content"]

        try:
            return parse_response_json(content)
        except Exception as exc:
            last_error = exc

    raise last_error if last_error else RuntimeError("Unknown scoring error")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--provider",
        choices=("openrouter", "ollama"),
        default=os.getenv("LLM_PROVIDER", "openrouter"),
        help="LLM backend to use.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model name. Defaults depend on the provider.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Override the API base URL. Example: http://localhost:11434/v1",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Override API key. Not required for local Ollama by default.",
    )
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=None)
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-score even if already cached",
    )
    args = parser.parse_args()

    config = resolve_config(args)

    with open("occupations.json", encoding="utf-8") as handle:
        occupations = json.load(handle)

    subset = occupations[args.start:args.end]
    current_dataset = occupations[0].get("dataset", "") if occupations else ""

    scores = {}
    if os.path.exists(OUTPUT_FILE) and not args.force:
        with open(OUTPUT_FILE, encoding="utf-8") as handle:
            for entry in json.load(handle):
                entry_dataset = entry.get("dataset", "")
                if current_dataset and entry_dataset != current_dataset:
                    continue
                scores[entry["slug"]] = entry

    errors = []
    client = httpx.Client()
    config = resolve_ollama_model(client, config)

    print(f"Scoring {len(subset)} occupations with provider={config.provider} model={config.model}")
    print(f"Endpoint: {config.api_url}")
    print(f"Already cached: {len(scores)}")

    for i, occ in enumerate(subset):
        slug = occ["slug"]

        if slug in scores:
            continue

        md_path = f"pages/{slug}.md"
        if not os.path.exists(md_path):
            print(f"  [{i+1}] SKIP {slug} (no markdown)")
            continue

        with open(md_path, encoding="utf-8") as handle:
            text = handle.read()

        print(f"  [{i+1}/{len(subset)}] {occ['title']}...", end=" ", flush=True)

        try:
            result = score_occupation(client, text, config)
            scores[slug] = {
                "slug": slug,
                "title": occ["title"],
                "dataset": current_dataset,
                "provider": config.provider,
                "model": config.model,
                **result,
            }
            print(f"exposure={result['exposure']}")
        except Exception as exc:
            print(f"ERROR: {exc}")
            errors.append(slug)

        with open(OUTPUT_FILE, "w", encoding="utf-8") as handle:
            json.dump(list(scores.values()), handle, indent=2)

        if i < len(subset) - 1:
            time.sleep(args.delay)

    client.close()

    print(f"\nDone. Scored {len(scores)} occupations, {len(errors)} errors.")
    if errors:
        print(f"Errors: {errors}")

    vals = [score for score in scores.values() if "exposure" in score]
    if vals:
        avg = sum(score["exposure"] for score in vals) / len(vals)
        by_score = {}
        for score in vals:
            bucket = score["exposure"]
            by_score[bucket] = by_score.get(bucket, 0) + 1
        print(f"\nAverage exposure across {len(vals)} occupations: {avg:.1f}")
        print("Distribution:")
        for key in sorted(by_score):
            print(f"  {key}: {'#' * by_score[key]} ({by_score[key]})")


if __name__ == "__main__":
    main()
