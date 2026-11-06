import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { getAdminNotificationStats, listAdminNotificationLogs } from '../services/notifications.js';

const statusTone = { sent: 'success', failed: 'danger', pending: 'warning', processing: 'info', cancelled: 'neutral' };

export default function AdminNotificationLogsPage() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([getAdminNotificationStats(), listAdminNotificationLogs({ limit: 50 })])
      .then(([summary, result]) => { if (active) { setStats(summary); setLogs(result.items); } })
      .catch(() => { if (active) setError('We couldn’t load notification monitoring. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return <>
    <PageHeader eyebrow="Administration" title="Notification monitoring" description="Review delivery status, retry counts, and safe provider error categories. Private document details and email contents are not included."/>
    {error && <div className="mb-4"><ErrorState title="Notification monitoring unavailable" description={error}/><Button className="mt-3" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
    {loading ? <Card><LoadingIndicator label="Loading safe delivery logs…"/></Card> : stats && <>
      <section aria-label="Notification totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(stats.totals).map(([label,value]) => <Card key={label}><p className="text-sm capitalize text-slate-600">{label.replace(/([A-Z])/g, ' $1')}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p></Card>)}</section>
      <Card className="mt-6"><h2 className="font-bold text-slate-950">Recent safe delivery logs</h2>{logs.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-3 pr-4">Notification</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Attempts</th><th className="py-3 pr-4">Last attempt</th><th className="py-3">Safe error category</th></tr></thead><tbody>{logs.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="py-3 pr-4 font-medium text-slate-900">{item.title}</td><td className="py-3 pr-4"><StatusBadge tone={statusTone[item.deliveryStatus] || 'neutral'}>{item.deliveryStatus}</StatusBadge></td><td className="py-3 pr-4">{item.attemptCount}</td><td className="py-3 pr-4 text-slate-600">{item.lastAttemptAt ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(item.lastAttemptAt)) : '—'}</td><td className="py-3 text-slate-600">{item.safeError?.category || '—'}</td></tr>)}</tbody></table></div> : <div className="mt-4"><EmptyState title="No delivery logs yet" description="The worker will add safe notification delivery records here."/></div>}</Card>
    </>}
  </>;
}
