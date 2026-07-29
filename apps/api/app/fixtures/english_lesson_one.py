from dataclasses import dataclass
from typing import Any

from app.domain.models import QuestionType

QUESTION_FILENAME = "english_lesson1_similar_practice.pdf"
ANSWER_FILENAME = "english_lesson1_similar_answer_key.pdf"


@dataclass(frozen=True)
class LessonQuestionSpec:
    type: QuestionType
    prompt: str
    answer_key: dict[str, Any]
    knowledge_code: str
    knowledge_label: str
    options: tuple[str, ...] | None = None
    points: float = 1


def matches_lesson_one_import(
    filenames: list[str],
    answer_filenames: list[str],
) -> bool:
    return QUESTION_FILENAME in filenames and ANSWER_FILENAME in answer_filenames


def lesson_one_source_summary(reference_file_count: int) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "unit": "Lesson 1 · What Are Your Plans for the Vacation?",
        "artifact_kind": "ai_generated_practice",
        "knowledge_points": [
            "and / but / or / so",
            "imperative + and / or",
            "when / while / after / before",
            "present tense in future time clauses",
            "How / What exclamations",
        ],
        "reference_file_count": reference_file_count,
    }


def _choice(
    number: str,
    prompt: str,
    options: tuple[str, ...],
    answer: int,
    knowledge_code: str,
    knowledge_label: str,
) -> LessonQuestionSpec:
    return LessonQuestionSpec(
        type=QuestionType.SINGLE_CHOICE,
        prompt=f"{number} {prompt}",
        options=options,
        answer_key={"choice": answer},
        knowledge_code=knowledge_code,
        knowledge_label=knowledge_label,
    )


def _text(
    number: str,
    prompt: str,
    answer: str,
    knowledge_code: str,
    knowledge_label: str,
) -> LessonQuestionSpec:
    return LessonQuestionSpec(
        type=QuestionType.TYPED_TEXT,
        prompt=f"{number} {prompt}",
        answer_key={"text": answer},
        knowledge_code=knowledge_code,
        knowledge_label=knowledge_label,
    )


def _order(
    number: str,
    tokens: tuple[str, ...],
    answer: tuple[str, ...],
) -> LessonQuestionSpec:
    return LessonQuestionSpec(
        type=QuestionType.WORD_ORDER,
        prompt=f"{number} 語句を並べかえて、感嘆文を完成させなさい。",
        options=tokens,
        answer_key={"tokens": list(answer)},
        knowledge_code="exclamations",
        knowledge_label="How / What exclamations",
    )


