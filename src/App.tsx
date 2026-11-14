import React, { useEffect, useRef, useState } from 'react';
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

type IconName =
  | 'chart'
  | 'check'
  | 'chevron'
  | 'collapse'
  | 'message'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    chart: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /></>,
    check: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    collapse: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="m15 9 3 3-3 3" /></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5l3 5" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
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

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const matches = Array.from(text.matchAll(/(\*\*.*?\*\*|__.*?__|\*.*?\*|_.*?_\b|`.*?`|\[.*?\]\(.*?\)|~~.*?~~)/g));

  if (!matches.length) {
    return [text];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match) => {
    const matchText = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    if (matchText.startsWith('**') && matchText.endsWith('**')) {
      nodes.push(<strong key={`${matchText}-${start}`}>{matchText.slice(2, -2)}</strong>);
    } else if (matchText.startsWith('__') && matchText.endsWith('__')) {
      nodes.push(<strong key={`${matchText}-${start}`}>{matchText.slice(2, -2)}</strong>);
    } else if (matchText.startsWith('[') && matchText.includes('](') && matchText.endsWith(')')) {
      const end = matchText.lastIndexOf('](');
      const label = matchText.slice(1, end);
      const href = matchText.slice(end + 2, -1);
      nodes.push(
        <a key={`${matchText}-${start}`} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else if (matchText.startsWith('~~') && matchText.endsWith('~~')) {
      nodes.push(<del key={`${matchText}-${start}`}>{matchText.slice(2, -2)}</del>);
    } else if (matchText.startsWith('`') && matchText.endsWith('`')) {
      nodes.push(<code key={`${matchText}-${start}`}>{matchText.slice(1, -1)}</code>);
    } else if ((matchText.startsWith('*') || matchText.startsWith('_')) && matchText.endsWith(matchText[0])) {
      nodes.push(<em key={`${matchText}-${start}`}>{matchText.slice(1, -1)}</em>);
    } else {
      nodes.push(matchText);
    }

    lastIndex = start + matchText.length;
  });

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderMarkdownText(text: string): React.ReactNode[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim());

  return blocks.flatMap((block, blockIndex) => {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const trimmed = lines.map((line) => line.trim());

    if (trimmed.every((line) => /^\|.*\|$/.test(line))) {
      const rows = trimmed.map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
      const [header, ...bodyRows] = rows;
      const separator = bodyRows[0] ?? [];
      const isTable =
        header.length > 0 &&
        separator.length === header.length &&
        separator.every((cell) => /^:?-{3,}:?$/.test(cell));

      if (isTable) {
        const tableBody = bodyRows.slice(1).map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => (
              <td key={`${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell)}</td>
            ))}
          </tr>
        ));

        return [
          <table key={`table-${blockIndex}`} className="markdown-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`header-${cellIndex}`}>{renderInlineMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>{tableBody}</tbody>
          </table>,
        ];
      }
    }

    if (trimmed.every((line) => /^#{1,6}\s+.+$/.test(line))) {
      const heading = trimmed[0];
      const level = (heading.match(/^#+/)?.[0] ?? '#').length;
      const content = heading.replace(/^#{1,6}\s+/, '');
      return [
        React.createElement(`h${Math.min(level, 6)}`, { key: `heading-${blockIndex}` }, renderInlineMarkdown(content)),
      ];
    }

    if (trimmed.every((line) => /^[-*+]\s+.+$/.test(line))) {
      return [
        <ul key={`list-${blockIndex}`}>
          {trimmed.map((line, index) => (
            <li key={`${blockIndex}-${index}`}>{renderInlineMarkdown(line.replace(/^[-*+]\s+/, ''))}</li>
          ))}
        </ul>,
      ];
    }

    if (trimmed.every((line) => /^\d+\.\s+.+$/.test(line))) {
      return [
        <ol key={`ordered-list-${blockIndex}`}>
          {trimmed.map((line, index) => (
            <li key={`${blockIndex}-${index}`}>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>
          ))}
        </ol>,
      ];
    }

    if (trimmed.length === 1 && /^---+$/.test(trimmed[0])) {
      return [<hr key={`hr-${blockIndex}`} />];
    }

    if (trimmed.length === 1 && /^>\s*.+$/.test(trimmed[0])) {
      return [
        <blockquote key={`quote-${blockIndex}`}>
          {renderInlineMarkdown(trimmed[0].replace(/^>\s*/, ''))}
        </blockquote>,
      ];
    }

    if (trimmed.length === 1 && /^```/.test(trimmed[0])) {
      const codeLines = lines.slice(1, -1);
      return [
        <pre key={`code-${blockIndex}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      ];
    }

    return [
      <p key={`paragraph-${blockIndex}`}>{renderInlineMarkdown(lines.join(' '))}</p>,
    ];
  });
}

const starterPrompts = [
  'Summarize an article',
  'Compare two papers',
  'Tidy up my notes',
];

const TITLE_LENGTH = 35;
const formatTokens = (tokens: number) => new Intl.NumberFormat('en-US').format(tokens);

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'assistant',
      text: 'Hey, what would you like to summarize?',
      model: '',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [requestError, setRequestError] = useState('');
  const [restartError, setRestartError] = useState('');
  const [model, setModel] = useState('Loading…');
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [conversationSummary, setConversationSummary] = useState('');
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sessionTotalTokens, setSessionTotalTokens] = useState(0);
  const latestMessageRef = useRef<HTMLDivElement>(null);

  const firstUserMessage = messages.find((message) => message.sender === 'user');
  const conversationTitle = firstUserMessage
    ? firstUserMessage.text.length > TITLE_LENGTH
      ? `${firstUserMessage.text.slice(0, TITLE_LENGTH)}…`
      : firstUserMessage.text
    : 'New conversation';
  const isConversationVisible = conversationTitle
    .toLowerCase()
    .includes(conversationSearch.trim().toLowerCase());
  const sessionInputTokens = usage?.session_input_tokens ?? 0;
  const sessionOutputTokens = usage?.session_output_tokens ?? 0;
  const tokenSplit = sessionInputTokens + sessionOutputTokens;
  const inputShare = tokenSplit ? (sessionInputTokens / tokenSplit) * 100 : 50;

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  const handleNewConversation = () => {
    if (isSending || isRestarting) return;

    setMessages([
      {
        id: `${Date.now()}-welcome`,
        sender: 'assistant',
        text: 'Hey, what would you like to summarize?',
      },
    ]);
    setInput('');
    setSessionId(crypto.randomUUID());
    setUsage(null);
    setConversationSummary('');
    setSessionTotalTokens(0);
    setRequestError('');
    setRestartError('');
    setModel('Loading…');
  };

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
          throw new Error(responseText || `The server returned ${response.status}.`);
        }
        throw new Error('The server returned an invalid response.');
      }

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
        throw new Error('Missing "reply".');
      }

      const reply = payload.reply;
      if (typeof reply !== 'string') {
        throw new Error(`"reply" should be a string, received: ${typeof reply}`);
      }

      setConversationSummary(
        'summary' in payload && typeof payload.summary === 'string'
          ? payload.summary
          : '',
      );

      const assistantId = `${Date.now()}-assistant`;
      setMessages((prev) => [...prev, { id: assistantId, sender: 'assistant', text: '' }]);

      const responseModel =
        'model' in payload && typeof payload.model === 'string'
          ? payload.model
          : 'Unknown Model';

      setModel(responseModel);
      const responseUsage = 'usage' in payload ? payload.usage : undefined;
      const tokenUsage = isTokenUsage(responseUsage) ? responseUsage : null;
      setUsage(tokenUsage);
      setSessionTotalTokens(tokenUsage?.session_total_tokens ?? 0);

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
      setConversationSummary('');
      setSessionTotalTokens(0);
      setSessionId(crypto.randomUUID());
    } catch (error) {
      setRestartError(
        error instanceof Error ? error.message : 'The server could not be restarted.',
      );
    } finally {
      setIsRestarting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`chat-app${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <Icon name="message" />
            </div>
            <span className="brand-name">Sumarize</span>
          </div>
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="collapse" />
          </button>
        </div>

        <button
          className="new-chat-button"
          onClick={handleNewConversation}
          disabled={isSending || isRestarting}
        >
          <Icon name="plus" />
          <span>New conversation</span>
        </button>

        <label className="search-box">
          <Icon name="search" />
          <input
            type="search"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search current conversation"
          />
        </label>

        <div className="recent-heading">
          <span>Recent conversations</span>
          <Icon name="chevron" />
        </div>
        <div className="recent-list">
          {isConversationVisible && (
            <div className="recent-item active" title={conversationTitle} aria-current="page">
              <Icon name="message" />
              <span className="recent-title">{conversationTitle}</span>
              <span className="active-indicator" />
            </div>
          )}
          {!isConversationVisible && (
            <p className="empty-search">No matching conversation</p>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-status">
            <span className="status-orb" />
            <div>
              <span className="status-label">Current session</span>
              <span className="status-value">Token counts at a glance</span>
            </div>
          </div>
          <div className="profile-row">
            <div className="profile-avatar">S</div>
            <div className="profile-copy">
              <span>Sumarize</span>
              <small>Conversation workspace</small>
            </div>
            <Icon name="chevron" />
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="project-heading">
            <span className="breadcrumb">WORKSPACE <span>/</span> CONVERSATION</span>
            <h1 title={conversationTitle}>{conversationTitle}</h1>
          </div>
          <div className="header-actions">
            <div className="model-badge" aria-label={`Active model: ${model}`}>
              <span className="status-dot" aria-hidden="true" />
              <span className="model-details">
                <span className="model-label">MODEL</span>
                <span className="model-name">{model}</span>
              </span>
              <Icon name="chevron" />
            </div>
            <button
              className="restart-button"
              onClick={handleRestart}
              disabled={isRestarting || isSending}
              aria-label="Restart Python server"
              title="Restart Python server"
            >
              <Icon name="refresh" />
              <span>{isRestarting ? 'Restarting…' : 'Restart'}</span>
            </button>
          </div>
        </header>

        {restartError && (
          <div className="restart-error" role="alert">
            Could not restart server: {restartError}
          </div>
        )}

        <section className="conversation" aria-label="Conversation">
          <div className="conversation-intro">
            <div>
              <p className="eyebrow">YOUR CONVERSATION</p>
              <h2>What are we <span>working on?</span></h2>
              <p className="conversation-subtitle">
                Paste something to summarize or start with a question.
              </p>
            </div>
          </div>

          {conversationSummary && (
            <section className="conversation-summary" aria-live="polite">
              <div className="summary-icon"><Icon name="message" /></div>
              <div>
                <p className="eyebrow">CONVERSATION SUMMARY</p>
                <div className="markdown-content">{renderMarkdownText(conversationSummary)}</div>
              </div>
            </section>
          )}

          <div className="message-list" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`message-row ${message.sender}`}>
                {message.sender === 'assistant' && (
                  <div className="assistant-avatar" aria-hidden="true">
                    <Icon name="message" />
                  </div>
                )}
                <div className={`message-bubble ${message.sender}`}>
                  <div className="message-meta">
                    <span>{message.sender === 'user' ? 'You' : 'Assistant'}</span>
                  </div>
                  <div className="markdown-content">{renderMarkdownText(message.text)}</div>
                </div>
              </div>
            ))}
            <div ref={latestMessageRef} />
          </div>

          {messages.length === 1 && (
            <div className="starter-prompts" aria-label="Suggested prompts">
              <span className="starter-label">Try one of these</span>
              <div className="starter-list">
                {starterPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => setInput(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          <div className="composer">
            <div className="composer-box">
              <textarea
                rows={2}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isRestarting}
                placeholder="Write a message or paste text…"
                aria-label="Message your assistant"
              />
              <div className="composer-controls">
                <span className="composer-hint">Shift + Enter for a new line</span>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isSending || isRestarting}
                  aria-label="Send message"
                  title="Send message"
                >
                  <Icon name="send" />
                </button>
              </div>
            </div>
            {requestError && <p className="request-error" role="alert">{requestError}</p>}
            <div className="composer-footer">
              <span><span className="footer-status-dot" /> Model: {model}</span>
              <span>
                {isTyping
                  ? 'Writing response…'
                  : isSending
                    ? 'Contacting Python server…'
                    : usage
                      ? `This reply · ${formatTokens(usage.total_tokens ?? 0)} tokens`
                      : 'Ready when you are'}
              </span>
            </div>
          </div>
        </footer>
      </main>

      <aside className="insights-rail" aria-label="Conversation insights">
        <div className="insights-header">
          <div className="insights-title">
            <span className="insights-icon"><Icon name="chart" /></span>
            <span>Token usage</span>
          </div>
          <span className="live-label">SESSION</span>
        </div>

        <section className="stats-card token-card">
          <div className="card-overline">THIS SESSION</div>
          <div className="total-token-value">{formatTokens(sessionTotalTokens)}</div>
          <div className="token-caption">
            {usage ? 'Tokens used so far' : 'No replies yet'}
          </div>
          <div className="token-breakdown">
            <div className="token-breakdown-item">
              <span className="token-key"><span className="token-dot input-dot" />Input</span>
              <strong>{formatTokens(sessionInputTokens)}</strong>
            </div>
            <div className="token-breakdown-item">
              <span className="token-key"><span className="token-dot output-dot" />Output</span>
              <strong>{formatTokens(sessionOutputTokens)}</strong>
            </div>
          </div>
          <div
            className="token-comparison"
            role="img"
            aria-label={`${Math.round(inputShare)} percent input tokens and ${Math.round(100 - inputShare)} percent output tokens`}
          >
            <span style={{ width: `${inputShare}%` }} />
            <span style={{ width: `${100 - inputShare}%` }} />
          </div>
        </section>

        <section className="stats-card saved-card">
          <div className="saved-card-heading">
            <span className="saved-icon"><Icon name="message" /></span>
            <span>Summary</span>
          </div>
          <div className={`summary-state${conversationSummary ? ' is-ready' : ''}`}>
            <span className="summary-state-dot"><Icon name={conversationSummary ? 'check' : 'message'} /></span>
            <span>{conversationSummary ? 'Ready' : 'Not started'}</span>
          </div>
          <p>
            {conversationSummary
              ? 'Key details from this conversation.'
              : 'A summary appears as the conversation grows.'}
          </p>
          {conversationSummary && <div className="summary-preview">{conversationSummary}</div>}
        </section>

        <section className="stats-card response-card">
          <div className="response-card-heading">
            <span className="response-icon"><Icon name="message" /></span>
            <span>Most recent reply</span>
          </div>
          <div className="response-stat">
            <span>Input</span>
            <strong>{usage?.input_tokens == null ? '—' : formatTokens(usage.input_tokens)}</strong>
          </div>
          <div className="response-stat">
            <span>Output</span>
            <strong>{usage?.output_tokens == null ? '—' : formatTokens(usage.output_tokens)}</strong>
          </div>
          <div className="response-footnote">
            <Icon name="check" />
            {usage ? 'Tokens reported by the model' : 'Waiting for first response'}
          </div>
        </section>

        <div className="insights-footer">
          <span className="footer-check"><Icon name="check" /></span>
          <span>Counts update after each reply</span>
        </div>
      </aside>

      <div className="compact-token-pill" aria-live="polite">
        <Icon name="chart" />
        {formatTokens(sessionTotalTokens)} tokens
      </div>
    </div>
  );
}
