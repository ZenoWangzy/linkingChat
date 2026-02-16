import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import type { MessageResponse, ConverseResponse } from '@linkingchat/ws-protocol';

interface ChatThreadProps {
  converseId: string;
  onGroupInfoClick?: () => void;
}

export function ChatThread({ converseId, onGroupInfoClick }: ChatThreadProps) {
  const { messages, typingUsers, hasMore, cursors, prependMessages } =
    useChatStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const loadingRef = useRef(false);

  const converse = useChatStore((s) =>
    s.converses.find((c) => c.id === converseId),
  );
  const currentUserId = useChatStore((s) => s.currentUserId);
  const msgs = messages[converseId] ?? [];
  const typing = typingUsers[converseId] ?? [];

  // Fetch messages on mount / converseId change
  useEffect(() => {
    async function fetchMessages() {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const token = await window.electronAPI.getToken();
        if (!token) return;

        const res = await fetch(
          `http://localhost:3008/api/v1/messages?converseId=${converseId}&limit=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          const items: MessageResponse[] = data.messages ?? [];
          const next: string | null = data.nextCursor ?? null;
          const more = data.hasMore ?? false;
          prependMessages(converseId, items, more, next);
        }
      } catch (e) {
        console.error('Failed to fetch messages:', e);
      } finally {
        loadingRef.current = false;
      }
    }

    // Only fetch if we don't have messages yet
    if ((messages[converseId] ?? []).length === 0) {
      fetchMessages();
    }
  }, [converseId]);

  // Scroll to bottom on new messages (if user was at bottom)
  useEffect(() => {
    if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs.length]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check if at bottom
    const threshold = 60;
    wasAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    // Load more at top
    if (el.scrollTop < 40 && hasMore[converseId] && !loadingRef.current) {
      loadOlderMessages();
    }
  }, [converseId, hasMore]);

  async function loadOlderMessages() {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const el = containerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    try {
      const token = await window.electronAPI.getToken();
      if (!token) return;

      const cursor = cursors[converseId];
      let url = `http://localhost:3008/api/v1/messages?converseId=${converseId}&limit=50`;
      if (cursor) url += `&cursor=${cursor}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const items: MessageResponse[] = data.messages ?? [];
        const next: string | null = data.nextCursor ?? null;
        const more = data.hasMore ?? false;
        prependMessages(converseId, items, more, next);

        // Maintain scroll position after prepend
        requestAnimationFrame(() => {
          if (el) {
            el.scrollTop = el.scrollHeight - prevScrollHeight;
          }
        });
      }
    } catch (e) {
      console.error('Failed to load older messages:', e);
    } finally {
      loadingRef.current = false;
    }
  }

  // Messages are stored newest-first, reverse for display
  const displayMsgs = [...msgs].reverse();

  return (
    <div className="chat-thread">
      <div className="chat-thread-header">
        <div className="chat-thread-title">
          <span className="chat-thread-name">
            {getConverseName(converse, currentUserId)}
          </span>
          {converse?.type === 'GROUP' && converse.memberCount && (
            <span className="chat-thread-members">
              {converse.memberCount} members
            </span>
          )}
        </div>
        {onGroupInfoClick && (
          <button className="chat-thread-info-btn" onClick={onGroupInfoClick} title="Group Info">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        )}
      </div>

      <div
        className="chat-thread-messages"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {hasMore[converseId] && (
          <div className="chat-load-more">Loading older messages...</div>
        )}
        {displayMsgs.map((msg, i) => {
          const prev = i > 0 ? displayMsgs[i - 1] : null;
          const showDate = !prev || !isSameDay(msg.createdAt, prev.createdAt);
          const showAuthor =
            !prev ||
            prev.authorId !== msg.authorId ||
            showDate;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="chat-date-separator">
                  <span>{formatDateSeparator(msg.createdAt)}</span>
                </div>
              )}
              <div
                className={`chat-message ${showAuthor ? 'with-avatar' : 'compact'}`}
              >
                {showAuthor && (
                  <div className="chat-message-avatar">
                    {(msg.author?.displayName ?? msg.author?.username ?? '?')
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}
                <div className="chat-message-body">
                  {showAuthor && (
                    <div className="chat-message-header">
                      <span className="chat-message-author">
                        {msg.author?.displayName ?? msg.author?.username}
                      </span>
                      <span className="chat-message-time">
                        {formatTime(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className="chat-message-content">{msg.content}</div>
                </div>
              </div>
            </div>
          );
        })}

        {typing.length > 0 && (
          <div className="chat-typing">
            <div className="chat-typing-dots">
              <span />
              <span />
              <span />
            </div>
            <span className="chat-typing-text">
              {typing.length === 1
                ? 'Someone is typing...'
                : `${typing.length} people are typing...`}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function getConverseName(c?: ConverseResponse, currentUserId?: string | null): string {
  if (!c) return 'Chat';
  if (c.name) return c.name;
  // DM: show the OTHER person's name
  if (c.members.length > 0) {
    const other = currentUserId
      ? c.members.find((m) => m.userId !== currentUserId)
      : null;
    const target = other ?? c.members[0];
    return target.displayName ?? target.username ?? 'Unknown';
  }
  return 'Unnamed';
}

function isSameDay(a: string, b: string): boolean {
  try {
    return new Date(a).toDateString() === new Date(b).toDateString();
  } catch {
    return false;
  }
}

function formatDateSeparator(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
