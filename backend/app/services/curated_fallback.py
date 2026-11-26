"""Small, authored safety net after AI candidates fail validation.

These are practice items, not CEFR certification. The returned level belongs to the
actual item: a B2 safety-net question must never be scored as the requested C1.
Provider policy/configuration failures do not select this bank. No user input is
sent anywhere by this module, and keys remain inside the normal sealed token.
"""
from __future__ import annotations

from dataclasses import dataclass
from random import SystemRandom
from typing import Any

from . import tokens
from ._grammar_prompts import BUILD_CUE_INSTRUCTION


@dataclass(frozen=True)
class Item:
    topic: str
    level: str
    text: str
    answer: str
    distractors: tuple[str, str, str]


# Context/meaning requirements are displayed, not hidden in the answer key. Deliberately
# avoid stylistic alternatives, optional backshift and modal choices without a stated meaning.
BANK: tuple[Item, ...] = (
    Item("articles", "A1", "She bought ___ umbrella.", "an", ("a", "these", "many")),
    Item("articles", "B2", "Complete the fixed expression: In ___ long run, regular practice helps.", "the", ("a", "an", "each")),
    Item("prepositions", "A1", "The workshop starts ___ Monday.", "on", ("at", "of", "between")),
    Item("prepositions", "B2", "Complete the standard verb pattern: They objected ___ paying an extra fee.", "to", ("for", "at", "with")),
    Item("conditionals", "A2", "Use the first conditional: If it rains tomorrow, we ___ indoors.", "will stay", ("would stayed", "staying", "has stayed")),
    Item("conditionals", "B2", "Use a completed unreal past result: If she had received the message yesterday, she ___ immediately.", "would have replied", ("has replied", "will reply", "replies")),
    Item("verb sequence (tense agreement)", "A2", "Use the past simple with yesterday: The team ___ the report yesterday.", "finished", ("finishes", "has finished", "will finish")),
    Item("verb sequence (tense agreement)", "B1", "Use backshift to report 'I am tired': He said that he ___ tired.", "was", ("is", "has", "will")),
    Item("vocabulary", "A1", "She is a ___ (a person who teaches).", "teacher", ("window", "ticket", "garden")),
    Item("vocabulary", "B2", "She is a ___ investor (careful not to take risks).", "cautious", ("reckless", "unrelated", "annual")),
    Item("modal verbs", "A2", "You ___ park here (it is forbidden).", "must not", ("do not have to", "might", "should")),
    Item("modal verbs", "B2", "She ___ arrived home (a strong logical deduction about a completed past event).", "must have", ("should have", "might be", "can be")),
    Item("phrasal verbs", "A2", "Could you ___ the cat (take care of it)?", "look after", ("give up", "turn off", "run out")),
    Item("phrasal verbs", "B1", "They decided to ___ the meeting until Friday (postpone it).", "put off", ("carry out", "look into", "break down")),
    Item("gerunds & infinitives", "A2", "Complete the standard pattern: She enjoys ___ after work.", "swimming", ("to swim", "swim", "swims")),
    Item("gerunds & infinitives", "B2", "Complete the standard pattern: She admitted ___ the confidential file.", "copying", ("to copy", "copy", "copied")),
    Item("comparatives & superlatives", "A2", "This box weighs 10 kg; that box weighs 5 kg. This box is ___ than that one.", "heavier", ("heaviest", "heavy", "most heavy")),
    Item("comparatives & superlatives", "B2", "The more you practise, ___ your answers become.", "the more accurate", ("more accurater", "the most accurate", "most accurate")),
    Item("word order", "A1", "Choose the normal statement word order: ___", "She plays tennis.", ("Plays she tennis.", "Tennis plays she.", "She tennis plays.")),
    Item("word order", "A2", "Choose the normal question word order: ___", "Where do you work?", ("Where you do work?", "Where do work you?", "You where do work?")),
    Item("word order", "B1", "Complete the indirect question: Could you tell me ___?", "where the station is", ("where is the station", "where does the station", "where the station does")),
    Item("punctuation", "A2", "Write a list of three separate items (tea / bread / milk): ___", "We bought tea, bread and milk.", ("We bought tea bread and milk.", "We bought, tea bread and milk.", "We bought tea bread and, milk.")),
    Item("punctuation", "B2", "Choose standard written punctuation for two clauses joined by however: ___", "It was raining; however, we went out.", ("It was raining, however we went out.", "It was raining however, we went out.", "It was raining; however we went out.")),
)

