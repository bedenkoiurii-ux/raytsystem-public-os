"""Мапа сюжетів — географія розповіді, а не список точок.

ЗАДУМ ЮРІЯ (2026-07-27): «Тема розгортається в кількох вимірах. Вона бере
початок в одній географічній точці, набуває розвитку в іншій, а закінчується
в третій. Ліворуч мапа, праворуч перелік подій, згорнутих у назву або часовий
проміжок; під назвою — реперні точки: рік, місце, що сталося. І пунктирні
лінії, які зв'язують, а також стрілки — вектори розвитку в часі й просторі.»

**Сюжет = документ**, до якого прив'язані події: розділ книги, епізод фільму,
MOC. Окремого поля не заводимо — розділ уже є одиницею розповіді, і зв'язок
уже існує: картка події має секцію «## Згадується в» з вікілінком на документ.
Той самий механізм, яким `build_apparatus.py` збирає апарат.

**Місце події — поле `place:`**, не вікілінки з тіла. Вікілінк може бути
порівнянням: картка «Чорнобильська катастрофа» згадує [[Катинь]] як приклад
тієї самої державної брехні — і мапа ставила туди точку аварії. `place:` каже
буквально, де це сталося.

**Маршрут події.** У `place:` автор часто пише не точку, а рух: «Київ →
Володимир-на-Клязьмі → Москва», «Вискулі (Біловезька пуща) — Москва». Ми
шукаємо в рядку всі відомі місця **в порядку появи** — це і є вектор події.

**Областей не малюємо.** Рішення Юрія: «Області точно не малюємо і обводити
їх теж не потрібно. Ніколи нічим.» Контурів історичних територій у бібліотеці
немає, а домальовувати кордони на око — вигадана географія з виглядом факту.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends

from raytsystem.documents.index import DocumentIndex
from raytsystem.documents import load_document_config

ENTITY_INDEX = "90-Meta/entity-index.json"
PLACES = "30-Research/Places"
EVENTS = "30-Research/Events"
# Періоди не вигадуємо — беремо ті, що вже виписані в бібліотеці: хроніки й
# дослідження за десятиліттями (1917–2019). Для давнішої історії періодів
# у матеріалі немає, там одиницею розповіді лишається розділ книги.
PERIOD_HINTS = ("хронік", "дослідж", "макроподі", "період", "доба", "епоха")
MIN_NAME = 4          # коротші назви ловлять випадкові підрядки


def _front(text: str) -> str:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return m.group(1) if m else ""


def _field(fm: str, key: str) -> str:
    m = re.search(rf"^{key}:\s*(.+?)$", fm, re.M)
    return m.group(1).strip().strip("'\"") if m else ""


def _list_field(fm: str, key: str) -> list[str]:
    m = re.search(rf"^{key}:\s*\n((?:\s*-\s*.+\n)+)", fm, re.M)
    return [x.strip().strip("'\"") for x in re.findall(r"-\s*(.+)", m.group(1))] if m else []


def _mentions(body: str) -> list[str]:
    """Документи, до яких прив'язана картка — секція «## Згадується в»."""
    m = re.search(r"^## Згадується в\s*\n(.*?)(?=\n## |\Z)", body, re.S | re.M)
    if not m:
        return []
    return [x.strip() for x in re.findall(r"\[\[([^\]|#]+)", m.group(1))]


