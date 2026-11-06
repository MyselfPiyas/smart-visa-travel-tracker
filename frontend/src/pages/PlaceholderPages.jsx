import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui/index.jsx';

const content = {
  dashboard: ['Dashboard', 'A summary of your travel-document workspace.'], documents: ['My Documents', 'Keep your travel-document list organized.'], upload: ['Upload Document', 'Add a document to your personal travel workspace.'], details: ['Document Details', 'Review the information associated with a selected document.'], reminders: ['Reminder Settings', 'Choose how you want to track important dates.'], notifications: ['Notification History', 'Review updates related to your workspace.'], travel: ['Travel History', 'Keep a record of previous and planned trips.'], checklist: ['Destination Checklist', 'Prepare for destination-specific travel requirements.'], profile: ['Profile Settings', 'Manage personal workspace preferences.'], adminDashboard: ['Admin Dashboard', 'An overview of platform administration tools.'], users: ['User Management', 'Review and manage platform accounts.'], logs: ['Notification Logs', 'Review system notification activity.'], destinations: ['Destination Requirements', 'Maintain travel requirement information by destination.'], support: ['Support Queries', 'Review support requests from travelers.'],
};
function Reveal({ children, className = '', delay = 0, as = 'div' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const Element = as;

  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.unobserve(node); }
    }, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <Element ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`} style={{ '--reveal-delay': `${delay}ms` }}>{children}</Element>;
}

function RouteGlyph() {
  return <svg className="route-glyph" viewBox="0 0 500 380" fill="none" aria-hidden="true"><path id="hero-flight-route" d="M34 310C139 277 115 118 239 141s94 150 222-85" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 10"/><circle cx="34" cy="310" r="7" fill="currentColor"/><circle cx="461" cy="56" r="7" fill="currentColor"/><path d="m435 61 28-5-12 25-3-13-13-7Z" fill="currentColor"/><g className="flight-marker"><text x="-8" y="7" fill="currentColor" fontSize="20">✈</text><animateMotion dur="11s" repeatCount="indefinite" rotate="auto"><mpath href="#hero-flight-route"/></animateMotion></g></svg>;
}

export function LandingPage() {
  const artRef = useRef(null);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return undefined;
    let frame = 0;
    const move = (event) => {
      const bounds = art.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width - 0.5);
      const y = ((event.clientY - bounds.top) / bounds.height - 0.5);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        art.style.setProperty('--parallax-x', `${x * 15}px`);
        art.style.setProperty('--parallax-y', `${y * 15}px`);
        art.style.setProperty('--parallax-opposite-x', `${x * -17}px`);
        art.style.setProperty('--parallax-opposite-y', `${y * -17}px`);
        art.style.setProperty('--art-tilt-x', `${-y * 3}deg`);
        art.style.setProperty('--art-tilt-y', `${x * 3}deg`);
        art.style.setProperty('--art-tilt-opposite-x', `${y * 3}deg`);
        art.style.setProperty('--art-tilt-opposite-y', `${x * -3}deg`);
      });
    };
    const reset = () => {
      art.style.setProperty('--parallax-x', '0px');
      art.style.setProperty('--parallax-y', '0px');
      art.style.setProperty('--parallax-opposite-x', '0px');
      art.style.setProperty('--parallax-opposite-y', '0px');
      art.style.setProperty('--art-tilt-x', '0deg');
      art.style.setProperty('--art-tilt-y', '0deg');
      art.style.setProperty('--art-tilt-opposite-x', '0deg');
      art.style.setProperty('--art-tilt-opposite-y', '0deg');
    };
    art.addEventListener('pointermove', move, { passive: true });
    art.addEventListener('pointerleave', reset, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      art.removeEventListener('pointermove', move);
      art.removeEventListener('pointerleave', reset);
    };
  }, []);

  return <div className="landing-page">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-grid" aria-hidden="true"/><div className="hero-glow" aria-hidden="true"/>
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="hero-kicker-dot"/>YOUR DOCUMENTS. READY TO GO.</span>
          <h1 id="landing-title"><span>Travel</span> lighter.<br/><em>Arrive ready.</em></h1>
          <p>Keep the documents, important dates, and trip details you need close at hand—so planning feels a little more like looking forward.</p>
          <div className="hero-actions"><Link to="/register" className="hero-button hero-button-primary">Get started <span aria-hidden="true">↗</span></Link><Link to="/login" className="hero-button hero-button-secondary">Sign in</Link></div>
          <div className="hero-footnote"><span>SMART VISA &amp; TRAVEL DOCUMENT TRACKER</span><span>ACADEMIC PROJECT · UNIFIED MENTOR</span></div>
        </div>
        <div ref={artRef} className="hero-art" aria-label="Illustration of a travel document wallet and boarding pass">
          <RouteGlyph/>
          <div className="hero-orbit orbit-one" aria-hidden="true"/><div className="hero-orbit orbit-two" aria-hidden="true"/>
          <span className="art-spark spark-one" aria-hidden="true">✦</span><span className="art-spark spark-two" aria-hidden="true">✳</span><span className="art-spark spark-three" aria-hidden="true">✦</span>
          <div className="wallet-parallax"><div className="travel-wallet">
            <div className="wallet-top"><span>WAYFARER / TRAVEL WALLET</span><span className="wallet-star" aria-hidden="true">✳</span></div>
            <div className="wallet-emblem" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="19" stroke="currentColor"/><path d="M11 28c8-1 15-8 21-17M15 35c8-2 15-8 22-17M20 40l15-13" stroke="currentColor" strokeWidth="1.5"/><path d="m31 9 5 1-1 5" stroke="currentColor" strokeWidth="1.5"/></svg></div>
            <div className="wallet-caption"><span>PERSONAL DOCUMENTS</span><strong>TRAVEL<br/>READY</strong></div>
            <div className="wallet-bottom"><span>PREPARE / PROTECT / GO</span><span>EST. 2026</span></div>
          </div></div>
          <div className="pass-parallax"><div className="boarding-pass"><div className="pass-head"><span>BOARDING PASS</span><span className="pass-dot"/></div><div className="pass-route"><span>FROM</span><strong>HOME</strong><span className="pass-plane" aria-hidden="true">✈</span><span>TO</span><strong>ANYWHERE</strong></div><div className="pass-bottom"><span>TRIP PREPARATION</span><span>● READY</span></div></div></div>
          <div className="art-stamp stamp-top">✦<span>ONE PLACE<br/>FOR THE DETAILS</span></div><div className="art-stamp stamp-bottom">01<span>KEEP IT<br/>TOGETHER</span></div>
        </div>
      </div>
      <div className="hero-scroll"><span/>SCROLL TO EXPLORE</div>
    </section>

    <Reveal className="landing-ribbon"><span>DOCUMENTS IN ORDER</span><b>✳</b><span>DATES IN VIEW</span><b>✳</b><span>MORE ROOM TO LOOK FORWARD</span><b>✳</b><span>DOCUMENTS IN ORDER</span></Reveal>

    <section className="landing-features" id="workspace">
      <Reveal className="section-intro"><p className="section-kicker">A LITTLE MORE PEACE OF MIND</p><h2>All the important<br/><em>details, in one place.</em></h2><p>Thoughtful tools to help you stay organized before, during, and after the journey.</p></Reveal>
      <div className="feature-grid">
        <Reveal className="feature-card feature-card-docs" delay={40}><div className="feature-card-top"><span>01 / YOUR DOCUMENTS</span><span className="feature-arrow">↗</span></div><div className="document-stack" aria-hidden="true"><div className="doc-sheet sheet-back"/><div className="doc-sheet sheet-front"><span className="doc-mark">✳</span><span className="doc-line line-long"/><span className="doc-line line-short"/><span className="doc-footer-line"/></div><span className="doc-status">PRIVATE<br/>BY DESIGN</span></div><h3>Keep the essentials close.</h3><p>Organize travel documents and their key dates in a private, owner-scoped workspace.</p></Reveal>
        <Reveal className="feature-card feature-card-dates" delay={120}><div className="feature-card-top"><span>02 / IMPORTANT DATES</span><span className="feature-arrow">↗</span></div><div className="date-orbit" aria-hidden="true"><span className="orbit-date date-a">90</span><span className="orbit-date date-b">30</span><span className="orbit-center">DAYS<br/>IN VIEW</span><span className="orbit-date date-c">01</span></div><h3>See what’s coming.</h3><p>Expiry summaries and configurable reminders help bring upcoming dates into view.</p></Reveal>
        <Reveal className="feature-card feature-card-trip" delay={200}><div className="feature-card-top"><span>03 / YOUR NEXT CHAPTER</span><span className="feature-arrow">↗</span></div><div className="trip-art" aria-hidden="true"><div className="trip-sun"/><svg viewBox="0 0 360 150" fill="none"><path d="M0 123 74 54l38 38 56-70 67 82 37-45 88 67v24H0v-27Z" fill="currentColor"/><path d="m130 56 38-34 28 34" stroke="rgba(255,255,255,.5)" strokeWidth="2"/><path d="M27 119c45-30 80-29 122-3s72 23 111 1 58-21 80-9" stroke="#e0ff62" strokeWidth="2" strokeDasharray="4 7"/></svg><span className="trip-pin">✦</span></div><h3>Bring the trip together.</h3><p>Keep travel plans and destination preparation connected to your document checklist.</p></Reveal>
      </div>
    </section>

    <section className="landing-how">
      <Reveal className="how-heading"><p className="section-kicker">SIMPLE BY DESIGN</p><h2>Get set. Then <em>go.</em></h2><p>A clear starting point for your travel-document workspace.</p></Reveal>
      <div className="how-steps"><Reveal className="how-step"><span>01</span><div><h3>Create your account</h3><p>Start a private traveler workspace with your own sign-in.</p></div><i aria-hidden="true">↗</i></Reveal><Reveal className="how-step" delay={100}><span>02</span><div><h3>Add what matters</h3><p>Save document details, important dates, and trip plans.</p></div><i aria-hidden="true">↗</i></Reveal><Reveal className="how-step" delay={200}><span>03</span><div><h3>Keep moving forward</h3><p>Review what’s ahead and prepare at your own pace.</p></div><i aria-hidden="true">↗</i></Reveal></div>
    </section>

    <section className="landing-cta"><Reveal className="cta-panel"><div><p className="section-kicker">YOUR NEXT TRIP STARTS HERE</p><h2>Less last-minute.<br/><em>More looking forward.</em></h2></div><Link to="/register" className="hero-button hero-button-primary">Build your workspace <span aria-hidden="true">↗</span></Link><span className="cta-star" aria-hidden="true">✳</span></Reveal></section>
  </div>;
}
export function PlaceholderPage({ page }) { const [title, description] = content[page] || content.dashboard; const { documentId } = useParams(); return <><PageHeader eyebrow={['adminDashboard','users','logs','destinations','support'].includes(page) ? 'Administration · Preview' : 'Workspace · Preview'} title={title} description={description} action={<StatusBadge>Placeholder</StatusBadge>}/><Card><div className="mb-5"><h2 className="font-semibold text-slate-900">{title} workspace</h2><p className="mt-1 text-sm text-slate-500">Preview content only · No business data is connected.</p>{documentId && <code className="mt-2 block text-xs">Document reference: {documentId}</code>}</div><EmptyState title={`${title} is coming in a later project part`} description={`${description} This preview does not store or retrieve business data.`}/></Card></>; }
export function AccessPlaceholder({ register = false }) { const title = register ? 'Create your workspace' : 'Welcome back'; return <div className="mx-auto max-w-xl px-5 py-12 sm:py-20"><Card className="p-6 sm:p-9"><StatusBadge tone="warning">Preview only</StatusBadge><h1 className="mt-5 text-3xl font-bold">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{register ? 'Registration' : 'Sign in'} will be implemented in a later project part. No account is created or authenticated here.</p><div className="mt-7 space-y-4"><label className="block text-sm font-semibold">Email address<input disabled type="email" placeholder="you@example.com" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3"/></label><label className="block text-sm font-semibold">Password<input disabled type="password" placeholder="Available in a later part" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3"/></label><button disabled className="min-h-11 w-full rounded-xl bg-teal-800 px-4 text-sm font-bold text-white opacity-60">{register ? 'Create account' : 'Sign in'} (not active)</button></div><p className="mt-5 text-center text-sm text-slate-600">Return to <Link className="font-semibold text-teal-800" to="/">project home</Link></p></Card></div>; }
export function NotFoundPage() { return <div className="mx-auto max-w-2xl px-5 py-24 text-center"><p className="text-sm font-bold uppercase tracking-[.16em] text-teal-800">404 · Not found</p><h1 className="mt-4 text-3xl font-bold">We can’t find that page.</h1><p className="mt-3 text-slate-600">The address may be incorrect, or this page has not been added yet.</p><Link className="mt-7 inline-flex rounded-xl bg-teal-800 px-5 py-3 text-sm font-bold text-white" to="/">Return to home</Link></div>; }
