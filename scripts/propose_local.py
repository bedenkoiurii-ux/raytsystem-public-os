#!/usr/bin/env python3
"""Поверх 1 конвеєра знань: локальна модель формулює твердження з сегментів.

Апстрімовий пропонувальник — заглушка: бере перший сегмент і кладе його текст
у claim дослівно. Абзац тексту не є твердженням: «Бо коли Захід учиться жити
без імператора…» — це проза, а твердження в ній треба сформулювати.

**Чому локальна модель, а не хмарна.** Контур вимагає, щоб відповідь була
відтворюваною побітово: `ingestion.py` перераховує `proposal_response_id` із
хеша запиту й самих пропозицій. Локальна модель із фіксованими вагами,
`temperature=0` і сталим seed це дає; хмарну постачальник підмінить під тим
самим іменем — і вся минула робота перестане звірятися.

**Межа поверху.** Модель формулює, ЩО стверджує фрагмент, і не більше. Вона
не оцінює істинність, не шукає джерел, не присвоює статус за шкалою опори —
це судження, поверх 2, робота Claude. Модель не має інтернету за побудовою.

  uv run python3 scripts/propose_local.py <run_id> --root ~/Writer-Lab/Library
  … --limit 12        # пробний прогін на частині сегментів
  … --dry             # показати, нічого не записуючи

Далі:  raytsystem proposal import <run_id> ops/staging/<run_id>/proposal_response.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from raytsystem.contracts.base import (  # noqa: E402
    ComponentRef,
    ProducerKind,
    ProducerRef,
    RecordRef,
    canonical_json_bytes,
    derive_id,
    sha256_hex,
)
from raytsystem.contracts.proposals import (  # noqa: E402
    ProposalItem,
    ProposalRequest,
    ProposalResponse,
)

HOST = "http://127.0.0.1:11434"
MODEL = "qwen2.5:32b"
BATCH = 6
SKIP = "ПРОПУСК"

PROMPT = f"""Ти працюєш із текстом української книги про історію. Для кожного
фрагмента визнач, ЩО він стверджує про світ, і сформулюй це одним реченням
українською.

Правила:
- Формулюй твердження, а не переказ: «Київська митрополія лишалася під
  Константинополем до 1686 року», а не «У тексті йдеться про митрополію».
- Нічого не додавай від себе. Якщо у фрагменті немає дати, не вигадуй її.
- Якщо фрагмент не містить твердження про світ — риторичний перехід,
  звертання, питання, заголовок, уривок фрази — відповідай {SKIP}.
- Одна відповідь на один фрагмент, у тому самому порядку.

Формат відповіді — рівно по одному рядку на фрагмент, у вигляді:
<номер>. <твердження або {SKIP}>
"""


def ask(fragments: list[tuple[int, str]]) -> dict[int, str]:
    body = "\n\n".join(f"{n}. {text}" for n, text in fragments)
    payload = {
        "model": MODEL,
        "prompt": f"{PROMPT}\n\nФрагменти:\n\n{body}\n\nВідповідь:\n",
        "stream": False,
        # Детермінізм — вимога контуру, не побажання.
        "options": {"temperature": 0, "seed": 42, "num_ctx": 32768},
    }
    request = urllib.request.Request(
        f"{HOST}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        answer = json.loads(response.read())["response"]
    out: dict[int, str] = {}
    for line in answer.splitlines():
        m = re.match(r"\s*(\d+)[.)]\s*(.+)$", line.strip())
        if m:
            out[int(m.group(1))] = m.group(2).strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id")
    ap.add_argument("--root", default=".", type=Path)
    ap.add_argument("--limit", type=int, default=0, help="скільки сегментів узяти")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    staging = args.root.resolve() / "ops" / "staging" / args.run_id
    pack = json.loads((staging / "evidence_pack.json").read_text(encoding="utf-8"))
    request = ProposalRequest.model_validate(
        json.loads((staging / "proposal_request.json").read_text(encoding="utf-8"))
    )
    items_in = pack["items"][: args.limit] if args.limit else pack["items"]
    print(f"сегментів: {len(items_in)} · модель: {MODEL}")

    statements: dict[str, str] = {}
    for start in range(0, len(items_in), BATCH):
        chunk = items_in[start : start + BATCH]
        numbered = [(i + 1, item["excerpt"]) for i, item in enumerate(chunk)]
        try:
            answers = ask(numbered)
        except (urllib.error.URLError, TimeoutError) as error:
            print(f"Ollama недоступна: {error}")
            return 1
        for i, item in enumerate(chunk):
            text = answers.get(i + 1, "")
            if text and SKIP not in text.upper():
                statements[item["segment_id"]] = text
        done = min(start + BATCH, len(items_in))
        print(f"  {done}/{len(items_in)} · тверджень {len(statements)}", flush=True)

    if not statements:
        print("Модель не сформулювала жодного твердження — нічого імпортувати.")
        return 1

    proposals = tuple(
        ProposalItem(
            proposal_item_id=derive_id(
                "pitem",
                {"request_id": request.proposal_request_id, "segment_id": segment_id},
            ),
            kind="claim",
            payload={"statement": statement, "language": "uk"},
            evidence_ids=(segment_id,),
        )
        for segment_id, statement in statements.items()
    )
    request_sha = sha256_hex(canonical_json_bytes(request))
    response = ProposalResponse(
        proposal_response_id=derive_id(
            "pres", {"request_sha256": request_sha, "items": list(proposals)}
        ),
        request_ref=RecordRef(
            kind="proposal_request",
            id=request.proposal_request_id,
            object_sha256=request_sha,
        ),
        producer=ProducerRef(
            kind=ProducerKind.KERNEL,
            component=ComponentRef(
                name=f"local_{MODEL.replace(':', '_')}",
                version="1.0.0",
                config_sha256=sha256_hex(
                    canonical_json_bytes({"temperature": 0, "seed": 42, "prompt": PROMPT})
                ),
            ),
        ),
        allowed_evidence_ids=request.allowed_evidence_ids,
        proposed_items=proposals,
        created_at=request.created_at,
    )

    print(f"\nтверджень: {len(proposals)} з {len(items_in)} сегментів")
    for item in proposals[:3]:
        print(f"  • {item.payload['statement'][:100]}")
    if args.dry:
        return 0

    out = staging / "proposal_response.json"
    out.write_bytes(canonical_json_bytes(response))
    rel = out.relative_to(args.root.resolve())
    print(f"\nuv run raytsystem proposal import {args.run_id} {rel} --root .")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
