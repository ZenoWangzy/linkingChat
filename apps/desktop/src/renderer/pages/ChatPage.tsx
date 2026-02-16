import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatThread } from '../components/chat/ChatThread';
import { MessageInput } from '../components/chat/MessageInput';
import { GroupPanel } from '../components/chat/GroupPanel';

export function ChatPage() {
  const { converseId } = useParams<{ converseId?: string }>();
  const { setActiveConverse } = useChatStore();
  const [showGroupPanel, setShowGroupPanel] = useState(false);

  const converse = useChatStore((s) =>
    converseId ? s.converses.find((c) => c.id === converseId) : undefined,
  );
  const isGroup = converse?.type === 'GROUP';

  useEffect(() => {
    setActiveConverse(converseId ?? null);
  }, [converseId, setActiveConverse]);

  // Close group panel when switching conversations
  useEffect(() => {
    setShowGroupPanel(false);
  }, [converseId]);

  // Fetch converses on mount
  useEffect(() => {
    async function fetchConverses() {
      const token = await window.electronAPI.getToken();
      if (!token) return;

      try {
        const res = await fetch('http://localhost:3008/api/v1/converses', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          useChatStore.getState().setConverses(data);
        }
      } catch (e) {
        console.error('Failed to fetch converses:', e);
      }
    }
    fetchConverses();
  }, []);

  return (
    <div className="chat-page">
      <div className="chat-sidebar">
        <ConversationList />
      </div>
      <div className="chat-main">
        {converseId ? (
          <>
            <ChatThread
              converseId={converseId}
              onGroupInfoClick={isGroup ? () => setShowGroupPanel((v) => !v) : undefined}
            />
            <MessageInput converseId={converseId} />
          </>
        ) : (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <p>Select a conversation</p>
          </div>
        )}
      </div>
      {showGroupPanel && converseId && isGroup && (
        <div className="chat-right-panel">
          <GroupPanel
            converseId={converseId}
            onClose={() => setShowGroupPanel(false)}
          />
        </div>
      )}
    </div>
  );
}
