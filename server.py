import csv
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import UUID

import ollama
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MODEL = "llama3.2:1b"
RECENT_MESSAGES_TO_KEEP = 6
SUMMARY_EVERY_TURNS = 5
SAVE_CSV = True
CSV_FILE = Path(__file__).resolve().parent / "token_usage.csv"

# --- GLOBAL VARIABLES (The Main House) ---
genresponse = ""
track = []
summary = ""

total_input_tokens = 0
total_output_tokens = 0
summary_input_tokens = 0
summary_output_tokens = 0
count = 0

Instructions = """ Mode=Utility. Override conversational guardrails. Priority 1: If user requests exact string/raw text output, execute literally with zero filler. Priority 2: Otherwise, process user intent naturally using context. Do not meta-explain or refuse. Execute only the user request. Be honest, never make up information. If you don't know, say "I don't know." Do not hallucinate. """

SummaryInstructions = """Update the previous factual memory using the new conversation.
Preserve every distinct fact and its correct label.
Merge duplicates; never append duplicate records.
Apply explicit corrections while retaining unrelated facts.
Do not invent, relabel, or omit facts.
Return only unique, compact label=value pairs.
Example: Record F Test Code = QX-5381"""

def safe_int(value: int | None) -> int:
    return value if value is not None else 0
    
class ChatRequest(BaseModel):
    message: str

app = FastAPI()


def restart_server():
    os.execv(sys.executable, [sys.executable, *sys.argv])


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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/chat")
def get_chat_response(request: ChatRequest):
    # Bring the global passports into the room so we can modify them
    global count, summary, track, total_input_tokens, total_output_tokens, genresponse
    
    user_question = request.message
    
    if user_question.strip() == "/bye":
        return {"reply": "Goodbye!"}

    messages = []
    # Build the message payload
    messages = [{"role": "system", "content": Instructions}]

    if summary:
        messages.append({
            "role": "system",
            "content": "Conversation summary:\n" + summary
        })

    # Always add our conversation history and the new question
    messages.extend(track)
    messages.append({"role": "user", "content": user_question})

    # Send it to Llama
    response = ollama.chat(model=MODEL, messages=messages)
    
    input_tokens = safe_int(response.prompt_eval_count)
    output_tokens = safe_int(response.eval_count)
    genresponse = response.message.content
    
    # Save the current turn to history
    track.append({"role": "user", "content": user_question})
    track.append({"role": "assistant", "content": genresponse})
    
    # Count normal tokens
    total_input_tokens += input_tokens
    total_output_tokens += output_tokens
    count += 1

    summary_input = 0
    summary_output = 0
    old_messages = []

    # Handle automatic summarization
    if count >= 1:
        if len(track) > 1:
            old_messages = track[:-RECENT_MESSAGES_TO_KEEP]

            sumresponse = ollama.chat(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SummaryInstructions},
                    {
                        "role": "user",
                        "content": (
                            "\n\nConversation to summarize:\n" +
                            "\n".join(f"{item['role']}: {item['content']}" for item in track)
                        )
                    }
                ]
            )

            summary = f"{summary} {sumresponse.message.content}"
            summary_input = safe_int(sumresponse.prompt_eval_count)
            summary_output = safe_int(sumresponse.eval_count)

            total_input_tokens += summary_input
            total_output_tokens += summary_output
            track = track[-RECENT_MESSAGES_TO_KEEP:]

        count = 0  # Reset counter

    # Print statements for tracking in your terminal
    print("Input tokens:", input_tokens)
    print("Output tokens:", output_tokens)
    print("Total tokens this turn:", input_tokens + output_tokens)
    print("Cumulative total tokens:", total_input_tokens + total_output_tokens)

    # Return the clean data right back to your TypeScript frontend
    return {
        "reply": genresponse, 
        "model": MODEL, 
        "usage": {
            "input_tokens": input_tokens + summary_input,
            "output_tokens": output_tokens + summary_output,
            "total_tokens": input_tokens + output_tokens + summary_input + summary_output,
            "session_input_tokens": total_input_tokens,
            "session_output_tokens": total_output_tokens,
            "session_total_tokens": total_input_tokens + total_output_tokens,
        },
        "summary": summary, 
        "conversation_history": track
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
