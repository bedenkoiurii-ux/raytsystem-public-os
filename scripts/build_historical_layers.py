#!/usr/bin/env python3
"""Історичні кордони для Мапи — зрізи по роках, обрізані до нашого регіону.

РІШЕННЯ ЮРІЯ (2026-07-28), яке скасовує попереднє «областей не малюємо»:
«Це ж не те, що буде наша якась вигадка. Це цілком абсолютно реальні історично
доведені речі, реальні історично існуючі карти.» Заперечення знімає не сам факт
існування атласів, а поле `BORDERPRECISION` у джерелі: воно каже, наскільки
кордон певний, і ми малюємо саме цю певність, а не рівну лінію на око.

Джерело: `aourednik/historical-basemaps`, GPL-3.0 — 53 зрізи від −123000 до
сьогодні, з полями NAME, SUBJECTO, PARTOF, BORDERPRECISION (1 приблизний,
2 помірно точний, 3 визначений правом).

Сирий світовий зріз — близько 1 МБ; після обрізання до Європи, Причорномор'я
й Волги лишається ~235 КБ і 52 об'єкти замість 264. Геометрію ще й прорідили:
на масштабі століть різниця невидима, а вага бандла втричі менша.

  uv run python3 scripts/build_historical_layers.py --out web/src/features/historical
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson"
# Роки, які покривають «Камінь»: від Геродота до розділів про імперію.
YEARS = [-500, -323, -100, 100, 400, 700, 900, 1000, 1100, 1200, 1279,
         1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1783, 1800]
# Світ: розповідь виходить далеко за Європу — вікінги на півночі, Візантія
# й Африка на півдні, ГУЛАГ до Колими на сході (Юрій, 2026-07-29). Обрізання
# до Європи лишало на мапі саму лише київську оптику.
BOX = (-180.0, -60.0, 180.0, 84.0)
TOLERANCE = 0.15          # градуси: світовий обсяг вимагає грубшого кроку


def name_for(year: int) -> str:
    return f"world_bc{-year}.geojson" if year < 0 else f"world_{year}.geojson"


def inside(coords) -> bool:
    if isinstance(coords[0], (int, float)):
        return BOX[0] <= coords[0] <= BOX[2] and BOX[1] <= coords[1] <= BOX[3]
    return any(inside(item) for item in coords)


def thin(ring: list, tolerance: float) -> list:
    """Проріджування за відстанню — дешевше за Дугласа-Пекера й тут достатнє.

    Точку лишаємо, якщо вона відійшла від попередньої лишеної далі, ніж на
    tolerance. Перша й остання лишаються завжди, щоб кільце не розімкнулось.
    """
    if len(ring) <= 4:
        return ring
    out = [ring[0]]
    for point in ring[1:-1]:
        last = out[-1]
        if abs(point[0] - last[0]) > tolerance or abs(point[1] - last[1]) > tolerance:
            out.append(point)
    out.append(ring[-1])
    return out if len(out) >= 4 else ring


def simplify(geometry: dict) -> dict | None:
    kind = geometry.get("type")
    if kind == "Polygon":
        rings = [thin(r, TOLERANCE) for r in geometry["coordinates"]]
        rings = [r for r in rings if len(r) >= 4]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if kind == "MultiPolygon":
        polys = []
        for poly in geometry["coordinates"]:
            rings = [thin(r, TOLERANCE) for r in poly]
            rings = [r for r in rings if len(r) >= 4]
            if rings:
                polys.append(rings)
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    index = []
    for year in YEARS:
        url = f"{BASE}/{name_for(year)}"
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                data = json.loads(response.read())
        except Exception as error:                       # мережа або нема зрізу
            print(f"  {year}: пропущено ({error})")
            continue
        features = []
        for feature in data.get("features", []):
            geometry = feature.get("geometry")
            if not geometry or not geometry.get("coordinates"):
                continue
            if not inside(geometry["coordinates"]):
                continue
            simplified = simplify(geometry)
            if simplified is None:
                continue
            props = feature.get("properties", {})
            features.append({
                "type": "Feature",
                "geometry": simplified,
                "properties": {
                    "name": props.get("NAME"),
                    "part_of": props.get("PARTOF"),
                    "subject_to": props.get("SUBJECTO"),
                    # Головне поле: 1 приблизний · 2 помірно точний · 3 за правом.
                    # Саме воно перетворює штриховку з декорації на свідчення.
                    "precision": props.get("BORDERPRECISION"),
                },
            })
        payload = json.dumps({"year": year, "features": features},
                             ensure_ascii=False, separators=(",", ":"))
        path = args.out / f"{'bc' if year < 0 else ''}{abs(year)}.json"
        path.write_text(payload, encoding="utf-8")
        index.append({"year": year, "file": path.name, "count": len(features)})
        print(f"  {year:>6}: {len(features):>3} обʼєктів · {len(payload) // 1024} КБ")

    (args.out / "index.json").write_text(
        json.dumps({
            "source": "aourednik/historical-basemaps",
            "licence": "GPL-3.0",
            "note": "Кордони з історичного атласу; precision 1–3 — певність межі.",
            "slices": index,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum((args.out / s["file"]).stat().st_size for s in index) // 1024
    print(f"\nзрізів: {len(index)} · разом {total} КБ · {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
