import React, { useEffect, useRef, useState } from 'react';
import brainIcon from './assets/pngtree-ai-brain-icon-with-circuits-png-image_15855770.png';
import './App.css';

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  model?: string;
}

interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  session_input_tokens: number;
  session_output_tokens: number;
  session_total_tokens: number;
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== 'object' || value === null) return false;

  return (
    'input_tokens' in value &&
    (typeof value.input_tokens === 'number' || value.input_tokens === null) &&
    'output_tokens' in value &&
    (typeof value.output_tokens === 'number' || value.output_tokens === null) &&
    'total_tokens' in value &&
    (typeof value.total_tokens === 'number' || value.total_tokens === null) &&
    'session_input_tokens' in value &&
    typeof value.session_input_tokens === 'number' &&
    'session_output_tokens' in value &&
    typeof value.session_output_tokens === 'number' &&
    'session_total_tokens' in value &&
    typeof value.session_total_tokens === 'number'
  );
}

export function ChatComponent({ messages }: { messages: Message[] }) {
  // 1. Create a reference holder for the <main> element
  const chatMainRef = useRef<HTMLElement>(null);

  // 2. Automatically scroll whenever the messages array updates
  useEffect(() => {
    if (chatMainRef.current) {
      chatMainRef.current.scrollTop = chatMainRef.current.scrollHeight;
    }
  }, [messages]); // <-- This triggers the code every time a new message arrives

  return (
    /* 3. Link the ref to your HTML tag */
    <main className="chat-main" ref={chatMainRef}>
      {/* Your messages map loop goes here */}
    </main>
  );
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'assistant',
      text: 'Hello! How can I help you test your conversation model today?',
      model: ""
    },
  ]);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [restartError, setRestartError] = useState('');
  const [model, setModel] = useState<string>('Loading…');
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [sessionTotalTokens, setSessionTotalTokens] = useState<number>(0);
  const latestMessageRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

 
    

  const handleSend = async () => {
    const message = input.trim();
    if (!message || isSending || isRestarting) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: message,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setRequestError('');
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId }),
      });
      const responseText = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        if (!response.ok) {
          throw new Error(
            responseText || `The server returned ${response.status}.`,
          );
        }
        throw new Error('The server returned an invalid response.');
      }
      console.log("Payload JSON:", JSON.stringify(payload, null, 2));

      if (!response.ok) {
        const detail =
          typeof payload === 'object' &&
          payload !== null &&
          'detail' in payload &&
          typeof payload.detail === 'string'
            ? payload.detail
            : `The server returned ${response.status}.`;
        throw new Error(detail);
      }
      if (typeof payload !== 'object' || payload === null || !('reply' in payload)) {
        throw new Error(`Missing "reply".`);
      }

      const reply = payload.reply;
      if (typeof reply !== 'string') {
        throw new Error(`"reply" should be a string, received: ${typeof reply}`);
      }

      console.log('summary' in payload ? payload.summary : undefined);

      const assistantId = `${Date.now()}-assistant`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, sender: 'assistant', text: '' },
      ]);

      const responseModel =
        'model' in payload && typeof payload.model === 'string'
          ? payload.model
          : 'Unknown Model';

      setModel(responseModel);
      const responseUsage = 'usage' in payload ? payload.usage : undefined;
      setUsage(isTokenUsage(responseUsage) ? responseUsage : null);
      setSessionTotalTokens((prev) => prev + (usage?.total_tokens ?? 0));

      setIsTyping(true);
      const chunkSize = 3;
      for (let index = 0; index < reply.length; index += chunkSize) {
        const visibleText = reply.slice(0, index + chunkSize);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, text: visibleText } : msg,
          ),
        );
        await new Promise((resolve) => window.setTimeout(resolve, 15));
      }
    } catch (error) {
      setRequestError(
        error instanceof TypeError
          ? 'Could not reach the Python server. Start it with "python server.py".'
          : error instanceof Error
            ? error.message
            : 'The request failed unexpectedly.',
      );
    } finally {
      setIsTyping(false);
      setIsSending(false);
    }
  };

  const handleRestart = async () => {
    if (
      isRestarting ||
      !window.confirm('Restart the Python server? This will clear the current conversation.')
    ) {
      return;
    }

    setIsRestarting(true);
    setRestartError('');
    setRequestError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/restart`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`The server returned ${response.status}.`);
      }

      setMessages([
        {
          id: Date.now().toString(),
          sender: 'assistant',
          text: 'Server restarted. Start a new conversation whenever you’re ready.',
        },
      ]);
      setInput('');
      setModel('Loading…');
      setUsage(null);
      setSessionTotalTokens(0);
    } catch (error) {
      setRestartError(
        error instanceof Error ? error.message : 'The server could not be restarted.',
      );
    } finally {
      setIsRestarting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-app">
      <header className="chat-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src={brainIcon} alt="" />
          </div>
          <div>
            <p className="eyebrow">WEB SUMMARIZER</p>
            <h1>AI Summarization Test Bench</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="model-badge" aria-label={`Active model: ${model}`}>
            <span className="status-dot" aria-hidden="true" />
            <span className="model-details">
              <span className="model-label">ACTIVE MODEL</span>
              <span className="model-name">{model}</span>
            </span>
          </div>
          <button
            className="restart-button"
            onClick={handleRestart}
            disabled={isRestarting || isSending}
            aria-label="Restart Python server"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M16.2 7.2A6.5 6.5 0 1 0 16.4 11M16.2 3.8v3.8h-3.8" />
            </svg>
            <span>{isRestarting ? 'Restarting…' : 'Restart server'}</span>
          </button>
        </div>
      </header>
      {restartError && (
        <div className="restart-error" role="alert">
          Could not restart server: {restartError}
        </div>
      )}

      <main className="chat-main">
        <section className="conversation" aria-label="Conversation">
          <div className="conversation-heading">
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>Conversation</h2>
            <p className="conversation-subtitle">Try out a prompt and see how your assistant responds.</p>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.map((msg) => (
              <div key={msg.id} className={`message-row ${msg.sender}`}>
                {msg.sender === 'assistant' && <div className="assistant-avatar" aria-hidden="true"><img src={brainIcon} alt="" /></div>}
                <div className={`message-bubble ${msg.sender}`}>
                  <div className="message-sender">{msg.sender === 'user' ? 'You' : 'Assistant'}</div>
                  <p>{msg.text}</p>
                </div>
              </div>
            ))}
            <div ref={latestMessageRef} />
          </div>
          <div className="conversation-note">
            <span className="note-icon" aria-hidden="true">✦</span>
            Your messages are sent to the local Python server.
          </div>
        </section>
      </main>

      <footer className="composer-wrap">
        <div className="composer">
          <div className="composer-box">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRestarting}
              placeholder="Message your assistant..."
              aria-label="Message your assistant"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isSending || isRestarting}
              aria-label="Send message"
              title="Send message"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          </div>
          {requestError && <p className="request-error" role="alert">{requestError}</p>}
          <div className="composer-hint">
            <span>Enter to send <span className="hint-divider">·</span> Shift + Enter for a new line</span>
            <span>
              {isTyping
                ? 'Writing response…'
                : isSending
                  ? 'Contacting Python server…'
                  : 'Python API · /api/chat'}
            </span>
          </div>
          <div className="token-usage" aria-live="polite">
            {usage
              ? `Turn (reply + summary): ${usage.input_tokens ?? '—'} in / ${usage.output_tokens ?? '—'} out (${sessionTotalTokens ?? '—'} total) · Session: ${usage.session_total_tokens} tokens, Summary: ${usage.session_input_tokens} in / ${usage.session_output_tokens} out`
              : 'Token usage will appear after the first reply.'}
          </div>
        </div>
      </footer>
    </div>
  );
};