def lesson_one_question_specs() -> tuple[LessonQuestionSpec, ...]:
    conjunction = ("conjunctions", "and / but / or / so")
    time_clause = ("time-conjunctions", "when / while / after / before")
    exclamation = ("exclamations", "How / What exclamations")
    questions = (
        _choice(
            "1-1(1)",
            "（　）から最も適切な語を選びなさい。Emma ___ Leo are in the music club.",
            ("and", "but", "so"),
            0,
            *conjunction,
        ),
        _choice(
            "1-1(2)",
            "Are you going to Osaka ___ Kyoto this summer?",
            ("and", "or", "so"),
            1,
            *conjunction,
        ),
        _choice(
            "1-1(3)",
            "The box is small, ___ it is very heavy.",
            ("but", "or", "so"),
            0,
            *conjunction,
        ),
        _choice(
            "1-1(4)",
            "I studied hard, ___ I passed the test.",
            ("and", "but", "so"),
            2,
            *conjunction,
        ),
        _choice(
            "1-1(5)",
            "We can walk ___ take the bus.",
            ("and", "or", "so"),
            1,
            *conjunction,
        ),
        _choice(
            "1-1(6)",
            "It was sunny, ___ we played soccer after school.",
            ("but", "or", "so"),
            2,
            *conjunction,
        ),
        _text(
            "1-2(1)",
            "and, but, or, so のうち最も適切な語を入れなさい。"
            "I wanted to call you, ___ my phone was dead.",
            "but",
            *conjunction,
        ),
        _text(
            "1-2(2)",
            "My mother cooks dinner, ___ my father washes the dishes.",
            "and",
            *conjunction,
        ),
        _text(
            "1-2(3)",
            "It was late, ___ we went home.",
            "so",
            *conjunction,
        ),
        _text(
            "1-2(4)",
            "You can have juice ___ water.",
            "or",
            *conjunction,
        ),
        _text(
            "1-2(5)",
            "Mr. Brown speaks Spanish, ___ his sister speaks French.",
            "and",
            *conjunction,
        ),
        _text(
            "1-2(6)",
            "The movie was long, ___ it was exciting.",
            "but",
            *conjunction,
        ),
        _choice(
            "1-3(1)",
            "命令文の意味に合う語を選びなさい。Take this road, ___ you will reach the library.",
            ("and", "or"),
            0,
            *conjunction,
        ),
        _choice(
            "1-3(2)",
            "Leave now, ___ you will miss the first train.",
            ("and", "or"),
            1,
            *conjunction,
        ),
        _choice(
            "1-3(3)",
            "Read the question carefully, ___ you can avoid mistakes.",
            ("and", "or"),
            0,
            *conjunction,
        ),
        _text(
            "1-4(1)",
            "2つの文を so を使って1文にしなさい。I was hungry. I made a sandwich.",
            "I was hungry, so I made a sandwich.",
            *conjunction,
        ),
        _text(
            "1-4(2)",
            "2つの文を or を使って1文にしなさい。Does Aya want tea? Does Aya want milk?",
            "Does Aya want tea or milk?",
            *conjunction,
        ),
        _text(
            "1-4(3)",
            "2つの文を and を使って1文にしなさい。Mark cleaned the room. He listened to music.",
            "Mark cleaned the room and listened to music.",
            *conjunction,
        ),
        _choice(
            "2-1(1)",
            "最も適切な語を選びなさい。Please turn off the lights ___ you leave the room.",
            ("before", "while"),
            0,
            *time_clause,
        ),
        _choice(
            "2-1(2)",
            "I met my teacher ___ I was walking home.",
            ("when", "after"),
            0,
            *time_clause,
        ),
        _choice(
            "2-1(3)",
            "We ate dessert ___ we finished dinner.",
            ("after", "before"),
            0,
            *time_clause,
        ),
        _choice(
            "2-1(4)",
            "My brother was doing his homework ___ I was cooking.",
            ("when", "while"),
            1,
            *time_clause,
        ),
        _choice(
            "2-1(5)",
            "I will send you a photo ___ I arrive in Kyoto.",
            ("when", "before"),
            0,
            *time_clause,
        ),
        _text(
            "2-2(1)",
            "when, while, after, before のうち最も適切な語を入れなさい。"
            "___ I was ten, I lived in Nagoya.",
            "When",
            *time_clause,
        ),
        _text(
            "2-2(2)",
            "___ you are waiting, please read this sign.",
            "While",
            *time_clause,
        ),
        _text(
            "2-2(3)",
            "We will start the game ___ everyone comes.",
            "when",
            *time_clause,
        ),
        _text(
            "2-2(4)",
            "___ you finish lunch, wash your hands.",
            "After",
            *time_clause,
        ),
        _text(
            "2-2(5)",
            "Lock the door ___ you go out.",
            "before",
            *time_clause,
        ),
        _text(
            "2-2(6)",
            "___ my parents were shopping, I cleaned the kitchen.",
            "While",
            *time_clause,
        ),
        _text(
            "2-3(1)",
            "after を使って1文にしなさい。I will finish my chores. I will watch a movie.",
            "I will watch a movie after I finish my chores.",
            *time_clause,
        ),
        _text(
            "2-3(2)",
            "when を使って1文にしなさい。The bell rang. We were having lunch.",
            "We were having lunch when the bell rang.",
            *time_clause,
        ),
        _text(
            "2-3(3)",
            "before を使って1文にしなさい。Put on your coat. You go outside.",
            "Put on your coat before you go outside.",
            *time_clause,
        ),
        _text(
            "2-3(4)",
            "while を使って1文にしなさい。My mother was talking on the phone. I fed the cat.",
            "I fed the cat while my mother was talking on the phone.",
            *time_clause,
        ),
        _text(
            "2-4",
            "英文の誤りを直して、全文を書きなさい。I will text you when I will get home.",
            "I will text you when I get home.",
            *time_clause,
        ),
        _text(
            "3-1(1)",
            "日本文の意味に合うように空所を埋めなさい。"
            "これはなんて美しい絵なのでしょう。"
            "___ beautiful picture this is!",
            "What a",
            *exclamation,
        ),
        _text(
            "3-1(2)",
            "ユキはなんて注意深く書くのでしょう。___ carefully Yuki writes!",
            "How",
            *exclamation,
        ),
        _text(
            "3-1(3)",
            "あの建物はなんて高いのでしょう。___ tall that building is!",
            "How",
            *exclamation,
        ),
        _text(
            "3-1(4)",
            "彼らはなんて面白い話をしてくれたのでしょう。___ interesting stories they told us!",
            "What",
            *exclamation,
        ),
        _text(
            "3-1(5)",
            "その電車はなんて速く走っているのでしょう。___ fast the train is moving!",
            "How",
            *exclamation,
        ),
        _text(
            "3-1(6)",
            "あなたはなんてかわいい犬を飼っているのでしょう。___ cute dog you have!",
            "What a",
            *exclamation,
        ),
        _order(
            "3-2(1)",
            ("a", "What", "delicious", "cake", "this", "is"),
            ("What", "a", "delicious", "cake", "this", "is"),
        ),
        _order(
            "3-2(2)",
            ("How", "is", "loudly", "singing", "that girl"),
            ("How", "loudly", "that girl", "is", "singing"),
        ),
        _order(
            "3-2(3)",
            ("What", "a", "wonderful", "idea", "you", "have"),
            ("What", "a", "wonderful", "idea", "you", "have"),
        ),
        _order(
            "3-2(4)",
            ("How", "these flowers", "are", "beautiful"),
            ("How", "beautiful", "these flowers", "are"),
        ),
        _text(
            "3-3(1)",
            "How で始まる感嘆文に書きかえなさい。This soup is very hot.",
            "How hot this soup is!",
            *exclamation,
        ),
        _text(
            "3-3(2)",
            "What で始まる感嘆文に書きかえなさい。You bought an interesting book.",
            "What an interesting book you bought!",
            *exclamation,
        ),
        _text(
            "3-3(3)",
            "How で始まる感嘆文に書きかえなさい。Those players are very strong.",
            "How strong those players are!",
            *exclamation,
        ),
        _choice(
            "3-4(1)",
            "省略されている語句を選びなさい。Look at your new bike. What a cool bike ___!",
            ("it is", "it was"),
            0,
            *exclamation,
        ),
        _choice(
            "3-4(2)",
            "省略されている語句を選びなさい。We saw a waterfall. How beautiful ___!",
            ("it is", "it was"),
            1,
            *exclamation,
        ),
    )
    if len(questions) != 49:
        raise RuntimeError("The Lesson 1 fixture must contain exactly 49 questions.")
    return questions
