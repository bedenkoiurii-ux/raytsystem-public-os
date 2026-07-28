#!/usr/bin/env python3
"""Схвалення підготованого run — щоб `promote` мав до чого прив'язатися.

Контур ingest вимагає ApprovalRecord, прив'язаний до хеша саме цього кандидата:
схвалення не можна ні перенести на інший матеріал, ні виписати наперед. Скрипт
читає staging підготованого run і складає такий запис.

  uv run python3 scripts/approve_run.py <run_id> [--root .] [--minutes 30]

Далі:  uv run raytsystem promote <run_id> --approval ops/approvals/incoming/<id>.json
"""
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from raytsystem.contracts.base import canonical_json_bytes, sha256_hex
from raytsystem.contracts.operations import ApprovalRecord, PromotionTxn


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id")
    ap.add_argument("--root", default=".", type=Path)
    ap.add_argument("--minutes", default=30, type=int, help="Скільки схвалення живе")
    ap.add_argument("--approver", default="iurii")
    args = ap.parse_args()

    root: Path = args.root.resolve()
    txn = PromotionTxn.model_validate(
        json.loads((root / "ops" / "staging" / args.run_id / "promotion_txn.json").read_text())
    )
    if txn.candidate_manifest_sha256 is None:
        print("Кандидат без хеша маніфесту — run не підготований до кінця.")
        return 1

    now = datetime.now(UTC)
    approval = ApprovalRecord.create(
        action="promote",
        target_id=txn.txn_id,
        artifact_sha256=txn.candidate_manifest_sha256,
        policy_version="1.0.0",
        policy_sha256=sha256_hex((root / "config" / "policies.yaml").read_bytes()),
        approver=args.approver,
        approved_at=now,
        expires_at=now + timedelta(minutes=args.minutes),
        scope=("real_corpus",),
    )
    out = root / "ops" / "approvals" / "incoming" / f"{approval.approval_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(canonical_json_bytes(approval))

    rel = out.relative_to(root)
    print(f"схвалення: {approval.approval_id} · дійсне {args.minutes} хв")
    print(f"uv run raytsystem promote {args.run_id} --approval {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
