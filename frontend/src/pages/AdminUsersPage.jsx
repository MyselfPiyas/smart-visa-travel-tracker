import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { listAdminUsers, setAdminUserStatus } from '../services/admin.js';

const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
const statusTone = { active: 'success', suspended: 'danger', pending: 'warning' };

export default function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || ''); const [status, setStatus] = useState(searchParams.get('status') || ''); const [createdFrom, setCreatedFrom] = useState(''); const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1); const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [retry, setRetry] = useState(0); const [selectedUser, setSelectedUser] = useState(null);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    const params = { q: query, status, createdFrom, createdTo, page, limit: 15 };
    setSearchParams(Object.fromEntries(Object.entries({ q: query, status }).filter(([, value]) => value)), { replace: true });
    listAdminUsers(params).then((result) => live && setData(result)).catch(() => live && setError('Could not load accounts.')).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [query, status, createdFrom, createdTo, page, retry]);
  async function confirmStatusChange() {
    if (!selectedUser) return;
    const nextStatus = selectedUser.accountStatus === 'suspended' ? 'active' : 'suspended';
    try { await setAdminUserStatus(selectedUser.id, nextStatus); setNotice(`Account ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'}. This action was audited.`); setSelectedUser(null); setRetry((value) => value + 1); }
    catch { setSelectedUser(null); setError('Account status was not changed. Please retry.'); }
  }
  return <>
    <PageHeader eyebrow="Administration" title="User management" description="Search traveler accounts, review limited profile details, and manage account access."/>
    <Card className="mb-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm font-semibold">Search name or email<input aria-label="Search name or email" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"/></label>
      <label className="text-sm font-semibold">Account status<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label>
      <label className="text-sm font-semibold">Registered from<input type="date" value={createdFrom} onChange={(event) => { setPage(1); setCreatedFrom(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"/></label>
      <label className="text-sm font-semibold">Registered through<input type="date" value={createdTo} onChange={(event) => { setPage(1); setCreatedTo(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"/></label>
    </div></Card>
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {error && <div className="mb-4"><ErrorState title="Account list unavailable" description={error}/><Button className="mt-3" onClick={() => { setError(''); setRetry((value) => value + 1); }}>Try again</Button></div>}
    {loading ? <Card><LoadingIndicator label="Loading accounts…"/></Card> : data?.users.length ? <>
      <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3">Traveler</th><th>Email</th><th>Status</th><th>Created</th><th>Locale</th><th>Actions</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id} className="border-b border-slate-100"><td className="py-3 font-semibold"><Link to={`/admin/users/${user.id}`} className="text-teal-900 hover:underline">{user.name}</Link></td><td>{user.email}</td><td><StatusBadge tone={statusTone[user.accountStatus]}>{user.accountStatus}</StatusBadge></td><td>{formatDate(user.createdAt)}</td><td>{user.profileSettings.locale}</td><td><Button variant="secondary" onClick={() => setSelectedUser(user)}>{user.accountStatus === 'suspended' ? 'Reactivate' : 'Suspend'}</Button></td></tr>)}</tbody></table></div></Card>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{data.pagination.total} accounts · page {page} of {Math.max(1, data.pagination.pages)}</p><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </> : <EmptyState title="No travelers found" description="Try a different search, status, or registration date range."/>}
    <ConfirmDialog open={Boolean(selectedUser)} title={selectedUser?.accountStatus === 'suspended' ? 'Reactivate this account?' : 'Suspend this account?'} onCancel={() => setSelectedUser(null)} onConfirm={confirmStatusChange}>{selectedUser?.accountStatus === 'suspended' ? 'The traveler will be able to sign in again.' : 'The traveler will be signed out and blocked from signing in until reactivated.'} This administrative action is recorded in the audit log.</ConfirmDialog>
  </>;
}
