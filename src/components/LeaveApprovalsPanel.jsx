import { useCallback, useEffect, useMemo, useState } from 'react';

/*
  Shared "review leave requests" panel for Team Lead and CEO accounts.

  Usage:
    <LeaveApprovalsPanel currentUser={currentUser} apiBase={API_BASE} />

  The server only lets accounts with a Team Lead or CEO role list and decide requests.
*/

const STATUS_STYLES = {
    Pending: { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', color: '#fbbf24' },
    Approved: { bg: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.3)', color: '#4ade80' },
    Rejected: { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.3)', color: '#f87171' }
};

const FILTERS = ['Pending', 'Approved', 'Rejected', 'All'];

// The backend should trust this token (not the reviewerId we pass in the
// query string / body) to decide who is actually approving a request.
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

// Reads a response as JSON, with a clear message if the server sent HTML (e.g. an old backend without these routes)
const parseJsonResponse = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`The server sent an unexpected response (HTTP ${res.status}). Make sure the backend is updated and restarted.`);
    }
};

const formatDate = (value) => {
    if (!value) return '';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatDateTime = (value) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

export default function LeaveApprovalsPanel({
    currentUser,
    apiBase = 'http://localhost:5000',
    title = 'Leave Approvals'
}) {
    const reviewerId = currentUser?._id || currentUser?.id || currentUser?.username || '';

    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('Pending');
    const [comments, setComments] = useState({});
    const [busyId, setBusyId] = useState(null);
    const [notice, setNotice] = useState({ type: '', text: '' });

    // State is only set inside promise callbacks (never synchronously), so it is safe to call from an effect
    const loadRequests = useCallback(
        () =>
            fetch(`${apiBase}/api/leave-requests?reviewerId=${encodeURIComponent(reviewerId)}`, { headers: authHeaders() })
                .then((res) => parseJsonResponse(res).then((data) => ({ ok: res.ok, status: res.status, data })))
                .then(({ ok, status, data }) => {
                    if (!ok) throw new Error(data.error || `HTTP ${status}`);
                    setRequests(data.requests || []);
                    setError('');
                })
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false)),
        [apiBase, reviewerId]
    );

    // Load on open, then refresh every 30s so new requests show up without reloading
    useEffect(() => {
        loadRequests();
        const timer = setInterval(loadRequests, 30000);
        return () => clearInterval(timer);
    }, [loadRequests]);

    const decide = async (request, status) => {
        setBusyId(request._id);
        setNotice({ type: '', text: '' });

        try {
            const res = await fetch(`${apiBase}/api/leave-requests/${request._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    status,
                    reviewerId,
                    comment: comments[request._id] || ''
                })
            });
            const data = await parseJsonResponse(res);
            if (!res.ok) throw new Error(data.error || 'Could not update the request');

            setRequests((prev) => prev.map((r) => (r._id === request._id ? data.request : r)));
            setNotice({
                type: 'success',
                text: `${request.employeeName}'s request was ${status.toLowerCase()}.`
            });
        } catch (err) {
            setNotice({ type: 'error', text: err.message });
            loadRequests(); // someone else may have decided it already
        } finally {
            setBusyId(null);
        }
    };

    const counts = useMemo(() => {
        const c = { Pending: 0, Approved: 0, Rejected: 0, All: requests.length };
        requests.forEach((r) => {
            if (c[r.status] !== undefined) c[r.status] += 1;
        });
        return c;
    }, [requests]);

    const visible = useMemo(
        () => (filter === 'All' ? requests : requests.filter((r) => r.status === filter)),
        [requests, filter]
    );

    const card = {
        background: 'rgba(18, 21, 36, 0.62)',
        border: '1px solid rgba(124, 58, 237, 0.22)',
        borderRadius: '10px',
        padding: '20px'
    };

    return (
        <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <div style={{ color: '#c4b5fd', fontSize: '9px', fontWeight: '900', letterSpacing: '1px' }}>
                        APPROVALS
                    </div>
                    <h3 style={{ color: '#fff', fontSize: '15px', fontWeight: '900', margin: '6px 0 4px' }}>
                        {title}
                    </h3>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0 }}>
                        Leave requests from employees. The first Team Lead or CEO decision is final.
                    </p>
                </div>

                <button
                    onClick={loadRequests}
                    style={{ background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(124, 58, 237, 0.4)', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontWeight: '800' }}
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: '8px', margin: '18px 0', flexWrap: 'wrap' }}>
                {FILTERS.map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        style={{
                            background: filter === f ? '#7c3aed' : 'rgba(8, 10, 17, 0.6)',
                            color: filter === f ? '#fff' : '#94a3b8',
                            border: '1px solid rgba(124, 58, 237, 0.3)',
                            padding: '7px 14px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: '800'
                        }}
                    >
                        {f} ({counts[f]})
                    </button>
                ))}
            </div>

            {notice.text && (
                <div
                    style={{
                        marginBottom: '14px',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700',
                        background: notice.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        border: notice.type === 'success' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                        color: notice.type === 'success' ? '#4ade80' : '#fca5a5'
                    }}
                >
                    {notice.text}
                </div>
            )}

            {loading && (
                <div style={{ padding: '25px', textAlign: 'center', color: '#64748b', fontSize: '11px' }}>
                    Loading requests...
                </div>
            )}

            {!loading && error && (
                <div style={{ padding: '14px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5' }}>
                    Could not load requests: {error}
                </div>
            )}

            {!loading && !error && visible.length === 0 && (
                <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '11px' }}>
                    {filter === 'Pending' ? 'No requests are waiting for approval.' : `No ${filter.toLowerCase()} requests.`}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {visible.map((r) => {
                    const st = STATUS_STYLES[r.status] || STATUS_STYLES.Pending;
                    const isPending = r.status === 'Pending';
                    const busy = busyId === r._id;

                    return (
                        <div
                            key={r._id}
                            style={{ background: 'rgba(8, 10, 17, 0.5)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '8px', padding: '16px' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ color: '#fff', fontSize: '13px', fontWeight: '800' }}>
                                        {r.employeeName}
                                        <span style={{ color: '#c4b5fd', fontSize: '10px', fontWeight: '700', marginLeft: '8px' }}>
                                            {r.employeeId}
                                        </span>
                                    </div>
                                    <div style={{ color: '#64748b', fontSize: '10px', marginTop: '3px' }}>
                                        {[r.role, r.department].filter(Boolean).join(' • ')}
                                        {r.createdAt ? ` • Requested ${formatDateTime(r.createdAt)}` : ''}
                                    </div>
                                </div>

                                <span style={{ padding: '4px 10px', borderRadius: '5px', background: st.bg, border: `1px solid ${st.border}`, color: st.color, fontSize: '9px', fontWeight: '800', letterSpacing: '0.5px' }}>
                                    {String(r.status).toUpperCase()}
                                </span>
                            </div>

                            <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', marginTop: '14px' }}>
                                <Info label="LEAVE TYPE" value={r.leaveType} />
                                <Info
                                    label="DATES"
                                    value={
                                        r.fromDate === r.toDate
                                            ? formatDate(r.fromDate)
                                            : `${formatDate(r.fromDate)} → ${formatDate(r.toDate)}`
                                    }
                                />
                                <Info label="DAYS" value={r.days} />
                            </div>

                            <div style={{ marginTop: '12px' }}>
                                <div style={{ color: '#64748b', fontSize: '8px', fontWeight: '800', letterSpacing: '0.6px' }}>REASON</div>
                                <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '5px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {r.reason}
                                </div>
                            </div>

                            {isPending ? (
                                <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        placeholder="Optional comment for the employee"
                                        value={comments[r._id] || ''}
                                        onChange={(e) => setComments((prev) => ({ ...prev, [r._id]: e.target.value }))}
                                        style={{ flex: 1, minWidth: '200px', background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '9px 12px', borderRadius: '6px', fontSize: '11px' }}
                                    />
                                    <button
                                        disabled={busy}
                                        onClick={() => decide(r, 'Approved')}
                                        style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.45)', padding: '9px 16px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer', fontSize: '10px', fontWeight: '800', opacity: busy ? 0.6 : 1 }}
                                    >
                                        ✓ Approve
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => decide(r, 'Rejected')}
                                        style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '9px 16px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer', fontSize: '10px', fontWeight: '800', opacity: busy ? 0.6 : 1 }}
                                    >
                                        ✕ Reject
                                    </button>
                                </div>
                            ) : (
                                <div style={{ marginTop: '12px', color: '#94a3b8', fontSize: '10px' }}>
                                    {r.status} by <b style={{ color: '#e2e8f0' }}>{r.reviewedBy}</b>
                                    {r.reviewerRole ? ` (${r.reviewerRole})` : ''}
                                    {r.reviewedAt ? ` • ${formatDateTime(r.reviewedAt)}` : ''}
                                    {r.reviewComment ? ` • “${r.reviewComment}”` : ''}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function Info({ label, value }) {
    return (
        <div>
            <div style={{ color: '#64748b', fontSize: '8px', fontWeight: '800', letterSpacing: '0.6px' }}>{label}</div>
            <div style={{ color: '#e2e8f0', fontSize: '11px', fontWeight: '700', marginTop: '5px' }}>{value}</div>
        </div>
    );
}