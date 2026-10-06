import React from "react";
import { Input } from "../ui/Input";
import { HoursPicker } from "../HoursPicker";
import { FieldRow } from "./SettingsRows";
import type { DealerSettingsForm } from "./useDealerSettingsForm";

/** Store profile: the facts captions can use. Brand color lives in Creative. */
export const ProfileSection: React.FC<{ form: DealerSettingsForm }> = ({ form }) => {
  const { values } = form;
  return (
    <div className="flex min-w-0 flex-col">
      {/* Side by side from sm, one continuous hairline above both. */}
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <FieldRow label="Website" className="sm:pr-2">
          {(a11y) => (
            <Input
              {...a11y}
              value={values.website}
              onChange={(e) => form.setWebsite(e.target.value)}
              placeholder="https://yourdealership.com"
              inputMode="url"
              fullWidth
            />
          )}
        </FieldRow>
        <FieldRow label="Phone" className="sm:pl-2">
          {(a11y) => (
            <Input
              {...a11y}
              value={values.phone}
              onChange={(e) => form.setPhone(e.target.value)}
              placeholder="(313) 555-0100"
              inputMode="tel"
              fullWidth
            />
          )}
        </FieldRow>
      </div>
      <FieldRow label="Address">
        {(a11y) => (
          <Input
            {...a11y}
            value={values.address}
            onChange={(e) => form.setAddress(e.target.value)}
            placeholder="123 Main St, Detroit MI 48201"
            fullWidth
          />
        )}
      </FieldRow>
      <div className="border-t border-hairline py-4">
        <HoursPicker
          title="Hours"
          framed={false}
          value={form.hoursWeek}
          onChange={form.setHoursWeek}
          preview={values.hours}
        />
      </div>
      <FieldRow label="Tagline">
        {(a11y) => (
          <Input
            {...a11y}
            value={values.tagline}
            onChange={(e) => form.setTagline(e.target.value)}
            placeholder="Family-owned since 1985, no-haggle pricing"
            fullWidth
          />
        )}
      </FieldRow>
      <FieldRow label="OEM affiliation">
        {(a11y) => (
          <Input
            {...a11y}
            value={values.oem}
            onChange={(e) => form.setOem(e.target.value)}
            placeholder="Ford, GM, Stellantis, Independent…"
            fullWidth
          />
        )}
      </FieldRow>
    </div>
  );
};
