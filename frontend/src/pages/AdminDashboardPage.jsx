import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { getAdminActivity, getAdminCompliance, getAdminSummary } from '../services/admin.js';

const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
const stats = (data) => [
  ['Registered users', data.users.total, '/admin/users'], ['Active users', data.users.active, '/admin/users?status=active'], ['Suspended users', data.users.suspended, '/admin/users?status=suspended'],
  ['Travel documents', data.documents.total], ['Expiring soon', data.documents.expiringSoon], ['Expired documents', data.documents.expired], ['Travel records', data.travelHistory.total],
  ['Notifications', data.notifications.total, '/admin/notifications'], ['Delivered', data.notifications.sent, '/admin/notifications?status=sent'], ['Failed deliveries', data.notifications.failed, '/admin/notifications?status=failed'], ['Pending', data.notifications.pending, '/admin/notifications?status=pending'],
  ['Active destination entries', data.destinationRequirements.active, '/admin/destinations'],
];

export default function AdminDashboardPage() {
  const [data, setData] = useState(null); const [activity, setActivity] = useState([]); const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    Promise.all([getAdminSummary(), getAdminActivity({ limit: 8 }), getAdminCompliance()])
      .then(([summary, recent, complianceSummary]) => { if (live) { setData(summary); setActivity(recent); setCompliance(complianceSummary); } })
      .catch(() => live && setError('Could not load administrator statistics. Try again.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [retry]);
  return <>
    <PageHeader eyebrow="Administration" title="Admin dashboard" description="Current account, travel document, delivery, and requirement totals from the database." action={<Button variant="secondary" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Refresh</Button>}/>
    {error && <div className="mb-4"><ErrorState title="Dashboard unavailable" description={error}/><Button className="mt-3" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Try again</Button></div>}
    {loading ? <Card><LoadingIndicator label="Loading application totals…"/></Card> : data && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats(data).map(([label, value, href]) => {
        const card = <Card className="h-full hover:border-teal-300"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p></Card>;
        return href ? <Link key={label} to={href}>{card}</Link> : <div key={label}>{card}</div>;
      })}</div>
      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card><h2 className="font-bold">Notification delivery</h2><p className="mt-2 text-4xl font-bold text-teal-900">{data.notifications.successRate}%</p><p className="text-xs text-slate-600">Sent / sent plus failed; pending messages are excluded.</p><Link className="mt-4 inline-block text-sm font-semibold text-teal-800" to="/admin/notifications">View delivery logs →</Link></Card>
        <Card><h2 className="font-bold">Requirement review</h2><div className="mt-3 flex flex-wrap gap-2"><StatusBadge tone="success">{compliance?.activeRequirements || 0} active</StatusBadge><StatusBadge tone="warning">{compliance?.staleRequirements || 0} outdated</StatusBadge><StatusBadge tone="danger">{compliance?.unverifiedRequirements || 0} unverified</StatusBadge></div><Link className="mt-4 inline-block text-sm font-semibold text-teal-800" to="/admin/destinations">Manage destination entries →</Link></Card>
      </section>
      <Card className="mt-5"><h2 className="font-bold">Recent system activity</h2>{activity.length ? <ul className="mt-3 divide-y divide-slate-100">{activity.map((item) => <li key={item.id} className="py-3 text-sm"><span className="font-semibold">{item.action}</span><span className="text-slate-600"> · {item.resourceType} · {date(item.occurredAt)}</span></li>)}</ul> : <div className="mt-3"><EmptyState title="No recent activity" description="Audited administrative actions will appear here."/></div>}</Card>
    </>}
  </>;
}
