import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// The backend should trust this token (not the agentId we type into the form)
// to decide who is submitting the evaluation.
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export default function QASubmissionForm({ currentUser }) {
  const [formData, setFormData] = useState({
    agentId: '',
    client: '',
    score: 95,
    adherence: 'Excellent',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const qaId = "QA-" + Math.floor(1000 + Math.random() * 9000);
      const payload = {
        qaId,
        agentId: formData.agentId.trim(),
        client: formData.client.trim(),
        date: new Date().toISOString().split('T')[0],
        score: Number(formData.score),
        adherence: formData.adherence,
        evaluator: currentUser?.name || currentUser?.username || 'QA Supervisor',
        notes: formData.notes.trim()
      };

      const res = `${API_BASE}/api/evaluations`;
      const response = await fetch(res, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Evaluation ${qaId} successfully saved!` });
        setFormData({ agentId: '', client: '', score: 95, adherence: 'Excellent', notes: '' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to submit evaluation.' });
      }
    } catch (err) {
      console.error('Submission error:', err);
      setMessage({ type: 'error', text: 'Network error connecting to backend.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 bg-slate-900 text-slate-100 font-mono rounded border border-slate-800 max-w-xl mx-auto">
      <h2 className="text-lg font-bold text-cyan-400 mb-4">SUBMIT QA EVALUATION</h2>
      
      {message && (
        <div className={`p-3 mb-4 rounded text-xs ${message.type === 'success' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block text-slate-400 mb-1">AGENT ID / USERNAME</label>
          <input 
            type="text" 
            required
            placeholder="e.g. agent_zain"
            value={formData.agentId}
            onChange={(e) => setFormData({...formData, agentId: e.target.value})}
            className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1">CLIENT NAME</label>
          <input 
            type="text" 
            required
            placeholder="e.g. Arthur Pendelton"
            value={formData.client}
            onChange={(e) => setFormData({...formData, client: e.target.value})}
            className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-400 mb-1">SCORE (%)</label>
            <input 
              type="number" 
              min="0" max="100"
              required
              value={formData.score}
              onChange={(e) => setFormData({...formData, score: e.target.value})}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">ADHERENCE</label>
            <select 
              value={formData.adherence}
              onChange={(e) => setFormData({...formData, adherence: e.target.value})}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="Excellent">Excellent</option>
              <option value="Good">Good</option>
              <option value="Needs Improvement">Needs Improvement</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">EVALUATOR NOTES</label>
          <textarea 
            rows="3"
            required
            placeholder="Review call flow, disclaimers, and compliance..."
            value={formData.notes}
            onChange={(e) => setFormData({...formData, notes: e.target.value})}
            className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <button 
          type="submit" 
          disabled={submitting}
          className="w-full py-2 bg-cyan-950 border border-cyan-500 text-cyan-300 font-bold rounded hover:bg-cyan-900 transition-all"
        >
          {submitting ? 'TRANSMITTING...' : 'SUBMIT EVALUATION'}
        </button>
      </form>
    </div>
  );
}