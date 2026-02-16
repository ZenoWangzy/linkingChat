import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { CreateGroupDialog } from './CreateGroupDialog';
import type { ConverseResponse } from '@linkingchat/ws-protocol';

export function ConversationList() {
  const navigate = useNavigate();
  const { converses, activeConverseId, markConverseRead, currentUserId } = useChatStore();
  const [search, setSearch] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  // Filter and sort
  const filtered = converses
    .filter((c) => {
      if (!search) return true;
      const name = getConverseName(c, currentUserId);
      return name.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      // Pinned bots first
      const aPinned = (a as any).isPinned ?? false;
      const bPinned = (b as any).isPinned ?? false;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      // Then by updatedAt
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <h2>Chats</h2>
        <button
          className="create-group-btn"
          onClick={() => setShowCreateGroup(true)}
          title="Create Group"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="23" y1="11" x2="17" y2="11" />
            <line x1="20" y1="8" x2="20" y2="14" />
          </svg>
        </button>
      </div>
      <div className="conversation-search">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="conversation-items">
        {filtered.length === 0 && (
          <div className="conversation-empty">No conversations</div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`conversation-item ${activeConverseId === c.id ? 'active' : ''}`}
            onClick={() => {
              markConverseRead(c.id);
              navigate(`/chat/${c.id}`);
            }}
          >
            <div className="conversation-avatar">
              {getAvatarLetter(c, currentUserId)}
            </div>
            <div className="conversation-info">
              <div className="conversation-name-row">
                <span className="conversation-name">{getConverseName(c, currentUserId)}</span>
                {c.lastMessage && (
                  <span className="conversation-time">
                    {formatTime(c.lastMessage.createdAt)}
                  </span>
                )}
              </div>
              <div className="conversation-preview-row">
                <span className="conversation-preview">
                  {c.lastMessage?.content ?? ''}
                </span>
                {(c.unreadCount ?? 0) > 0 && (
                  <span className="unread-badge">
                    {(c.unreadCount ?? 0) > 99 ? '99+' : c.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <CreateGroupDialog
        open={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
      />
    </div>
  );
}

function getConverseName(c: ConverseResponse, currentUserId: string | null): string {
  const ext = c as any;
  if (ext.botInfo?.name) return ext.botInfo.name;
  if (c.name) return c.name;
  // DM: show the OTHER person's name, not your own
  if (c.members.length > 0) {
    const other = currentUserId
      ? c.members.find((m) => m.userId !== currentUserId)
      : null;
    const target = other ?? c.members[0];
    return target.displayName ?? target.username ?? 'Unknown';
  }
  return 'Unnamed';
}

function getAvatarLetter(c: ConverseResponse, currentUserId: string | null): string {
  const name = getConverseName(c, currentUserId);
  return name.charAt(0).toUpperCase() || '?';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
