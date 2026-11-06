import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { listTravelRecords } from '../services/travelHistory.js';
import { formatTravelDate, formatCountry, travelPurposeLabels } from '../utils/travelPresentation.js';

const initialFilters = { period: 'all', country: '', purpose: '', dateFrom: '', dateTo: '', sort: 'newest' };
export default function TravelHistoryPage() {
  const [filters, setFilters] = useState(initialFilters); const [records, setRecords] = useState([]); const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await listTravelRecords({ page, limit: 10, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }); setRecords(result.records); setPagination(result.pagination); }
    catch { setError('We couldn’t load your travel history. Please try again.'); }
    finally { setLoading(false); }
  }, [filters, page, refreshKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const refresh = () => setRefreshKey((key) => key + 1); window.addEventListener('tracker:data-changed', refresh); return () => window.removeEventListener('tracker:data-changed', refresh); }, []);
  function change(event) { const { name, value } = event.target; setFilters((current) => ({ ...current, [name]: value })); setPage(1); }
  function reset() { setFilters(initialFilters); setPage(1); }
  const past = records.filter((record) => new Date(record.departureDate).getTime() <= Date.now());
  const upcoming = records.filter((record) => new Date(record.departureDate).getTime() > Date.now());
  return <>
    <PageHeader eyebrow="Your travel workspace" title="Travel history" description="Keep country visits, confirmed entry and exit dates, and associated visas together." action={<Link to="/app/travel-history/new" className="inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900">＋ Add travel record</Link>}/>
    <Card className="mb-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="space-y-1 text-xs font-semibold text-slate-700">Trip period<select name="period" value={filters.period} onChange={change} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All trips</option><option value="past">Past trips</option><option value="upcoming">Upcoming trips</option></select></label>
      <label className="space-y-1 text-xs font-semibold text-slate-700">Country code<input name="country" value={filters.country} onChange={change} maxLength={2} placeholder="IN" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" aria-label="Search by destination country code"/></label>
      <label className="space-y-1 text-xs font-semibold text-slate-700">Travel purpose<select name="purpose" value={filters.purpose} onChange={change} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">All purposes</option>{Object.entries(travelPurposeLabels).filter(([key]) => ['tourism','business','education','employment','family_visit','medical','transit','other'].includes(key)).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1 text-xs font-semibold text-slate-700">Departure from<input type="date" name="dateFrom" value={filters.dateFrom} onChange={change} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"/></label>
      <label className="space-y-1 text-xs font-semibold text-slate-700">Departure through<input type="date" name="dateTo" value={filters.dateTo} onChange={change} min={filters.dateFrom || undefined} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"/></label>
      <label className="space-y-1 text-xs font-semibold text-slate-700">Sort by departure<select name="sort" value={filters.sort} onChange={change} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    </div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Search by two-letter country code (for example, IN or JP). Each country visit is stored as its own record.</p><Button variant="ghost" onClick={reset}>Clear filters</Button></div></Card>
    {error && <div className="mb-5"><ErrorState title="Travel history unavailable" description={error}/><Button className="mt-3" onClick={load}>Try again</Button></div>}
    {loading ? <Card><LoadingIndicator label="Loading travel records…"/></Card> : !error && records.length === 0 ? <EmptyState title="No trips match these filters" description={pagination.total ? 'Try changing or clearing your filters.' : 'Add a past or upcoming trip to start building your travel history.'}/> : !error && <>
      <div className="mb-4 flex flex-wrap gap-3"><StatusBadge tone="neutral">{pagination.total} recorded {pagination.total === 1 ? 'trip' : 'trips'}</StatusBadge><StatusBadge tone="info">{upcoming.length} upcoming on this page</StatusBadge><StatusBadge>{past.length} past on this page</StatusBadge></div>
      <section className="space-y-5" aria-label="Travel records">
        {upcoming.length > 0 && <div><h2 className="mb-3 text-lg font-bold text-slate-950">Upcoming trips</h2><div className="grid gap-3 lg:grid-cols-2">{upcoming.map((record) => <TripCard key={record.id} record={record} upcoming/>)}</div></div>}
        {past.length > 0 && <div><h2 className="mb-3 text-lg font-bold text-slate-950">Past trips</h2><div className="grid gap-3 lg:grid-cols-2">{past.map((record) => <TripCard key={record.id} record={record}/>)}</div></div>}
      </section>
      <div className="mt-6 flex items-center justify-between gap-3"><p className="text-sm text-slate-600">Page {pagination.page} of {Math.max(1,pagination.pages)}</p><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
    </>}
  </>;
}

function TripCard({ record, upcoming = false }) {
  return <Card className="transition hover:border-teal-200"><Link to={`/app/travel-history/${record.id}`} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-950">{formatCountry(record.destinationCountry)}</h3><p className="mt-1 text-sm text-slate-600">{travelPurposeLabels[record.purpose] || 'Travel'}</p></div><StatusBadge tone={upcoming ? 'info' : 'neutral'}>{upcoming ? 'Upcoming' : 'Past'}</StatusBadge></div><p className="mt-4 text-sm text-slate-700">{formatTravelDate(record.departureDate)} <span className="text-slate-400">→</span> {formatTravelDate(record.returnDate)}</p>{record.visaDocument && <p className="mt-2 text-xs font-medium text-teal-800">Visa: {record.visaDocument.displayName} · {record.visaDocument.visaEntryType?.replaceAll('_',' ') || 'entry type not recorded'}</p>}<p className="mt-3 text-sm font-semibold text-teal-800">View trip details →</p></Link></Card>;
}