# Independent prompts in the same topic and band keep repeated fallback reads useful.
_PRACTICE_VARIANTS = (
    Item("articles", "A1", "I saw ___ elephant at the zoo.", "an", ("a", "each", "many")),
    Item("articles", "B2", "Complete the fixed expression: What she said was beside ___ point.", "the", ("a", "an", "every")),
    Item("prepositions", "A1", "Meet me ___ noon.", "at", ("on", "into", "of")),
    Item("prepositions", "B2", "Complete the standard verb pattern: They insisted ___ paying the full amount.", "on", ("at", "in", "with")),
    Item("conditionals", "A2", "Use the first conditional: If we miss the bus, we ___ the train.", "will take", ("would took", "taking", "has taken")),
    Item("conditionals", "B2", "Use an unreal past result: If I had packed earlier, I ___ my keys.", "would not have forgotten", ("will not forget", "did not forgot", "have not forgot")),
    Item("verb sequence (tense agreement)", "A2", "Use the past simple: We ___ for the bus yesterday.", "waited", ("wait", "have waited", "are waiting")),
    Item("verb sequence (tense agreement)", "B1", "Use backshift to report 'I have finished': She said she ___ the task.", "had finished", ("has finished", "will finish", "finishing")),
    Item("vocabulary", "A1", "A ___ is a piece of furniture you sleep on.", "bed", ("coat", "cup", "pen")),
    Item("vocabulary", "B2", "The report was ___ (short and clear, with no unnecessary words).", "concise", ("hesitant", "incomplete", "imprecise")),
    Item("modal verbs", "A2", "I ___ (I am able to) swim across the pool.", "can", ("must not", "should not", "have to")),
    Item("modal verbs", "B2", "They ___ have used the lift (it was definitely broken all day).", "cannot", ("should", "might", "must")),
    Item("phrasal verbs", "A2", "Please ___ your shoes (remove them) before coming in.", "take off", ("look after", "turn on", "look up")),
    Item("phrasal verbs", "B1", "The plane will ___ (leave the ground) at noon.", "take off", ("hand in", "turn down", "carry out")),
    Item("gerunds & infinitives", "A2", "Use the standard pattern: He decided ___ home.", "to walk", ("walking", "walks", "walk")),
    Item("gerunds & infinitives", "B2", "Use the standard verb pattern: She denied ___ the files.", "copying", ("to copy", "copy", "copied")),
    Item("comparatives & superlatives", "A2", "The car costs $10,000 and the bike costs $800. The bike is ___ than the car.", "cheaper", ("cheapest", "cheap", "the cheaper")),
    Item("comparatives & superlatives", "B2", "The longer you wait, ___ it becomes.", "the more expensive", ("more expensiver", "the most expensive", "most expensive")),
    Item("word order", "A1", "Choose the usual statement order: ___", "Tom reads books.", ("Reads Tom books.", "Tom books reads.", "Books reads Tom.")),
    Item("word order", "A2", "Choose the usual question order: ___", "When does the bus leave?", ("When the bus does leave?", "When does leave the bus?", "When the bus leave does?")),
    Item("word order", "B1", "Complete the indirect question: Do you know ___?", "what time the shop closes", ("what time does the shop close", "what time closes the shop", "what the shop time closes")),
    Item("punctuation", "A2", "Add the usual punctuation to a direct question: ___", "Where is the station?", ("Where is the station.", "Where is the station,", "Where is the station:")),
    Item("punctuation", "B2", "Use a semicolon to join independent clauses: ___", "The train was late; we waited.", ("The train was late, we waited.", "The train; was late we waited.", "The train was; late we waited.")),
)

_ASSESSMENT_BUILDS = {
    ("word order", "A1"): (
        ("Я читаю книги дома.", "Say that you look at books where you live.", "I read books at home."),
        ("Ты живёшь здесь?", "Ask if this is the other person's home.", "Do you live here?"),
    ),
    ("word order", "A2"): (
        ("Ты всегда проверяешь журналы?", "Ask whether someone looks at the system records every time.",
         "Do you always check the logs?"),
        ("Напишите нейтральный вопрос. Когда уходит поезд?", "Ask for the time of the train's departure.",
         "When does the train leave?"),
    ),
    ("word order", "B1"): (
        ("Вы можете сказать мне, где станция?", "Politely ask someone to tell you the location of the station.",
         "Can you tell me where the station is?"),
        ("Вы знаете, когда закрывается магазин?", "Ask if the other person knows what time the store shuts.",
         "Do you know when the shop closes?"),
    ),
    ("word order", "B2"): (
        ("Начните с Rarely. Я редко видел настолько шумный офис.",
         "Begin with Rarely. Say that you have hardly ever come across a workplace that loud.",
         "Rarely have I seen such a noisy office."),
        ("Начните с Seldom. Мы редко получаем настолько ясные инструкции.",
         "Begin with Seldom. Say that directions this clear are unusual for you and your team.",
         "Seldom do we receive such clear instructions."),
    ),
    ("word order", "C1"): (
        ("Начните с Only after. Мы поняли, насколько ненадёжны оценки, лишь когда изучили данные.",
         "Begin with Only after. Explain that your group saw the initial numbers could not be trusted once you analyzed the records.",
         "Only after examining the data did we realize how unreliable the estimates were."),
        ("Начните с Not until. Мы поняли последствия только после завершения переговоров.",
         "Begin with Not until. Explain that your group grasped the implications after the talks had finished.",
         "Not until the negotiations ended did we understand the consequences."),
    ),
}

