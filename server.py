import csv
import os
import sys
from _thread import LockType
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Iterable, cast
from uuid import UUID
from groq import Groq
from groq.types.chat import ChatCompletionMessageParam
from dotenv import load_dotenv
import uuid
import re

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().with_name(".env"), override=True)
client = Groq()

MODEL = "openai/gpt-oss-20b"

def count_tokens(text: str) -> int:
    return len(text) // 4  # Rough estimate: 1 token ≈ 4 characters


SUMMARY_TOKEN_THRESHOLD = 3000
SAVE_CSV = True
CSV_FILE = Path(__file__).resolve().parent / "token_usage.csv"
summaryCount = 0

Instructions = """Follow user intent literally. Responses under 40 words unless specified. Be concise, honest, context-aware, and distinguish verified facts from assumptions. Never fabricate."""

SummaryInstructions = """Update the summary using new messages. Keep the summary concise (60-100 words). Preserve essential facts, decisions, preferences, sources, status, corrections, and uncertainty. Distinguish confirmed facts, suggestions, implementations, plans, and assumptions. Remove redundancy. Label all sources as fact, inference or question."""

def safe_int(value: int | None) -> int:
    return value if value is not None else 0
    
class ChatRequest(BaseModel):
    message: str
    session_id: UUID | None = None

@dataclass
class ConversationState:
    track: list[dict[str, str]] = field(default_factory=list)
    summary: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    lock: LockType = field(default_factory=Lock, repr=False)
    summary_used: list[dict[str, str]] = field(default_factory=list)
    summary_count: int = 0

app = FastAPI()
app.state.conversations = {}
app.state.conversations_lock = Lock()



def restart_server():
    os.execv(sys.executable, [sys.executable, *sys.argv])

def clean_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@app.get("/test")
def test_route():
    return {"message": "This is the correct server"}


@app.post("/api/restart")
def restart_server_route(background_tasks: BackgroundTasks):
    background_tasks.add_task(restart_server)
    return {"message": "Restarting server"}


# FIX CORS: This allows your TypeScript frontend to talk to this Python server!
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5500",
    ],
    allow_origin_regex=r"https://web-summarizer-.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/chat")
def get_chat_response(request: ChatRequest):
    conversation_id = str(request.session_id or uuid.uuid4())
    with app.state.conversations_lock:
        state = app.state.conversations.get(conversation_id)
        if state is None:
            state = ConversationState()
            app.state.conversations[conversation_id] = state
    with state.lock:
        return respond_to_chat(request.message, conversation_id, state)


def respond_to_chat(
    user_question: str, conversation_id: str, state: ConversationState
):
    if user_question.strip() == "/bye":
        return {"reply": "Goodbye!", "session_id": conversation_id}

    user_question = clean_whitespace(user_question)
    state.track.append({"role": "user", "content": user_question})

    summary_input = 0
    summary_output = 0
    recent = []

    if (
        state.track
        and state.input_tokens + state.output_tokens + count_tokens(user_question)
        > SUMMARY_TOKEN_THRESHOLD
    ):
        # Keep the newest message + up to 1,500 tokens out of the summary
         # Only protect the newest message if it fits inside the 1,500-token window
        running_tokens = 0
        for msg in reversed(state.track):
            msg_tokens = count_tokens(msg["content"])
            if running_tokens + msg_tokens > 1500:
                break
            recent.insert(0, msg)
            running_tokens += msg_tokens


        # Anything older than 'recent' that hasn't been summarized yet gets summarized now
        cutoff = len(state.track) - len(recent)
        
        older_messages = state.track[len(state.summary_used):cutoff]

        if older_messages:
            sumresponse = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SummaryInstructions},
                    {
                        "role": "user",
                        "content": (
                            "\n\nConversation to summarize:\n"
                            "Existing Summary:\n"
                            + state.summary
                            + "\n\nNew Messages\n"
                            + "\n".join(
                                f"{item['role']}: {item['content']}"
                                for item in older_messages
                            )
                        )
                    }
                ]
            )

            summary_input = safe_int(
                sumresponse.usage.prompt_tokens if sumresponse.usage else None
            )
            summary_output = safe_int(
                sumresponse.usage.completion_tokens if sumresponse.usage else None
            )

            state.input_tokens += summary_input
            state.output_tokens += summary_output
            updated_summary = sumresponse.choices[0].message.content
            if updated_summary and updated_summary.strip():
                state.summary = updated_summary.strip()
                state.summary_used.extend(older_messages)
                state.summary_count += 1
            else:
                # Fallback: keep a simple truncated snippet so we don't pay twice!
                fallback_text = " ".join(m["content"] for m in older_messages)[:400]
                state.summary = (state.summary + " " + fallback_text).strip()
                state.summary_used.extend(older_messages)
                state.summary_count += 1
                print("Summary returned empty; used truncated fallback to prevent double tokens.")

    messages: list[dict[str, str]] = [{"role": "system", "content": Instructions}]

    if state.summary:
        messages.append({
            "role": "system",
            "content": "Conversation summary:\n" + state.summary
        })

    # Send ONLY messages that have not been summarized yet
    unsummarized = state.track[len(state.summary_used):]
    messages.extend(unsummarized)
    messages.append({"role": "user", "content": user_question})

    response = client.chat.completions.create(
            model=MODEL,
            messages=cast(Iterable[ChatCompletionMessageParam], messages)
    )

    input_tokens = safe_int(response.usage.prompt_tokens if response.usage else None)
    output_tokens = safe_int(response.usage.completion_tokens if response.usage else None)
    genresponse = response.choices[0].message.content
    if genresponse is None:
            raise HTTPException(status_code=502, detail="The model returned no response.")
            
    genresponse = clean_whitespace(genresponse)
    state.track.append({"role": "assistant", "content": genresponse})
        
    state.input_tokens += input_tokens
    state.output_tokens += output_tokens

    print(state.summary)
    print(len(state.summary_used))
    print("Input tokens:", input_tokens)
    print("Output tokens:", output_tokens)
    print("Total tokens this turn:", input_tokens + output_tokens)
    print("Cumulative total tokens:", state.input_tokens + state.output_tokens)
    print("Summary count:", state.summary_count)

    return {
            "reply": genresponse,
            "model": MODEL,
            "session_id": conversation_id,
            "usage": {
                "input_tokens": input_tokens + summary_input,
                "output_tokens": output_tokens + summary_output,
                "total_tokens": input_tokens + output_tokens + summary_input + summary_output,
                "session_input_tokens": state.input_tokens,
                "session_output_tokens": state.output_tokens,
                "session_total_tokens": state.input_tokens + state.output_tokens,
            },
            "summary": state.summary,
            "conversation_history": state.track
    }


if __name__ == "__main__":
    from threading import Thread

    def listen_for_restart():
        for command in sys.stdin:
            if command.strip() == "/restart":
                restart_server()

    if sys.stdin is not None:
        print("Type /restart in this terminal to restart the server.", flush=True)
        Thread(target=listen_for_restart, daemon=True).start()

    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
