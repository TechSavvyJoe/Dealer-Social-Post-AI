import React, { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { CATEGORY_OUTPUTS } from "../../services/creativeSystem";
import type { BrandCategoryId, FeaturePermissionKey } from "../../types";
import { cn } from "../../utils/classNames";
import {
  DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE,
  buildEmployeeDisclosure,
} from "../../utils/complianceDisclosures";
import {
  APPROVAL_FIRST_N_MAX,
  APPROVAL_FIRST_N_MIN,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  DESTINATION_LABELS,
  clampFirstN,
  type ReviewScope,
} from "./settingsModel";
import {
  ChoiceRow,
  Chip,
  DisclosureRow,
  FieldRow,
  ROW_HELPER,
  SettingsGroup,
  SettingsSubgroup,
  SwitchRow,
} from "./SettingsRows";
import type { DealerSettingsForm } from "./useDealerSettingsForm";

const FEATURE_ROWS: ReadonlyArray<{
  key: FeaturePermissionKey;
  label: string;
  helper: string;
}> = [
  {
    key: "playful",
    label: "Playful style",
    helper: "Salespeople can try the store's playful style on a post.",
  },
  {
    key: "video",
    label: "Video",
    helper: "Salespeople can add a short video to a post.",
  },
];

interface WorkflowSectionProps {
  form: DealerSettingsForm;
  dealerName: string;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

/** Workflow: approval, the team-member disclosure, and the advanced controls. */
export const WorkflowSection: React.FC<WorkflowSectionProps> = ({
  form,
  dealerName,
  advancedOpen,
  onToggleAdvanced,
}) => {
  const { values, reviewChoice } = form;
  const approvalName = useId();
  const scopeName = useId();
  const firstNId = useId();
  const firstNHelpId = useId();
  const categoryHelpId = useId();
  const advancedId = useId();

  const chooseScope = (scope: ReviewScope) => {
    form.setFirstNDraft(null);
    form.setReviewChoice((current) => ({ ...current, scope }));
  };

  const stepFirstN = (delta: number) => {
    form.setFirstNDraft(null);
    form.setReviewChoice((current) => ({
      ...current,
      firstN: clampFirstN(current.firstN + delta),
    }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <SettingsGroup title="Manager approval">
        <div role="radiogroup" aria-label="Manager approval requirement">
          <ChoiceRow
            name={approvalName}
            value="off"
            checked={!values.approval}
            onChange={() => form.setApproval(false)}
            label="No approval required"
            helper="Posts can be shared as soon as they are created."
          />
          <ChoiceRow
            name={approvalName}
            value="on"
            checked={values.approval}
            onChange={() => form.setApproval(true)}
            label="Require manager approval"
            helper="Posts that need approval wait in your approval queue and cannot be shared until you approve them."
          />
        </div>
        {values.approval ? (
          // A sibling of the radiogroup, so that group holds only its two
          // radios; indented to sit under "Require manager approval".
          <div className="min-w-0 pb-3 pl-8.5">
            <fieldset className="min-w-0 border-t border-hairline pt-3.5">
              <legend className="float-left w-full pb-1 text-sm font-semibold text-ink-2">
                Which posts need approval?
              </legend>
              <div className="clear-both">
                <ChoiceRow
                  compact
                  name={scopeName}
                  value="every"
                  checked={reviewChoice.scope === "every"}
                  onChange={() => chooseScope("every")}
                  label="Every post"
                />
                <ChoiceRow
                  compact
                  name={scopeName}
                  value="first_n"
                  checked={reviewChoice.scope === "first_n"}
                  onChange={() => chooseScope("first_n")}
                  label="Each person's first posts"
                  helper="A person's posts are reviewed until you have approved a set number of them."
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label htmlFor={firstNId} className="text-sm text-ink-2">
                        Posts to approve first
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          aria-label="One fewer post"
                          disabled={reviewChoice.firstN <= APPROVAL_FIRST_N_MIN}
                          onClick={() => stepFirstN(-1)}
                          className="w-11 px-0"
                        >
                          <Minus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Input
                          id={firstNId}
                          type="number"
                          inputMode="numeric"
                          min={APPROVAL_FIRST_N_MIN}
                          max={APPROVAL_FIRST_N_MAX}
                          step={1}
                          value={form.firstNDraft ?? String(reviewChoice.firstN)}
                          onChange={(event) => {
                            const raw = event.target.value;
                            form.setFirstNDraft(raw);
                            const next = Number(raw);
                            if (raw.trim() === "" || !Number.isFinite(next)) return;
                            form.setReviewChoice((current) => ({
                              ...current,
                              firstN: clampFirstN(next),
                            }));
                          }}
                          onBlur={() => form.setFirstNDraft(null)}
                          aria-describedby={firstNHelpId}
                          className="w-16 px-2 text-center font-semibold tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          aria-label="One more post"
                          disabled={reviewChoice.firstN >= APPROVAL_FIRST_N_MAX}
                          onClick={() => stepFirstN(1)}
                          className="w-11 px-0"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <p id={firstNHelpId} className={ROW_HELPER}>
                      Each person's posts are reviewed until you have approved this
                      many.
                    </p>
                  </div>
                </ChoiceRow>
                <ChoiceRow
                  compact
                  name={scopeName}
                  value="per_category"
                  checked={reviewChoice.scope === "per_category"}
                  onChange={() => chooseScope("per_category")}
                  label="Selected post types"
                  helper="Posts of the types you check are reviewed."
                >
                  <div className="flex flex-col gap-2.5">
                    <div
                      role="group"
                      aria-label="Post types to review"
                      aria-describedby={categoryHelpId}
                      className="flex flex-wrap gap-2"
                    >
                      {CATEGORY_IDS.map((category) => {
                        const checked = reviewChoice.categories.includes(category);
                        const onlyOne = checked && reviewChoice.categories.length === 1;
                        return (
                          <Chip
                            key={category}
                            type="checkbox"
                            checked={checked}
                            disabled={onlyOne}
                            onChange={() => form.toggleReviewCategory(category)}
                          >
                            {CATEGORY_LABELS[category]}
                          </Chip>
                        );
                      })}
                    </div>
                    <p id={categoryHelpId} className={ROW_HELPER}>
                      Posts that involve a customer are always reviewed when Deliveries
                      is checked. Review follows the post type the salesperson picks.
                    </p>
                  </div>
                </ChoiceRow>
              </div>
            </fieldset>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Team-member disclosure">
        <SwitchRow
          label="Add the disclosure to every post"
          helper={
            <>
              The FTC requires a salesperson posting about your inventory to say they
              work here. This line is added to the top of every post, where it stays
              visible above the &ldquo;see more&rdquo; fold.
            </>
          }
          checked={values.disclosureOn}
          onChange={form.setDisclosureOn}
        />
        {!values.disclosureOn && (
          <p
            role="alert"
            className="mb-4 rounded-sm border border-warning-ink/30 bg-warning-fill px-3 py-2 text-sm text-warning-ink"
          >
            Your team&rsquo;s posts will carry no material-connection disclosure.
            Confirm this with your compliance officer before saving.
          </p>
        )}
        <FieldRow
          label={
            <>
              Wording (optional). Use <code>{"{dealer}"}</code> for your dealership
              name.
            </>
          }
        >
          {(a11y) => (
            <Textarea
              {...a11y}
              value={values.disclosureText}
              onChange={(e) => form.setDisclosureText(e.target.value.slice(0, 280))}
              maxLength={280}
              rows={2}
              disabled={!values.disclosureOn}
              placeholder={DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE}
              fullWidth
            />
          )}
        </FieldRow>
        {/* The sample post shows the line from lg up. */}
        <p className="text-sm text-ink-2 lg:hidden">
          Preview:{" "}
          {buildEmployeeDisclosure({
            name: dealerName,
            employee_disclosure_text: values.disclosureText,
            employee_disclosure_disabled: !values.disclosureOn,
          }) || "No disclosure will be added."}
        </p>
      </SettingsGroup>

      <section
        aria-label="Advanced workflow controls"
        className="flex min-w-0 flex-col"
      >
        <DisclosureRow
          title="Advanced workflow controls"
          open={advancedOpen}
          onToggle={onToggleAdvanced}
          controls={advancedId}
        />
        {/* The class hides it too: `flex` outranks the `[hidden]` preflight rule. */}
        <div
          id={advancedId}
          hidden={!advancedOpen}
          className={cn("flex-col gap-8 pt-6", advancedOpen ? "flex" : "hidden")}
        >
          <SettingsSubgroup
            title="Team feature access"
            description="Turn off anything you do not want your team using."
          >
            {FEATURE_ROWS.map(({ key, label, helper }) => {
              const enabled = values.featurePermissions?.[key]?.team !== false;
              return (
                <SwitchRow
                  key={key}
                  subtle
                  label={label}
                  helper={helper}
                  checked={enabled}
                  onChange={() =>
                    form.setFeaturePermissions((current) => ({
                      ...(current || {}),
                      [key]: {
                        team: !enabled,
                        people: current?.[key]?.people || {},
                      },
                    }))
                  }
                  className="last:border-b"
                />
              );
            })}
          </SettingsSubgroup>

          <SettingsSubgroup
            title="Channels by post type"
            description="Salespeople only see the channels you leave checked. Each post type keeps at least one."
          >
            {(Object.keys(CATEGORY_OUTPUTS) as BrandCategoryId[]).map((category) => {
              const output = CATEGORY_OUTPUTS[category];
              const configured = values.categoryDestinations?.[category];
              const selected = configured?.platformIds || [...output.platformIds];
              return (
                <div
                  key={category}
                  role="group"
                  aria-label={`${CATEGORY_LABELS[category]} channels`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline py-2.5 last:border-b"
                >
                  <span className="w-28 shrink-0 text-base text-ink">
                    {CATEGORY_LABELS[category]}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {output.platformIds.map((platformId) => {
                      const checked = selected.includes(platformId);
                      return (
                        <Chip
                          key={platformId}
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const nextIds = checked
                              ? selected.filter((id) => id !== platformId)
                              : [...selected, platformId];
                            // The last checked channel stays: a post type
                            // with nowhere to go helps nobody.
                            if (nextIds.length === 0) return;
                            form.setCategoryDestinations((current) => ({
                              ...(current || {}),
                              [category]: {
                                platformIds: nextIds,
                                formatIds: configured?.formatIds || [
                                  ...output.formatIds,
                                ],
                                video: configured?.video ?? output.videoAllowed,
                              },
                            }));
                          }}
                        >
                          {DESTINATION_LABELS[platformId] || platformId}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </SettingsSubgroup>
        </div>
      </section>
    </div>
  );
};
