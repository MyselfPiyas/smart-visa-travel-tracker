import { StatusBadge } from '../ui/index.jsx';
import { getStatusLabel, getStatusTone } from '../../utils/documentPresentation.js';

export default function DocumentStatusBadge({ status }) {
  return <StatusBadge tone={getStatusTone(status)}>{getStatusLabel(status)}</StatusBadge>;
}
