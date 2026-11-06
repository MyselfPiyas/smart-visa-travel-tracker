import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { getNotification, markNotificationRead } from '../services/notifications.js';

const tones = { sent: 'success', failed: 'danger', pending: 'warning', processing: 'info', cancelled: 'neutral' };

export default function NotificationDetailsPage() {
  const { notificationId } = useParams();
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getNotification(notificationId).then((value) => { if (active) setNotification(value); })
      .catch(() => { if (active) setError('This notification is unavailable or does not belong to your account.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notificationId]);

  async function markRead() {
    try { setNotification(await markNotificationRead(notification.id)); }
    catch { setError('We couldn’t update this notification. Please try again.'); }
  }

  if (loading) return <Card><LoadingIndicator label="Loading notification…"/></Card>;
  if (!notification) return <><PageHeader title="Notification details"/><ErrorState title="Notification unavailable" description={error || 'This notification is unavailable.'}/><Link to="/app/notifications" className="mt-4 inline-block text-sm font-semibold text-teal-800">← Back to notifications</Link></>;
  return <>
    <PageHeader eyebrow="Your travel workspace" title={notification.title} description="Delivery and read status for this account notification." action={<Link to="/app/notifications" className="text-sm font-semibold text-teal-800 hover:underline">← Notification history</Link>}/>
    {error && <div className="mb-4"><ErrorState title="Action unavailable" description={error}/></div>}
    <Card className="max-w-2xl"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={tones[notification.deliveryStatus] || 'neutral'}>{notification.deliveryStatus}</StatusBadge><StatusBadge>{notification.readAt ? 'Read' : 'Unread'}</StatusBadge></div><dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase text-slate-500">Created</dt><dd className="mt-1 text-sm">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(notification.createdAt))} UTC</dd></div><div><dt className="text-xs font-semibold uppercase text-slate-500">Sent</dt><dd className="mt-1 text-sm">{notification.sentAt ? `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(notification.sentAt))} UTC` : 'Not sent'}</dd></div><div><dt className="text-xs font-semibold uppercase text-slate-500">Delivery attempts</dt><dd className="mt-1 text-sm">{notification.attemptCount}</dd></div>{notification.document && <div><dt className="text-xs font-semibold uppercase text-slate-500">Related document</dt><dd className="mt-1 text-sm">{notification.document.displayName}</dd></div>}</dl>{notification.deliveryStatus === 'failed' && <p role="status" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">Email delivery has not succeeded. The system will retry when possible, or contact support if the issue continues.</p>}{notification.type === 'potential_overstay_warning' && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">This is an informational alert based on recorded travel dates, not a legal determination. Immigration rules differ by country; confirm details with official sources.</p>}{!notification.readAt && <Button className="mt-5" onClick={markRead}>Mark as read</Button>}</Card>
  </>;
}
