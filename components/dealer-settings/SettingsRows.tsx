import React, { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Switch } from "../ui/Switch";
import { cn } from "../../utils/classNames";

/**
 * The settings form's row kinds (spec 2026-10-05 §4). Forms sit directly on
 * the canvas: a group is a display-face title and its rows, and rows are
 * separated by one hairline. Nothing here is boxed, tinted or brand-coloured;
 * a selected row or chip is neutral, because the dealer's colour belongs to
 * the primary action alone.
 */

/** 16/22 semibold: the label of a setting, switch or disclosure row. */
export const ROW_LABEL = "text-base font-semibold leading-[1.375rem] text-ink";
/** 14/20: the helper sentence under a label. */
export const ROW_HELPER = "text-sm text-ink-2";
/** 14/20 medium: a field's label above its control. */
export const FIELD_LABEL = "block text-sm font-medium text-ink-2";

const useIds = () => {
  const base = useId();
  return {
    controlId: `${base}control`,
    labelId: `${base}label`,
    helperId: `${base}helper`,
  };
};

export interface RowIds {
  /** Give it to the control (an input's `id`). */
  controlId: string;
  /** The row's label element. */
  labelId: string;
  /** The helper sentence, when the row has one. */
  helperId?: string;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
interface GroupProps {
  title: string;
  description?: React.ReactNode;
  /** Use this id for the heading, when a control is labelled by it. */
  headingId?: string;
  className?: string;
  children: React.ReactNode;
}

/** A group: an h3 in the display face (22/28), an optional sentence, its rows. */
export const SettingsGroup: React.FC<GroupProps> = ({
  title,
  description,
  headingId,
  className,
  children,
}) => {
  const generated = useId();
  const id = headingId || generated;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col", className)}>
      <h3 id={id} className="font-display text-[1.375rem] leading-7 text-ink">
        {title}
      </h3>
      {description ? (
        <p className={cn("mt-1 max-w-prose", ROW_HELPER)}>{description}</p>
      ) : null}
      <div className="mt-3 flex min-w-0 flex-col">{children}</div>
    </section>
  );
};

