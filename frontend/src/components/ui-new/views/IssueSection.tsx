import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { StatusDot } from '../primitives/StatusDot';
import {
  PropertyDropdown,
  type PropertyDropdownOption,
} from '../primitives/PropertyDropdown';

export interface StatusOption {
  value: string;
  label: string;
  color: string;
}

interface IssueSectionProps {
  title: string;
  statusId: string;
  statusOptions: StatusOption[];
  onStatusChange: (statusId: string) => void;
  onNavigate: () => void;
}

function statusToDropdownOptions(
  options: StatusOption[]
): PropertyDropdownOption[] {
  return options.map((s) => ({
    value: s.value,
    label: s.label,
    renderOption: () => (
      <span className="flex items-center gap-half">
        <StatusDot color={s.color} />
        {s.label}
      </span>
    ),
  }));
}

export function IssueSection({
  title,
  statusId,
  statusOptions,
  onStatusChange,
  onNavigate,
}: IssueSectionProps) {
  const dropdownOptions = statusToDropdownOptions(statusOptions);

  return (
    <div className="flex items-center gap-base px-base py-half w-full min-w-0">
      <span className="text-sm text-normal truncate flex-1 min-w-0">
        {title}
      </span>
      <div className="flex items-center gap-half flex-shrink-0">
        <PropertyDropdown
          value={statusId}
          options={dropdownOptions}
          onChange={onStatusChange}
        />
        <button
          type="button"
          onClick={onNavigate}
          className="flex-shrink-0 text-low hover:text-normal transition-colors"
          title="Go to issue"
        >
          <ArrowSquareOutIcon className="size-icon-xs" weight="bold" />
        </button>
      </div>
    </div>
  );
}
