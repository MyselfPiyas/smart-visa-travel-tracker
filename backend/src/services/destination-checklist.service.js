import DestinationRequirement from '../models/DestinationRequirement.js';
import TravelDocument from '../models/TravelDocument.js';
import { getDocumentExpiryDetails } from './document-expiry.service.js';

const DOCUMENT_KINDS = ['passport', 'visa', 'travel_insurance', 'vaccination_certificate'];
const DAY_MS = 86400000;

function cleanText(value = '') { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
export function inferChecklistDocumentKind(requirement) {
  const text = cleanText(`${requirement.title || ''} ${requirement.description || ''}`);
  if (/passport/.test(text)) return 'passport';
  if (/\bvisa\b|electronic travel auth|\beta\b|visa waiver/.test(text)) return 'visa';
  if (/insurance/.test(text)) return 'travel_insurance';
  if (/vaccin|immuni[sz]ation/.test(text)) return 'vaccination_certificate';
  return null;
}

function verificationState(lastVerifiedAt, currentTime, staleDays) {
  if (!lastVerifiedAt || Number.isNaN(new Date(lastVerifiedAt).valueOf())) return { status: 'unverified', ageDays: null };
  const ageDays = Math.floor((currentTime.getTime() - new Date(lastVerifiedAt).getTime()) / DAY_MS);
  return { status: ageDays > staleDays ? 'outdated' : 'current', ageDays: Math.max(0, ageDays) };
}

function documentCoverage(document, { departureDate, returnDate }, currentTime) {
  const detail = getDocumentExpiryDetails(document, currentTime);
  const expiry = document.expiryDate ? new Date(document.expiryDate) : null;
  const validFrom = document.validFrom ? new Date(document.validFrom) : null;
  if (expiry && (expiry < departureDate || expiry < returnDate)) return { status: 'potentially_expired', reason: 'The saved document may expire before your planned return date. Verify its dates and the official requirement.' };
  if (!expiry || (validFrom && validFrom > departureDate)) return { status: 'uncertain', reason: 'Check document validity dates against your full trip.' };
  if (document.documentType === 'vaccination_certificate') return { status: 'uncertain', reason: 'A saved certificate does not establish that it meets destination rules.' };
  return { status: 'potential_match', reason: detail.status === 'expired' ? 'The saved document appears expired today. Verify its current status.' : 'A document of this type is saved. Confirm that its details meet the official requirement.' };
}

function presentRequirement(requirement, currentTime, staleDays, documentMap = null, dates = null, destinationCountry = null) {
  const stale = verificationState(requirement.lastVerifiedAt, currentTime, staleDays);
  const result = {
    id: String(requirement._id), destinationCountry: requirement.destinationCountry,
    nationality: requirement.nationality, purpose: requirement.purpose,
    title: requirement.title, description: requirement.description,
    requirementType: requirement.requirementType, officialSourceUrl: requirement.officialSourceUrl,
    lastVerifiedAt: requirement.lastVerifiedAt || null, verificationStatus: stale.status,
    verificationAgeDays: stale.ageDays,
  };
  if (!documentMap || !dates) return result;
  const kind = inferChecklistDocumentKind(requirement);
  if (!kind) return { ...result, matchStatus: 'uncertain', matchExplanation: 'The requirement cannot be reliably matched to a saved document type. Review the official source.' };
  let candidates = documentMap[kind] || [];
  if (kind === 'visa') {
    const destinationMatches = candidates.filter((document) => document.issuingCountry === destinationCountry);
    if (destinationMatches.length) candidates = destinationMatches;
    else if (candidates.length) return { ...result, matchStatus: 'uncertain', matchExplanation: 'You have a saved visa, but its recorded country does not match this destination. Review it manually.' };
  }
  if (!candidates.length) return { ...result, matchStatus: 'missing', matchExplanation: 'No saved document of this type was found. This is a checklist prompt, not a legal conclusion.' };
  const covered = candidates.map((document) => ({ document, coverage: documentCoverage(document, dates, currentTime) }));
  const potential = covered.find(({ coverage }) => coverage.status === 'potential_match');
  if (potential) return { ...result, matchStatus: 'potential_match', matchExplanation: potential.coverage.reason, matchedDocuments: covered.map(({ document, coverage }) => ({ id: String(document._id), displayName: document.displayName, documentType: document.documentType, status: coverage.status, expiryDate: document.expiryDate || null })) };
  const expired = covered.find(({ coverage }) => coverage.status === 'potentially_expired');
  if (expired) return { ...result, matchStatus: 'potentially_expired', matchExplanation: expired.coverage.reason, matchedDocuments: covered.map(({ document, coverage }) => ({ id: String(document._id), displayName: document.displayName, documentType: document.documentType, status: coverage.status, expiryDate: document.expiryDate || null })) };
  return { ...result, matchStatus: 'uncertain', matchExplanation: covered[0].coverage.reason, matchedDocuments: covered.map(({ document }) => ({ id: String(document._id), displayName: document.displayName, documentType: document.documentType, expiryDate: document.expiryDate || null })) };
}

export function createDestinationChecklistService({ RequirementModel = DestinationRequirement, DocumentModel = TravelDocument, now = () => new Date(), staleDays = () => Math.max(1, Math.min(3650, Number(process.env.DESTINATION_REQUIREMENT_STALE_DAYS) || 180)) } = {}) {
  async function listRequirements({ destinationCountry, nationality, purpose, page = 1, limit = 20, q }) {
    const filter = { active: true };
    if (destinationCountry) filter.destinationCountry = destinationCountry;
    if (nationality) filter.nationality = nationality;
    if (purpose) filter.purpose = { $in: [purpose, 'any'] };
    if (q) { const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ destinationCountry: { $regex: safe, $options: 'i' } }, { title: { $regex: safe, $options: 'i' } }]; }
    const [items, total] = await Promise.all([
      RequirementModel.find(filter).sort({ destinationCountry: 1, requirementType: 1, title: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      RequirementModel.countDocuments(filter),
    ]);
    const currentTime = now();
    return { items: items.map((item) => presentRequirement(item, currentTime, staleDays())), verificationStaleAfterDays: staleDays(), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async function buildChecklist({ owner, destinationCountry, nationality, purpose, departureDate, returnDate }) {
    const filter = { active: true, destinationCountry, nationality, purpose: { $in: [purpose, 'any'] } };
    const [items, documents] = await Promise.all([
      RequirementModel.find(filter).sort({ requirementType: 1, title: 1 }).lean(),
      DocumentModel.find({ owner, status: { $ne: 'archived' }, documentType: { $in: DOCUMENT_KINDS } })
        .select('documentType displayName issuingCountry issueDate expiryDate validFrom visaEntryType allowedStayDays').lean(),
    ]);
    const documentMap = Object.fromEntries(DOCUMENT_KINDS.map((kind) => [kind, documents.filter((document) => document.documentType === kind)]));
    const currentTime = now();
    const dates = { departureDate: new Date(departureDate), returnDate: new Date(returnDate) };
    const requirements = items.map((item) => presentRequirement(item, currentTime, staleDays(), documentMap, dates, destinationCountry));
    return {
      destinationCountry, nationality, purpose, departureDate: dates.departureDate, returnDate: dates.returnDate,
      requirements,
      verificationStaleAfterDays: staleDays(),
      summary: { total: requirements.length, potentialMatches: requirements.filter((item) => item.matchStatus === 'potential_match').length, potentiallyExpired: requirements.filter((item) => item.matchStatus === 'potentially_expired').length, missing: requirements.filter((item) => item.matchStatus === 'missing').length, uncertain: requirements.filter((item) => item.matchStatus === 'uncertain').length, outdated: requirements.filter((item) => item.verificationStatus !== 'current').length },
      notice: 'This checklist is informational. Document matches are not determinations that a traveler meets a legal requirement. Verify current rules with the linked official source.',
    };
  }

  return { listRequirements, buildChecklist };
}

export default createDestinationChecklistService();
