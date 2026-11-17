"""Explicit input/output contracts. Exact quotes check provenance, not medical truth."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Evidence(StrictModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(pattern=r"^https://", max_length=2000)
    text: str = Field(min_length=20, max_length=6000)

class Query(StrictModel):
    question: str = Field(min_length=3, max_length=1600)
    role: Literal["general", "clinician"]
    mode: Literal["search", "chat"] = "search"
    topic_kind: Literal["knowledge", "condition"] = "knowledge"
    evidence: list[Evidence] = Field(default_factory=list, max_length=12)
    history: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def bounded_context(self):
        if len({s.id for s in self.evidence}) != len(self.evidence):
            raise ValueError("Evidence IDs must be unique")
        if sum(len(s.text) for s in self.evidence) > 24000 or any(len(h) > 1200 for h in self.history):
            raise ValueError("Evidence or history exceeds research context limit")
        return self

class Citation(StrictModel):
    source_id: str
    quote: str = Field(min_length=20, max_length=1500)

class Claim(StrictModel):
    text: str = Field(min_length=3, max_length=1000)
    citations: list[Citation] = Field(min_length=1, max_length=3)

class Deck(StrictModel):
    id: int = Field(ge=1, le=6)
    claims: list[Claim] = Field(default_factory=list, max_length=3)

class Answer(StrictModel):
    status: Literal["answer", "clarify", "refuse", "insufficient_evidence"]
    message: str = Field(default="", max_length=1000)
    answer: list[Claim] = Field(default_factory=list, max_length=4)
    decks: list[Deck] = Field(default_factory=list, max_length=6)
    choices: list[str] = Field(default_factory=list, max_length=4)


def validate_answer(value, query: Query) -> Answer:
    result = Answer.model_validate(value)
    if result.status != "answer":
        if result.answer or result.decks:
            raise ValueError("Non-answer responses cannot contain medical claims")
        if result.status == "clarify" and not 2 <= len(result.choices) <= 4:
            raise ValueError("Clarification requires two to four options")
        if not result.message.strip():
            raise ValueError("Non-answer responses must explain their status")
    else:
        if not result.answer:
            raise ValueError("A direct answer is required before decks")
        expected = list(range(1, 7)) if query.mode == "search" else []
        if [d.id for d in result.decks] != expected:
            raise ValueError("Search requires six ordered decks; chat requires none")
        if result.choices or result.message:
            raise ValueError("Put medical content in cited claims, not uncited messages")
    if result.status != "clarify" and result.choices:
        raise ValueError("Choices belong only to clarification responses")
    evidence = {s.id: s for s in query.evidence}
    for claim in [*result.answer, *(c for d in result.decks for c in d.claims)]:
        for citation in claim.citations:
            source = evidence.get(citation.source_id)
            if source is None or citation.quote not in source.text:
                raise ValueError("Citation is absent from supplied evidence")
    return result