/** A group inside a disclosure: an h4 (18/24 semibold), its sentence, its rows. */
export const SettingsSubgroup: React.FC<GroupProps> = ({
  title,
  description,
  headingId,
  className,
  children,
}) => {
  const generated = useId();
  const id = headingId || generated;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col", className)}>
      <h4 id={id} className="text-lg leading-6 text-ink">
        {title}
      </h4>
      {description ? (
        <p className={cn("mt-0.5 max-w-prose", ROW_HELPER)}>{description}</p>
      ) : null}
      <div className="mt-2.5 flex min-w-0 flex-col">{children}</div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Field row: the label above the control, the helper under it
// ---------------------------------------------------------------------------
interface FieldRowProps {
  label: React.ReactNode;
  helper?: React.ReactNode;
  /** No hairline or padding: a field inside another row (a channel's fields). */
  bare?: boolean;
  className?: string;
  children: (a11y: { id: string; "aria-describedby"?: string }) => React.ReactNode;
}

export const FieldRow: React.FC<FieldRowProps> = ({
  label,
  helper,
  bare = false,
  className,
  children,
}) => {
  const { controlId, helperId } = useIds();
  return (
    <div className={cn("min-w-0", !bare && "border-t border-hairline py-4", className)}>
      <label htmlFor={controlId} className={cn("mb-1.5", FIELD_LABEL)}>
        {label}
      </label>
      {children({
        id: controlId,
        "aria-describedby": helper ? helperId : undefined,
      })}
      {helper ? (
        <p id={helperId} className={cn("mt-1.5", ROW_HELPER)}>
          {helper}
        </p>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Setting row: label and helper on the left, the control on the right
// ---------------------------------------------------------------------------
interface SettingRowProps {
  label: React.ReactNode;
  helper?: React.ReactNode;
  /** Render the label as a <label> for the control (give it `controlId`). */
  labelFor?: boolean;
  /** Align the control to the top of the row instead of its middle. */
  alignTop?: boolean;
  className?: string;
  children: (ids: RowIds) => React.ReactNode;
}

/** Wraps the control under the label when the column is narrow. */
export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  helper,
  labelFor = false,
  alignTop = false,
  className,
  children,
}) => {
  const { controlId, labelId, helperId } = useIds();
  return (
    <div
      className={cn(
        "flex flex-wrap gap-x-6 gap-y-3 border-t border-hairline py-4",
        alignTop ? "items-start" : "items-center",
        className,
      )}
    >
      <div className="min-w-0 flex-[1_1_15rem]">
        {labelFor ? (
          <label id={labelId} htmlFor={controlId} className={cn("block", ROW_LABEL)}>
            {label}
          </label>
        ) : (
          <p id={labelId} className={ROW_LABEL}>
            {label}
          </p>
        )}
        {helper ? (
          <p id={helperId} className={cn("mt-0.5", ROW_HELPER)}>
            {helper}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5">
        {children({ controlId, labelId, helperId: helper ? helperId : undefined })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Switch row
// ---------------------------------------------------------------------------
interface SwitchRowProps {
  label: string;
  helper?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** A regular-weight label and tighter padding, for rows under an h4. */
  subtle?: boolean;
  className?: string;
}

/** Label and helper left; the word "On" or "Off" and the switch right. */
export const SwitchRow: React.FC<SwitchRowProps> = ({
  label,
  helper,
  checked,
  onChange,
  disabled,
  subtle = false,
  className,
}) => {
  const { labelId, helperId } = useIds();
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-t border-hairline",
        subtle ? "py-2.5" : "py-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          id={labelId}
          className={cn(
            "text-base leading-[1.375rem] text-ink",
            !subtle && "font-semibold",
          )}
        >
          {label}
        </p>
        {helper ? (
          <p id={helperId} className={cn("mt-0.5", ROW_HELPER)}>
            {helper}
          </p>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={helper ? helperId : undefined}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Choice row: a real radio, its label and helper
// ---------------------------------------------------------------------------
interface ChoiceRowProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  helper?: React.ReactNode;
  /** A nested option: no hairline, a smaller radio. */
  compact?: boolean;
  /** Shown under the row while it is the checked choice. */
  children?: React.ReactNode;
}

/**
 * A native radio, so the browser's own arrow keys move through the group.
 * The radio is named by its label alone; the helper describes it.
 */
export const ChoiceRow: React.FC<ChoiceRowProps> = ({
  name,
  value,
  checked,
  onChange,
  label,
  helper,
  compact = false,
  children,
}) => {
  const { labelId, helperId } = useIds();
  return (
    <div className={cn("min-w-0", !compact && "border-t border-hairline")}>
      <label
        className={cn(
          "flex cursor-pointer items-start",
          compact ? "min-h-11 gap-3 py-2.5" : "gap-3.5 py-3.5",
        )}
      >
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          aria-labelledby={labelId}
          aria-describedby={helper ? helperId : undefined}
          className={cn(
            "shrink-0 cursor-pointer accent-brand-ink",
            compact ? "mt-0.5 h-[18px] w-[18px]" : "mt-px h-5 w-5",
          )}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            id={labelId}
            className={cn(
              "text-base leading-[1.375rem] text-ink",
              checked && "font-semibold",
            )}
          >
            {label}
          </span>
          {helper ? (
            <span id={helperId} className={ROW_HELPER}>
              {helper}
            </span>
          ) : null}
        </span>
      </label>
      {checked && children ? (
        <div
          className={cn("min-w-0 pb-3", compact ? "pl-[1.875rem]" : "pl-[2.125rem]")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Chip: a pill with a real checkbox or radio inside
// ---------------------------------------------------------------------------
interface ChipProps {
  type: "checkbox" | "radio";
  name?: string;
  value?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  type,
  name,
  value,
  checked,
  onChange,
  disabled = false,
  children,
}) => (
  <label
    className={cn(
      "inline-flex min-h-11 select-none items-center gap-2 rounded-full border px-3.5 text-sm transition-colors duration-120 ease-out",
      checked
        ? "border-strong bg-panel-raised font-semibold text-ink"
        : "border-hairline text-ink-2 hover:border-strong hover:text-ink",
      disabled ? "cursor-not-allowed" : "cursor-pointer",
    )}
  >
    <input
      type={type}
      name={name}
      value={value}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-[18px] w-[18px] shrink-0 cursor-[inherit] accent-brand-ink"
    />
    {children}
  </label>
);

// ---------------------------------------------------------------------------
// Disclosure row: a full-width button that opens advanced controls
// ---------------------------------------------------------------------------
interface DisclosureRowProps {
  title: string;
  helper?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** The id of the panel it opens. */
  controls: string;
  className?: string;
}

export const DisclosureRow: React.FC<DisclosureRowProps> = ({
  title,
  helper,
  open,
  onToggle,
  controls,
  className,
}) => {
  const { labelId, helperId } = useIds();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-labelledby={labelId}
      aria-describedby={helper ? helperId : undefined}
      onClick={onToggle}
      className={cn(
        "group flex w-full items-center justify-between gap-3 border-y border-hairline text-left",
        helper ? "min-h-16 py-2.5" : "min-h-12 py-2",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className={ROW_LABEL}>
          {title}
        </span>
        {helper ? (
          <span id={helperId} className={ROW_HELPER}>
            {helper}
          </span>
        ) : null}
      </span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "h-[18px] w-[18px] shrink-0 text-ink-2 transition-transform duration-180 ease-out group-hover:text-ink motion-reduce:transition-none",
          open && "rotate-180",
        )}
      />
    </button>
  );
};

// ---------------------------------------------------------------------------
// Service row: a connected service, what it does, its state or action
// ---------------------------------------------------------------------------
interface ServiceRowProps {
  name: string;
  /** One true sentence about what the service does. */
  description: React.ReactNode;
  /** The state in words ("Connected"), or the action, at the right. */
  aside?: React.ReactNode;
  /** Detail under the row: who it is connected to, a step, an error. */
  children?: React.ReactNode;
}

export const ServiceRow: React.FC<ServiceRowProps> = ({
  name,
  description,
  aside,
  children,
}) => (
  <div className="border-b border-hairline py-3.5">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-[1_1_16rem]">
        <h4 className={ROW_LABEL}>{name}</h4>
        <p className={ROW_HELPER}>{description}</p>
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-3">{aside}</div> : null}
    </div>
    {children ? (
      <div className="mt-3 flex min-w-0 flex-col gap-3">{children}</div>
    ) : null}
  </div>
);

/** A state in words with a check, for a row that is set up ("Ready", "Connected"). */
export const DoneMark: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-2">
    <Check className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
    {children}
  </span>
);

/** An inline error under the control it is about. */
export const ErrorNote: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <p
    role="alert"
    className={cn(
      "rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink",
      className,
    )}
  >
    {children}
  </p>
);