def create_map_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    index = DocumentIndex(root, config=load_document_config(root))

    def _doc_id(relative: str) -> str | None:
        """Шлях → document_id. Маршрут /documents приймає ТІЛЬКИ id: без цього
        клік «відкрити картку» веде в порожній екран (оплачено)."""
        try:
            row = index.row_for_path(relative)
        except Exception:
            return None
        return str(row["document_id"]) if row else None

    _index_cache: dict[str, Any] = {"mtime": 0.0, "data": None}

    def _entity_index() -> dict[str, Any]:
        """Індекс імен → uid. Перечитуємо лише коли файл змінився.

        Побудований `entity_index.py` із трьох джерел: title, aliases і форм
        з посилань `[[Ціль|як стоїть у реченні]]` — 1 855 таких по бібліотеці.
        Це словник відмінків, який автор писав роками, ніколи не збираючи.
        """
        path = root / ENTITY_INDEX
        if not path.is_file():
            return {"cards": {}, "forms": {}}
        stamp = path.stat().st_mtime
        if _index_cache["data"] is None or stamp != _index_cache["mtime"]:
            try:
                _index_cache["data"] = json.loads(path.read_text(encoding="utf-8"))
                _index_cache["mtime"] = stamp
            except (OSError, ValueError):
                return {"cards": {}, "forms": {}}
        return _index_cache["data"]

    def _by_index(name: str) -> tuple[Path | None, list[dict[str, str]]]:
        """Шлях за будь-якою формою імені. Неоднозначність не вгадуємо —
        повертаємо варіанти, хай обирає читач."""
        index = _entity_index()
        key = re.sub(r"\s+", " ", unicodedata.normalize("NFC", name)).strip().lower()
        uids = index.get("forms", {}).get(key) or []
        cards = index.get("cards", {})
        if len(uids) == 1 and uids[0] in cards:
            return root / cards[uids[0]]["path"], []
        if len(uids) > 1:
            return None, [{"uid": u, "title": cards[u]["title"], "path": cards[u]["path"]}
                          for u in uids if u in cards]
        return None, []

    def _places() -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
        """Канонічні місця з координатами + індекс «будь-яка назва → канон»."""
        canon: dict[str, dict[str, Any]] = {}
        alias: dict[str, str] = {}
        base = root / PLACES
        if not base.is_dir():
            return canon, alias
        for path in sorted(base.glob("*.md")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            fm = _front(text)
            coords = re.search(r"^coordinates:\s*\n\s*-\s*([\d.-]+)\s*\n\s*-\s*([\d.-]+)", fm, re.M)
            if not coords:
                continue
            name = _field(fm, "title") or path.stem
            canon[name] = {
                "title": name,
                "lat": float(coords.group(1)),
                "lon": float(coords.group(2)),
                "path": str(path.relative_to(root)),
                "document_id": _doc_id(str(path.relative_to(root))),
            }
            for variant in [name, path.stem, *_list_field(fm, "aliases")]:
                if len(variant) >= MIN_NAME:
                    alias.setdefault(variant, name)
        return canon, alias

    def _route(place_line: str, alias: dict[str, str]) -> list[str]:
        """Місця в рядку `place:` у порядку появи — маршрут події."""
        found: list[tuple[int, str]] = []
        seen: set[str] = set()
        for variant, name in alias.items():
            at = place_line.find(variant)
            if at < 0 or name in seen:
                continue
            seen.add(name)
            found.append((at, name))
        found.sort()
        return [name for _, name in found]

    def _periods() -> list[dict[str, Any]]:
        found = []
        for path in sorted(root.rglob("*.md")):
            parts = set(path.relative_to(root).parts)
            if {".git", "graphify-out", "90-Meta"} & parts:
                continue
            head = path.read_text(encoding="utf-8", errors="ignore")[:1400]
            fm = _front(head)
            start, end = _field(fm, "time_start"), _field(fm, "time_end")
            if not (re.fullmatch(r"-?\d+", start or "") and re.fullmatch(r"-?\d+", end or "")):
                continue
            if _field(fm, "time_kind") == "life" or int(end) - int(start) < 5:
                continue
            title = _field(fm, "title") or path.stem
            if not any(h in title.lower() for h in PERIOD_HINTS):
                continue
            if title.startswith("Зауваги"):          # службовий супутник хроніки
                continue
            found.append({"title": title, "from": int(start), "to": int(end),
                          "path": str(path.relative_to(root))})
        found.sort(key=lambda x: x["from"])
        return found

    @router.post("/map/request")
    def map_request(payload: dict[str, Any], _session=Depends(require_session)) -> dict[str, Any]:
        """Сутність, якої в бібліотеці немає, — у чергу агентам.

        РІШЕННЯ ЮРІЯ (2026-07-28): «Що стосується сутності чи подій, які
        відсутні в бібліотеці — це привід дати поштовх нашим агентам шукати
        інформацію, перевіряти і додавати до бібліотеки.» Читання перестає
        бути споживанням: натрапив на порожнє посилання — замовив картку.

        Пишемо в той самий посівний список, з якого живиться конвеєр апарату,
        і знімаємо сентинел, щоб він прокинувся сам.
        """
        name = str(payload.get("name", "")).strip()
        if not name or len(name) > 120 or "\n" in name:
            return {"ok": False, "error": "bad_name"}
        store = Path.home() / ".writer-lab"
        store.mkdir(parents=True, exist_ok=True)
        seed = store / "apparat-seed.txt"
        lines = seed.read_text(encoding="utf-8").splitlines() if seed.is_file() else []
        if name in lines:
            return {"ok": True, "already": True, "queued": len(lines)}
        with seed.open("a", encoding="utf-8") as handle:
            handle.write(f"{name}\n")
        (store / "apparat.done").unlink(missing_ok=True)      # робота зʼявилась
        return {"ok": True, "already": False, "queued": len(lines) + 1}

    @router.get("/map/story")
    def map_story(title: str, _session=Depends(require_session)) -> dict[str, Any]:
        """Текст самого сюжету — розділу книги, епізоду, есею чи MOC.

        Сюжет у списку названо за `title` документа, тож шукаємо по ньому.
        Апарат відрізаємо: у панелі читається авторський текст, а сутності
        доступні через реперні точки поруч.
        """
        want = title.strip()
        for candidate in sorted(root.rglob("*.md")):
            if {".git", "graphify-out"} & set(candidate.relative_to(root).parts):
                continue
            head = candidate.read_text(encoding="utf-8", errors="ignore")[:900]
            fm = _front(head)
            if (_field(fm, "title") or candidate.stem) != want:
                continue
            text = candidate.read_text(encoding="utf-8", errors="ignore")
            fmt = _front(text)
            body = text[len(fmt) + 8:] if fmt else text
            body = re.split(r"<!-- apparatus:start", body)[0].strip()
            rel = str(candidate.relative_to(root))
            return {
                "title": want,
                "kind": _field(fmt, "type"),
                "body": body[:60_000],
                "path": rel,
                "document_id": _doc_id(rel),
            }
        return {"error": "not_found", "title": want}

    @router.get("/map/card")
    def map_card(name: str, _session=Depends(require_session)) -> dict[str, Any]:
        """Картка будь-якої сутності за назвою — для кліку по передумові.

        Передумови ведуть не лише на події: «Флоренція» — місце, «Ісидор» —
        людина. Шукаємо по всьому 30-Research, а секції беремо ті, що є: у
        події це «Що сталося»/«Наслідки», у людини — «Значення для розповіді».
        """
        safe = name.strip().replace("/", "").replace("\\", "")
        if not safe:
            return {"error": "not_found"}
        # Спершу 30-Research (там сутності), далі вся бібліотека: посилання
        # в тексті ведуть і на накази, есеї, розділи — вони існують, і казати
        # «картки немає» про наявний документ було б неправдою.
        def scan(base: Path) -> Path | None:
            if not base.is_dir():
                return None
            for candidate in sorted(base.rglob("*.md")):
                if {".git", "graphify-out"} & set(candidate.parts):
                    continue
                if candidate.stem == safe:
                    return candidate
            for candidate in sorted(base.rglob("*.md")):
                if {".git", "graphify-out"} & set(candidate.parts):
                    continue
                fm = _front(candidate.read_text(encoding="utf-8", errors="ignore")[:900])
                if safe in [_field(fm, "title"), *_list_field(fm, "aliases")]:
                    return candidate
            return None

        def loose(base: Path) -> Path | None:
            """Останній шанс: часткове входження, але лише коли кандидат один —
            інакше «Острозький» міг би впіймати і місто, і людину."""
            hits = [c for c in sorted(base.rglob("*.md"))
                    if not ({".git", "graphify-out"} & set(c.parts)) and safe.lower() in c.stem.lower()]
            return hits[0] if len(hits) == 1 else None

        # Пряме звернення за вічним ключем: так фронт відкриває обраний варіант
        # неоднозначного імені, не покладаючись на назву.
        if safe.startswith("uid:"):
            card = _entity_index().get("cards", {}).get(safe[4:])
            if not card:
                return {"error": "not_found", "name": safe}
            target, choices = root / card["path"], []
        else:
            # Індекс знає відмінкові форми й тримається за uid, а не за назву,
            # тож переживає перейменування картки.
            target, choices = _by_index(safe)
        if choices:
            return {"error": "ambiguous", "name": safe, "choices": choices}
        target = target or scan(root / "30-Research") or scan(root) or loose(root / "30-Research")
        if target is None:
            return {"error": "not_found", "name": safe}

        text = target.read_text(encoding="utf-8", errors="ignore")
        fm = _front(text)
        body = text[len(fm) + 8:] if fm else text

        def section(*names: str) -> str:
            for n in names:
                m = re.search(rf"^## {n}\s*\n(.*?)(?=\n## |\Z)", body, re.S | re.M)
                if m and m.group(1).strip():
                    return m.group(1).strip()
            return ""

        rel = str(target.relative_to(root))
        return {
            "title": _field(fm, "title") or target.stem,
            "kind": _field(fm, "type"),
            "year": _field(fm, "time_start"),
            "year_end": _field(fm, "time_end"),
            "place": _field(fm, "place"),
            # Заголовки різняться за типом картки: подія — «Що сталося», місце —
            # «Що тут відбувалося», людина — «Життя», поняття — «Що це».
            # Для документів поза 30-Research беремо початок тіла: у наказу чи
            # есею немає «Що сталося», але перший абзац і є відповіддю «що це».
            "what": (section("Що сталося", "Що тут відбувалося", "Що це", "Життя", "Хто це")
                     or re.sub(r"^#[^\n]*\n+", "", body.strip()).strip())[:1500],
            "consequences": section("Наслідки", "Цінність для розповіді", "Реперні події", "Чому важить")[:1500],
            "related": [x.strip() for x in re.findall(r"\[\[([^\]|#]+)", section("Пов'язане"))][:8],
            "path": rel,
            "document_id": _doc_id(rel),
        }

    @router.get("/map/event")
    def map_event(path: str, _session=Depends(require_session)) -> dict[str, Any]:
        """Картка події для панелі: що сталося, наслідки, передумови.

        Передумов як окремої секції в картках немає, і вигадувати її не будемо.
        Чесна відповідь на «що було до цього» складається з двох частин:
        попередня подія того самого сюжету (структурна передумова, рахується
        тут) і секція «Пов'язане» самої картки (авторські зв'язки).
        """
        target = (root / path).resolve()
        if not str(target).startswith(str((root / EVENTS).resolve())) or not target.is_file():
            return {"error": "not_found"}
        text = target.read_text(encoding="utf-8", errors="ignore")
        fm = _front(text)
        body = text[len(fm) + 8:] if fm else text

        def section(name: str) -> str:
            m = re.search(rf"^## {name}\s*\n(.*?)(?=\n## |\Z)", body, re.S | re.M)
            return m.group(1).strip() if m else ""

        return {
            "title": _field(fm, "title") or target.stem,
            "year": _field(fm, "time_start"),
            "year_end": _field(fm, "time_end"),
            "place": _field(fm, "place"),
            "what": section("Що сталося")[:1800],
            "consequences": section("Наслідки")[:1800],
            "related": [x.strip() for x in re.findall(r"\[\[([^\]|#]+)", section("Пов'язане"))][:8],
            "sides": section("Учасники й сторони")[:600],
            "path": path,
            "document_id": _doc_id(path),
        }

    @router.get("/map")
    def map_data(_session=Depends(require_session)) -> dict[str, Any]:
        canon, alias = _places()
        stories: dict[str, list[dict[str, Any]]] = defaultdict(list)
        loose: list[dict[str, Any]] = []

        base = root / EVENTS
        for path in sorted(base.glob("*.md")) if base.is_dir() else []:
            text = path.read_text(encoding="utf-8", errors="ignore")
            fm = _front(text)
            year = _field(fm, "time_start")
            if not re.fullmatch(r"-?\d+", year or ""):
                continue
            route = _route(_field(fm, "place"), alias)
            event = {
                "title": _field(fm, "title") or path.stem,
                "year": int(year),
                "year_end": int(_field(fm, "time_end")) if re.fullmatch(r"-?\d+", _field(fm, "time_end") or "") else None,
                "place_raw": _field(fm, "place"),
                "route": route,                       # 0, 1 або кілька точок
                "path": str(path.relative_to(root)),
                "document_id": _doc_id(str(path.relative_to(root))),
            }
            targets = _mentions(text)
            if targets:
                for target in targets:
                    stories[target].append(event)
            else:
                loose.append(event)

        out = []
        for title, events in stories.items():
            events.sort(key=lambda e: e["year"])
            mapped = [e for e in events if e["route"]]
            if not events:
                continue
            out.append({
                "title": title,
                "from": events[0]["year"],
                "to": max(e["year_end"] or e["year"] for e in events),
                "events": events,
                "mapped": len(mapped),        # скільки подій сюжету лягає на мапу
            })
        # Хронологія, а не «спершу цікаве»: якщо це часова шкала, то й порядок
        # часовий (Юрій, 2026-07-27). Сюжети без жодної точки на мапі лишаються
        # в списку на своєму місці в часі — вони теж частина розповіді.
        out.sort(key=lambda s: (s["from"], s["to"]))
        return {
            "places": list(canon.values()),
            "periods": _periods(),
            "stories": out,
            "loose": sorted(loose, key=lambda e: e["year"]),
        }

    return router
