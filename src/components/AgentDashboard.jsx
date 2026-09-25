import { useState, useEffect, useCallback } from 'react';

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

export default function AgentDashboard({ currentUser, onSignOut }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  
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

  const employeeId = currentUser?.employeeId || currentUser?.empId || currentUser?.id?.substring(0, 6)?.toUpperCase() || 'EMP-001';
  const userName = currentUser?.name || 'Valued Agent';
  const userRole = currentUser?.role || 'Sales Agent';
  const userEmail = currentUser?.email || 'agent@aeturnum.internal';
  const shiftTiming = '07:00 PM - 12:00 AM';

  const getInitials = (name) => {
    if (!name) return 'AG';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  const userInitials = getInitials(currentUser?.name);

  const todayStr = new Date().toISOString().split('T')[0];

  // Attendance now lives in the database (Note: requires a matching
  // GET/POST /api/attendance/agent/:id route on the backend, following the
  // same convention as /api/sales/agent/:id and /api/evaluations/agent/:id -
  // this used to be localStorage-only, which meant it wasn't visible to
  // managers and could be edited from devtools).
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

        if (isMounted && data.success && data.logs) {
          setAttendanceLogs(data.logs);
        }
      } catch (err) {
        console.error('Failed to load attendance from database:', err);
      } finally {
        if (isMounted) setLoadingAttendance(false);
      }
    }

    loadAttendance();
    return () => { isMounted = false; };
  }, [currentUser, employeeId]);

  // Sales Achieved State (Live from MongoDB backend)
  const [salesAchievedList, setSalesAchievedList] = useState([]);
  const [loadingSales, setLoadingSales] = useState(true);

  // Refactored with isMounted protection to satisfy React hook rules cleanly
  useEffect(() => {
    let isMounted = true;

    async function loadMySales() {
      try {
        const agentId = currentUser?.id || currentUser?.username || employeeId;
        if (!agentId) return;

        const res = await fetch(`${API_BASE}/api/sales/agent/${agentId}`, { headers: authHeaders() });
        const data = await parseJsonResponse(res);

        if (isMounted && data.success && data.sales) {
          setSalesAchievedList(data.sales);
        }
      } catch (err) {
        console.error('Failed to load sales from database:', err);
      } finally {
        if (isMounted) {
          setLoadingSales(false);
        }
      }
    }

    loadMySales();

    return () => {
      isMounted = false;
    };
  }, [currentUser, employeeId]);

  // QA Quality Call Evaluations State (Live from MongoDB backend)
  const [qaScoresList, setQaScoresList] = useState([]);
  const [loadingEvals, setLoadingEvals] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadLiveEvaluations() {
      try {
        const agentId = currentUser?.id || currentUser?.username || employeeId;
        if (!agentId) return;

        const res = await fetch(`${API_BASE}/api/evaluations/agent/${agentId}`, { headers: authHeaders() });
        const data = await parseJsonResponse(res);
        
        if (isMounted && data.success && data.evaluations) {
          setQaScoresList(data.evaluations);
        }
      } catch (err) {
        console.error('Failed to fetch live QA evaluations from backend:', err);
      } finally {
        if (isMounted) {
          setLoadingEvals(false);
        }
      }
    }

    if (currentUser || employeeId) {
      loadLiveEvaluations();
    }

    return () => {
      isMounted = false;
    };
  }, [currentUser, employeeId]);

  const averageQaScore = qaScoresList.length > 0 
    ? Math.round(qaScoresList.reduce((acc, curr) => acc + (Number(curr.score) || 0), 0) / qaScoresList.length)
    : 0;

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

  // Medicare Campaign Sales Form State
  const [medicareData, setMedicareData] = useState({
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    medicarePart: 'Part A & B',
    currentPlan: 'Original Medicare',
    primaryDoctor: '',
    medicationsList: '',
    saleAmount: '',
    tcpaConsent: false,
    notes: ''
  });
  const [saleSubmitting, setSaleSubmitting] = useState(false);
  const [saleMsg, setSaleMsg] = useState({ type: '', text: '' });

  const handleMedicareChange = (e) => {
    const { name, value, type, checked } = e.target;
    setMedicareData({ 
      ...medicareData, 
      [name]: type === 'checkbox' ? checked : value 
    });
  };

  const handleMedicareSubmit = async (e) => {
    e.preventDefault();
    if (!medicareData.tcpaConsent) {
      setSaleMsg({ type: 'error', text: 'TCPA Verbal Consent must be confirmed before posting the sale.' });
      return;
    }

    setSaleSubmitting(true);
    setSaleMsg({ type: '', text: '' });

    try {
      const response = await fetch(`${API_BASE}/api/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          agentId: employeeId,
          agentName: userName,
          clientName: medicareData.clientName,
          clientPhone: medicareData.clientPhone,
          packageTier: `${medicareData.medicarePart} (${medicareData.currentPlan})`,
          saleAmount: medicareData.saleAmount,
          notes: medicareData.notes
        })
      });

      const data = await parseJsonResponse(response);

      if (data.success) {
        setSalesAchievedList(prev => [data.sale, ...prev]);

        setSaleMsg({ type: 'success', text: 'Medicare Sale successfully posted and sent to QA for review!' });
        setMedicareData({
          clientName: '',
          clientPhone: '',
          clientEmail: '',
          medicarePart: 'Part A & B',
          currentPlan: 'Original Medicare',
          primaryDoctor: '',
          medicationsList: '',
          saleAmount: '',
          tcpaConsent: false,
          notes: ''
        });
      } else {
        setSaleMsg({ type: 'error', text: data.error || 'Failed to post Medicare sale. Please check your connection.' });
      }
    } catch (err) {
      console.error('Sale submission error:', err);
      setSaleMsg({ type: 'error', text: err.message || 'An error occurred while submitting the form.' });
    } finally {
      setSaleSubmitting(false);
    }
  };

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
      // email a notification and lie about having updated anything.
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

  useEffect(() => {
    if (activeTab === 'approvals') fetchMyLeaves();
  }, [activeTab, fetchMyLeaves]);

  const handleLeaveChange = (e) => {
    const { name, value } = e.target;
    setLeaveForm((prev) => {
      const next = { ...prev, [name]: value };
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
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr', width: '100%', height: '100%', background: 'rgba(10, 12, 20, 0.35)', backdropFilter: 'blur(25px)', border: 'none', borderRadius: '0', boxShadow: 'none', overflow: 'hidden', margin: 0, boxSizing: 'border-box', position: 'relative' }}>

        {/* LEFT SIDEBAR */}
        <aside style={{ background: 'rgba(12, 14, 24, 0.85)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(124, 58, 237, 0.25)', padding: '24px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 2, height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
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
                { id: 'schedule', label: 'Shift Schedule' },
                { id: 'attendance', label: 'Attendance Work Log' },
                { id: 'approvals', label: 'Approvals' },
                { id: 'sales', label: 'Medicare Sales Portal' },
                { id: 'salesAchieved', label: 'Sales Achieved' },
                { id: 'qaScores', label: 'QA Quality Scores' },
                { id: 'settings', label: 'Account Config' }
              ].map((item) => (
                <button 
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
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

        {/* RIGHT MAIN CONTENT AREA */}
        <main style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', zIndex: 2, boxSizing: 'border-box' }}>
          
          {/* Top Header Bar */}
          <header style={{ padding: '16px 35px', background: 'rgba(12, 14, 24, 0.65)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(124, 58, 237, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
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
          <div style={{ width: '100%', flex: 1, padding: '30px 40px', boxSizing: 'border-box', overflowY: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '100%' }}>
              
              {/* Dashboard Tab */}
              {activeTab === 'dashboard' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                  <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                    <h4 style={{ fontSize: '13px', color: '#c4b5fd', margin: '0 0 10px 0', fontWeight: '800', letterSpacing: '1px' }}>
                      Medicare Campaign Workspace
                    </h4>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                      Welcome, {userName}. Use the Medicare Sales Portal to record client details and post confirmed enrollments. All submitted sales are sent directly to the Quality Assurance team for review and approval.
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


              {/* Medicare Sales Portal Tab */}
              {activeTab === 'sales' && (
                <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h3 style={{ fontSize: '15px', color: '#fff', margin: 0, fontWeight: '800' }}>Medicare Campaign Sales Portal</h3>
                    <span style={{ fontSize: '10px', background: 'rgba(124, 58, 237, 0.2)', color: '#c4b5fd', padding: '4px 10px', borderRadius: '6px', fontWeight: '700', textTransform: 'uppercase' }}>
                      Option: Send to QA Review
                    </span>
                  </div>
                  <p style={{ margin: '0 0 20px 0', fontSize: '11px', color: '#94a3b8' }}>Capture Medicare prospect details, current coverage, physician preferences, and send the verified sale to QA for final review and approval.</p>

                  {saleMsg.text && (
                    <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', background: saleMsg.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', border: saleMsg.type === 'success' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)', color: saleMsg.type === 'success' ? '#4ade80' : '#fca5a5' }}>
                      {saleMsg.text}
                    </div>
                  )}

                  <form onSubmit={handleMedicareSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Customer Full Name:</label>
                        <input 
                          type="text" 
                          name="clientName"
                          required
                          value={medicareData.clientName}
                          onChange={handleMedicareChange}
                          placeholder="Customer Legal Name"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Customer Phone Number:</label>
                        <input 
                          type="text" 
                          name="clientPhone"
                          required
                          value={medicareData.clientPhone}
                          onChange={handleMedicareChange}
                          placeholder="+1 (555) 000-0000"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Email Address:</label>
                        <input 
                          type="email" 
                          name="clientEmail"
                          required
                          value={medicareData.clientEmail}
                          onChange={handleMedicareChange}
                          placeholder="client@email.com"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Medicare Eligibility / Parts:</label>
                        <select 
                          name="medicarePart"
                          value={medicareData.medicarePart}
                          onChange={handleMedicareChange}
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        >
                          <option value="Part A & B">Part A & Part B Active</option>
                          <option value="Part A Only">Part A Only</option>
                          <option value="Part B Only">Part B Only</option>
                          <option value="Qualifying Soon">Turning 65 / Qualifying Soon</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Current Medicare Plan:</label>
                        <select 
                          name="currentPlan"
                          value={medicareData.currentPlan}
                          onChange={handleMedicareChange}
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        >
                          <option value="Original Medicare">Original Medicare</option>
                          <option value="Medicare Advantage (Part C)">Medicare Advantage (Part C)</option>
                          <option value="Medigap Supplement">Medigap Supplement</option>
                          <option value="None / First Time">None / First Time Enrollment</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Sale Value / Commission Tag:</label>
                        <input 
                          type="text" 
                          name="saleAmount"
                          required
                          value={medicareData.saleAmount}
                          onChange={handleMedicareChange}
                          placeholder="e.g. $250 or Verified Lead"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Primary Doctor / Provider Preference:</label>
                        <input 
                          type="text" 
                          name="primaryDoctor"
                          value={medicareData.primaryDoctor}
                          onChange={handleMedicareChange}
                          placeholder="Doctor name or medical group"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Current Medications (Formulary):</label>
                        <input 
                          type="text" 
                          name="medicationsList"
                          value={medicareData.medicationsList}
                          onChange={handleMedicareChange}
                          placeholder="List prescription drugs if any"
                          style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '700' }}>Call Notes / Enrollment Details:</label>
                      <textarea 
                        name="notes"
                        rows="2"
                        value={medicareData.notes}
                        onChange={handleMedicareChange}
                        placeholder="Add specific client preferences or call summary notes..."
                        style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#fff', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', resize: 'vertical' }}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(8, 10, 17, 0.6)', padding: '10px 14px', borderRadius: '6px', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
                      <input 
                        type="checkbox"
                        name="tcpaConsent"
                        id="tcpaConsent"
                        checked={medicareData.tcpaConsent}
                        onChange={handleMedicareChange}
                        style={{ width: '16px', height: '16px', accentColor: '#7c3aed', cursor: 'pointer' }}
                      />
                      <label htmlFor="tcpaConsent" style={{ fontSize: '11px', color: '#cbd5e1', cursor: 'pointer', fontWeight: '600' }}>
                        <strong style={{ color: '#c4b5fd' }}>TCPA Compliance Check:</strong> Customer has given verbal consent to be contacted regarding Medicare plan options and enrollment processing.
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button 
                        type="submit"
                        disabled={saleSubmitting}
                        style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '6px', cursor: saleSubmitting ? 'wait' : 'pointer', fontWeight: '700', fontSize: '12px', letterSpacing: '0.5px' }}
                      >
                        {saleSubmitting ? 'Sending Sale to QA...' : 'Submit Sale to QA Review'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Sales Achieved Tab */}
              {activeTab === 'salesAchieved' && (
                <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '15px', color: '#fff', margin: '0 0 4px 0', fontWeight: '800' }}>Sales Achieved & QA Approval Status</h3>
                      <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>All submitted sales are reviewed by Quality Assurance and marked as approved or pending from their portal queue.</p>
                    </div>
                    <span style={{ fontSize: '11px', color: '#c4b5fd', background: 'rgba(124, 58, 237, 0.2)', padding: '6px 12px', borderRadius: '6px', fontWeight: '700' }}>
                      Total Submitted: {salesAchievedList.length}
                    </span>
                  </div>

                  {loadingSales ? (
                    <div style={{ padding: '30px', background: 'rgba(8, 10, 17, 0.6)', borderRadius: '8px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Loading your sales from the database...</p>
                    </div>
                  ) : salesAchievedList.length > 0 ? (
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.3)', color: '#c4b5fd', fontWeight: '800' }}>
                            <th style={{ padding: '12px' }}>Sale ID</th>
                            <th style={{ padding: '12px' }}>Date</th>
                            <th style={{ padding: '12px' }}>Customer Name</th>
                            <th style={{ padding: '12px' }}>Customer Number</th>
                            <th style={{ padding: '12px' }}>Package / Tier</th>
                            <th style={{ padding: '12px' }}>Amount</th>
                            <th style={{ padding: '12px' }}>Sale Confirmation Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesAchievedList.map((sale, index) => {
                            const isApproved = sale.qaStatus === 'Approved by QA';
                            const isRejected = sale.qaStatus === 'Rejected';
                            return (
                              <tr key={index} style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.1)', color: '#cbd5e1' }}>
                                <td style={{ padding: '12px', fontWeight: '700', color: '#c4b5fd' }}>{sale.id}</td>
                                <td style={{ padding: '12px' }}>{sale.date}</td>
                                <td style={{ padding: '12px', fontWeight: '700', color: '#fff' }}>{sale.clientName}</td>
                                <td style={{ padding: '12px', color: '#94a3b8' }}>{sale.clientPhone}</td>
                                <td style={{ padding: '12px' }}>{sale.packageTier}</td>
                                <td style={{ padding: '12px', fontWeight: '700', color: '#4ade80' }}>{sale.saleAmount}</td>
                                <td style={{ padding: '12px' }}>
                                  <span style={{ 
                                    padding: '4px 10px', 
                                    borderRadius: '6px', 
                                    fontWeight: '800', 
                                    fontSize: '10px',
                                    background: isApproved ? 'rgba(34, 197, 94, 0.2)' : isRejected ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                                    color: isApproved ? '#4ade80' : isRejected ? '#fca5a5' : '#facc15',
                                    border: isApproved ? '1px solid rgba(34, 197, 94, 0.4)' : isRejected ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(234, 179, 8, 0.4)'
                                  }}>
                                    {sale.qaStatus}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '30px', background: 'rgba(8, 10, 17, 0.6)', borderRadius: '8px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>No sales recorded yet. Submit a sale through the Medicare Sales Portal to send it to the QA queue.</p>
                    </div>
                  )}
                </div>
              )}

              {/* QA Quality Scores Tab */}
              {activeTab === 'qaScores' && (
                <div style={{ background: 'rgba(18, 21, 36, 0.9)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '10px', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '15px', color: '#fff', margin: '0 0 4px 0', fontWeight: '800' }}>QA Quality Call Evaluations & Scores</h3>
                      <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Review evaluated call metrics, compliance scores, and specific feedback left by Quality Assurance supervisors from the database.</p>
                    </div>
                    <span style={{ fontSize: '11px', color: '#4ade80', background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.4)', padding: '6px 12px', borderRadius: '6px', fontWeight: '800' }}>
                      Average QA Score: {averageQaScore}%
                    </span>
                  </div>

                  {loadingEvals ? (
                    <div style={{ padding: '30px', background: 'rgba(8, 10, 17, 0.6)', borderRadius: '8px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Loading live evaluations from database...</p>
                    </div>
                  ) : qaScoresList.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {qaScoresList.map((item, index) => (
                        <div key={item._id || index} style={{ background: 'rgba(8, 10, 17, 0.8)', border: '1px solid rgba(124, 58, 237, 0.25)', borderRadius: '8px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: '800', color: '#c4b5fd' }}>{item.qaId || item.id}</span>
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>|</span>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>Client: {item.client}</span>
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>|</span>
                              <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{item.date}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <span style={{ fontSize: '10px', background: 'rgba(124, 58, 237, 0.25)', color: '#e9d5ff', padding: '3px 8px', borderRadius: '4px', fontWeight: '700' }}>
                                Adherence: {item.adherence}
                              </span>
                              <span style={{ fontSize: '11px', background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)', padding: '4px 10px', borderRadius: '6px', fontWeight: '800' }}>
                                Score: {item.score}%
                              </span>
                            </div>
                          </div>

                          <div style={{ background: 'rgba(20, 24, 41, 0.5)', padding: '12px 14px', borderRadius: '6px', border: '1px solid rgba(124, 58, 237, 0.15)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '10px', color: '#c4b5fd', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              QA Evaluator Notes ({item.evaluator || 'Supervisor'}):
                            </span>
                            <p style={{ margin: 0, fontSize: '11px', color: '#cbd5e1', lineHeight: '1.5' }}>
                              {item.notes}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '30px', background: 'rgba(8, 10, 17, 0.6)', borderRadius: '8px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>No QA quality evaluations found in the database for your account.</p>
                    </div>
                  )}
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
                    <p style={{ margin: '0 0 20px 0', fontSize: '11px', color: '#94a3b8' }}>Update your authentication credentials directly in the main database.</p>

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