# In all three types, the visible words give enough context for one well-defined decision.
_ASSESSMENT_BLANKS = {
    ("word order", "A1"): ("___ every day. ___ near the station.", ("She reads", "We live"), ("Reads she", "Live we")),
    ("word order", "A2"): ("___ at noon? ___ before lunch?", ("Does it start", "Do they leave"), ("Does start it", "Do leave they")),
    ("word order", "B1"): ("Can you tell me ___? Do you know ___?", ("where the station is", "when it closes"),
                             ("where is the station", "when does it close")),
    ("punctuation", "A1"): ("Where is the station___ I can see it___", ("?", "."), (".", ",")),
    ("punctuation", "A2"): ("Is the station open___ The next train leaves at noon___", ("?", "."), (".", ",")),
}
_ASSESSMENT_ERRORS = {
    ("punctuation", "A1"): ("Hello. everyone.", 0, "Hello,"),
    ("punctuation", "A2"): ("After it stopped raining. we went home.", 3, "raining,"),
}

_BANDS = ("A1", "A2", "B1", "B2", "C1")


def _card(kind: str, topic: str, level: str, key: dict[str, Any], **display: Any) -> dict[str, Any]:
    return {
        "type": kind, "topic": topic, "level": level, "source": "curated",
        **display, "token": tokens.seal({"t": kind, "topic": topic, **key}),
    }


def _assessment_card(
    topic: str, level: str, kind: str, index: int, lang: str | None,
) -> dict[str, Any] | None:
    if kind == "build-the-sentence":
        variants = _ASSESSMENT_BUILDS.get((topic, level))
        if variants:
            translation, cue, answer = variants[index % len(variants)]
            english_cue = (lang or "").strip().lower() == "en"
            words = answer.split()
            tiles = words[:]
            SystemRandom().shuffle(tiles)
            if tiles == words:
                tiles.reverse()
            return _card(
                kind, topic, level, {"sentence": answer}, tiles=tiles,
                text=BUILD_CUE_INSTRUCTION if english_cue else "Translate into English:",
                prompt=cue if english_cue else translation,
                **({"instruction": BUILD_CUE_INSTRUCTION} if english_cue else {}),
            )
    elif kind == "multiple-blanks":
        item = _ASSESSMENT_BLANKS.get((topic, level))
        if item:
            text, answers, other = item
            options = [[answer, alternative] for answer, alternative in zip(answers, other)]
            for choices in options:
                SystemRandom().shuffle(choices)
            return _card(kind, topic, level, {"answers": list(answers), "text": text},
                         text=text, blankOptions=options)
    elif kind == "tap-the-error":
        item = _ASSESSMENT_ERRORS.get((topic, level))
        if item:
            sentence, position, correction = item
            words = sentence.split()
            key = {"index": position, "answer": f"'{words[position]}' → '{correction}'", "text": sentence}
            return _card(kind, topic, level, key, text="Tap the word that is wrong.", tokens=words)
    return None


def build_fallback(
    topic: str, level: str | None, practice_index: int | None = None,
    *, exact_type: str | None = None, lang: str | None = None,
) -> dict[str, Any] | None:
    index = max(0, practice_index or 0)
    if exact_type and exact_type != "multiple-choice":
        return _assessment_card(topic, level, exact_type, index, lang) if level in _BANDS else None

    candidates = [item for item in (*BANK, *_PRACTICE_VARIANTS) if item.topic == topic]
    if exact_type:
        pool = [item for item in candidates if item.level == level]
        if not pool:
            return None
    else:
        if not candidates:
            return None
        requested = _BANDS.index(level) if level in _BANDS else 1
        accessible = [item for item in candidates if _BANDS.index(item.level) <= requested]
        # Keep the item's authored band visible if the exact band is unavailable.
        band = (max if accessible else min)(_BANDS.index(item.level) for item in (accessible or candidates))
        pool = [item for item in (accessible or candidates) if _BANDS.index(item.level) == band]
    item = pool[index % len(pool)]
    options = [item.answer, *item.distractors]
    SystemRandom().shuffle(options)
    return _card("multiple-choice", topic, item.level, {"answer": item.answer, "text": item.text},
                 text=item.text, options=options)
