"""Global search route coverage."""

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    Peg,
)
from memory_anki.modules.search.presentation import router as search_router


def test_global_search_returns_all_result_groups(make_client, db_session):
    subject = Subject(name="生物")
    db_session.add(subject)
    db_session.flush()
    chapter = Chapter(subject_id=subject.id, name="线粒体与能量代谢")
    db_session.add(chapter)
    db_session.flush()
    palace = Palace(title="线粒体宫殿", description="含线粒体呼吸链", archived=False)
    archived_palace = Palace(title="线粒体归档宫殿", archived=True)
    db_session.add_all([palace, archived_palace])
    db_session.flush()
    db_session.add_all(
        [
            Peg(palace_id=palace.id, name="厨房灶台", content="灶台上的火等于线粒体产能"),
            Peg(palace_id=archived_palace.id, name="线粒体归档桩", content="不可见"),
            PalaceQuizQuestion(palace_id=palace.id, stem="线粒体内膜上进行的是？"),
            PalaceQuizQuestion(source_chapter_id=chapter.id, stem="线粒体来自知识章节题"),
        ]
    )
    db_session.commit()

    client = make_client(search_router)
    response = client.get("/api/v1/search?q=线粒体&limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "线粒体"
    assert [item["title"] for item in body["palaces"]] == ["线粒体宫殿"]
    assert body["pegs"][0]["name"] == "厨房灶台"
    assert body["pegs"][0]["palace_id"] == palace.id
    assert {item["palace_id"] for item in body["questions"]} == {palace.id, None}
    assert body["chapters"] == [
        {"id": chapter.id, "name": "线粒体与能量代谢", "subject_name": "生物"}
    ]


def test_global_search_escapes_like_wildcards(make_client, db_session):
    palace = Palace(title="100%_literal\\needle", archived=False)
    wildcard_only = Palace(title="100xxliteralxneedle", archived=False)
    db_session.add_all([palace, wildcard_only])
    db_session.commit()

    client = make_client(search_router)
    response = client.get("/api/v1/search", params={"q": "%_literal\\", "limit": 10})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["palaces"]] == [palace.id]


def test_global_search_trims_empty_query(make_client):
    client = make_client(search_router)
    response = client.get("/api/v1/search?q=%20%20")

    assert response.status_code == 200
    assert response.json() == {
        "query": "",
        "palaces": [],
        "pegs": [],
        "questions": [],
        "chapters": [],
    }
