import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader } from '../components/ui/index.jsx';
import { DashboardPanel, DashboardStat, ExpiryList, NotificationList, PotentialOverstayList, ReminderList, TravelHistoryList } from '../components/dashboard/DashboardWidgets.jsx';
import { formatDocumentDate } from '../utils/documentPresentation.js';
import { formatCountry, formatTravelDate } from '../utils/travelPresentation.js';

const actions = [
  ['Add document', '/app/documents/upload', '＋'], ['View all documents', '/app/documents', '▤'], ['Configure reminders', '/app/reminders', '◷'], ['Add travel record', '/app/travel-history', '↗'], ['Destination checklist', '/app/checklist', '☷'],
];

function getGreeting(name) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${greeting}, ${name?.trim().split(/\s+/)[0] || 'traveler'}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError('');
    try {
      const response = await api.get('/traveler/dashboard');
      setData(response.data);
    } catch {
      setError('We could not load your dashboard. Check your connection and try again.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    loadDashboard({ initial: true });
    const refresh = () => loadDashboard();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('tracker:data-changed', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('tracker:data-changed', refresh); document.removeEventListener('visibilitychange', onVisibility); };
  }, [loadDashboard]);

  return <>
    <PageHeader eyebrow="Your travel overview" title={getGreeting(user?.name)} description="A secure snapshot of your travel documents, reminders, and recent trips." action={<Button variant="secondary" onClick={() => loadDashboard()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>}/>
    {loading && <Card><LoadingIndicator label="Loading your dashboard…"/></Card>}
    {!loading && error && <Card><ErrorState title="Dashboard unavailable" description={error}/><Button className="mt-4" onClick={() => loadDashboard({ initial: true })}>Try again</Button></Card>}
    {!loading && data && <>
      <section aria-label="Document summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <DashboardStat label="Saved documents" value={data.counts.total} detail="Across your workspace" icon="▤"/>
        <DashboardStat label="Valid" value={data.counts.valid} detail="Outside the configured warning window" tone="green" icon="✓"/>
        <DashboardStat label="Expiring soon" value={data.counts.expiringSoon} detail={`Within ${data.thresholds?.[0] || 90} days`} tone="amber" icon="◷"/>
        <DashboardStat label="Expired" value={data.counts.expired} detail="Review these documents" tone="rose" icon="!"/>
        <DashboardStat label="Needs information" value={data.counts.pendingInformation} detail="Add or correct required dates" tone="slate" icon="i"/>
        <DashboardStat label="Visas not yet valid" value={data.counts.notYetValid || 0} detail="Their valid-from date is ahead" tone="slate" icon="◷"/>
      </section>

      {data.nextUpcomingExpiry && <Card className="mt-4 border-teal-200 bg-teal-50"><p className="text-xs font-bold uppercase tracking-wide text-teal-900">Next upcoming expiry</p><p className="mt-1 font-semibold text-slate-950">{data.nextUpcomingExpiry.displayName} · {formatDocumentDate(data.nextUpcomingExpiry.expiryDate)}</p><p className="mt-1 text-sm text-slate-700">{data.nextUpcomingExpiry.remainingDays === 0 ? 'Expires today' : `${data.nextUpcomingExpiry.remainingDays} days remaining`}</p></Card>}

      <Card className="mt-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">Quick actions</h2><p className="mt-1 text-sm text-slate-600">Pick up where you need to.</p></div><div className="flex flex-wrap gap-2">{actions.map(([label, to, icon]) => <Link key={to} to={to} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"><span aria-hidden="true">{icon}</span>{label}</Link>)}</div></div></Card>

      <Card className="mt-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-teal-800">Travel history</p><h2 className="mt-1 text-xl font-bold text-slate-950">{data.totalTravelRecords} recorded {data.totalTravelRecords === 1 ? 'trip' : 'trips'}</h2><p className="mt-1 text-sm text-slate-600">Recently visited countries</p><div className="mt-3 flex flex-wrap gap-2">{data.recentlyVisitedCountries?.length ? data.recentlyVisitedCountries.map((country) => <span key={country} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{formatCountry(country)}</span>) : <span className="text-sm text-slate-500">No past visits recorded yet.</span>}</div></div><Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/travel-history">Manage trips →</Link></div></Card>

      {data.counts.total === 0 && <div className="mt-6"><EmptyState title="Start your travel workspace" description="Add a travel document to see expiry summaries and keep important dates together."/></div>}

      <section className="mt-6 grid gap-5 xl:grid-cols-2" aria-label="Travel dashboard details">
        <DashboardPanel title="Upcoming document expiries" action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/documents">All documents →</Link>}><ExpiryList records={data.upcomingExpiries}/></DashboardPanel>
        <DashboardPanel title="Upcoming reminders" action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/reminders">Settings →</Link>}><ReminderList records={data.upcomingReminders}/></DashboardPanel>
        <DashboardPanel title="Recent notifications" action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/notifications">View history →</Link>}><NotificationList records={data.recentNotifications}/></DashboardPanel>
        <DashboardPanel title="Recent travel history" action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/travel-history">View history →</Link>}><TravelHistoryList records={data.recentTravelHistory}/></DashboardPanel>
        <DashboardPanel title="Upcoming trips" action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/travel-history">All trips →</Link>}>{data.upcomingTrips?.length ? <ul className="divide-y divide-slate-100">{data.upcomingTrips.map((trip, index) => <li key={`${trip.destinationCountry}-${trip.departureDate}-${index}`} className="py-3 first:pt-0"><p className="font-semibold text-slate-900">{formatCountry(trip.destinationCountry)} · {trip.purpose.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-slate-600">{formatTravelDate(trip.departureDate)} → {formatTravelDate(trip.returnDate)}</p></li>)}</ul> : <EmptyState title="No upcoming trips" description="Trips with future departure dates will appear here."/>}</DashboardPanel>
        <DashboardPanel title="Travel records to verify"><PotentialOverstayList records={data.potentialOverstayWarnings || []}/></DashboardPanel>
      </section>
    </>}
  </>;
}
