import { useState, useEffect, useCallback, useMemo } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://aeturnum-portal.onrender.com';
if (!import.meta.env.VITE_API_URL) {
  console.error('⚠️ VITE_API_URL is not set — falling back to the production backend URL. Set VITE_API_URL in your hosting platform\'s environment variables so this isn\'t hardcoded.');
}

// Every request needs to prove who's asking - the backend should trust this
// token (not any agentId/employeeId we put in the URL) to decide whose data to return.
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Annual Leave', 'Emergency Leave', 'Half Day', 'Other'];

const LEAVE_STATUS_STYLES = {
  Pending: { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', color: '#fbbf24' },
  Approved: { bg: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.3)', color: '#4ade80' },
  Rejected: { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.3)', color: '#f87171' }
};

// Reads a response as JSON, with a clear message if the server sent HTML (e.g. an old backend without these routes)
const parseJsonResponse = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server sent an unexpected response (HTTP ${res.status}). Make sure the backend is updated and restarted.`);
  }
};

const formatLeaveDate = (value) => {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// Marking present is only allowed between 6:55 PM and 11:55 PM
const PRESENT_WINDOW_START_MINUTES = 18 * 60 + 55; // 6:55 PM
const PRESENT_WINDOW_END_MINUTES = 23 * 60 + 55;   // 11:55 PM
const PRESENT_WINDOW_LABEL = '6:55 PM – 11:55 PM';

const isWithinPresentWindow = (date = new Date()) => {
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  return (
    totalMinutes >= PRESENT_WINDOW_START_MINUTES &&
    totalMinutes <= PRESENT_WINDOW_END_MINUTES
  );
};

/* ---------------- Quality Overview (from the QA dashboard) ---------------- */
const EVALUATIONS_URL = `${API_BASE}/api/evaluations`; // GET all evaluations

// Standards a call is rated on. "critical" items are compliance rules: failing one makes the whole call a critical fail.
const CHECKS = [
  { id: 'tcpa', label: 'TCPA verbal consent captured and stated clearly', critical: true },
  { id: 'cms', label: 'CMS disclosures read in full', critical: true },
  { id: 'identity', label: 'Customer identity verified before discussing plan details', critical: true },
  { id: 'phi', label: 'Protected health information handled securely', critical: true },
  { id: 'needs', label: 'Asked about doctors and medications before recommending a plan' },
  { id: 'accuracy', label: 'Plan and eligibility details stated accurately' },
  { id: 'objections', label: 'Handled objections without pressure' },
  { id: 'tone', label: 'Professional tone and proper call closing' }
];

/* ---------- colors: same palette as AgentDashboard ---------- */
const C = { text: '#cbd5e1', muted: '#94a3b8', dim: '#64748b', lav: '#c4b5fd', purple: '#7c3aed', line: 'rgba(124, 58, 237, 0.3)', soft: 'rgba(124, 58, 237, 0.15)' };
const T = {
  pass: { fg: '#4ade80', bg: 'rgba(34, 197, 94, 0.2)', bd: 'rgba(34, 197, 94, 0.4)' },
  warn: { fg: '#facc15', bg: 'rgba(234, 179, 8, 0.2)', bd: 'rgba(234, 179, 8, 0.4)' },
  fail: { fg: '#fca5a5', bg: 'rgba(239, 68, 68, 0.2)', bd: 'rgba(239, 68, 68, 0.4)' },
  none: { fg: '#94a3b8', bg: 'rgba(100, 116, 139, 0.2)', bd: 'rgba(100, 116, 139, 0.35)' }
};
const scoreTone = (n) => (n >= 90 ? T.pass : n >= 75 ? T.warn : T.fail);
const resultFor = (score, criticalFail) => (criticalFail ? 'Critical fail' : score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : 'Needs coaching');

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekStart = (d) => {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return isoDate(c);
};
const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const num = (e) => Number(e.score) || 0;
const isCritical = (e) => Boolean(e.criticalFail) || e.result === 'Critical fail';

/* ---------- shared styles (copied from AgentDashboard, defined once) ---------- */
const S = {
  card: { background: 'rgba(18, 21, 36, 0.9)', border: `1px solid ${C.line}`, borderRadius: '10px', padding: '24px' },
  inner: { background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.25)', borderRadius: '8px', padding: '16px' },
  input: { background: 'rgba(8, 10, 17, 0.8)', border: `1px solid ${C.line}`, color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'inherit' },
  label: { fontSize: '11px', color: C.lav, fontWeight: '700' },
  h3: { fontSize: '15px', color: '#fff', margin: 0, fontWeight: '800' },
  sub: { margin: '4px 0 0', fontSize: '11px', color: C.muted, lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' },
  thead: { borderBottom: `1px solid ${C.line}`, color: C.lav, fontWeight: '800' },
  row: { borderBottom: `1px solid ${C.soft}`, color: C.text },
  primary: { background: C.purple, border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '6px', fontWeight: '700', fontSize: '12px', letterSpacing: '0.5px' },
  ghost: { background: 'transparent', color: C.lav, border: '1px solid rgba(124, 58, 237, 0.4)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontWeight: '800' }
};

function Badge({ tone, children }) {
  return (
    <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '10px', background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Notice({ type, children }) {
  const tone = type === 'success' ? T.pass : T.fail;
  return (
    <div role="status" style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg }}>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: '30px', background: 'rgba(8, 10, 17, 0.6)', borderRadius: '8px', textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{children}</p>
    </div>
  );
}

function ScoreRing({ value, size = 150, tone }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.min(value, 100) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={value === null ? 'No score yet' : `Score ${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(124, 58, 237, 0.2)" strokeWidth="10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone.fg} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight="800" fill="#fff">{value === null ? '—' : `${value}%`}</text>
    </svg>
  );
}

