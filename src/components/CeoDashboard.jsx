import { useEffect, useMemo, useState } from 'react';
import LeaveApprovalsPanel from './LeaveApprovalsPanel';

const API_BASE =
    import.meta.env.VITE_API_URL ||
    'http://localhost:5000';

// Marking present is only allowed from 6:55:00 PM until exactly 11:55:00 PM
const PRESENT_WINDOW_START_MINUTES = 18 * 60 + 55; // 6:55 PM
const PRESENT_WINDOW_END_MINUTES = 23 * 60 + 55;   // 11:55 PM
const PRESENT_WINDOW_LABEL = '6:55 PM – 11:55 PM';

const isWithinPresentWindow = (date = new Date()) => {
    const totalSeconds =
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
    return (
        totalSeconds >= PRESENT_WINDOW_START_MINUTES * 60 &&
        totalSeconds < PRESENT_WINDOW_END_MINUTES * 60
    );
};

/* -------------------------------------------------------
   SALES COUNT HELPERS (sales posted per agent, by period)
------------------------------------------------------- */
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
// Monday of the week the date falls in (weeks run Monday to Sunday)
const mondayOf = (d) => {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
    return isoDay(c);
};
// Same rule as the stats cards: anything not approved or rejected is still pending
const saleResult = (sale) => {
    const s = String(sale.qaStatus || '').toLowerCase();
    return s.includes('approve') ? 'approved' : s.includes('reject') ? 'rejected' : 'pending';
};
const saleWhen = (sale) => {
    for (const v of [sale.createdAt, sale.postedAt, sale.timestamp, sale.date]) {
        if (!v) continue;
        const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T00:00:00`) : new Date(v);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
};
const emptyCount = () => ({ total: 0, approved: 0, pending: 0, rejected: 0 });
const bumpCount = (c, result) => {
    c.total += 1;
    c[result] += 1;
};
const SALE_PERIODS = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' }
];
const SALE_COLS = [
    { id: 'total', label: 'Posted', color: '#fff' },
    { id: 'approved', label: 'Approved', color: '#4ade80' },
    { id: 'pending', label: 'Pending', color: '#facc15' },
    { id: 'rejected', label: 'Rejected', color: '#fca5a5' }
];
const countTh = (color, divider) => ({
    padding: '11px',
    textAlign: 'center',
    color,
    borderBottom: '1px solid rgba(124, 58, 237, 0.2)',
    borderLeft: divider ? '1px solid rgba(124, 58, 237, 0.2)' : undefined,
    whiteSpace: 'nowrap'
});
const countTd = (color, strong, divider) => ({
    padding: '11px',
    textAlign: 'center',
    color,
    fontWeight: strong ? '800' : '600',
    borderBottom: '1px solid rgba(124, 58, 237, 0.08)',
    borderLeft: divider ? '1px solid rgba(124, 58, 237, 0.2)' : undefined,
    whiteSpace: 'nowrap'
});

export default function CeoDashboard({
    currentUser,
    salesList = [],
    onSignOut
}) {
    const [summary, setSummary] = useState(null);
    const [summaryError, setSummaryError] = useState('');
    const [teamMembers, setTeamMembers] = useState([]);
    const [sales, setSales] = useState([]);
    const [salesError, setSalesError] = useState('');
    const [reviewingSaleId, setReviewingSaleId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [activePage, setActivePage] = useState('Dashboard');
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Close the mobile sidebar automatically whenever a nav item is picked
    const goToPage = (label) => {
        setActivePage(label);
        setSidebarOpen(false);
    };
    
    const [checkInTime, setCheckInTime] = useState(() => {
        const savedTime = localStorage.getItem('ceo_checkin_time');
        return savedTime ? new Date(savedTime) : null;
    });

    // PRESENT only lasts for today's window: it switches off by itself at
    // 11:55 PM and never carries over to the next day.
    const isCheckedIn =
        Boolean(checkInTime) &&
        checkInTime.toDateString() === currentTime.toDateString() &&
        isWithinPresentWindow(currentTime);

    // Once PRESENT has expired, clear the saved check-in
    useEffect(() => {
        if (checkInTime && !isCheckedIn) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setCheckInTime(null);
            localStorage.removeItem('ceo_checked_in');
            localStorage.removeItem('ceo_checkin_time');
        }
    }, [checkInTime, isCheckedIn]);

    const [employeeSearch, setEmployeeSearch] = useState('');

    // Account Creation & Editing States inside Employee Management
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [newEmpName, setNewEmpName] = useState('');
    const [newEmpEmail, setNewEmpEmail] = useState('');
    const [newEmpPassword, setNewEmpPassword] = useState('');
    const [newEmpEmployeeId, setNewEmpEmployeeId] = useState('');
    const [newEmpRole, setNewEmpRole] = useState('CSR');
    const [newEmpDepartment, setNewEmpDepartment] = useState('Call Center');
    
    // Avatar file upload states
    const [newEmpAvatarFile, setNewEmpAvatarFile] = useState(null);
    const [newEmpAvatarPreview, setNewEmpAvatarPreview] = useState('');

    const [creatingEmp, setCreatingEmp] = useState(false);
    const [createError, setCreateError] = useState('');
    const [createSuccess, setCreateSuccess] = useState('');

    const userName =
        currentUser?.name ||
        currentUser?.fullName ||
        'CEO';

    const employeeId =
        currentUser?.employeeId ||
        currentUser?.empId ||
        currentUser?.id ||
        'CEO-001';

    const userRole =
        currentUser?.role ||
        currentUser?.designation ||
        'CEO & Founder';

    const department =
        currentUser?.department ||
        currentUser?.division ||
        'Management';

    const email =
        currentUser?.email ||
        'Not available';

    const phone =
        currentUser?.phone ||
        currentUser?.phoneNumber ||
        'Not available';

    const doj =
        currentUser?.doj ||
        currentUser?.dateOfJoining ||
        currentUser?.joiningDate ||
        'Not available';

    const status =
        currentUser?.status ||
        'Active';

    const userAvatar =
        currentUser?.avatar ||
        currentUser?.profilePic ||
        currentUser?.picture ||
        currentUser?.img;

    const getInitials = (name) => {
        if (!name) return 'CEO';

        const parts = name.trim().split(/\s+/);

        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        }

        return name.substring(0, 2).toUpperCase();
    };

    const userInitials = getInitials(userName);

    /* -------------------------------------------------------
       LIVE CLOCK
    ------------------------------------------------------- */

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    /* -------------------------------------------------------
       FETCH CEO SUMMARY & EMPLOYEES FROM DB
    ------------------------------------------------------- */
    const fetchEmployees = () => {
        const token = localStorage.getItem('token');
        const headers = {
            Authorization: `Bearer ${token}`
        };

        Promise.all([
            fetch(`${API_BASE}/api/evaluations/ceo-summary`, { headers }).then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }).catch((err) => {
                console.error('CEO summary fetch failed:', err);
                setSummaryError(err.message || 'Request failed');
                return null;
            }),
            
            // FIXED: Changed from /api/employees to /api/users to match your creation route
            fetch(`${API_BASE}/api/users`, { headers }).then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }).catch((err) => {
                console.error('Users fetch failed:', err);
                return [];
            }),

            fetch(`${API_BASE}/api/sales`, { headers }).then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }).catch((err) => {
                console.error('Sales fetch failed:', err);
                setSalesError(err.message || 'Request failed');
                return null;
            })
        ]).then(([summaryData, employeesData, salesData]) => {
            // Log the raw payload once so you can see exactly what the API
            // actually sends back and match the key names below to it.
            console.log('CEO summary raw response:', summaryData);

            if (summaryData) {
                // The backend may not use the exact keys this component expects
                // (totalEvaluations / companyAverage). Try the common variants
                // instead of silently falling back to 0.
                const totalEvaluations =
                    summaryData.totalEvaluations ??
                    summaryData.total_evaluations ??
                    summaryData.totalEvaluationCount ??
                    summaryData.evaluationCount ??
                    summaryData.count;

                const companyAverage =
                    summaryData.companyAverage ??
                    summaryData.company_average ??
                    summaryData.averageScore ??
                    summaryData.avgScore ??
                    summaryData.average;

                if (totalEvaluations === undefined && companyAverage === undefined) {
                    // The request succeeded but none of the expected keys were
                    // present at all - flag it instead of quietly showing 0s.
                    setSummaryError(
                        `Response has no recognized fields. Keys received: ${Object.keys(summaryData).join(', ') || '(empty object)'}`
                    );
                } else {
                    setSummaryError('');
                }

                setSummary({ ...summaryData, totalEvaluations, companyAverage });
            }
            
            // Safely parse the user array regardless of how the backend wraps it
            const empList = Array.isArray(employeesData) 
                ? employeesData 
                : (employeesData?.users || employeesData?.employees || employeesData?.data || []);
            
            setTeamMembers(empList);

            if (salesData) {
                setSales(Array.isArray(salesData) ? salesData : (salesData.sales || []));
                setSalesError('');
            }

            setLoading(false);
        }).catch((error) => {
            console.error('Error fetching dashboard database records:', error);
            setSummaryError(error.message || 'Request failed');
            setLoading(false);
        });
    };
    useEffect(() => {
        fetchEmployees();
    }, []);

    /* -------------------------------------------------------
       OPEN CREATE / EDIT MODAL
    ------------------------------------------------------- */

    const handleOpenCreateModal = () => {
        setEditingEmployee(null);
        setNewEmpName('');
        setNewEmpEmail('');
        setNewEmpPassword('');
        setNewEmpEmployeeId('');
        setNewEmpRole('CSR');
        setNewEmpDepartment('Call Center');
        setNewEmpAvatarFile(null);
        setNewEmpAvatarPreview('');
        setCreateError('');
        setCreateSuccess('');
        setShowCreateModal(true);
    };

    const handleOpenEditModal = (emp) => {
        setEditingEmployee(emp);
        setNewEmpName(emp.name || emp.fullName || '');
        setNewEmpEmail(emp.email || '');
        setNewEmpPassword(''); // keep blank unless updating
        setNewEmpEmployeeId(emp.employeeId || emp.empId || emp.id || '');
        setNewEmpRole(emp.role || emp.designation || 'CSR');
        setNewEmpDepartment(emp.department || emp.division || 'Call Center');
        setNewEmpAvatarFile(null);
        setNewEmpAvatarPreview(emp.avatar || emp.profilePic || '');
        setCreateError('');
        setCreateSuccess('');
        setShowCreateModal(true);
    };

    /* -------------------------------------------------------
       AVATAR FILE CHANGE HANDLER
    ------------------------------------------------------- */

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setNewEmpAvatarFile(file);

        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                // Shrink to a small thumbnail so the request stays well under the server body limit
                const MAX = 256; // px
                const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                setNewEmpAvatarPreview(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    /* -------------------------------------------------------
       CREATE / UPDATE EMPLOYEE ACCOUNT HANDLER
    ------------------------------------------------------- */

    const handleSaveEmployee = async (e) => {
        e.preventDefault();
        setCreateError('');
        setCreateSuccess('');
        setCreatingEmp(true);

        try {
            const token = localStorage.getItem('token');
            const url = editingEmployee 
                ? `${API_BASE}/api/users/${editingEmployee._id || editingEmployee.id}`
                : `${API_BASE}/api/users`;
            
            const method = editingEmployee ? 'PUT' : 'POST';

            const payload = {
                id: newEmpEmployeeId,
                employeeId: newEmpEmployeeId,
                name: newEmpName,
                email: newEmpEmail,
                role: newEmpRole,
                department: newEmpDepartment
            };

            // Only send the avatar when a NEW photo was picked (already resized to a small thumbnail).
            // Never re-send the stored avatar on edit, it can be a huge base64 string from older saves.
            if (newEmpAvatarFile && newEmpAvatarPreview) {
                payload.avatar = newEmpAvatarPreview;
            }

            if (!editingEmployee || newEmpPassword) {
                payload.password = newEmpPassword;
            }

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.message || 'Failed to save employee account');
            }

            // --- INSTANTLY UPDATE LOCAL STATE ---
            const savedUser = data.user || data.savedUser || data;
            if (editingEmployee) {
                setTeamMembers(prev => prev.map(emp => 
                    (emp._id === savedUser._id || emp.id === savedUser.id) ? savedUser : emp
                ));
            } else {
                setTeamMembers(prev => [savedUser, ...prev]);
            }
            // ------------------------------------

            setCreateSuccess(editingEmployee ? 'Employee account updated successfully!' : 'Employee account created successfully!');
            fetchEmployees();
            
            setTimeout(() => {
                setShowCreateModal(false);
                setCreateSuccess('');
            }, 1500);
        } catch (err) {
            setCreateError(err.message);
        } finally {
            setCreatingEmp(false);
        }
    };

    /* -------------------------------------------------------
       CHECK-IN
    ------------------------------------------------------- */

    const handleCheckIn = () => {
        if (isCheckedIn) return;
        if (!isWithinPresentWindow()) return;

        const now = new Date();

        setCurrentTime(now);
        setCheckInTime(now);
        localStorage.setItem('ceo_checkin_time', now.toISOString());
    };

    // currentTime already ticks every second (see the live clock effect above),
    // so this recomputes automatically as the window opens/closes
    const canMarkPresent = isWithinPresentWindow(currentTime);

    /* -------------------------------------------------------
       FILTERED EMPLOYEES
    ------------------------------------------------------- */

    const filteredEmployees = useMemo(() => {
        const search = employeeSearch.trim().toLowerCase();

        if (!search) {
            return teamMembers;
        }

        return teamMembers.filter((member) => {
            const values = [
                member.name,
                member.email,
                member.id,
                member.employeeId,
                member.role,
                member.department,
                member.division
            ];

            return values.some((value) =>
                String(value || '')
                    .toLowerCase()
                    .includes(search)
            );
        });
    }, [teamMembers, employeeSearch]);

    /* -------------------------------------------------------
       HELPERS
    ------------------------------------------------------- */

    const formatTime = (date) => {
        if (!date) return '';

        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const getRoleCount = (role) => {
        return teamMembers.filter(
            (member) =>
                String(member.role || '').toLowerCase() ===
                role.toLowerCase()
        ).length;
    };

    /* -------------------------------------------------------
       SALES STATUS BREAKDOWN
       Sales are now fetched live from /api/sales (see fetchEmployees
       above). qaStatus comes from the backend as one of:
       'Pending QA Review', 'Approved by QA', 'Rejected'.
    ------------------------------------------------------- */
    const salesStats = useMemo(() => {
        const stats = { total: sales.length, pending: 0, approved: 0, rejected: 0 };

        sales.forEach((sale) => {
            const status = String(sale.qaStatus || '').toLowerCase();

            if (status.includes('approve')) {
                stats.approved += 1;
            } else if (status.includes('reject')) {
                stats.rejected += 1;
            } else {
                stats.pending += 1;
            }
        });

        return stats;
    }, [sales]);

    /* -------------------------------------------------------
       SALES COUNT PER AGENT
       Uses the same `sales` and `teamMembers` already loaded
       above, so there is no extra request. Daily / weekly /
       monthly counts are split into posted, approved, pending
       and rejected.
    ------------------------------------------------------- */
    const [salesAgentFilter, setSalesAgentFilter] = useState('all');

    const salesCount = useMemo(() => {
        const now = new Date();
        const todayKey = isoDay(now);
        const weekKey = mondayOf(now);
        const monthKey = monthOf(now);

        // Last 14 days, newest first
        const dayKeys = [];
        for (let i = 0; i < 14; i += 1) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayKeys.push({
                key: isoDay(d),
                label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
            });
        }

        const rows = new Map();
        const lookup = new Map(); // any known identifier of an agent -> its row key
        const newRow = (key, name) => ({ key, name, today: emptyCount(), week: emptyCount(), month: emptyCount() });

        // Every agent gets a row, even with zero sales
        teamMembers
            .filter((m) => /agent|csr/i.test(m.role || '') && !/team\s*lead|quality|auditor/i.test(m.role || ''))
            .forEach((m) => {
                const key = String(m.id || m._id || m.employeeId || m.username || m.name);
                rows.set(key, newRow(key, m.name || m.username || key));
                [m.id, m._id, m.employeeId, m.username, m.name].forEach((v) => {
                    if (v) lookup.set(String(v), key);
                });
            });

        const rowKeyFor = (sale) => {
            const ref = String(sale.agentId || sale.agentName || '');
            if (!ref) return null;
            const known = lookup.get(ref) || lookup.get(String(sale.agentName || ''));
            if (known) return known;
            if (!rows.has(ref)) rows.set(ref, newRow(ref, sale.agentName || ref));
            return ref;
        };

        const daily = new Map(); // row key or 'all' -> Map(day key -> counts)
        const dailyFor = (k) => {
            if (!daily.has(k)) daily.set(k, new Map(dayKeys.map((d) => [d.key, emptyCount()])));
            return daily.get(k);
        };

        const totals = { today: emptyCount(), week: emptyCount(), month: emptyCount() };
        let undated = 0;

        sales.forEach((sale) => {
            const key = rowKeyFor(sale);
            if (!key) return;
            const row = rows.get(key);
            const when = saleWhen(sale);
            if (!when) {
                undated += 1;
                return;
            }
            const result = saleResult(sale);

            if (isoDay(when) === todayKey) {
                bumpCount(row.today, result);
                bumpCount(totals.today, result);
            }
            if (mondayOf(when) === weekKey) {
                bumpCount(row.week, result);
                bumpCount(totals.week, result);
            }
            if (monthOf(when) === monthKey) {
                bumpCount(row.month, result);
                bumpCount(totals.month, result);
            }

            const dayKey = isoDay(when);
            const allSlot = dailyFor('all').get(dayKey);
            if (allSlot) {
                bumpCount(allSlot, result);
                bumpCount(dailyFor(key).get(dayKey), result);
            }
        });

        const list = [...rows.values()].sort(
            (a, b) => b.month.total - a.month.total || String(a.name).localeCompare(String(b.name))
        );

        return { list, totals, undated, dayKeys, daily };
    }, [sales, teamMembers]);

    const handleReviewSale = async (saleId, qaStatus) => {
        setReviewingSaleId(saleId);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/api/sales/${saleId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ qaStatus, reviewedBy: userName })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            // Refresh from the database so every card/table reflects the change
            fetchEmployees();
        } catch (err) {
            console.error('Failed to review sale:', err);
            setSalesError(err.message || 'Failed to update sale');
        } finally {
            setReviewingSaleId(null);
        }
    };

    const navItems = [
        {
            label: 'Dashboard',
            icon: '✦'
        },
        {
            label: 'Employee Management',
            icon: '👥'
        },
        {
            label: 'Divisions',
            icon: '◈'
        },
        {
            label: 'Roles & Permissions',
            icon: '🛡'
        },
        {
            label: 'Attendance',
            icon: '✓'
        },
        {
            label: 'Schedules',
            icon: '◷'
        },
        {
            label: 'Approvals',
            icon: '⌁'
        },
        {
            label: 'Sales / Performance',
            icon: '↗'
        },
        {
            label: 'QA / Evaluations',
            icon: '◎'
        },
        {
            label: 'Account Settings',
            icon: '⚙'
        }
    ];

    return (
        <>
            <style>{`
                * {
                    box-sizing: border-box;
                }

                div::-webkit-scrollbar,
                aside::-webkit-scrollbar,
                main::-webkit-scrollbar {
                    display: none !important;
                    width: 0 !important;
                    height: 0 !important;
                }

                div,
                aside,
                main {
                    scrollbar-width: none !important;
                    -ms-overflow-style: none !important;
                }

                button {
                    font-family: inherit;
                }

                input::placeholder, select::placeholder {
                    color: #64748b;
                }

                .ceo-mobile-menu-btn {
                    display: none;
                }

                .ceo-sidebar-overlay {
                    display: none;
                }

                /* ============ MOBILE LAYOUT ============ */
                @media (max-width: 860px) {
                    .ceo-shell {
                        grid-template-columns: 1fr !important;
                    }

                    .ceo-sidebar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        bottom: 0;
                        width: 78vw;
                        max-width: 280px;
                        transform: translateX(-100%);
                        transition: transform 0.25s ease;
                        z-index: 100;
                    }

                    .ceo-sidebar.ceo-sidebar-open {
                        transform: translateX(0);
                    }

                    .ceo-mobile-menu-btn {
                        display: inline-flex !important;
                    }

                    .ceo-sidebar-overlay.ceo-sidebar-open {
                        display: block;
                        position: fixed;
                        inset: 0;
                        background: rgba(0, 0, 0, 0.55);
                        z-index: 90;
                    }

                    .ceo-header {
                        padding-left: 14px !important;
                        padding-right: 14px !important;
                        flex-wrap: wrap !important;
                    }

                    .ceo-content {
                        padding: 16px !important;
                    }

                    table {
                        font-size: 9px;
                    }
                }
            `}</style>

            <div
                className="ceo-shell"
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'grid',
                    gridTemplateColumns: '270px minmax(0, 1fr)',
                    background: 'rgba(10, 12, 20, 0.35)',
                    backdropFilter: 'blur(12px)',
                    overflow: 'hidden',
                    position: 'relative'
                }}
            >


                {/* =====================================================
                    LEFT SIDEBAR
                ====================================================== */}

                <aside
                    className={`ceo-sidebar${sidebarOpen ? ' ceo-sidebar-open' : ''}`}
                    style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '20px 14px',
                        background: 'rgba(8, 10, 17, 0.72)',
                        backdropFilter: 'blur(18px)',
                        borderRight:
                            '1px solid rgba(124, 58, 237, 0.25)',
                        overflowY: 'auto',
                        zIndex: 5
                    }}
                >
                    <div>

                        {/* BRAND */}

                        <div
                            style={{
                                padding: '4px 8px 18px',
                                borderBottom:
                                    '1px solid rgba(255,255,255,0.06)',
                                marginBottom: '18px'
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '18px',
                                    fontWeight: '900',
                                    letterSpacing: '3px',
                                    background:
                                        'linear-gradient(135deg, #ffffff 15%, #c4b5fd 55%, #a855f7 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent'
                                }}
                            >
                                AETURNUM
                            </div>

                            <div
                                style={{
                                    marginTop: '4px',
                                    fontSize: '9px',
                                    color: '#64748b',
                                    letterSpacing: '1.5px',
                                    fontWeight: '700'
                                }}
                            >
                                EMPLOYEE PORTAL
                            </div>
                        </div>

                        {/* PROFILE */}

                        <div
                            style={{
                                padding: '14px',
                                marginBottom: '18px',
                                background:
                                    'rgba(20, 24, 41, 0.58)',
                                border:
                                    '1px solid rgba(124, 58, 237, 0.2)',
                                borderRadius: '12px'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '11px'
                                }}
                            >
                                <div
                                    style={{
                                        width: '48px',
                                        height: '48px',
                                        minWidth: '48px',
                                        borderRadius: '50%',
                                        background:
                                            'linear-gradient(135deg, #7c3aed, #4c1d95)',
                                        border:
                                            '2px solid #c4b5fd',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        overflow: 'hidden',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: '900'
                                    }}
                                >
                                    {userAvatar ? (
                                        <img
                                            src={userAvatar}
                                            alt={userName}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover'
                                            }}
                                        />
                                    ) : (
                                        userInitials
                                    )}
                                </div>

                                <div
                                    style={{
                                        minWidth: 0
                                    }}
                                >
                                    <div
                                        style={{
                                            color: '#fff',
                                            fontSize: '13px',
                                            fontWeight: '800',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {userName}
                                    </div>

                                    <div
                                        style={{
                                            color: '#c4b5fd',
                                            fontSize: '9px',
                                            fontWeight: '700',
                                            marginTop: '3px'
                                        }}
                                    >
                                        {employeeId}
                                    </div>

                                    <div
                                        style={{
                                            color: '#94a3b8',
                                            fontSize: '9px',
                                            marginTop: '2px'
                                        }}
                                    >
                                        {userRole}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* NAVIGATION */}

                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px'
                            }}
                        >
                            {navItems.map((item) => {
                                const active =
                                    activePage === item.label;

                                return (
                                    <button
                                        key={item.label}
                                        onClick={() =>
                                            goToPage(item.label)
                                        }
                                        style={{
                                            width: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '11px',
                                            padding: '10px 11px',
                                            border: 'none',
                                            borderLeft: active
                                                ? '3px solid #8b5cf6'
                                                : '3px solid transparent',
                                            borderRadius:
                                                '0 7px 7px 0',
                                            background: active
                                                ? 'rgba(124, 58, 237, 0.16)'
                                                : 'transparent',
                                            color: active
                                                ? '#ffffff'
                                                : '#94a3b8',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            fontSize: '10px',
                                            fontWeight: active
                                                ? '800'
                                                : '650',
                                            letterSpacing: '0.25px'
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: '20px',
                                                textAlign: 'center',
                                                fontSize: '13px'
                                            }}
                                        >
                                            {item.icon}
                                        </span>

                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* SIGN OUT */}

                    <button
                        onClick={onSignOut}
                        style={{
                            width: '100%',
                            marginTop: '16px',
                            padding: '10px',
                            background:
                                'rgba(239, 68, 68, 0.05)',
                            color: '#fca5a5',
                            border:
                                '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '7px',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: '800',
                            letterSpacing: '0.8px'
                        }}
                    >
                        SIGN OUT
                    </button>
                </aside>

                {/* Tap-outside-to-close backdrop, mobile only */}
                <div
                    className={`ceo-sidebar-overlay${sidebarOpen ? ' ceo-sidebar-open' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                />

                {/* =====================================================
                    RIGHT WORKSPACE
                ====================================================== */}

                <main
                    style={{
                        minWidth: 0,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        zIndex: 4
                    }}
                >

                    {/* TOP HEADER */}

                    <header
                        className="ceo-header"
                        style={{
                            minHeight: '62px',
                            padding: '10px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '15px',
                            background:
                                'rgba(8, 10, 17, 0.46)',
                            borderBottom:
                                '1px solid rgba(124, 58, 237, 0.18)',
                            backdropFilter: 'blur(12px)'
                        }}
                    >

                        {/* MOBILE MENU TOGGLE */}

                        <button
                            className="ceo-mobile-menu-btn"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open menu"
                            style={{
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '36px',
                                height: '36px',
                                borderRadius: '7px',
                                border: '1px solid rgba(124, 58, 237, 0.4)',
                                background: 'rgba(124, 58, 237, 0.12)',
                                color: '#e2e8f0',
                                fontSize: '16px',
                                cursor: 'pointer',
                                marginRight: '4px'
                            }}
                        >
                            ☰
                        </button>

                        {/* CHECK IN */}

                        <button
                            onClick={handleCheckIn}
                            disabled={isCheckedIn || !canMarkPresent}
                            title={
                                !isCheckedIn && !canMarkPresent
                                    ? `Marking present is only available ${PRESENT_WINDOW_LABEL}`
                                    : undefined
                            }
                            style={{
                                padding: '9px 15px',
                                borderRadius: '7px',
                                border: isCheckedIn
                                    ? '1px solid rgba(74, 222, 128, 0.35)'
                                    : '1px solid rgba(124, 58, 237, 0.5)',
                                background: isCheckedIn
                                    ? 'rgba(74, 222, 128, 0.1)'
                                    : canMarkPresent
                                        ? 'linear-gradient(135deg, #7c3aed, #6d28d9)'
                                        : 'rgba(100, 116, 139, 0.15)',
                                color: isCheckedIn
                                    ? '#4ade80'
                                    : canMarkPresent
                                        ? '#ffffff'
                                        : '#64748b',
                                fontSize: '10px',
                                fontWeight: '900',
                                cursor: isCheckedIn || !canMarkPresent
                                    ? 'default'
                                    : 'pointer',
                                letterSpacing: '0.5px'
                            }}
                        >
                            {isCheckedIn
                                ? `✓ PRESENT — ${formatTime(checkInTime)}`
                                : canMarkPresent
                                    ? '✓ MARK PRESENT'
                                    : `MARK PRESENT (${PRESENT_WINDOW_LABEL})`}
                        </button>

                        {/* CLOCK */}

                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                color: '#c4b5fd',
                                fontSize: '11px',
                                fontWeight: '700'
                            }}
                        >
                            <span>
                                {currentTime.toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    second: '2-digit'
                                })}
                            </span>

                            <span
                                style={{
                                    color: 'rgba(255,255,255,0.16)'
                                }}
                            >
                                |
                            </span>

                            <span>
                                {employeeId}
                            </span>
                        </div>
                    </header>

                    {/* =================================================
                        CONTENT
                    ================================================== */}

                    <div
                        className="ceo-content"
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '25px 30px 35px'
                        }}
                    >

                        {/* =================================================
                            DASHBOARD
                        ================================================== */}

                        {activePage === 'Dashboard' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="DASHBOARD"
                                    subtitle="Aeturnum company overview and executive control."
                                />

                                {/* CEO MESSAGE */}

                                <section style={cardStyle}>
                                    <div style={sectionLabel}>
                                        ✦ MESSAGE FROM CEO
                                    </div>

                                    <div
                                        style={{
                                            marginTop: '13px',
                                            padding: '17px',
                                            background:
                                                'rgba(8, 10, 17, 0.45)',
                                            borderRadius: '9px',
                                            border:
                                                '1px solid rgba(124, 58, 237, 0.16)'
                                        }}
                                    >
                                        <div
                                            style={{
                                                color: '#e2e8f0',
                                                fontSize: '13px',
                                                lineHeight: '1.7'
                                            }}
                                        >
                                            Welcome back, {userName}.
                                            Please make sure all
                                            assigned company tasks
                                            are completed before the
                                            end of your shift.
                                        </div>

                                        <div
                                            style={{
                                                marginTop: '10px',
                                                color: '#a78bfa',
                                                fontSize: '10px',
                                                fontWeight: '800'
                                            }}
                                        >
                                            — CEO
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {/* =================================================
                            EMPLOYEE MANAGEMENT
                        ================================================== */}

                        {activePage === 'Employee Management' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                                    <PageTitle
                                        title="EMPLOYEE MANAGEMENT"
                                        subtitle="Manage Aeturnum employees, accounts, divisions and employment information."
                                    />
                                    <button
                                        onClick={handleOpenCreateModal}
                                        style={{
                                            padding: '10px 16px',
                                            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                                            color: '#fff',
                                            border: '1px solid rgba(124, 58, 237, 0.5)',
                                            borderRadius: '8px',
                                            fontSize: '10px',
                                            fontWeight: '900',
                                            cursor: 'pointer',
                                            letterSpacing: '0.5px'
                                        }}
                                    >
                                        + CREATE ACCOUNT
                                    </button>
                                </div>

                                {/* CREATE / EDIT ACCOUNT MODAL */}
                                {showCreateModal && (
                                    <section style={{ ...cardStyle, border: '1px solid rgba(124, 58, 237, 0.5)', background: 'rgba(15, 18, 30, 0.95)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                            <div style={sectionLabel}>
                                                {editingEmployee ? 'EDIT EMPLOYEE ACCOUNT' : 'REGISTER NEW EMPLOYEE ACCOUNT'}
                                            </div>
                                            <button 
                                                onClick={() => setShowCreateModal(false)}
                                                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                                            >
                                                ✕
                                            </button>
                                        </div>

                                        {createError && (
                                            <div style={{ padding: '10px', marginBottom: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', borderRadius: '6px', fontSize: '10px' }}>
                                                {createError}
                                            </div>
                                        )}

                                        {createSuccess && (
                                            <div style={{ padding: '10px', marginBottom: '12px', background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.3)', color: '#4ade80', borderRadius: '6px', fontSize: '10px' }}>
                                                {createSuccess}
                                            </div>
                                        )}

                                        <form onSubmit={handleSaveEmployee} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>FULL NAME</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={newEmpName}
                                                    onChange={(e) => setNewEmpName(e.target.value)}
                                                    placeholder="Enter full name"
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.7)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>EMPLOYEE ID</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={newEmpEmployeeId}
                                                    onChange={(e) => setNewEmpEmployeeId(e.target.value)}
                                                    placeholder="e.g. EMP-001"
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.7)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>EMAIL ADDRESS</label>
                                                <input
                                                    type="email"
                                                    required
                                                    value={newEmpEmail}
                                                    onChange={(e) => setNewEmpEmail(e.target.value)}
                                                    placeholder="employee@aeturnum.com"
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.7)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>
                                                    {editingEmployee ? 'PASSWORD (LEAVE BLANK TO KEEP CURRENT)' : 'PASSWORD'}
                                                </label>
                                                <input
                                                    type="password"
                                                    {...(!editingEmployee ? { required: true } : {})}
                                                    value={newEmpPassword}
                                                    onChange={(e) => setNewEmpPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.7)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>ROLE / DESIGNATION</label>
                                                <select
                                                    value={newEmpRole}
                                                    onChange={(e) => setNewEmpRole(e.target.value)}
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.9)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                >
                                                    <option value="CSR">CSR</option>
                                                    <option value="TEAM LEAD">TEAM LEAD</option>
                                                    <option value="QUALITY">QUALITY</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>DIVISION</label>
                                                <select
                                                    value={newEmpDepartment}
                                                    onChange={(e) => setNewEmpDepartment(e.target.value)}
                                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid rgba(124, 58, 237, 0.25)', background: 'rgba(8, 10, 17, 0.9)', color: '#fff', fontSize: '10px', outline: 'none' }}
                                                >
                                                    <option value="Call Center">Call Center</option>
                                                    <option value="Social Media Marketing">Social Media Marketing</option>
                                                </select>
                                            </div>

                                            {/* Profile Picture File Upload Option */}
                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ display: 'block', color: '#a78bfa', fontSize: '9px', fontWeight: '800', marginBottom: '5px' }}>
                                                    PROFILE PICTURE (DIRECT FILE)
                                                </label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleFileChange}
                                                        style={{ 
                                                            flex: 1, 
                                                            padding: '7px', 
                                                            borderRadius: '7px', 
                                                            border: '1px solid rgba(124, 58, 237, 0.25)', 
                                                            background: 'rgba(8, 10, 17, 0.7)', 
                                                            color: '#fff', 
                                                            fontSize: '9px', 
                                                            outline: 'none' 
                                                        }}
                                                    />
                                                    {newEmpAvatarPreview ? (
                                                        <img 
                                                            src={newEmpAvatarPreview} 
                                                            alt="Preview" 
                                                            style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #7c3aed' }} 
                                                        />
                                                    ) : (
                                                        <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(124, 58, 237, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: '8px', fontWeight: 'bold' }}>
                                                            IMG
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-end', marginTop: '5px' }}>
                                                <button
                                                    type="submit"
                                                    disabled={creatingEmp}
                                                    style={{ width: '100%', padding: '10px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '10px', fontWeight: '900', cursor: 'pointer' }}
                                                >
                                                    {creatingEmp ? 'SAVING...' : (editingEmployee ? 'UPDATE ACCOUNT' : 'SUBMIT ACCOUNT')}
                                                </button>
                                            </div>
                                        </form>
                                    </section>
                                )}

                                <section style={cardStyle}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent:
                                                'space-between',
                                            alignItems: 'center',
                                            gap: '15px',
                                            flexWrap: 'wrap'
                                        }}
                                    >
                                        <div>
                                            <div style={sectionLabel}>
                                                EMPLOYEE DIRECTORY
                                            </div>

                                            <div
                                                style={{
                                                    color: '#64748b',
                                                    fontSize: '10px',
                                                    marginTop: '5px'
                                                }}
                                            >
                                                {teamMembers.length}{' '}
                                                registered employee
                                                {teamMembers.length === 1
                                                    ? ''
                                                    : 's'}
                                            </div>
                                        </div>

                                        <input
                                            value={employeeSearch}
                                            onChange={(e) =>
                                                setEmployeeSearch(
                                                    e.target.value
                                                )
                                            }
                                            placeholder="Search employee..."
                                            style={{
                                                width: '230px',
                                                maxWidth: '100%',
                                                padding: '9px 12px',
                                                borderRadius: '7px',
                                                border:
                                                    '1px solid rgba(124, 58, 237, 0.25)',
                                                background:
                                                    'rgba(8, 10, 17, 0.7)',
                                                color: '#fff',
                                                outline: 'none',
                                                fontSize: '10px'
                                            }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            marginTop: '17px',
                                            overflowX: 'auto'
                                        }}
                                    >
                                        <table
                                            style={{
                                                width: '100%',
                                                borderCollapse:
                                                    'collapse',
                                                fontSize: '10px'
                                            }}
                                        >
                                            <thead>
                                                <tr>
                                                    <TableHead>
                                                        NAME
                                                    </TableHead>

                                                    <TableHead>
                                                        EMPLOYEE ID
                                                    </TableHead>

                                                    <TableHead>
                                                        DESIGNATION
                                                    </TableHead>

                                                    <TableHead>
                                                        DIVISION
                                                    </TableHead>

                                                    <TableHead>
                                                        STATUS
                                                    </TableHead>

                                                    <TableHead>
                                                        ACTIONS
                                                    </TableHead>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {filteredEmployees.map(
                                                    (member, index) => (
                                                        <tr
                                                            key={
                                                                member.id ||
                                                                member._id ||
                                                                member.employeeId ||
                                                                index
                                                            }
                                                        >
                                                            <TableCell
                                                                bold
                                                            >
                                                                {member.name ||
                                                                    member.fullName ||
                                                                    'Unnamed'}
                                                            </TableCell>

                                                            <TableCell>
                                                                {member.employeeId ||
                                                                    member.empId ||
                                                                    member.id ||
                                                                    member._id ||
                                                                    'N/A'}
                                                            </TableCell>

                                                            <TableCell>
                                                                {member.role ||
                                                                    member.designation ||
                                                                    'N/A'}
                                                            </TableCell>

                                                            <TableCell>
                                                                {member.department ||
                                                                    member.division ||
                                                                    'N/A'}
                                                            </TableCell>

                                                            <TableCell>
                                                                <StatusBadge
                                                                    status={
                                                                        member.status ||
                                                                        'Active'
                                                                    }
                                                                />
                                                            </TableCell>

                                                            <TableCell>
                                                                <button
                                                                    onClick={() => handleOpenEditModal(member)}
                                                                    style={{
                                                                        padding: '5px 10px',
                                                                        background: 'rgba(124, 58, 237, 0.2)',
                                                                        border: '1px solid rgba(124, 58, 237, 0.4)',
                                                                        color: '#c4b5fd',
                                                                        borderRadius: '5px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '9px',
                                                                        fontWeight: 'bold'
                                                                    }}
                                                                >
                                                                    EDIT
                                                                </button>
                                                            </TableCell>
                                                        </tr>
                                                    )
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    {filteredEmployees.length === 0 && (
                                        <EmptyState text="No employees found." />
                                    )}
                                </section>
                            </div>
                        )}

                        {/* =================================================
                            DIVISIONS
                        ================================================== */}

                        {activePage === 'Divisions' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="DIVISIONS"
                                    subtitle="Aeturnum organizational divisions."
                                />

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns:
                                            'repeat(auto-fit, minmax(250px, 1fr))',
                                        gap: '15px'
                                    }}
                                >
                                    <DivisionCard
                                        title="CALL CENTER"
                                        description="Customer service, inbound, outbound and sales operations."
                                        count={
                                            teamMembers.filter((m) =>
                                                String(
                                                    m.department ||
                                                        m.division ||
                                                        ''
                                                )
                                                    .toLowerCase()
                                                    .includes(
                                                        'call center'
                                                    )
                                            ).length
                                        }
                                    />

                                    <DivisionCard
                                        title="SOCIAL MEDIA MARKETING"
                                        description="Social media management, content, advertising and marketing operations."
                                        count={
                                            teamMembers.filter((m) =>
                                                String(
                                                    m.department ||
                                                        m.division ||
                                                        ''
                                                )
                                                    .toLowerCase()
                                                    .includes(
                                                        'social media'
                                                    )
                                            ).length
                                        }
                                    />
                                </div>
                            </div>
                        )}

                        {/* =================================================
                            ROLES & PERMISSIONS
                        ================================================== */}

                        {activePage === 'Roles & Permissions' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="ROLES & PERMISSIONS"
                                    subtitle="Role structure for Aeturnum employees."
                                />

                                <section style={cardStyle}>
                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns:
                                                'repeat(auto-fit, minmax(190px, 1fr))',
                                            gap: '11px'
                                        }}
                                    >
                                        {[
                                            'CSR',
                                            'TEAM LEAD',
                                            'QUALITY'
                                        ].map((role) => (
                                            <div
                                                key={role}
                                                style={{
                                                    padding: '15px',
                                                    background:
                                                        'rgba(8, 10, 17, 0.5)',
                                                    border:
                                                        '1px solid rgba(124, 58, 237, 0.18)',
                                                    borderRadius: '9px'
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        color: '#fff',
                                                        fontSize: '11px',
                                                        fontWeight: '800'
                                                    }}
                                                >
                                                    {role}
                                                </div>

                                                <div
                                                    style={{
                                                        color: '#64748b',
                                                        fontSize: '9px',
                                                        marginTop: '6px'
                                                    }}
                                                >
                                                    {getRoleCount(role)}{' '}
                                                    employee
                                                    {getRoleCount(role) ===
                                                    1
                                                        ? ''
                                                        : 's'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        )}

                        {/* =================================================
                            ATTENDANCE
                        ================================================== */}

                        {activePage === 'Attendance' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="ATTENDANCE"
                                    subtitle="Company attendance overview."
                                />

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns:
                                            'repeat(auto-fit, minmax(180px, 1fr))',
                                        gap: '12px'
                                    }}
                                >
                                    <StatCard
                                        label="CEO STATUS"
                                        value={
                                            isCheckedIn
                                                ? 'PRESENT'
                                                : 'NOT MARKED'
                                        }
                                    />

                                    <StatCard
                                        label="SHIFT"
                                        value="6:55 PM – 12:00 AM"
                                    />

                                    <StatCard
                                        label="WORK DAYS"
                                        value="MON – SAT"
                                    />
                                </div>
                            </div>
                        )}

                        {/* =================================================
                            SCHEDULES
                        ================================================== */}

                        {activePage === 'Schedules' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="SCHEDULES"
                                    subtitle="Company work schedules and shift structure."
                                />

                                <section style={cardStyle}>
                                    <div style={sectionLabel}>
                                        DEFAULT SHIFT
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns:
                                                'repeat(2, 1fr)',
                                            gap: '10px',
                                            marginTop: '14px'
                                        }}
                                    >
                                        <InfoBox
                                            label="MONDAY – SATURDAY"
                                            value="Working Days"
                                        />

                                        <InfoBox
                                            label="SHIFT"
                                            value="6:55 PM – 12:00 AM"
                                        />
                                    </div>
                                </section>
                            </div>
                        )}

                        {/* =================================================
                            APPROVALS
                        ================================================== */}

                        {activePage === 'Approvals' && (
                            <LeaveApprovalsPanel
                                currentUser={currentUser}
                                apiBase={API_BASE}
                                title="Leave Approvals"
                            />
                        )}

                        {/* =================================================
                            SALES / PERFORMANCE
                        ================================================== */}

                        {activePage === 'Sales / Performance' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="SALES / PERFORMANCE"
                                    subtitle="Company performance overview."
                                />

                                {salesError && (
                                    <div
                                        style={{
                                            padding: '10px 13px',
                                            borderRadius: '7px',
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            border: '1px solid rgba(239, 68, 68, 0.3)',
                                            color: '#fca5a5',
                                            fontSize: '10px'
                                        }}
                                    >
                                        Couldn't load sales: {salesError}
                                    </div>
                                )}

                                {loading ? (
                                    <LoadingCard />
                                ) : (
                                    <>
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'repeat(auto-fit, minmax(190px, 1fr))',
                                                gap: '12px'
                                            }}
                                        >
                                            <StatCard
                                                label="TOTAL SALES"
                                                value={salesStats.total}
                                            />

                                            <StatCard
                                                label="PENDING QA REVIEW"
                                                value={salesStats.pending}
                                            />

                                            <StatCard
                                                label="APPROVED"
                                                value={salesStats.approved}
                                            />

                                            {salesStats.rejected > 0 && (
                                                <StatCard
                                                    label="REJECTED"
                                                    value={salesStats.rejected}
                                                />
                                            )}
                                        </div>

                                        {/* -------- SALES COUNT PER AGENT -------- */}
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'repeat(auto-fit, minmax(230px, 1fr))',
                                                gap: '12px'
                                            }}
                                        >
                                            {SALE_PERIODS.map((p) => {
                                                const t = salesCount.totals[p.id];
                                                return (
                                                    <div key={p.id} style={cardStyle}>
                                                        <div style={sectionLabel}>
                                                            {p.label.toUpperCase()}
                                                        </div>
                                                        <div
                                                            style={{
                                                                margin: '8px 0 4px',
                                                                color: '#fff',
                                                                fontSize: '26px',
                                                                fontWeight: '900'
                                                            }}
                                                        >
                                                            {t.total}
                                                        </div>
                                                        <div style={{ color: '#64748b', fontSize: '9px', marginBottom: '10px' }}>
                                                            sales posted by all agents
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '10px', fontWeight: '800' }}>
                                                            <span style={{ color: '#4ade80' }}>{t.approved} approved</span>
                                                            <span style={{ color: '#facc15' }}>{t.pending} pending</span>
                                                            <span style={{ color: '#fca5a5' }}>{t.rejected} rejected</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div style={cardStyle}>
                                            <div style={sectionLabel}>SALES PER AGENT</div>
                                            <div style={{ color: '#64748b', fontSize: '10px', margin: '6px 0 12px' }}>
                                                Posted = every sale the agent submitted. Pending means QA has not approved or rejected it yet. Weeks run Monday to Sunday.
                                            </div>

                                            {salesCount.undated > 0 && (
                                                <div
                                                    style={{
                                                        padding: '10px 13px',
                                                        marginBottom: '12px',
                                                        borderRadius: '7px',
                                                        background: 'rgba(239, 68, 68, 0.1)',
                                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                                        color: '#fca5a5',
                                                        fontSize: '10px'
                                                    }}
                                                >
                                                    {salesCount.undated} posted sale{salesCount.undated === 1 ? ' has' : 's have'} no readable date, so {salesCount.undated === 1 ? 'it is' : 'they are'} left out of these counts.
                                                </div>
                                            )}

                                            {salesCount.list.length === 0 ? (
                                                <EmptyState text="No agents or posted sales yet." />
                                            ) : (
                                                <div style={{ width: '100%', overflowX: 'auto' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr>
                                                                <th
                                                                    rowSpan={2}
                                                                    style={{
                                                                        padding: '11px',
                                                                        textAlign: 'left',
                                                                        color: '#a78bfa',
                                                                        borderBottom: '1px solid rgba(124, 58, 237, 0.2)'
                                                                    }}
                                                                >
                                                                    Agent
                                                                </th>
                                                                {SALE_PERIODS.map((p) => (
                                                                    <th
                                                                        key={p.id}
                                                                        colSpan={4}
                                                                        style={{
                                                                            padding: '11px',
                                                                            textAlign: 'center',
                                                                            color: '#a78bfa',
                                                                            borderLeft: '1px solid rgba(124, 58, 237, 0.2)'
                                                                        }}
                                                                    >
                                                                        {p.label}
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                            <tr>
                                                                {SALE_PERIODS.flatMap((p) =>
                                                                    SALE_COLS.map((c, i) => (
                                                                        <th key={`${p.id}-${c.id}`} style={countTh(c.color, i === 0)}>
                                                                            {c.label}
                                                                        </th>
                                                                    ))
                                                                )}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {salesCount.list.map((r) => (
                                                                <tr key={r.key}>
                                                                    <TableCell bold>{r.name}</TableCell>
                                                                    {SALE_PERIODS.flatMap((p) =>
                                                                        SALE_COLS.map((c, i) => (
                                                                            <td
                                                                                key={`${p.id}-${c.id}`}
                                                                                style={countTd(
                                                                                    r[p.id][c.id] ? c.color : '#64748b',
                                                                                    c.id === 'total',
                                                                                    i === 0
                                                                                )}
                                                                            >
                                                                                {r[p.id][c.id]}
                                                                            </td>
                                                                        ))
                                                                    )}
                                                                </tr>
                                                            ))}
                                                            <tr style={{ background: 'rgba(124, 58, 237, 0.08)' }}>
                                                                <TableCell bold>All agents</TableCell>
                                                                {SALE_PERIODS.flatMap((p) =>
                                                                    SALE_COLS.map((c, i) => (
                                                                        <td
                                                                            key={`${p.id}-${c.id}`}
                                                                            style={countTd(c.color, true, i === 0)}
                                                                        >
                                                                            {salesCount.totals[p.id][c.id]}
                                                                        </td>
                                                                    ))
                                                                )}
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        <div style={cardStyle}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    flexWrap: 'wrap',
                                                    marginBottom: '12px'
                                                }}
                                            >
                                                <div>
                                                    <div style={sectionLabel}>DAILY BREAKDOWN</div>
                                                    <div style={{ color: '#64748b', fontSize: '10px', marginTop: '6px' }}>
                                                        Last 14 days, newest first.
                                                    </div>
                                                </div>
                                                <select
                                                    value={salesAgentFilter}
                                                    onChange={(e) => setSalesAgentFilter(e.target.value)}
                                                    aria-label="Choose an agent"
                                                    style={{
                                                        background: 'rgba(8, 10, 17, 0.8)',
                                                        border: '1px solid rgba(124, 58, 237, 0.3)',
                                                        color: '#fff',
                                                        padding: '8px 10px',
                                                        borderRadius: '6px',
                                                        fontSize: '11px',
                                                        fontFamily: 'inherit'
                                                    }}
                                                >
                                                    <option value="all">All agents</option>
                                                    {salesCount.list.map((r) => (
                                                        <option key={r.key} value={r.key}>
                                                            {r.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div style={{ width: '100%', overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr>
                                                            <TableHead>Day</TableHead>
                                                            {SALE_COLS.map((c) => (
                                                                <th key={c.id} style={countTh(c.color, false)}>
                                                                    {c.label}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {salesCount.dayKeys.map((d) => {
                                                            const c =
                                                                (salesCount.daily.get(salesAgentFilter) || new Map()).get(d.key) ||
                                                                emptyCount();
                                                            return (
                                                                <tr key={d.key}>
                                                                    <TableCell bold>{d.label}</TableCell>
                                                                    {SALE_COLS.map((col) => (
                                                                        <td
                                                                            key={col.id}
                                                                            style={countTd(
                                                                                c[col.id] ? col.color : '#64748b',
                                                                                col.id === 'total',
                                                                                false
                                                                            )}
                                                                        >
                                                                            {c[col.id]}
                                                                        </td>
                                                                    ))}
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <div style={cardStyle}>
                                            <div style={sectionLabel}>SALES QUEUE</div>

                                            {sales.length === 0 ? (
                                                <EmptyState text="No sales submitted yet." />
                                            ) : (
                                                <div style={{ width: '100%', overflowX: 'auto', marginTop: '12px' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr>
                                                                <TableHead>Sale ID</TableHead>
                                                                <TableHead>Date</TableHead>
                                                                <TableHead>Agent</TableHead>
                                                                <TableHead>Client</TableHead>
                                                                <TableHead>Package</TableHead>
                                                                <TableHead>Amount</TableHead>
                                                                <TableHead>Status</TableHead>
                                                                <TableHead>Action</TableHead>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {sales.map((sale) => {
                                                                const isPending = String(sale.qaStatus || '')
                                                                    .toLowerCase()
                                                                    .includes('pending');
                                                                const isBusy = reviewingSaleId === sale.id;

                                                                return (
                                                                    <tr key={sale.id}>
                                                                        <TableCell bold>{sale.id}</TableCell>
                                                                        <TableCell>{sale.date}</TableCell>
                                                                        <TableCell>{sale.agentName || sale.agentId}</TableCell>
                                                                        <TableCell>{sale.clientName}</TableCell>
                                                                        <TableCell>{sale.packageTier}</TableCell>
                                                                        <TableCell>{sale.saleAmount}</TableCell>
                                                                        <TableCell>
                                                                            <StatusBadge status={sale.qaStatus} />
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            {isPending ? (
                                                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                                                    <button
                                                                                        disabled={isBusy}
                                                                                        onClick={() => handleReviewSale(sale.id, 'Approved by QA')}
                                                                                        style={{
                                                                                            padding: '5px 9px',
                                                                                            borderRadius: '5px',
                                                                                            border: '1px solid rgba(74, 222, 128, 0.4)',
                                                                                            background: 'rgba(74, 222, 128, 0.12)',
                                                                                            color: '#4ade80',
                                                                                            fontSize: '9px',
                                                                                            fontWeight: '800',
                                                                                            cursor: isBusy ? 'wait' : 'pointer'
                                                                                        }}
                                                                                    >
                                                                                        Approve
                                                                                    </button>
                                                                                    <button
                                                                                        disabled={isBusy}
                                                                                        onClick={() => handleReviewSale(sale.id, 'Rejected')}
                                                                                        style={{
                                                                                            padding: '5px 9px',
                                                                                            borderRadius: '5px',
                                                                                            border: '1px solid rgba(239, 68, 68, 0.4)',
                                                                                            background: 'rgba(239, 68, 68, 0.12)',
                                                                                            color: '#fca5a5',
                                                                                            fontSize: '9px',
                                                                                            fontWeight: '800',
                                                                                            cursor: isBusy ? 'wait' : 'pointer'
                                                                                        }}
                                                                                    >
                                                                                        Reject
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <span style={{ color: '#64748b', fontSize: '9px' }}>
                                                                                    {sale.reviewedBy ? `by ${sale.reviewedBy}` : '—'}
                                                                                </span>
                                                                            )}
                                                                        </TableCell>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* =================================================
                            QA / EVALUATIONS
                        ================================================== */}

                        {activePage === 'QA / Evaluations' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="QA / EVALUATIONS"
                                    subtitle="Company-wide quality evaluation overview."
                                />

                                {summaryError && (
                                    <div
                                        style={{
                                            padding: '10px 13px',
                                            borderRadius: '7px',
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            border: '1px solid rgba(239, 68, 68, 0.3)',
                                            color: '#fca5a5',
                                            fontSize: '10px'
                                        }}
                                    >
                                        Couldn't load evaluation summary: {summaryError}
                                    </div>
                                )}

                                {loading ? (
                                    <LoadingCard />
                                ) : (
                                    <>
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'repeat(auto-fit, minmax(190px, 1fr))',
                                                gap: '12px'
                                            }}
                                        >
                                            <StatCard
                                                label="COMPANY AVERAGE"
                                                value={
                                                    summary?.companyAverage
                                                        ? `${Number(summary.companyAverage).toFixed(
                                                              1
                                                          )}%`
                                                        : '0.0%'
                                                }
                                            />

                                            <StatCard
                                                label="TOTAL EVALUATIONS"
                                                value={
                                                    summary?.totalEvaluations ??
                                                    0
                                                }
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* =================================================
                            ACCOUNT SETTINGS
                        ================================================== */}

                        {activePage === 'Account Settings' && (
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '18px'
                                }}
                            >
                                <PageTitle
                                    title="ACCOUNT SETTINGS"
                                    subtitle="CEO account information."
                                />

                                <section style={cardStyle}>
                                    <div style={sectionLabel}>
                                        ACCOUNT INFORMATION
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns:
                                                'repeat(auto-fit, minmax(210px, 1fr))',
                                            gap: '10px',
                                            marginTop: '15px'
                                        }}
                                    >
                                        <InfoBox
                                            label="NAME"
                                            value={userName}
                                        />

                                        <InfoBox
                                            label="EMPLOYEE ID"
                                            value={employeeId}
                                        />

                                        <InfoBox
                                            label="DESIGNATION"
                                            value={userRole}
                                        />

                                        <InfoBox
                                            label="DEPARTMENT"
                                            value={department}
                                        />

                                        <InfoBox
                                            label="EMAIL"
                                            value={email}
                                        />

                                        <InfoBox
                                            label="PHONE"
                                            value={phone}
                                        />

                                        <InfoBox
                                            label="DATE OF JOINING"
                                            value={doj}
                                        />

                                        <InfoBox
                                            label="STATUS"
                                            value={status}
                                        />
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </>
    );
}

/* =========================================================
   SMALL UI COMPONENTS
========================================================= */

function PageTitle({ title, subtitle }) {
    return (
        <div>
            <h1
                style={{
                    margin: 0,
                    color: '#fff',
                    fontSize: '19px',
                    fontWeight: '900',
                    letterSpacing: '1.5px'
                }}
            >
                {title}
            </h1>

            <p
                style={{
                    margin: '6px 0 0',
                    color: '#64748b',
                    fontSize: '10px'
                }}
            >
                {subtitle}
            </p>
        </div>
    );
}

function StatCard({ label, value }) {
    return (
        <div
            style={{
                background: 'rgba(18, 21, 36, 0.62)',
                border:
                    '1px solid rgba(124, 58, 237, 0.22)',
                borderRadius: '10px',
                padding: '17px'
            }}
        >
            <div
                style={{
                    color: '#a78bfa',
                    fontSize: '9px',
                    fontWeight: '800',
                    letterSpacing: '0.6px'
                }}
            >
                {label}
            </div>

            <div
                style={{
                    marginTop: '8px',
                    color: '#fff',
                    fontSize: '20px',
                    fontWeight: '900'
                }}
            >
                {value}
            </div>
        </div>
    );
}

function DivisionCard({
    title,
    description,
    count
}) {
    return (
        <section
            style={{
                background:
                    'rgba(18, 21, 36, 0.62)',
                border:
                    '1px solid rgba(124, 58, 237, 0.22)',
                borderRadius: '10px',
                padding: '20px'
            }}
        >
            <div
                style={{
                    color: '#c4b5fd',
                    fontSize: '9px',
                    fontWeight: '800',
                    letterSpacing: '1px'
                }}
            >
                DIVISION
            </div>

            <h3
                style={{
                    color: '#fff',
                    fontSize: '14px',
                    margin: '8px 0 7px',
                    fontWeight: '900'
                }}
            >
                {title}
            </h3>

            <p
                style={{
                    color: '#94a3b8',
                    fontSize: '10px',
                    lineHeight: '1.6',
                    margin: 0
                }}
            >
                {description}
            </p>

            <div
                style={{
                    marginTop: '15px',
                    color: '#4ade80',
                    fontSize: '10px',
                    fontWeight: '800'
                }}
            >
                {count} EMPLOYEE{count === 1 ? '' : 'S'}
            </div>
        </section>
    );
}

function StatusBadge({ status }) {
    const normalized = String(status).toLowerCase();
    const isActive = normalized === 'active' || normalized === 'present' || normalized.includes('approve');
    const isNegative = normalized === 'inactive' || normalized.includes('reject');

    const colors = isActive
        ? { bg: 'rgba(74, 222, 128, 0.1)', border: 'rgba(74, 222, 128, 0.2)', text: '#4ade80' }
        : isNegative
            ? { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.2)', text: '#fca5a5' }
            : { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' };

    return (
        <span
            style={{
                display: 'inline-block',
                padding: '4px 8px',
                borderRadius: '5px',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                fontSize: '8px',
                fontWeight: '800'
            }}
        >
            {status}
        </span>
    );
}

function TableHead({ children }) {
    return (
        <th
            style={{
                padding: '11px',
                textAlign: 'left',
                color: '#a78bfa',
                borderBottom:
                    '1px solid rgba(124, 58, 237, 0.2)',
                whiteSpace: 'nowrap'
            }}
        >
            {children}
        </th>
    );
}

function TableCell({ children, bold = false }) {
    return (
        <td
            style={{
                padding: '11px',
                color: bold ? '#fff' : '#94a3b8',
                fontWeight: bold ? '800' : '600',
                borderBottom:
                    '1px solid rgba(124, 58, 237, 0.08)',
                whiteSpace: 'nowrap'
            }}
        >
            {children}
        </td>
    );
}

function EmptyState({ text }) {
    return (
        <div
            style={{
                padding: '25px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '10px'
            }}
        >
            {text}
        </div>
    );
}

function LoadingCard() {
    return (
        <section
            style={{
                background:
                    'rgba(18, 21, 36, 0.62)',
                border:
                    '1px solid rgba(124, 58, 237, 0.22)',
                borderRadius: '10px',
                padding: '35px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '10px'
            }}
        >
            Loading evaluation data...
        </section>
    );
}

function ComingSoon({
    title,
    description
}) {
    return (
        <section
            style={{
                background:
                    'rgba(18, 21, 36, 0.62)',
                border:
                    '1px solid rgba(124, 58, 237, 0.22)',
                borderRadius: '10px',
                padding: '45px',
                textAlign: 'center'
            }}
        >
            <div
                style={{
                    fontSize: '28px',
                    marginBottom: '12px'
                }}
            >
                ◈
            </div>

            <div
                style={{
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: '900'
                }}
            >
                {title}
            </div>

            <div
                style={{
                    color: '#64748b',
                    fontSize: '10px',
                    marginTop: '8px'
                }}
            >
                {description}
            </div>

            <div
                style={{
                    display: 'inline-block',
                    marginTop: '14px',
                    padding: '5px 9px',
                    borderRadius: '5px',
                    background:
                        'rgba(124, 58, 237, 0.1)',
                    border:
                        '1px solid rgba(124, 58, 237, 0.2)',
                    color: '#a78bfa',
                    fontSize: '8px',
                    fontWeight: '800',
                    letterSpacing: '0.7px'
                }}
            >
                COMING SOON
            </div>
        </section>
    );
}

/* =========================================================
   SHARED STYLES
========================================================= */

const cardStyle = {
    background: 'rgba(18, 21, 36, 0.62)',
    border: '1px solid rgba(124, 58, 237, 0.22)',
    borderRadius: '10px',
    padding: '20px'
};

const sectionLabel = {
    color: '#c4b5fd',
    fontSize: '9px',
    fontWeight: '900',
    letterSpacing: '1px'
};

const InfoBox = ({ label, value }) => (
    <div
        style={{
            padding: '13px',
            borderRadius: '8px',
            background: 'rgba(8, 10, 17, 0.5)',
            border: '1px solid rgba(124, 58, 237, 0.15)'
        }}
    >
        <div style={{ color: '#64748b', fontSize: '8px', fontWeight: '800', letterSpacing: '0.6px' }}>
            {label}
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '10px', fontWeight: '700', marginTop: '6px', wordBreak: 'break-word' }}>
            {value || 'N/A'}
        </div>
    </div>
);