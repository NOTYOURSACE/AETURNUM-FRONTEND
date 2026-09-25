import { useState, useEffect } from 'react';
import * as THREE from 'three';

import Login from './component/login';
import AgentDashboard from './components/AgentDashboard';
import CeoDashboard from './components/CeoDashboard';
import TeamLeadDashboard from './components/TeamLeadDashboard';
import QADashboard from './components/QADashboard';

/*
 * SESSION LENGTH
 * Everyone is signed out this many minutes after logging in and has to
 * log in again. Only the login is cleared: the Mark Present / attendance
 * records are stored separately and are NOT touched by this.
 */
const SESSION_MINUTES = 30;
const SESSION_WARNING_SECONDS = 120; // "session ending" banner appears this long before
const SESSION_KEY = 'sessionStartedAt';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  'https://aeturnum-portal.onrender.com';

/*
 * Stable identifier for a user record (supports SQL-style `id`
 * and MongoDB-style `_id`). Returns null if neither exists, so two
 * users with a missing id are never treated as the same person.
 */
const getUserKey = (user) => {
  const key = user?.id ?? user?._id;
  return key === undefined || key === null ? null : String(key);
};

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('Invalid saved user:', error);
      localStorage.removeItem('user');
      return null;
    }
  });

  const [teamMembers, setTeamMembers] = useState([]);

  /*
   * SALES DATA
   *
   * Kept because CEO / Team Lead / QA dashboards
   * may still use the sales data.
   *
   * It is NOT passed to AgentDashboard anymore.
   */
  const [salesList] = useState(() => {
    try {
      const saved = localStorage.getItem('allSalesData');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Invalid sales data:', error);
      return [];
    }
  });

  /*
   * FIND THE MOST RECENT USER RECORD & NORMALIZE ROLE
   */
  const currentUserKey = getUserKey(currentUser);

  const currentUserRecord =
    (currentUserKey !== null &&
      teamMembers.find(
        (member) => getUserKey(member) === currentUserKey
      )) ||
    currentUser;

  const rawRole = currentUserRecord?.role || currentUser?.role || 'CSR';
  const normalizedRole = String(rawRole).trim().toLowerCase();


  /*
   * STRICT ROLE BOOLEANS (Exclusive Priority Order)
   */
  const isCEO = normalizedRole.includes('ceo') || normalizedRole.includes('founder') || normalizedRole === 'admin';
  const isTeamLead = /\bteam\s*lead(er)?\b/.test(normalizedRole);
  
  // QA must strictly be QA/Quality and MUST NOT match CEO or Team Lead titles
  const isQA = !isCEO && !isTeamLead && (normalizedRole === 'qa' || normalizedRole.includes('quality') || normalizedRole.includes('auditor'));

  /*
   * ============================================================
   * GLOBAL 3D BACKGROUND
   * ============================================================
   */

  useEffect(() => {
    const canvas = document.getElementById('global-bg-canvas');

    if (!canvas) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true
    });

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2)
    );

    /*
     * PARTICLES
     */

    const particleCount = 1000;

    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(
      particleCount * 3
    );

    for (let i = 0; i < particleCount * 3; i++) {
      positions[i] =
        (Math.random() - 0.5) * 10;
    }

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        positions,
        3
      )
    );

    const material = new THREE.PointsMaterial({
      color: 0xa78bfa,
      size: 0.03,
      transparent: true,
      opacity: 0.8
    });

    const particles = new THREE.Points(
      geometry,
      material
    );

    scene.add(particles);

    camera.position.z = 3;

    let animationFrameId;

    /*
     * ANIMATION
     */

    const animate = () => {
      animationFrameId =
        requestAnimationFrame(animate);

      particles.rotation.x += 0.001;
      particles.rotation.y += 0.002;

      renderer.render(
        scene,
        camera
      );
    };

    animate();

    /*
     * RESIZE
     */

    const handleResize = () => {
      camera.aspect =
        window.innerWidth /
        window.innerHeight;

      camera.updateProjectionMatrix();

      renderer.setSize(
        window.innerWidth,
        window.innerHeight
      );
    };

    window.addEventListener(
      'resize',
      handleResize
    );

    /*
     * CLEANUP
     */

    return () => {
      cancelAnimationFrame(
        animationFrameId
      );

      window.removeEventListener(
        'resize',
        handleResize
      );

      geometry.dispose();
      material.dispose();

      renderer.dispose();
    };
  }, []);

  /*
   * ============================================================
   * LOAD USERS FROM BACKEND
   * ============================================================
   */

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/api/users`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        return response.json();
      })
      .then((data) => {
        if (cancelled) return;

        const users =
          data.users || data;

        if (!Array.isArray(users)) {
          console.error(
            'Unexpected users response:',
            data
          );

          return;
        }

        setTeamMembers(users);

        if (localStorage.getItem('user')) {
          setCurrentUser((previous) => {
            if (!previous) return previous;

            const previousKey = getUserKey(previous);

            // No usable id: keep the logged-in user as-is instead of
            // matching (and overwriting with) the first user in the list.
            if (previousKey === null) return previous;

            const freshUser =
              users.find(
                (user) =>
                  getUserKey(user) === previousKey
              );

            if (!freshUser) return previous;

            localStorage.setItem(
              'user',
              JSON.stringify(freshUser)
            );

            return freshUser;
          });
        }
      })
      .catch((error) => {
        console.log(
          'Error fetching users:',
          error
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ============================================================
   * SIGN OUT
   * ============================================================
   */

  const handleSignOut = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser(null);
  };

  /*
   * ============================================================
   * 30-MINUTE SESSION
   * ============================================================
   */

  const [sessionExpired, setSessionExpired] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const loggedInUserKey = getUserKey(currentUser);

  useEffect(() => {
    // Nobody logged in: make sure no old session timer is left behind
    if (!currentUser) {
      localStorage.removeItem(SESSION_KEY);
      return undefined;
    }

    // Session start = first time the portal opens with this login
    let startedAt = Number(localStorage.getItem(SESSION_KEY));
    if (!startedAt) {
      startedAt = Date.now();
      localStorage.setItem(SESSION_KEY, String(startedAt));
    }
    const expiresAt = startedAt + SESSION_MINUTES * 60 * 1000;

    const tick = () => {
      const left = Math.ceil((expiresAt - Date.now()) / 1000);
      if (left <= 0) {
        setSessionExpired(true);
        handleSignOut();
        return;
      }
      setSecondsLeft(left <= SESSION_WARNING_SECONDS ? left : null);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedInUserKey]);

  /*
   * ============================================================
   * LOGIN
   * ============================================================
   */

  if (!currentUser) {
    return (
      <>
        {sessionExpired && (
          <div
            role="alert"
            style={{
              position: 'fixed',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9999,
              padding: '10px 18px',
              borderRadius: '8px',
              background: 'rgba(234, 179, 8, 0.2)',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              color: '#facc15',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            Your session ended after {SESSION_MINUTES} minutes. Please sign in again.
            Your attendance is not affected.
          </div>
        )}
        <Login />
      </>
    );
  }

  /*
   * ============================================================
   * PORTAL
   * ============================================================
   */

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background:
          'radial-gradient(900px 600px at 15% 20%, rgba(124, 58, 237, 0.22), transparent 60%), ' +
          'radial-gradient(700px 500px at 90% 90%, rgba(217, 70, 239, 0.12), transparent 60%), ' +
          '#07080c',
        color: '#f8fafc',
        overflow: 'hidden',
        position: 'relative'
      }}
    >

      {/* ======================================================
          GLOBAL 3D BACKGROUND
      ====================================================== */}

      <canvas
        id="global-bg-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* ======================================================
          PORTAL CONTENT
      ====================================================== */}

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%'
        }}
      >

        {secondsLeft !== null && (
          <div
            role="status"
            style={{
              position: 'fixed',
              bottom: 16,
              right: 16,
              zIndex: 9999,
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'rgba(234, 179, 8, 0.2)',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              color: '#facc15',
              fontSize: '12px',
              fontWeight: 700
            }}
          >
            Session ends in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}.
            Finish and save what you are doing.
          </div>
        )}

        {/* CEO */}

        {isCEO ? (
          <CeoDashboard
            currentUser={currentUserRecord}
            teamMembers={teamMembers}
            salesList={salesList}
            onSignOut={handleSignOut}
          />

        /* TEAM LEAD */

        ) : isTeamLead ? (
          <TeamLeadDashboard
            currentUser={currentUserRecord}
            teamMembers={teamMembers}
            salesList={salesList}
            onSignOut={handleSignOut}
          />

        /* QA */

        ) : isQA ? (
          <QADashboard
            currentUser={currentUserRecord}
            salesList={salesList}
            onSignOut={handleSignOut}
          />

        /* ALL OTHER EMPLOYEES (Agent) */

        ) : (
          <AgentDashboard
            currentUser={currentUserRecord}
            onSignOut={handleSignOut}
          />
        )}

      </div>
    </div>
  );
}

export default App;