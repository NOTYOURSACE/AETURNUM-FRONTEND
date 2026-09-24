import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import './login.css';

export default function LoginPage() {
  const mountRef = useRef(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const currentMount = mountRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (currentMount) {
      currentMount.appendChild(renderer.domElement);
    }

    // Create 3D Particles
    const particleCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 10;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.03,
      color: 0xa78bfa, // portal purple
      transparent: true,
      opacity: 0.8,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    camera.position.z = 3;

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      particles.rotation.x += 0.001;
      particles.rotation.y += 0.002;
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (currentMount && renderer.domElement) {
        currentMount.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'https://aeturnum-portal.onrender.com';

      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('user', JSON.stringify(data.user));

        if (data.token) {
          localStorage.setItem('token', data.token);
        }

        // App.jsx picks the right dashboard from the saved user's role, so
        // everyone goes to the same address. (The old /ceo-dashboard and
        // /agent-dashboard addresses give a 404 on most live hosts.)
        window.location.assign('/');
      } else {
        setError(data.error || 'Invalid username or password');
      }
    } catch (err) {
      console.error('Login request failed:', err);
      setError('An error occurred. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* 3D Canvas Background Layer */}
      <div ref={mountRef} className="login-canvas-bg" />

      <div className="login-layout">
        {/* Brand panel (hidden on phones) */}
        <section className="login-brand">
          <img src="/logo.png" alt="Aeturnum Logo" className="login-brand-logo" />
          <h1 className="login-wordmark">AETURNUM</h1>
          <p className="login-tagline">Employee Portal</p>
          <hr className="login-rule" />
          <p className="login-blurb">
            Sign in with the username and password you were given.
          </p>
        </section>

        {/* Sign-in card */}
        <section className="login-panel">
          <div className="login-card">
            {/* Logo shown here on phones only */}
            <div className="login-logo-container">
              <img src="/logo.png" alt="Aeturnum Logo" className="login-logo" />
            </div>

            <h2>Welcome back</h2>
            <p className="login-subtitle">Sign in to your Aeturnum workspace.</p>

            {error && (
              <div className="login-error-message" role="alert">
                {error}
              </div>
            )}

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="login-field">
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  type="text"
                  placeholder="Enter your username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div className="login-field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <p className="login-footnote">
              For your security, you are signed out automatically every 30 minutes.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}