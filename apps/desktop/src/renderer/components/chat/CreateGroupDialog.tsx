import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface CreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateGroupDialog({ open, onClose }: CreateGroupDialogProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Load friends list when dialog opens
  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setSelectedIds(new Set());
    setError('');
    loadFriends();
  }, [open]);

  async function loadFriends() {
    setFriendsLoading(true);
    try {
      const token = await window.electronAPI.getToken();
      if (!token) return;
      const res = await fetch('http://localhost:3008/api/v1/friends', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFriends(data);
      }
    } catch (e) {
      console.error('Failed to load friends:', e);
    } finally {
      setFriendsLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Select at least one member');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const token = await window.electronAPI.getToken();
      if (!token) return;
      const res = await fetch('http://localhost:3008/api/v1/converses/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          memberIds: Array.from(selectedIds),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onClose();
        // Navigate to the new group
        if (data.id) {
          navigate(`/chat/${data.id}`);
        }
        // Refresh converses list
        const listRes = await fetch('http://localhost:3008/api/v1/converses', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (listRes.ok) {
          useChatStore.getState().setConverses(await listRes.json());
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.message || `Failed to create group (${res.status})`);
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Create Group</h3>
          <button className="dialog-close" onClick={onClose}>&times;</button>
        </div>

        <div className="dialog-body">
          <div className="dialog-field">
            <label>Group Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter group name"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="dialog-field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={500}
            />
          </div>

          <div className="dialog-field">
            <label>Members ({selectedIds.size} selected)</label>
            <div className="dialog-member-list">
              {friendsLoading && (
                <div className="dialog-loading">Loading friends...</div>
              )}
              {!friendsLoading && friends.length === 0 && (
                <div className="dialog-loading">No friends to add</div>
              )}
              {friends.map((f) => (
                <div
                  key={f.id}
                  className={`dialog-member-item ${selectedIds.has(f.id) ? 'selected' : ''}`}
                  onClick={() => toggleSelect(f.id)}
                >
                  <div className="dialog-member-checkbox">
                    {selectedIds.has(f.id) ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="#4361ee">
                        <rect width="16" height="16" rx="3" />
                        <path d="M4 8l3 3 5-6" stroke="#fff" strokeWidth="1.5" fill="none" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" stroke="#4a5568" />
                      </svg>
                    )}
                  </div>
                  <div className="dialog-member-avatar">
                    {(f.displayName ?? f.username).charAt(0).toUpperCase()}
                  </div>
                  <span className="dialog-member-name">
                    {f.displayName ?? f.username}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="dialog-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="dialog-btn cancel" onClick={onClose}>Cancel</button>
          <button
            className="dialog-btn primary"
            onClick={handleCreate}
            disabled={loading || !name.trim() || selectedIds.size === 0}
          >
            {loading ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
