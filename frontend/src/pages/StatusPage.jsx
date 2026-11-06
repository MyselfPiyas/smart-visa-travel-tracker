import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getHealth } from '../services/api.js';

export default function StatusPage() {
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    let active = true;
    getHealth()
      .then((data) => active && setState({ loading: false, data, error: '' }))
      .catch(() => active && setState({ loading: false, data: null, error: 'The API could not be reached. Make sure the backend is running.' }));
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm font-medium text-emerald-800 hover:underline">← Back to home</Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-slate-900">System status</h1>
        <p className="mt-3 text-slate-600">This page checks communication between the frontend and backend.</p>
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-live="polite">
          <p className="text-sm font-medium text-slate-500">Backend health endpoint</p>
          {state.loading ? <p className="mt-4 text-lg text-slate-700">Checking connection…</p> : null}
          {state.data ? <div className="mt-4"><p className="text-lg font-semibold text-emerald-800">Connected</p><pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-emerald-100">{JSON.stringify(state.data, null, 2)}</pre></div> : null}
          {state.error ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-rose-800">{state.error}</p> : null}
        </section>
      </div>
    </main>
  );
}