function TrendChart({ data }) {
  const W = 440, H = 190, pl = 34, pr = 14, pt = 18, pb = 30;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = (i) => pl + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pt + ih - (v / 100) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Weekly average quality score">
      {[{ v: 90, c: T.pass.fg }, { v: 75, c: T.warn.fg }, { v: 50, c: C.dim }].map((g) => (
        <g key={g.v}>
          <line x1={pl} x2={W - pr} y1={y(g.v)} y2={y(g.v)} stroke={g.c} strokeOpacity="0.45" strokeDasharray="4 4" />
          <text x={pl - 6} y={y(g.v)} textAnchor="end" dominantBaseline="central" fontSize="10" fill={C.muted}>{g.v}</text>
        </g>
      ))}
      {data.length > 1 && <polyline fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinejoin="round" points={data.map((d, i) => `${x(i)},${y(d.avg)}`).join(' ')} />}
      {data.map((d, i) => (
        <g key={d.label}>
          <title>{`${d.label}: ${d.avg}% across ${d.n} call${d.n === 1 ? '' : 's'}`}</title>
          <circle cx={x(i)} cy={y(d.avg)} r="4.5" fill="#0c0e18" stroke="#a78bfa" strokeWidth="2.5" />
          <text x={x(i)} y={y(d.avg) - 11} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{d.avg}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={C.muted}>{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

export default function QADashboard({ currentUser, onSignOut }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const goToTab = (id) => { setActiveTab(id); setSidebarOpen(false); };
  
  // Real-time clock tick
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [canMarkPresent, setCanMarkPresent] = useState(() => isWithinPresentWindow());
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString());
      setCanMarkPresent(isWithinPresentWindow(now));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const employeeId = currentUser?.employeeId || currentUser?.empId || currentUser?.id?.substring(0, 6)?.toUpperCase() || 'TL-001';
  const userName = currentUser?.name || 'Team Lead';
  const userRole = currentUser?.role || 'QA';
  const userEmail = currentUser?.email || 'teamlead@aeturnum.internal';
  const shiftTiming = '07:00 PM - 12:00 AM';

  const getInitials = (name) => {
    if (!name) return 'TL';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  const userInitials = getInitials(currentUser?.name);

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const attendanceKey = `zyre_attendance_logs_${employeeId}`;

  // Password Change State & Handler
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState({ type: '', text: '' });

  const handlePasswordChangeInput = (e) => {
    const { name, value } = e.target;
    setPasswordData({ ...passwordData, [name]: value });
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordMsg({ type: '', text: '' });

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }

    setPasswordSubmitting(true);

    try {
      const userId = currentUser?._id || currentUser?.id;
      if (!userId) throw new Error('Could not determine your account ID.');

      // Actually updates the account record in the database (same endpoint the
      // CEO dashboard uses to set an employee's password) - this used to just
      // email a notification and never touch the real password.
      const response = await fetch(`${API_BASE}/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          password: passwordData.newPassword
        })
      });

      const data = await parseJsonResponse(response);

      if (response.ok) {
        setPasswordMsg({ type: 'success', text: 'Your password has been updated.' });
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setPasswordMsg({ type: 'error', text: data.error || 'Failed to update your password. Check your current password and try again.' });
      }
    } catch (err) {
      setPasswordMsg({ type: 'error', text: err.message || 'An error occurred while updating your password.' });
    } finally {
      setPasswordSubmitting(false);
    }
  };

  // Attendance now lives in the database (requires GET/POST
  // /api/attendance/agent/:id on the backend, same convention as
  // /api/sales/agent/:id) instead of a per-browser localStorage key.
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadAttendance() {
      try {
        const agentId = currentUser?.id || currentUser?.username || employeeId;
        if (!agentId) return;
        const res = await fetch(`${API_BASE}/api/attendance/agent/${agentId}`, { headers: authHeaders() });
        const data = await parseJsonResponse(res);
        if (isMounted && data.success && data.logs) setAttendanceLogs(data.logs);
      } catch (err) {
        console.error('Failed to load attendance from database:', err);
      } finally {
        if (isMounted) setLoadingAttendance(false);
      }
    }
    loadAttendance();
    return () => { isMounted = false; };
  }, [currentUser, employeeId]);

  const hasCheckedIn = attendanceLogs.some(r => r.date === todayStr && r.status === 'Available');

  const [checkInMsg, setCheckInMsg] = useState('');
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);

  const handleCheckIn = async () => {
    if (!isWithinPresentWindow()) return;

    const now = new Date();
    const timeString = now.toLocaleTimeString();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    
    const shiftStartTotalMinutes = 19 * 60; 
    const shiftEndTotalMinutes = 24 * 60; 
    const maxShiftMinutes = 300;
    const standardBreakMinutes = 20;

    let lateMins = 0;
    if (currentTotalMinutes > shiftStartTotalMinutes) {
      lateMins = currentTotalMinutes - shiftStartTotalMinutes;
    }

    let earlyDepMins = 0;
    if (currentTotalMinutes < shiftEndTotalMinutes && currentTotalMinutes > shiftStartTotalMinutes) {
      earlyDepMins = Math.max(0, shiftEndTotalMinutes - currentTotalMinutes);
    }

    let workedMinutes = Math.max(0, maxShiftMinutes - lateMins);
    workedMinutes = Math.min(maxShiftMinutes, workedMinutes);

    const netPortalMinutes = Math.max(0, workedMinutes - standardBreakMinutes - earlyDepMins);
    const netHours = Math.floor(netPortalMinutes / 60);
    const netMins = netPortalMinutes % 60;
    const netPortalTimeString = `${netHours}h ${netMins < 10 ? '0' : ''}${netMins}m`;

    const newRecord = {
      date: todayStr,
      checkInTime: timeString,
      lateArrival: lateMins > 0 ? `${lateMins}m Late` : 'On Time (00m)',
      earlyDeparture: earlyDepMins > 0 ? `${earlyDepMins}m Early` : 'None (00m)',
      breakTime: `${standardBreakMinutes}m Standard`,
      netPortalTime: netPortalTimeString,
      status: 'Available'
    };

    setCheckInSubmitting(true);
    try {
      const agentId = currentUser?.id || currentUser?.username || employeeId;
      const res = await fetch(`${API_BASE}/api/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ agentId, agentName: userName, ...newRecord })
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Failed to record attendance');

      setAttendanceLogs(prev => {
        const filtered = prev.filter(r => r.date !== todayStr);
        return [data.log || newRecord, ...filtered];
      });
      setCheckInMsg('Status updated to Available & Work Log Recorded');
    } catch (err) {
      console.error('Failed to save attendance:', err);
      setCheckInMsg('Could not save attendance - please try again.');
    } finally {
      setCheckInSubmitting(false);
      setTimeout(() => setCheckInMsg(''), 4000);
    }
  };

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filteredResults, setFilteredResults] = useState(null);
  const [hasQueried, setHasQueried] = useState(false);

  const handleQueryRange = (e) => {
    e.preventDefault();
    setHasQueried(true);
    if (!fromDate || !toDate) {
      setFilteredResults([]);
      return;
    }
    const results = attendanceLogs.filter(r => r.date >= fromDate && r.date <= toDate);
    setFilteredResults(results);
  };

  const sopsList = [
    { title: 'Attendance & Punctuality', content: 'All agents must log in before 07:00 PM to maintain punctuality standards.' },
    { title: 'Compliance & Verification', content: 'Medicare campaigns require strict adherence to CMS guidelines, recording all disclosures and verifications accurately.' },
    { title: 'TCPA & Consent', content: 'Verbal consent must always be confirmed and documented before finalizing any client transaction.' },
    { title: 'Data Privacy & Security', content: 'Never share client Protected Health Information (PHI) externally or over unsecured channels.' }
  ];

  const weeklySchedule = [
    { day: 'Monday', shift: '07:00 PM - 12:00 AM', status: 'Evening Operations' },
    { day: 'Tuesday', shift: '07:00 PM - 12:00 AM', status: 'Evening Operations' },
    { day: 'Wednesday', shift: '07:00 PM - 12:00 AM', status: 'Evening Operations' },
    { day: 'Thursday', shift: '07:00 PM - 12:00 AM', status: 'Evening Operations' },
    { day: 'Friday', shift: '07:00 PM - 12:00 AM', status: 'Evening Operations' },
    { day: 'Saturday', shift: '07:00 PM - 12:00 AM', status: 'Standard Coverage' },
    { day: 'Sunday', shift: 'Off Duty', status: 'Weekly Rest' }
  ];

  /* ---------------- Approvals (leave requests) ---------------- */
  const leaveEmployeeId = currentUser?.id || currentUser?.employeeId || currentUser?.username || employeeId;

  const emptyLeaveForm = { leaveType: 'Casual Leave', fromDate: '', toDate: '', reason: '' };
  const [leaveForm, setLeaveForm] = useState(emptyLeaveForm);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loadingLeaves, setLoadingLeaves] = useState(true);
  const [leaveLoadError, setLeaveLoadError] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveMsg, setLeaveMsg] = useState({ type: '', text: '' });

  const leaveDays =
    leaveForm.fromDate && leaveForm.toDate && leaveForm.toDate >= leaveForm.fromDate
      ? Math.round((new Date(leaveForm.toDate) - new Date(leaveForm.fromDate)) / 86400000) + 1
      : 0;

  // State is only set inside promise callbacks (never synchronously), so it is safe to call from an effect
  const fetchMyLeaves = useCallback(
    () =>
      fetch(`${API_BASE}/api/leave-requests/employee/${encodeURIComponent(leaveEmployeeId)}`, { headers: authHeaders() })
        .then((res) => parseJsonResponse(res).then((data) => ({ ok: res.ok, status: res.status, data })))
        .then(({ ok, status, data }) => {
          if (!ok) throw new Error(data.error || `HTTP ${status}`);
          setLeaveRequests(data.requests || []);
          setLeaveLoadError('');
        })
        .catch((err) => {
          console.error('Could not load leave requests:', err.message);
          setLeaveLoadError(err.message);
        })
        .finally(() => setLoadingLeaves(false)),
    [leaveEmployeeId]
  );

  // Load the employee's requests whenever the Approvals tab is opened
  useEffect(() => {
    if (activeTab === 'approvals') fetchMyLeaves();
  }, [activeTab, fetchMyLeaves]);

  const handleLeaveChange = (e) => {
    const { name, value } = e.target;
    setLeaveForm((prev) => {
      const next = { ...prev, [name]: value };
      // keep "To" from ending up before "From"
      if (name === 'fromDate' && next.toDate && next.toDate < value) next.toDate = value;
      return next;
    });
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setLeaveMsg({ type: '', text: '' });

    if (!leaveForm.reason.trim()) {
      setLeaveMsg({ type: 'error', text: 'Please write a reason for your request.' });
      return;
    }

    setLeaveSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/leave-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          employeeId: leaveEmployeeId,
          employeeName: userName,
          role: userRole,
          department: currentUser?.department || '',
          ...leaveForm
        })
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Failed to submit your request');

      setLeaveRequests((prev) => [data.request, ...prev]);
      setLeaveForm(emptyLeaveForm);
      setLeaveMsg({ type: 'success', text: 'Your request was sent to your Team Lead and the CEO for approval.' });
    } catch (err) {
      setLeaveMsg({ type: 'error', text: err.message });
    } finally {
      setLeaveSubmitting(false);
    }
  };

  /* ---------------- Quality Overview: data ---------------- */
  const [evals, setEvals] = useState([]);
  const [evalsLoading, setEvalsLoading] = useState(true);
  const [evalsError, setEvalsError] = useState('');

  const loadEvals = useCallback(async () => {
    setEvalsLoading(true);
    try {
      const data = await fetch(EVALUATIONS_URL, { headers: authHeaders() }).then(parseJsonResponse);
      if (data.success && data.evaluations) setEvals(data.evaluations);
      setEvalsError('');
    } catch (err) {
      console.error('Could not load evaluations:', err);
      setEvalsError(err.message);
    } finally {
      setEvalsLoading(false);
    }
  }, []);

  // Refresh the numbers whenever the Quality Overview tab is opened
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'overview') loadEvals();
  }, [activeTab, loadEvals]);

  /* ---------------- overview numbers ---------------- */
  const overall = useMemo(() => {
    const thisWeek = weekStart(new Date());
    const weekEvals = evals.filter((e) => { const d = new Date(e.date); return !Number.isNaN(d.getTime()) && weekStart(d) === thisWeek; });
    return {
      avg: avg(evals.map(num)),
      total: evals.length,
      week: weekEvals.length,
      weekAvg: avg(weekEvals.map(num)),
      critical: evals.filter(isCritical).length,
      passRate: evals.length ? Math.round((evals.filter((e) => !isCritical(e) && num(e) >= 75).length / evals.length) * 100) : null
    };
  }, [evals]);

  const trend = useMemo(() => {
    const m = new Map();
    evals.forEach((e) => {
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) return;
      const k = weekStart(d);
      m.set(k, [...(m.get(k) || []), num(e)]);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([k, list]) => ({
      label: new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      avg: avg(list),
      n: list.length
    }));
  }, [evals]);

  const missed = useMemo(() => {
    const tally = Object.fromEntries(CHECKS.map((c) => [c.id, { fail: 0, total: 0 }]));
    evals.forEach((e) => {
      if (!Array.isArray(e.checklist)) return;
      e.checklist.forEach((item) => {
        if (!tally[item.id] || (item.result !== 'pass' && item.result !== 'fail')) return;
        tally[item.id].total += 1;
        if (item.result === 'fail') tally[item.id].fail += 1;
      });
    });
    return CHECKS.map((c) => ({ ...c, ...tally[c.id], rate: tally[c.id].total ? Math.round((tally[c.id].fail / tally[c.id].total) * 100) : null }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.rate - a.rate);
  }, [evals]);

  const agentRows = useMemo(() => {
    const map = new Map();
    evals.forEach((e) => {
      const id = e.agentId || e.agentName;
      if (!id) return;
      const r = map.get(id) || { id, name: e.agentName || id, scores: [], critical: 0, last: '' };
      r.scores.push(num(e));
      if (isCritical(e)) r.critical += 1;
      if ((e.date || '') > r.last) r.last = e.date;
      map.set(id, r);
    });
    return [...map.values()].map((r) => ({ ...r, avg: avg(r.scores) })).sort((a, b) => a.avg - b.avg); // lowest first = who needs coaching
  }, [evals]);

  const overallTone = overall.avg === null ? T.none : scoreTone(overall.avg);

  return (
    <>
      <style>{`
        div::-webkit-scrollbar, aside::-webkit-scrollbar, main::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        div, aside, main {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        .qa-root { font-variant-numeric: tabular-nums; }
        .qa-root button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
        .qa-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 22px; }
        .qa-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); flex: 1; }

        .qa-mobile-menu-btn { display: none; }
        .qa-sidebar-overlay { display: none; }

        @media (max-width: 860px) {
          .qa-root { grid-template-columns: 1fr !important; }
          .qa-sidebar {
            position: fixed;
            top: 0; left: 0; bottom: 0;
            width: 78vw;
            max-width: 280px;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 100 !important;
          }
          .qa-sidebar.qa-sidebar-open { transform: translateX(0); }
          .qa-mobile-menu-btn { display: inline-flex !important; }
          .qa-sidebar-overlay.qa-sidebar-open {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.55);
            z-index: 90;
          }
          .qa-header { padding-left: 14px !important; padding-right: 14px !important; flex-wrap: wrap !important; }
          .qa-content { padding: 16px !important; }
          table { font-size: 9px; }
        }
      `}</style>

      <div className="qa-root" style={{ display: 'grid', gridTemplateColumns: '270px 1fr', width: '100%', height: '100%', background: 'rgba(10, 12, 20, 0.35)', backdropFilter: 'blur(25px)', border: 'none', borderRadius: '0', boxShadow: 'none', overflow: 'hidden', margin: 0, boxSizing: 'border-box', position: 'relative' }}>

        {/* LEFT SIDEBAR */}
        <aside className={`qa-sidebar${sidebarOpen ? ' qa-sidebar-open' : ''}`} style={{ background: 'rgba(12, 14, 24, 0.85)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(124, 58, 237, 0.25)', padding: '24px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 2, height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
          <div>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '900', letterSpacing: '3px', background: 'linear-gradient(135deg, #fff 20%, #c4b5fd 70%, #7c3aed 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
                AETURNUM
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '22px', background: 'rgba(20, 24, 41, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
              {currentUser?.avatar || currentUser?.photo || currentUser?.imageUrl || currentUser?.profilePic ? (
                <img 
                  src={currentUser.avatar || currentUser.photo || currentUser.imageUrl || currentUser.profilePic} 
                  alt={userName}
                  style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #c4b5fd', marginBottom: '8px' }}
                />
              ) : (
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #4c1d95)', border: '2px solid #c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: '800', marginBottom: '8px' }}>
                  {userInitials}
                </div>
              )}
              <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#fff', margin: '0 0 2px 0', textAlign: 'center' }}>{userName}</h3>
              <p style={{ fontSize: '11px', color: '#c4b5fd', margin: '0 0 6px 0', fontWeight: '700' }}>{employeeId}</p>
              <span style={{ fontSize: '9px', background: 'rgba(124, 58, 237, 0.2)', color: '#e9d5ff', padding: '2px 8px', borderRadius: '6px', fontWeight: '700', textTransform: 'uppercase' }}>
                {userRole}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'overview', label: 'Quality Overview' },
                { id: 'schedule', label: 'Shift Schedule' },
                { id: 'attendance', label: 'Attendance Work Log' },
                { id: 'approvals', label: 'Approvals' },
                { id: 'settings', label: 'Account Config' }
              ].map((item) => (
                <button 
                  key={item.id}
                  onClick={() => goToTab(item.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'transparent',
                    color: activeTab === item.id ? '#fff' : '#94a3b8',
                    border: 'none',
                    borderLeft: activeTab === item.id ? '3px solid #7c3aed' : '3px solid transparent',
                    borderRadius: '0',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: activeTab === item.id ? '800' : '600',
                    letterSpacing: '0.8px',
                    textAlign: 'left',
                    transition: 'color 0.2s ease'
                  }}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={onSignOut} 
            style={{ width: '100%', background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '10px', letterSpacing: '1px' }}
          >
            Terminate Session
          </button>
        </aside>

        <div className={`qa-sidebar-overlay${sidebarOpen ? ' qa-sidebar-open' : ''}`} onClick={() => setSidebarOpen(false)} />

        {/* RIGHT MAIN CONTENT AREA */}
        <main style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', zIndex: 2, boxSizing: 'border-box' }}>
          
          {/* Top Header Bar */}
          <header className="qa-header" style={{ padding: '16px 35px', background: 'rgba(12, 14, 24, 0.65)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(124, 58, 237, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
            <button className="qa-mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu" style={{ alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.4)', background: 'rgba(124, 58, 237, 0.12)', color: '#e2e8f0', fontSize: '16px', cursor: 'pointer', marginRight: '4px' }}>☰</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button 
                onClick={handleCheckIn}
                disabled={hasCheckedIn || !canMarkPresent || checkInSubmitting}
                title={
                  !hasCheckedIn && !canMarkPresent
                    ? `Check-in is only available ${PRESENT_WINDOW_LABEL}`
                    : undefined
                }
                style={{ 
                  background: hasCheckedIn
                    ? 'rgba(34, 197, 94, 0.2)'
                    : canMarkPresent
                      ? '#7c3aed'
                      : 'rgba(100, 116, 139, 0.2)',
                  color: hasCheckedIn
                    ? '#4ade80'
                    : canMarkPresent
                      ? '#fff'
                      : '#64748b',
                  border: hasCheckedIn ? '1px solid rgba(34, 197, 94, 0.4)' : 'none', 
                  padding: '9px 18px', 
                  borderRadius: '6px', 
                  cursor: hasCheckedIn || !canMarkPresent ? 'default' : 'pointer', 
                  fontWeight: '700', 
                  fontSize: '11px',
                  letterSpacing: '1px'
                }}
              >
                {hasCheckedIn
                  ? 'Available'
                  : canMarkPresent
                    ? 'Check In'
                    : `Check In (${PRESENT_WINDOW_LABEL})`}
              </button>
              {checkInMsg && <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: '700' }}>{checkInMsg}</span>}
            </div>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '11px', fontWeight: '700' }}>
              <div style={{ background: 'rgba(15, 18, 30, 0.8)', padding: '6px 12px', borderRadius: '6px', color: '#c4b5fd' }}>
                {currentTime}
              </div>
              <div style={{ background: '#7c3aed', padding: '6px 12px', borderRadius: '6px', color: '#fff' }}>
                ID: {employeeId}
              </div>
            </div>
          </header>

          {/* Main Content Body */}
          <div className="qa-content" style={{ width: '100%', flex: 1, padding: '30px 40px', boxSizing: 'border-box', overflowY: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '100%' }}>
              
              {/* Dashboard Tab */}
              {activeTab === 'dashboard' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h4 style={{ fontSize: '13px', color: '#c4b5fd', margin: '0 0 10px 0', fontWeight: '800', letterSpacing: '1px' }}>
                      Team Lead Workspace
                    </h4>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                      Welcome, {userName}. Monitor your team's shift schedule and attendance work logs, and review leave requests sent to you for approval.
                    </p>
                    <span style={{ fontSize: '11px', color: '#a78bfa', fontWeight: '700', fontStyle: 'italic' }}>— Operations Management</span>
                  </div>

                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h4 style={{ fontSize: '13px', color: '#c4b5fd', margin: '0 0 16px 0', fontWeight: '800', letterSpacing: '1px' }}>
                      Compliance Guidelines & Protocols
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {sopsList.map((sop, idx) => (
                        <div key={idx} style={{ padding: '12px 14px', background: 'rgba(8, 10, 17, 0.6)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '6px' }}>
                          <h5 style={{ margin: '0 0 4px 0', color: '#fff', fontSize: '12px', fontWeight: '700' }}>{sop.title}</h5>
                          <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>{sop.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Schedule Tab */}
              {activeTab === 'schedule' && (
                <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '15px', color: '#fff', margin: 0, fontWeight: '800' }}>Weekly Shift Calendar (Monday - Sunday)</h3>
                    <span style={{ fontSize: '11px', color: '#c4b5fd', background: 'rgba(124, 58, 237, 0.2)', padding: '4px 10px', borderRadius: '6px', fontWeight: '700' }}>Active Weekly Cycle</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                    {weeklySchedule.map((item, idx) => (
                      <div key={idx} style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.25)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: '800', color: '#fff' }}>{item.day}</span>
                          <span style={{ fontSize: '9px', background: item.day === 'Sunday' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(124, 58, 237, 0.25)', color: item.day === 'Sunday' ? '#fca5a5' : '#e9d5ff', padding: '2px 6px', borderRadius: '4px', fontWeight: '700' }}>{item.status}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#c4b5fd', fontWeight: '700', marginTop: '4px' }}>
                          {item.shift}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attendance Work Log Tab */}
              {activeTab === 'attendance' && (
                <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                  <h3 style={{ fontSize: '15px', color: '#fff', margin: '0 0 6px 0', fontWeight: '800' }}>Attendance Work Duration Log</h3>
                  <p style={{ margin: '0 0 20px 0', fontSize: '11px', color: '#94a3b8' }}>Select your "From" and "To" date range to view your logged work history.</p>

                  <form onSubmit={handleQueryRange} style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>From Date:</label>
                      <input 
                        type="date" 
                        value={fromDate} 
                        onChange={(e) => setFromDate(e.target.value)}
                        style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>To Date:</label>
                      <input 
                        type="date" 
                        value={toDate} 
                        onChange={(e) => setToDate(e.target.value)}
                        style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                      />
                    </div>

                    <button 
                      type="submit"
                      style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '11px', height: '36px' }}
                    >
                      View Work Record
                    </button>
                  </form>

                  {hasQueried && (
                    <div>
                      {filteredResults && filteredResults.length > 0 ? (
                        <div style={{ width: '100%', overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.3)', color: '#c4b5fd', fontWeight: '800' }}>
                                <th style={{ padding: '10px' }}>Date</th>
                                <th style={{ padding: '10px' }}>Agent ID</th>
                                <th style={{ padding: '10px' }}>Shift Timing</th>
                                <th style={{ padding: '10px' }}>Net Portal Time</th>
                                <th style={{ padding: '10px' }}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredResults.map((record, index) => (
                                <tr key={index} style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.1)', color: '#cbd5e1' }}>
                                  <td style={{ padding: '10px', fontWeight: '700' }}>{record.date}</td>
                                  <td style={{ padding: '10px', color: '#c4b5fd', fontWeight: '700' }}>{employeeId}</td>
                                  <td style={{ padding: '10px' }}>{shiftTiming}</td>
                                  <td style={{ padding: '10px', fontWeight: '700', color: '#c4b5fd' }}>{record.netPortalTime}</td>
                                  <td style={{ padding: '10px' }}><span style={{ color: '#4ade80', fontWeight: '800' }}>{record.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: '24px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', textAlign: 'center' }}>
                          <p style={{ margin: 0, fontSize: '13px', color: '#fca5a5', fontWeight: '700' }}>No record found</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Approvals Tab */}
              {activeTab === 'approvals' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', color: '#fff', margin: '0 0 6px 0', fontWeight: '800' }}>Request Leave Approval</h3>
                    <p style={{ margin: '0 0 20px 0', fontSize: '11px', color: '#94a3b8' }}>
                      Your request goes to your Team Lead and the CEO. Whoever reviews it first will approve or reject it.
                    </p>

                    {leaveMsg.text && (
                      <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', background: leaveMsg.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', border: leaveMsg.type === 'success' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)', color: leaveMsg.type === 'success' ? '#4ade80' : '#fca5a5' }}>
                        {leaveMsg.text}
                      </div>
                    )}

                    <form onSubmit={handleLeaveSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Leave Type:</label>
                          <select
                            name="leaveType"
                            value={leaveForm.leaveType}
                            onChange={handleLeaveChange}
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                          >
                            {LEAVE_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>From Date:</label>
                          <input
                            type="date"
                            name="fromDate"
                            required
                            value={leaveForm.fromDate}
                            onChange={handleLeaveChange}
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '9px 12px', borderRadius: '6px', fontSize: '12px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>
                            To Date:{leaveDays > 0 && <span style={{ color: '#a78bfa', marginLeft: '8px' }}>({leaveDays} day{leaveDays === 1 ? '' : 's'})</span>}
                          </label>
                          <input
                            type="date"
                            name="toDate"
                            required
                            min={leaveForm.fromDate || undefined}
                            value={leaveForm.toDate}
                            onChange={handleLeaveChange}
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '9px 12px', borderRadius: '6px', fontSize: '12px' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Reason:</label>
                        <textarea
                          name="reason"
                          required
                          rows={4}
                          value={leaveForm.reason}
                          onChange={handleLeaveChange}
                          placeholder="Explain why you need this leave"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit' }}
                        />
                      </div>

                      <div>
                        <button
                          type="submit"
                          disabled={leaveSubmitting}
                          style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '11px 22px', borderRadius: '6px', cursor: leaveSubmitting ? 'default' : 'pointer', fontWeight: '700', fontSize: '11px', opacity: leaveSubmitting ? 0.7 : 1 }}
                        >
                          {leaveSubmitting ? 'Sending...' : 'Send for Approval'}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ fontSize: '15px', color: '#fff', margin: 0, fontWeight: '800' }}>My Requests</h3>
                      <button
                        onClick={() => { setLoadingLeaves(true); fetchMyLeaves(); }}
                        style={{ background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(124, 58, 237, 0.4)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontWeight: '800' }}
                      >
                        ↻ Refresh
                      </button>
                    </div>

                    {leaveLoadError && leaveRequests.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#fca5a5', fontWeight: '700' }}>Could not load your requests: {leaveLoadError}</p>
                    ) : loadingLeaves && leaveRequests.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Loading your requests...</p>
                    ) : leaveRequests.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>You haven't sent any requests yet.</p>
                    ) : (
                      <div style={{ width: '100%', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.3)', color: '#c4b5fd', fontWeight: '800' }}>
                              <th style={{ padding: '10px' }}>Type</th>
                              <th style={{ padding: '10px' }}>Dates</th>
                              <th style={{ padding: '10px' }}>Days</th>
                              <th style={{ padding: '10px' }}>Reason</th>
                              <th style={{ padding: '10px' }}>Status</th>
                              <th style={{ padding: '10px' }}>Reviewed By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveRequests.map((r) => {
                              const st = LEAVE_STATUS_STYLES[r.status] || LEAVE_STATUS_STYLES.Pending;
                              return (
                                <tr key={r._id} style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.1)', color: '#cbd5e1' }}>
                                  <td style={{ padding: '10px', fontWeight: '700' }}>{r.leaveType}</td>
                                  <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                                    {r.fromDate === r.toDate ? formatLeaveDate(r.fromDate) : `${formatLeaveDate(r.fromDate)} → ${formatLeaveDate(r.toDate)}`}
                                  </td>
                                  <td style={{ padding: '10px' }}>{r.days}</td>
                                  <td style={{ padding: '10px', maxWidth: '260px', wordBreak: 'break-word' }}>{r.reason}</td>
                                  <td style={{ padding: '10px' }}>
                                    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: '5px', background: st.bg, border: `1px solid ${st.border}`, color: st.color, fontSize: '9px', fontWeight: '800' }}>
                                      {String(r.status).toUpperCase()}
                                    </span>
                                  </td>
                                  <td style={{ padding: '10px', color: '#94a3b8' }}>
                                    {r.reviewedBy ? (
                                      <>
                                        <span style={{ color: '#e2e8f0', fontWeight: '700' }}>{r.reviewedBy}</span>
                                        {r.reviewComment ? <div style={{ fontSize: '10px', marginTop: '3px' }}>“{r.reviewComment}”</div> : null}
                                      </>
                                    ) : (
                                      'Awaiting review'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}


              {/* Quality Overview (from the QA dashboard) */}
              {activeTab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                  {evalsError && <Notice type="error">Could not load evaluations: {evalsError}{/404/.test(evalsError) ? ' The server has no GET /api/evaluations route yet. It needs one that returns every evaluation.' : ''}</Notice>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={loadEvals} disabled={evalsLoading} style={{ ...S.ghost, opacity: evalsLoading ? 0.6 : 1 }}>{evalsLoading ? 'Refreshing...' : '↻ Refresh QA data'}</button>
                  </div>
                  <section style={{ ...S.card, display: 'flex', alignItems: 'center', gap: '28px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
                      <ScoreRing value={overall.avg} tone={overallTone} />
                      <div style={{ maxWidth: '190px' }}>
                        <h3 style={S.h3}>Overall call quality</h3>
                        <p style={S.sub}>Average score across every call QA has rated.</p>
                        <div style={{ marginTop: '10px' }}>
                          {overall.avg === null ? <Badge tone={T.none}>No calls rated yet</Badge> : <Badge tone={overallTone}>{resultFor(overall.avg, false)}</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="qa-stats">
                      {[
                        { label: 'Calls rated', value: overall.total, note: `${overall.week} this week` },
                        { label: 'This week', value: overall.weekAvg === null ? '—' : `${overall.weekAvg}%`, note: 'Average score' },
                        { label: 'Pass rate', value: overall.passRate === null ? '—' : `${overall.passRate}%`, note: '75%+ and no critical fail' },
                        { label: 'Critical fails', value: overall.critical, note: 'Compliance rule broken', color: overall.critical ? T.fail.fg : '#fff' }
                      ].map((s) => (
                        <div key={s.label} style={{ padding: '4px 18px', borderLeft: `1px solid ${C.line}` }}>
                          <div style={{ fontSize: '11px', color: C.muted, fontWeight: '700' }}>{s.label}</div>
                          <div style={{ fontSize: '26px', fontWeight: '800', color: s.color || '#fff', margin: '2px 0' }}>{s.value}</div>
                          <div style={{ fontSize: '10px', color: C.dim }}>{s.note}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="qa-two">
                    <section style={S.card}>
                      <h3 style={S.h3}>Weekly quality trend</h3>
                      <p style={{ ...S.sub, marginBottom: '14px' }}>Average score per week. Dashed lines mark 90 (excellent) and 75 (good).</p>
                      {trend.length === 0 ? <Empty>Rate a call to start the trend.</Empty> : <TrendChart data={trend} />}
                    </section>

                    <section style={S.card}>
                      <h3 style={S.h3}>Most missed standards</h3>
                      <p style={{ ...S.sub, marginBottom: '16px' }}>Share of rated calls where the standard was failed. Coach the top ones first.</p>
                      {missed.length === 0 ? (
                        <Empty>Appears once calls are rated with the checklist.</Empty>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                          {missed.map((m) => (
                            <div key={m.id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', marginBottom: '5px', color: '#e2e8f0' }}>
                                <span>{m.label}{m.critical && <span style={{ color: T.fail.fg, fontWeight: '800' }}> (critical)</span>}</span>
                                <strong style={{ color: m.rate >= 25 ? T.fail.fg : C.muted }}>{m.rate}%</strong>
                              </div>
                              <div style={{ height: '6px', background: C.soft, borderRadius: '3px' }}>
                                <div style={{ width: `${m.rate}%`, height: '100%', background: m.rate >= 25 ? '#f87171' : '#a78bfa', borderRadius: '3px' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <section style={S.card}>
                    <h3 style={S.h3}>Agent quality</h3>
                    <p style={{ ...S.sub, marginBottom: '14px' }}>Lowest average first, so agents who need coaching are at the top.</p>
                    {evalsLoading && agentRows.length === 0 ? (
                      <Empty>Loading evaluations...</Empty>
                    ) : agentRows.length === 0 ? (
                      <Empty>No agents have been rated yet.</Empty>
                    ) : (
                      <div style={{ width: '100%', overflowX: 'auto' }}>
                        <table style={S.table}>
                          <thead>
                            <tr style={S.thead}>{['Agent', 'Calls rated', 'Average score', 'Critical fails', 'Last rated'].map((h, i) => <th key={i} style={{ padding: '10px' }}>{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {agentRows.map((a) => (
                              <tr key={a.id} style={S.row}>
                                <td style={{ padding: '10px' }}>
                                  <span style={{ fontWeight: '700', color: '#fff' }}>{a.name}</span>
                                  {a.name !== a.id && <span style={{ color: C.muted, marginLeft: '8px' }}>{a.id}</span>}
                                </td>
                                <td style={{ padding: '10px' }}>{a.scores.length}</td>
                                <td style={{ padding: '10px', minWidth: '170px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ flex: 1, height: '6px', background: C.soft, borderRadius: '3px' }}>
                                      <div style={{ width: `${a.avg}%`, height: '100%', background: scoreTone(a.avg).fg, borderRadius: '3px' }} />
                                    </div>
                                    <strong style={{ width: '38px', color: scoreTone(a.avg).fg }}>{a.avg}%</strong>
                                  </div>
                                </td>
                                <td style={{ padding: '10px', fontWeight: '700', color: a.critical ? T.fail.fg : C.muted }}>{a.critical}</td>
                                <td style={{ padding: '10px' }}>{a.last || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* Settings Tab / Account Config */}
              {activeTab === 'settings' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', color: '#fff', marginTop: 0, fontWeight: '800', marginBottom: '16px' }}>Account Configuration</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0 }}>Registered Email: <span style={{ color: '#c4b5fd', fontWeight: '700' }}>{userEmail}</span></p>
                      <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0 }}>Authorization Level: <span style={{ color: '#c4b5fd', fontWeight: '700' }}>{userRole}</span></p>
                      <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0 }}>Employee Identification: <span style={{ color: '#c4b5fd', fontWeight: '700' }}>{employeeId}</span></p>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', color: '#fff', marginTop: 0, fontWeight: '800', marginBottom: '6px' }}>Secure Password Change</h3>
                    <p style={{ margin: '0 0 20px 0', fontSize: '11px', color: '#94a3b8' }}>Send a password change request to the administrator.</p>

                    {passwordMsg.text && (
                      <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', background: passwordMsg.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', border: passwordMsg.type === 'success' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)', color: passwordMsg.type === 'success' ? '#4ade80' : '#fca5a5' }}>
                        {passwordMsg.text}
                      </div>
                    )}

                    <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Current Password:</label>
                          <input 
                            type="password" 
                            name="currentPassword"
                            required
                            value={passwordData.currentPassword}
                            onChange={handlePasswordChangeInput}
                            placeholder="••••••••"
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>New Password:</label>
                          <input 
                            type="password" 
                            name="newPassword"
                            required
                            value={passwordData.newPassword}
                            onChange={handlePasswordChangeInput}
                            placeholder="Min 6 characters"
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Confirm New Password:</label>
                          <input 
                            type="password" 
                            name="confirmPassword"
                            required
                            value={passwordData.confirmPassword}
                            onChange={handlePasswordChangeInput}
                            placeholder="Re-enter new password"
                            style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                        <button 
                          type="submit"
                          disabled={passwordSubmitting}
                          style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '6px', cursor: passwordSubmitting ? 'wait' : 'pointer', fontWeight: '700', fontSize: '12px', letterSpacing: '0.5px' }}
                        >
                          {passwordSubmitting ? 'Updating Database...' : 'Update Password in DB'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

            </div>
          </div>
        </main>
      </div>
    </>
  );
  
}