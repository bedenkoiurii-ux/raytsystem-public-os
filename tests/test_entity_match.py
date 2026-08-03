"""Три рубежі зіставлення сутності — випадок Юрія 03.08 і межі навколо нього."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from raytsystem.webapp.entity_match import find, stems

CARDS = {
    "ent-vt": {"title": "Великий терор", "path": "30-Research/Events/Великий терор.md"},
    "ent-dt": {"title": "Державний терор", "path": "30-Research/Concepts/Державний терор.md"},
    "ent-gm": {"title": "Голодомор", "path": "30-Research/Events/Голодомор.md"},
}
FORMS = {
    "великий терор": ["ent-vt"],
    "великого терору": ["ent-vt"],
    "державний терор": ["ent-dt"],
    "голодомор": ["ent-gm"],
    "голодомору": ["ent-gm"],
}


def titles(bucket):
    return [card["title"] for card in bucket]


def test_exact_form_wins():
    got = find("Великий терор", FORMS, CARDS)
    assert titles(got["exact"]) == ["Великий терор"]
    assert got["inflected"] == [] and got["fuzzy"] == []


def test_case_of_yurii_dative_is_found():
    """«Великому терору» — форма, якої в індексі немає й ніколи не було."""
    assert "великому терору" not in FORMS
    got = find("Великому терору", FORMS, CARDS)
    assert got["exact"] == []
    assert titles(got["inflected"]) == ["Великий терор"]


def test_other_inflections_of_the_same_entity():
    for term in ("Великим терором", "Великому терорі", "великих терорів"):
        got = find(term, FORMS, CARDS)
        assert titles(got["inflected"]) == ["Великий терор"], term


def test_single_word_inflection():
    got = find("Голодомором", FORMS, CARDS)
    assert titles(got["inflected"]) == ["Голодомор"]


def test_different_entity_is_not_pulled_in():
    """«Державний терор» не має ставати відповіддю на «Великий терор»."""
    got = find("Великому терору", FORMS, CARDS)
    assert "Державний терор" not in titles(got["inflected"])


def test_word_order_and_extra_words_are_a_guess_not_a_fact():
    got = find("терор великий сталінський", FORMS, CARDS)
    assert got["exact"] == [] and got["inflected"] == []
    assert "Великий терор" in titles(got["fuzzy"])


def test_invented_term_stays_unknown():
    got = find("Незнанославльський виверт", FORMS, CARDS)
    assert got["exact"] == [] and got["inflected"] == [] and got["fuzzy"] == []


def test_invented_term_in_oblique_case_stays_unknown():
    got = find("Незнанославльському вивертові", FORMS, CARDS)
    assert not any(got.values())


def test_empty_input_does_not_crash():
    for term in ("", "   ", "—"):
        assert find(term, FORMS, CARDS) == {"exact": [], "inflected": [], "fuzzy": []}


def test_stems_cut_where_inflection_starts():
    assert stems("Великому терору") == stems("Великий терор")
    assert stems("Голодомору") == stems("Голодомор")
    # Коротке слово лишається цілим — інакше «Крим» злипся б із «кримінал».
    assert stems("Крим") != stems("Кримінал")


@pytest.mark.parametrize("term,expected", [
    ("Великому терору", "Великий терор"),
    ("Великого терору", "Великий терор"),      # ця форма є в індексі — рубіж 1
])
def test_live_index_knows_the_entity(term, expected):
    """Той самий тест на ЖИВОМУ індексі бібліотеки, не на макеті.

    Якщо індекс протухне або картку перейменують, тест це побачить — саме
    заради цього він і читає диск.
    """
    index_path = Path("/Users/Nemo/Writer-Lab/Library/90-Meta/entity-index.json")
    if not index_path.is_file():
        pytest.skip("бібліотека недоступна")
    data = json.loads(index_path.read_text(encoding="utf-8"))
    got = find(term, data["forms"], data["cards"])
    found = titles(got["exact"]) + titles(got["inflected"])
    assert expected in found, got


def test_one_shared_word_is_not_a_guess():
    """«Великому терору» не має тягти за собою все, де трапилось «велик»."""
    forms = {**FORMS, "великий розкол": ["ent-vr"], "скіфський терор": ["ent-sk"]}
    cards = {**CARDS,
             "ent-vr": {"title": "Великий розкол", "path": "30-Research/Events/Великий розкол.md"},
             "ent-sk": {"title": "Скіфія", "path": "30-Research/Places/Скіфія.md"}}
    got = find("Великому терору", forms, cards)
    assert titles(got["inflected"]) == ["Великий терор"]
    assert titles(got["fuzzy"]) == [], got["fuzzy"]


def test_single_word_term_has_no_guesses():
    got = find("Голодоморові", FORMS, CARDS)
    assert titles(got["inflected"]) == ["Голодомор"]
    assert got["fuzzy"] == []


def test_three_word_term_still_guesses_on_two():
    got = find("терор великий сталінський", FORMS, CARDS)
    assert "Великий терор" in titles(got["fuzzy"])
