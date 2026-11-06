import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { listNotifications, markNotificationRead } from '../services/notifications.js';

const initialPage = { page: 1, limit: 20, total: 0, pages: 0 };
const statusTone = { sent: 'success', failed: 'danger', pending: 'warning', processing: 'info', cancelled: 'neutral' };
const failureMessage = 'Email delivery has not succeeded. The system will retry when possible, or contact support if the issue continues.';

export default function NotificationHistoryPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(initialPage);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    listNotifications({ page, limit: 20, ...(status ? { status } : {}) }).then((result) => {
      if (active) { setItems(result.items); setPagination(result.pagination); }
    }).catch(() => { if (active) setError('We couldn’t load your notifications. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status, retry]);

  async function markRead(id) {
    setBusyId(id);
    try { const updated = await markNotificationRead(id); setItems((current) => current.map((item) => item.id === id ? updated : item)); }
    catch { setError('We couldn’t update this notification. Please try again.'); }
    finally { setBusyId(''); }
  }

  function changeStatus(value) { setPage(1); setStatus(value); }

  return <>
    <PageHeader eyebrow="Your travel workspace" title="Notification history" description="Review reminder delivery, important document alerts, and travel record notices." action={<Link to="/app/reminders" className="text-sm font-semibold text-teal-800 hover:underline">Reminder settings →</Link>}/>
    <Card className="mb-5"><label className="block max-w-xs space-y-1.5 text-sm font-semibold text-slate-800">Delivery status<select value={status} onChange={(event) => changeStatus(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal"><option value="">All statuses</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label></Card>
    {loading ? <Card><LoadingIndicator label="Loading notification history…"/></Card> : error ? <Card><ErrorState title="Notifications unavailable" description={error}/><Button className="mt-4" onClick={() => setRetry((value) => value + 1)}>Try again</Button></Card> : items.length === 0 ? <Card><EmptyState title="No notifications found" description="Automated reminders and important updates will appear here when generated."/></Card> : <><div className="space-y-3">{items.map((item) => <Card key={item.id} className="!p-4 sm:!p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to={`/app/notifications/${item.id}`} className="font-semibold text-slate-950 hover:text-teal-800">{item.title}</Link><StatusBadge tone={statusTone[item.deliveryStatus] || 'neutral'}>{item.deliveryStatus}</StatusBadge>{!item.readAt && <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900">New</span>}</div><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.createdAt))}{item.sentAt ? ` · Sent ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.sentAt))}` : ''}</p>{item.document && <p className="mt-2 text-sm text-slate-700">{item.document.displayName}</p>}{item.deliveryStatus === 'failed' && <p className="mt-2 text-xs text-rose-800">{failureMessage}</p>}</div><div className="flex gap-2">{!item.readAt && <Button variant="secondary" disabled={busyId === item.id} onClick={() => markRead(item.id)}>{busyId === item.id ? 'Saving…' : 'Mark as read'}</Button>}<Link to={`/app/notifications/${item.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Details</Link></div></div></Card>)}</div>
      {pagination.pages > 1 && <nav aria-label="Notification pages" className="mt-5 flex items-center justify-between"><p className="text-sm text-slate-600">Page {pagination.page} of {pagination.pages} · {pagination.total} notifications</p><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></nav>}</>}
  </>;
}
