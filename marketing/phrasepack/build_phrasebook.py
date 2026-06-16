#!/usr/bin/env python3
"""
Relo Dojo — lead magnet #2: "50 фраз для IT-релокации" phrasebook PDF.

Companion to the web mini-quiz (../quiz/index.html). Same motion (a free, forwardable asset
for RU/CIS IT relocants → install), same three journey stages as scenarioPacks.ts
(interview -> life abroad -> workplace). RU framing + usage notes, EN phrases.

Self-contained build: needs only reportlab + a Cyrillic TrueType font (reportlab's built-in
Helvetica has NO Cyrillic glyphs, so we register Arial/DejaVu). Run:

    python3 -m venv /tmp/pdfvenv && /tmp/pdfvenv/bin/pip install reportlab
    /tmp/pdfvenv/bin/python marketing/phrasepack/build_phrasebook.py

Output: marketing/phrasepack/relo-dojo-50-relocation-phrases.pdf
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, KeepTogether, FrameBreak,
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "relo-dojo-50-relocation-phrases.pdf")

# ── brand (mirrors mobile/theme/theme.ts + the landing/quiz) ──────────────────
ACCENT = HexColor("#0E8A30")
ACCENT_PRESS = HexColor("#0B6E26")
GOLD = HexColor("#E3A52C")
FIRE = HexColor("#F0801F")
INK = HexColor("#15201A")
INK2 = HexColor("#586A60")
INK3 = HexColor("#8A988F")
SURFACE2 = HexColor("#F2F7F3")
LINE = HexColor("#E7EDE8")

# ── fonts: register the first Cyrillic-capable TTF we can find ─────────────────
REG_CANDS = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
BOLD_CANDS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _first(paths):
    for p in paths:
        if os.path.isfile(p):
            return p
    return None


reg, bold = _first(REG_CANDS), _first(BOLD_CANDS)
if not reg or not bold:
    raise SystemExit("No Cyrillic TTF found — install Arial or DejaVu and update REG_CANDS/BOLD_CANDS.")
pdfmetrics.registerFont(TTFont("Brand", reg))
pdfmetrics.registerFont(TTFont("Brand-Bold", bold))
pdfmetrics.registerFontFamily("Brand", normal="Brand", bold="Brand-Bold")

# ── content: 50 phrases across the three relocation stages ────────────────────
# (en, ru-usage-note). EN is what to say; RU explains when/why.
STAGES = [
    ("Собеседование", "The interview", ACCENT, [
        ("Thanks for taking the time to meet with me.", "Вежливое начало звонка."),
        ("Can you hear me okay?", "Проверить связь в первые секунды созвона."),
        ("Sorry, you cut out — could you repeat that?", "Когда собеседник пропал/заглушился."),
        ("I've been working as a backend developer for four years.", "Про опыт. Present Perfect Continuous — стаж до сих пор."),
        ("My main focus has been payment systems.", "Чем занимался в основном."),
        ("In my current role, I'm responsible for the API.", "За что отвечаешь сейчас."),
        ("I led a small team of three engineers.", "Про лидерский опыт."),
        ("Let me give you a bit of context first.", "Перед развёрнутым ответом."),
        ("We disagreed at first, but we found a compromise.", "Поведенческий вопрос про конфликт."),
        ("Looking back, I'd approach it differently now.", "Показать рефлексию и рост."),
        ("Let me think out loud for a moment.", "В техническом интервью — рассуждать вслух."),
        ("There's a trade-off here between speed and consistency.", "Назвать компромисс в дизайне."),
        ("Correct me if I'm wrong, but…", "Мягко проверить своё понимание задачи."),
        ("I'm currently on a one-month notice period.", "Про сроки выхода. «notice period» — отработка."),
        ("What would the next steps look like?", "Узнать про процесс в конце."),
        ("Do you have any concerns I could address?", "Сильный закрывающий вопрос."),
    ]),
    ("Жизнь за границей", "Life abroad", FIRE, [
        ("I'd like to open a bank account, please.", "В банке. Счёт «open», не make/create."),
        ("Do I need an appointment, or can I do it now?", "Нужна ли запись."),
        ("What documents do you need from me?", "Какие документы принести."),
        ("Could you explain the fees?", "Уточнить комиссии."),
        ("I'm calling about the flat listed online.", "Звонок по объявлению о квартире."),
        ("Is the apartment still available?", "Свободна ли ещё."),
        ("How much is the deposit?", "Размер залога."),
        ("The heating isn't working — could you send someone?", "Сообщить хозяину о поломке."),
        ("When would be a good time to view it?", "Договориться о просмотре."),
        ("I'd like to register with a doctor near my home.", "Прикрепиться к врачу. «register with»."),
        ("I'd like to book an appointment, please.", "Записаться на приём."),
        ("Is this covered by my insurance?", "Покрывает ли страховка."),
        ("I need to sort out my residence registration.", "Оформить регистрацию по месту жительства."),
        ("I'm looking for a SIM card with a data plan.", "Симка с интернетом."),
        ("Sorry, my German is a bit rusty — could you speak slowly?", "Подзабыл язык (подставь свой)."),
        ("Excuse me, how do I get to the city centre?", "Спросить дорогу."),
        ("Could you point me in the right direction?", "Попросить подсказать, куда идти."),
    ]),
    ("Работа в команде", "Workplace", GOLD, [
        ("Yesterday I finished the auth bug; today I'll start on the API.", "Стендап. С «yesterday» — Past Simple."),
        ("I'm blocked on the deploy — I need access to staging.", "Назвать блокер прямо."),
        ("No blockers on my side.", "Когда всё идёт по плану."),
        ("I'll need another day to wrap this up.", "Честно сдвинуть срок на день."),
        ("Did you consider handling the null case here?", "Ревью: мягкое замечание вместо «ты забыл»."),
        ("Nice work — just one small suggestion.", "Похвалить и затем предложить."),
        ("Could you add a test for this edge case?", "Попросить тест на крайний случай."),
        ("LGTM — looks good to me.", "Одобрить PR. Частое сокращение."),
        ("Can you help me out when you get a chance?", "Попросить помощь. «help out» — выручить."),
        ("Just a heads-up: the release might slip to Friday.", "Заранее предупредить о сдвиге."),
        ("Let me loop in Sarah on this.", "Подключить коллегу к треду."),
        ("Quick question — do we have a deadline for this?", "Короткий вопрос в Slack."),
        ("I see your point, but I'd suggest a different approach.", "Вежливо не согласиться."),
        ("Could we revisit this in the next sync?", "Перенести обсуждение на следующий созвон."),
        ("Just to make sure I understood correctly…", "Переспросить, что понял верно."),
        ("Sorry to interrupt — can I add something?", "Вступить в разговор на митинге."),
        ("Thanks for the detailed review.", "Поблагодарить за подробное ревью."),
    ]),
]

TOTAL = sum(len(s[3]) for s in STAGES)
assert TOTAL == 50, f"expected 50 phrases, got {TOTAL}"

# ── styles ────────────────────────────────────────────────────────────────────
def style(name, **kw):
    base = dict(fontName="Brand", textColor=INK, leading=13)
    base.update(kw)
    return ParagraphStyle(name, **base)


S_KICKER = style("kicker", fontName="Brand-Bold", fontSize=9, textColor=ACCENT_PRESS, leading=12,
                 spaceAfter=2)
S_STAGE = style("stage", fontName="Brand-Bold", fontSize=17, textColor=INK, leading=20, spaceAfter=2)
S_STAGE_EN = style("stage_en", fontSize=10.5, textColor=INK3, leading=13, spaceAfter=10)
S_EN = style("en", fontName="Brand-Bold", fontSize=11, textColor=INK, leading=14)
S_RU = style("ru", fontSize=9, textColor=INK2, leading=12, spaceAfter=9)
S_NUM = style("num", fontName="Brand-Bold", fontSize=9, textColor=ACCENT, leading=14)

# cover styles
S_TITLE = style("title", fontName="Brand-Bold", fontSize=30, textColor=INK, leading=33,
                alignment=TA_CENTER, spaceAfter=6)
S_TITLE_HL = style("title_hl", fontName="Brand-Bold", fontSize=30, textColor=ACCENT, leading=33,
                   alignment=TA_CENTER)
S_SUB = style("sub", fontSize=13, textColor=INK2, leading=19, alignment=TA_CENTER)
S_EYEBROW = style("eyebrow", fontName="Brand-Bold", fontSize=10, textColor=ACCENT_PRESS,
                  leading=13, alignment=TA_CENTER, spaceAfter=6)
S_HOWTO = style("howto", fontSize=11, textColor=INK2, leading=17, alignment=TA_CENTER)
S_CTA = style("cta", fontName="Brand-Bold", fontSize=14, textColor=INK, leading=19,
              alignment=TA_CENTER)


# ── page furniture: belt strip (top) + footer, drawn on every page ────────────
def draw_torii(c, cx, top_y, size):
    """Mirror the SVG torii mark: rounded green tile, white gateway, gold plaque."""
    s = size / 64.0
    x0 = cx - size / 2.0

    def mx(dx):  # design x -> page x
        return x0 + dx * s

    def my(dy):  # design y (down) -> page y (up)
        return top_y - dy * s

    c.saveState()
    c.setFillColor(ACCENT)
    c.roundRect(x0, top_y - size, size, size, 15 * s, fill=1, stroke=0)
    c.setStrokeColor(white)
    c.setLineWidth(4.6 * s)
    c.setLineCap(1)
    c.line(mx(13), my(21), mx(51), my(21))   # top lintel
    c.line(mx(12), my(30), mx(52), my(30))   # tie beam
    c.line(mx(20), my(30), mx(20), my(52))   # left pillar
    c.line(mx(44), my(30), mx(44), my(52))   # right pillar
    c.setFillColor(GOLD)
    c.rect(mx(27), my(37), 10 * s, 7 * s, fill=1, stroke=0)  # plaque
    c.restoreState()


def furniture(c, doc):
    w, h = A4
    # belt strip across the very top
    y = h - 6
    c.setFillColor(ACCENT); c.rect(0, y, w * 0.60, 6, fill=1, stroke=0)
    c.setFillColor(GOLD);   c.rect(w * 0.60, y, w * 0.20, 6, fill=1, stroke=0)
    c.setFillColor(FIRE);   c.rect(w * 0.80, y, w * 0.20, 6, fill=1, stroke=0)
    # footer
    c.setFont("Brand", 8.5)
    c.setFillColor(INK3)
    c.drawString(18 * mm, 12 * mm, "Relo Dojo — английский для IT-релокации")
    c.drawRightString(w - 18 * mm, 12 * mm, "relodojo.app")
    if doc.page > 1:
        c.drawCentredString(w / 2.0, 12 * mm, str(doc.page))


# ── build ─────────────────────────────────────────────────────────────────────
def main():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
        title="50 фраз для IT-релокации — Relo Dojo",
        author="Relo Dojo", subject="English for IT relocation",
    )
    w, h = A4
    fw = w - doc.leftMargin - doc.rightMargin

    # cover is one full frame; content flows in two columns afterwards
    cover = Frame(doc.leftMargin, doc.bottomMargin, fw, h - doc.topMargin - doc.bottomMargin,
                  id="cover", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    gut = 8 * mm
    cw = (fw - gut) / 2.0
    colL = Frame(doc.leftMargin, doc.bottomMargin, cw, h - doc.topMargin - doc.bottomMargin,
                 id="L", leftPadding=0, rightPadding=6, topPadding=0, bottomPadding=0)
    colR = Frame(doc.leftMargin + cw + gut, doc.bottomMargin, cw,
                 h - doc.topMargin - doc.bottomMargin,
                 id="R", leftPadding=6, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover], onPage=furniture),
        PageTemplate(id="cols", frames=[colL, colR], onPage=furniture),
    ])

    story = []
    # ---- COVER ----
    story.append(Spacer(1, 26 * mm))
    story.append(_ToriiFlowable(width=fw, size=58))
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("БЕСПЛАТНЫЙ РАЗГОВОРНИК · RELO DOJO", S_EYEBROW))
    story.append(Paragraph("50 фраз для", S_TITLE))
    story.append(Paragraph("IT-релокации", S_TITLE_HL))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        "От собеседования на английском до первого стендапа за границей.<br/>"
        "Реальные фразы для банка, аренды, врача, код-ревью и Slack.", S_SUB))
    story.append(Spacer(1, 12 * mm))
    story.append(Paragraph(
        "Как пользоваться: сохрани на телефон, открой перед звонком или походом "
        "по делам и подсмотри нужную строку. Слева — что сказать по-английски, "
        "справа — когда и зачем.", S_HOWTO))
    story.append(Spacer(1, 1))
    story.append(_NextTemplate("cols"))
    story.append(FrameBreak())

    # ---- PHRASES (two columns) ----
    n = 0
    flat = []
    for ru_title, en_title, color, items in STAGES:
        head = [
            Paragraph("ЭТАП", _kicker(color)),
            Paragraph(ru_title, S_STAGE),
            Paragraph(en_title, S_STAGE_EN),
        ]
        flat.append(KeepTogether(head))
        for en, ru in items:
            n += 1
            flat.append(KeepTogether([
                Paragraph(f'<font name="Brand-Bold" color="#0E8A30">{n}.</font>&nbsp; {en}', S_EN),
                Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;{ru}", S_RU),
            ]))
    story.extend(flat)

    # ---- CLOSING CTA ----
    story.append(Spacer(1, 6 * mm))
    story.append(_Rule(color=LINE))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Хочешь довести это до автоматизма?", S_CTA))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "Relo Dojo тренирует те же ситуации на твоей же роли — по 5 минут в день, "
        "с разбором ошибок на русском. Пройди тест на свой пояс: "
        "<font name=\"Brand-Bold\" color=\"#0B6E26\">relodojo.app/quiz</font>", S_RU))

    doc.build(story)
    print("wrote", OUT, "·", os.path.getsize(OUT), "bytes")


# ── small custom flowables ────────────────────────────────────────────────────
from reportlab.platypus import Flowable, NextPageTemplate  # noqa: E402


def _kicker(color):
    return ParagraphStyle("k", fontName="Brand-Bold", fontSize=8.5, textColor=color,
                          leading=11, spaceAfter=1)


class _ToriiFlowable(Flowable):
    def __init__(self, width, size=58):
        super().__init__()
        self.width = width
        self.size = size
        self.height = size

    def draw(self):
        draw_torii(self.canv, self.width / 2.0, self.size, self.size)


class _Rule(Flowable):
    def __init__(self, color=LINE, thickness=1):
        super().__init__()
        self.color = color
        self.thickness = thickness
        self.height = thickness

    def wrap(self, aw, ah):
        self.width = aw
        return aw, self.thickness

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)


def _NextTemplate(tid):
    return NextPageTemplate(tid)


if __name__ == "__main__":
    main()
