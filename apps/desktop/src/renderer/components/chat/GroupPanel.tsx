import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import type { ConverseResponse } from '@linkingchat/ws-protocol';

interface GroupPanelProps {
  converseId: string;
  onClose: () => void;
}

export function GroupPanel({ converseId, onClose }: GroupPanelProps) {
  const navigate = useNavigate();
  const converse = useChatStore((s) =>
    s.converses.find((c) => c.id === converseId),
  );
  const currentUserId = useChatStore((s) => s.currentUserId);

  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  if (!converse) return null;

  const ext = converse as any;
  const members = converse.members ?? [];
  const myMember = members.find((m) => m.userId === currentUserId);
  const myRole: string | null = myMember?.role ?? null;
  const isOwner = myRole === 'OWNER';
  const isAdmin = myRole === 'ADMIN';
  const canManage = isOwner || isAdmin;

  async function getToken(): Promise<string | null> {
    return window.electronAPI.getToken();
  }

  async function refreshConverses() {
    const token = await getToken();
    if (!token) return;
    const res = await fetch('http://localhost:3008/api/v1/converses', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      useChatStore.getState().setConverses(await res.json());
    }
  }

  async function handleUpdateGroup(data: { name?: string; description?: string }) {
    setActionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `http://localhost:3008/api/v1/converses/groups/${converseId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(data),
        },
      );
      if (res.ok) {
        await refreshConverses();
        setEditingName(false);
        setEditingDesc(false);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    const token = await getToken();
    if (!token) return;
    await fetch(
      `http://localhost:3008/api/v1/converses/groups/${converseId}/members/${memberId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    await refreshConverses();
  }

  async function handleUpdateRole(memberId: string, role: 'ADMIN' | 'MEMBER') {
    const token = await getToken();
    if (!token) return;
    await fetch(
      `http://localhost:3008/api/v1/converses/groups/${converseId}/members/${memberId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      },
    );
    await refreshConverses();
  }

  async function handleLeaveGroup() {
    const token = await getToken();
    if (!token) return;
    await fetch(
      `http://localhost:3008/api/v1/converses/groups/${converseId}/leave`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    await refreshConverses();
    navigate('/chat');
  }

  async function handleDeleteGroup() {
    setActionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(
        `http://localhost:3008/api/v1/converses/groups/${converseId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      await refreshConverses();
      navigate('/chat');
    } finally {
      setActionLoading(false);
    }
  }

  function getRoleBadge(role?: string) {
    if (!role) return null;
    const colors: Record<string, string> = {
      OWNER: '#f59e0b',
      ADMIN: '#4361ee',
      MEMBER: '#607b96',
    };
    return (
      <span className="group-role-badge" style={{ color: colors[role] ?? '#607b96' }}>
        {role.toLowerCase()}
      </span>
    );
  }

  function canRemove(targetRole?: string): boolean {
    if (!targetRole) return false;
    if (isOwner) return targetRole !== 'OWNER';
    if (isAdmin) return targetRole === 'MEMBER';
    return false;
  }

  return (
    <div className="group-panel">
      <div className="group-panel-header">
        <h3>Group Info</h3>
        <button className="dialog-close" onClick={onClose}>&times;</button>
      </div>

      <div className="group-panel-body">
        {/* Group Name */}
        <div className="group-panel-section">
          <div className="group-panel-label">Name</div>
          {editingName ? (
            <div className="group-panel-edit-row">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
                autoFocus
              />
              <button
                className="group-panel-save-btn"
                onClick={() => handleUpdateGroup({ name: editName })}
                disabled={actionLoading || !editName.trim()}
              >
                Save
              </button>
              <button
                className="group-panel-cancel-btn"
                onClick={() => setEditingName(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="group-panel-value-row">
              <span>{converse.name ?? 'Unnamed'}</span>
              {canManage && (
                <button
                  className="group-panel-edit-btn"
                  onClick={() => { setEditName(converse.name ?? ''); setEditingName(true); }}
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="group-panel-section">
          <div className="group-panel-label">Description</div>
          {editingDesc ? (
            <div className="group-panel-edit-row">
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={500}
                autoFocus
              />
              <button
                className="group-panel-save-btn"
                onClick={() => handleUpdateGroup({ description: editDesc })}
                disabled={actionLoading}
              >
                Save
              </button>
              <button
                className="group-panel-cancel-btn"
                onClick={() => setEditingDesc(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="group-panel-value-row">
              <span className="group-panel-desc">
                {ext.description || 'No description'}
              </span>
              {canManage && (
                <button
                  className="group-panel-edit-btn"
                  onClick={() => { setEditDesc(ext.description ?? ''); setEditingDesc(true); }}
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* Members */}
        <div className="group-panel-section">
          <div className="group-panel-label">
            Members ({ext.memberCount ?? members.length})
          </div>
          <div className="group-panel-members">
            {members.map((m) => (
              <div key={m.userId} className="group-member-item">
                <div className="group-member-avatar">
                  {(m.displayName ?? m.username ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="group-member-info">
                  <span className="group-member-name">
                    {m.displayName ?? m.username}
                    {m.userId === currentUserId && (
                      <span className="group-member-you"> (you)</span>
                    )}
                  </span>
                  {getRoleBadge(m.role)}
                </div>
                {m.userId !== currentUserId && canRemove(m.role) && (
                  <div className="group-member-actions">
                    {isOwner && m.role !== 'ADMIN' && (
                      <button
                        className="group-action-btn promote"
                        onClick={() => handleUpdateRole(m.userId, 'ADMIN')}
                        title="Promote to Admin"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
                        </svg>
                      </button>
                    )}
                    {isOwner && m.role === 'ADMIN' && (
                      <button
                        className="group-action-btn demote"
                        onClick={() => handleUpdateRole(m.userId, 'MEMBER')}
                        title="Demote to Member"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="group-action-btn remove"
                      onClick={() => handleRemoveMember(m.userId)}
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="group-panel-section group-panel-actions">
          <button className="group-leave-btn" onClick={handleLeaveGroup}>
            Leave Group
          </button>
          {isOwner && (
            <>
              {showConfirmDelete ? (
                <div className="group-delete-confirm">
                  <span>Delete this group permanently?</span>
                  <div className="group-delete-confirm-btns">
                    <button
                      className="group-delete-btn confirm"
                      onClick={handleDeleteGroup}
                      disabled={actionLoading}
                    >
                      {actionLoading ? 'Deleting...' : 'Yes, Delete'}
                    </button>
                    <button
                      className="group-delete-btn cancel-del"
                      onClick={() => setShowConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="group-delete-btn"
                  onClick={() => setShowConfirmDelete(true)}
                >
                  Delete Group
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
